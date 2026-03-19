import { EchoError, ErrorCodes } from "../errors.js";
import { loadConfig } from "../config/store.js";
import logger from "../utils/logger.js";
import { TokenBucket, ConcurrencyLimiter } from "../utils/rateLimit.js";
import { CHAINSCAN_DEFAULTS } from "./constants.js";
import {
  validateAddress,
  validateTxHash,
  validateAddressBatch,
  validateHashBatch,
  validatePagination,
  validateStatsPagination,
  validateTag,
} from "./validation.js";
import type {
  ChainScanTx,
  ChainScanTokenTransfer,
  ChainScanNftTransfer,
  ChainScanBalanceMulti,
  ChainScanTxStatus,
  ChainScanTxReceipt,
  ChainScanContractSource,
  ChainScanContractCreation,
  ChainScanDecodedMethod,
  ChainScanDecodedRaw,
  ChainScanTokenHolderStat,
  ChainScanTokenTransferStat,
  ChainScanUniqueParticipantStat,
  ChainScanTopAddress,
  PaginationOpts,
  StatsPaginationOpts,
} from "./types.js";

// --- Instances ---

const bucket = new TokenBucket(CHAINSCAN_DEFAULTS.RATE_LIMIT_PER_SEC);
const limiter = new ConcurrencyLimiter(CHAINSCAN_DEFAULTS.MAX_CONCURRENT);

// --- Helpers ---

function getBaseUrl(): string {
  return loadConfig().services.chainScanBaseUrl;
}

function getApiKey(): string {
  return process.env.CHAINSCAN_API_KEY ?? "";
}

async function withRetry<T>(fn: () => Promise<T>, maxRetries = CHAINSCAN_DEFAULTS.MAX_RETRIES): Promise<T> {
  let lastError: Error | undefined;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      const msg = lastError.message;
      const isRetryable = msg.includes("429") || /HTTP [5]\d{2}/.test(msg);
      if (!isRetryable || attempt === maxRetries) throw lastError;
      const backoff = Math.min(1000 * 2 ** attempt, 8000) + Math.random() * 500;
      logger.warn(`[ChainScan] Retry ${attempt + 1}/${maxRetries} after ${Math.round(backoff)}ms: ${msg}`);
      await new Promise(resolve => setTimeout(resolve, backoff));
    }
  }
  throw lastError;
}

// --- Etherscan-style fetch: GET /api?module=...&action=... ---

async function fetchEtherscanApi<T>(params: Record<string, string>): Promise<T> {
  await bucket.acquire();
  await limiter.acquire();

  try {
    return await withRetry(async () => {
      const url = new URL(`${getBaseUrl()}${CHAINSCAN_DEFAULTS.API_PATH}`);
      for (const [k, v] of Object.entries(params)) {
        url.searchParams.set(k, v);
      }
      const apiKey = getApiKey();
      if (apiKey) url.searchParams.set("apikey", apiKey);

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), CHAINSCAN_DEFAULTS.TIMEOUT_MS);

      try {
        const res = await fetch(url.toString(), { signal: controller.signal });
        if (!res.ok) {
          if (res.status === 429) {
            throw new EchoError(ErrorCodes.CHAINSCAN_RATE_LIMITED, `ChainScan HTTP 429`);
          }
          throw new EchoError(ErrorCodes.CHAINSCAN_API_ERROR, `ChainScan HTTP ${res.status}`);
        }

        const json = (await res.json()) as { status?: string; message?: string; result?: unknown };

        if (json.status !== "1" && json.message !== "OK") {
          if (json.message === "No transactions found" || json.result === null || json.message === "No records found") {
            return [] as unknown as T;
          }
          throw new EchoError(
            ErrorCodes.CHAINSCAN_API_ERROR,
            json.message || "ChainScan API error",
            "Check the request parameters"
          );
        }

        return json.result as T;
      } catch (err) {
        if (err instanceof EchoError) throw err;
        if (err instanceof Error && err.name === "AbortError") {
          throw new EchoError(
            ErrorCodes.CHAINSCAN_TIMEOUT,
            `ChainScan request timed out after ${CHAINSCAN_DEFAULTS.TIMEOUT_MS}ms`,
            "Try again or check network connectivity"
          );
        }
        throw new EchoError(
          ErrorCodes.CHAINSCAN_API_ERROR,
          err instanceof Error ? err.message : "ChainScan request failed"
        );
      } finally {
        clearTimeout(timer);
      }
    });
  } finally {
    limiter.release();
  }
}

// --- Custom endpoints fetch: GET /util/decode/..., /nft/..., /statistics/... ---

async function fetchCustomApi<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  await bucket.acquire();
  await limiter.acquire();

  try {
    return await withRetry(async () => {
      const url = new URL(`${getBaseUrl()}${path}`);
      for (const [k, v] of Object.entries(params)) {
        url.searchParams.set(k, v);
      }
      const apiKey = getApiKey();
      if (apiKey) url.searchParams.set("apikey", apiKey);

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), CHAINSCAN_DEFAULTS.TIMEOUT_MS);

      try {
        const res = await fetch(url.toString(), { signal: controller.signal });
        if (!res.ok) {
          if (res.status === 429) {
            throw new EchoError(ErrorCodes.CHAINSCAN_RATE_LIMITED, `ChainScan HTTP 429`);
          }
          throw new EchoError(ErrorCodes.CHAINSCAN_API_ERROR, `ChainScan HTTP ${res.status}`);
        }

        const json = await res.json() as Record<string, unknown>;

        // Defensively handle both response formats
        // Etherscan-style: { status: "1", message: "OK", result: T }
        if (typeof json.status === "string" && json.status === "1") {
          return json.result as T;
        }
        // Custom-style: { status: 0, message: "success", result: T }
        if (typeof json.status === "number" && json.status === 0) {
          return json.result as T;
        }
        // NFT/data-style: { code: 0, message: "...", data: T }
        if (typeof json.code === "number" && json.code === 0 && json.data !== undefined) {
          return json.data as T;
        }
        // Fallback: if result is present, return it
        if (json.result !== undefined && json.result !== null) {
          return json.result as T;
        }
        // Array response (some endpoints return raw arrays)
        if (Array.isArray(json)) {
          return json as unknown as T;
        }

        throw new EchoError(
          ErrorCodes.CHAINSCAN_INVALID_RESPONSE,
          `Unexpected ChainScan response format`,
          `status=${String(json.status)}, message=${String(json.message)}`
        );
      } catch (err) {
        if (err instanceof EchoError) throw err;
        if (err instanceof Error && err.name === "AbortError") {
          throw new EchoError(
            ErrorCodes.CHAINSCAN_TIMEOUT,
            `ChainScan request timed out after ${CHAINSCAN_DEFAULTS.TIMEOUT_MS}ms`,
            "Try again or check network connectivity"
          );
        }
        throw new EchoError(
          ErrorCodes.CHAINSCAN_API_ERROR,
          err instanceof Error ? err.message : "ChainScan request failed"
        );
      } finally {
        clearTimeout(timer);
      }
    });
  } finally {
    limiter.release();
  }
}

// --- Public API ---

export const chainscanClient = {
  // === Account ===

  getBalance(address: string, tag?: string): Promise<string> {
    const addr = validateAddress(address);
    const validTag = validateTag(tag);
    return fetchEtherscanApi<string>({
      module: "account",
      action: "balance",
      address: addr.toLowerCase(),
      tag: validTag,
    });
  },

  getBalanceMulti(addresses: string[], tag?: string): Promise<ChainScanBalanceMulti[]> {
    const validated = validateAddressBatch(addresses, CHAINSCAN_DEFAULTS.MAX_BATCH_BALANCE);
    const validTag = validateTag(tag);
    return fetchEtherscanApi<ChainScanBalanceMulti[]>({
      module: "account",
      action: "balancemulti",
      address: validated.map(a => a.toLowerCase()).join(","),
      tag: validTag,
    });
  },

  getTransactions(address: string, opts?: PaginationOpts): Promise<ChainScanTx[]> {
    const addr = validateAddress(address);
    const pag = validatePagination(opts);
    return fetchEtherscanApi<ChainScanTx[]>({
      module: "account",
      action: "txlist",
      address: addr.toLowerCase(),
      startblock: pag.startblock ?? "0",
      endblock: pag.endblock ?? "99999999",
      page: String(pag.page),
      offset: String(pag.offset),
      sort: pag.sort,
    });
  },

  getTokenTransfers(address: string, opts?: PaginationOpts & { contractaddress?: string }): Promise<ChainScanTokenTransfer[]> {
    const addr = validateAddress(address);
    const pag = validatePagination(opts);
    const params: Record<string, string> = {
      module: "account",
      action: "tokentx",
      address: addr.toLowerCase(),
      startblock: pag.startblock ?? "0",
      endblock: pag.endblock ?? "99999999",
      page: String(pag.page),
      offset: String(pag.offset),
      sort: pag.sort,
    };
    if (opts?.contractaddress) {
      params.contractaddress = validateAddress(opts.contractaddress, "contractaddress").toLowerCase();
    }
    return fetchEtherscanApi<ChainScanTokenTransfer[]>(params);
  },

  getNftTransfers(address: string, opts?: PaginationOpts & { contractaddress?: string }): Promise<ChainScanNftTransfer[]> {
    const addr = validateAddress(address);
    const pag = validatePagination(opts);
    const params: Record<string, string> = {
      module: "account",
      action: "tokennfttx",
      address: addr.toLowerCase(),
      startblock: pag.startblock ?? "0",
      endblock: pag.endblock ?? "99999999",
      page: String(pag.page),
      offset: String(pag.offset),
      sort: pag.sort,
    };
    if (opts?.contractaddress) {
      params.contractaddress = validateAddress(opts.contractaddress, "contractaddress").toLowerCase();
    }
    return fetchEtherscanApi<ChainScanNftTransfer[]>(params);
  },

  getTokenBalance(address: string, contractAddress: string): Promise<string> {
    const addr = validateAddress(address);
    const contract = validateAddress(contractAddress, "contractAddress");
    return fetchEtherscanApi<string>({
      module: "account",
      action: "tokenbalance",
      address: addr.toLowerCase(),
      contractaddress: contract.toLowerCase(),
      tag: "latest",
    });
  },

  // === Transaction verification ===

  getTxStatus(txHash: string): Promise<ChainScanTxStatus> {
    const hash = validateTxHash(txHash);
    return fetchEtherscanApi<ChainScanTxStatus>({
      module: "transaction",
      action: "getstatus",
      txhash: hash,
    });
  },

  getTxReceiptStatus(txHash: string): Promise<ChainScanTxReceipt> {
    const hash = validateTxHash(txHash);
    return fetchEtherscanApi<ChainScanTxReceipt>({
      module: "transaction",
      action: "gettxreceiptstatus",
      txhash: hash,
    });
  },

  // === Contract intel ===

  getContractAbi(address: string): Promise<string> {
    const addr = validateAddress(address);
    return fetchEtherscanApi<string>({
      module: "contract",
      action: "getabi",
      address: addr.toLowerCase(),
    });
  },

  getContractSource(address: string): Promise<ChainScanContractSource[]> {
    const addr = validateAddress(address);
    return fetchEtherscanApi<ChainScanContractSource[]>({
      module: "contract",
      action: "getsourcecode",
      address: addr.toLowerCase(),
    });
  },

  getContractCreation(addresses: string[]): Promise<ChainScanContractCreation[]> {
    const validated = validateAddressBatch(addresses, CHAINSCAN_DEFAULTS.MAX_BATCH_ADDRESSES);
    return fetchEtherscanApi<ChainScanContractCreation[]>({
      module: "contract",
      action: "getcontractcreation",
      contractaddresses: validated.map(a => a.toLowerCase()).join(","),
    });
  },

  // === Decode ===

  decodeByHashes(hashes: string[]): Promise<ChainScanDecodedMethod[]> {
    const validated = validateHashBatch(hashes, CHAINSCAN_DEFAULTS.MAX_BATCH_DECODE);
    return fetchCustomApi<ChainScanDecodedMethod[]>(
      "/util/decode/method",
      { hashes: validated.join(",") }
    );
  },

  decodeRaw(contracts: string[], inputs: string[]): Promise<ChainScanDecodedRaw[]> {
    if (contracts.length !== inputs.length) {
      throw new EchoError(
        ErrorCodes.INVALID_AMOUNT,
        `contracts (${contracts.length}) and inputs (${inputs.length}) must have same length`
      );
    }
    const validatedContracts = validateAddressBatch(contracts, CHAINSCAN_DEFAULTS.MAX_BATCH_DECODE);
    return fetchCustomApi<ChainScanDecodedRaw[]>(
      "/util/decode/method/raw",
      {
        contracts: validatedContracts.map(a => a.toLowerCase()).join(","),
        inputs: inputs.join(","),
      }
    );
  },

  // === Token supply ===

  getTokenSupply(contractAddress: string): Promise<string> {
    const addr = validateAddress(contractAddress, "contractAddress");
    return fetchEtherscanApi<string>({
      module: "stats",
      action: "tokensupply",
      contractaddress: addr.toLowerCase(),
    });
  },

  // === Meme coin intel (statistics endpoints) ===

  async getTokenHolderStats(contract: string, opts?: StatsPaginationOpts): Promise<ChainScanTokenHolderStat[]> {
    const addr = validateAddress(contract, "contract");
    const pag = validateStatsPagination(opts);
    const params: Record<string, string> = {
      contract: addr.toLowerCase(),
      skip: String(pag.skip),
      limit: String(pag.limit),
      sort: pag.sort.toUpperCase(),
    };
    if (pag.minTimestamp) params.minTimestamp = pag.minTimestamp;
    if (pag.maxTimestamp) params.maxTimestamp = pag.maxTimestamp;
    const res = await fetchCustomApi<{ list: ChainScanTokenHolderStat[] }>("/statistics/token/holder", params);
    return res.list;
  },

  async getTokenTransferStats(contract: string, opts?: StatsPaginationOpts): Promise<ChainScanTokenTransferStat[]> {
    const addr = validateAddress(contract, "contract");
    const pag = validateStatsPagination(opts);
    const params: Record<string, string> = {
      contract: addr.toLowerCase(),
      skip: String(pag.skip),
      limit: String(pag.limit),
      sort: pag.sort.toUpperCase(),
    };
    if (pag.minTimestamp) params.minTimestamp = pag.minTimestamp;
    if (pag.maxTimestamp) params.maxTimestamp = pag.maxTimestamp;
    const res = await fetchCustomApi<{ list: ChainScanTokenTransferStat[] }>("/statistics/token/transfer", params);
    return res.list;
  },

  async getTokenUniqueParticipants(contract: string, opts?: StatsPaginationOpts): Promise<ChainScanUniqueParticipantStat[]> {
    const addr = validateAddress(contract, "contract");
    const pag = validateStatsPagination(opts);
    const params: Record<string, string> = {
      contract: addr.toLowerCase(),
      skip: String(pag.skip),
      limit: String(pag.limit),
      sort: pag.sort.toUpperCase(),
    };
    if (pag.minTimestamp) params.minTimestamp = pag.minTimestamp;
    if (pag.maxTimestamp) params.maxTimestamp = pag.maxTimestamp;
    const res = await fetchCustomApi<{ list: ChainScanUniqueParticipantStat[] }>("/statistics/token/unique/participant", params);
    return res.list;
  },

  async getTopTokenSenders(spanType: "24h" | "3d" | "7d" = "24h"): Promise<ChainScanTopAddress[]> {
    const res = await fetchCustomApi<{ list: ChainScanTopAddress[] }>("/statistics/top/token/sender", { spanType });
    return res.list;
  },

  async getTopTokenReceivers(spanType: "24h" | "3d" | "7d" = "24h"): Promise<ChainScanTopAddress[]> {
    const res = await fetchCustomApi<{ list: ChainScanTopAddress[] }>("/statistics/top/token/receiver", { spanType });
    return res.list;
  },

  async getTopTokenParticipants(spanType: "24h" | "3d" | "7d" = "24h"): Promise<ChainScanTopAddress[]> {
    const res = await fetchCustomApi<{ list: ChainScanTopAddress[] }>("/statistics/top/token/participant", { spanType });
    return res.list;
  },
};

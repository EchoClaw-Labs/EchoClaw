import { isAddress, getAddress, type Address } from "viem";
import { EchoError, ErrorCodes } from "../errors.js";
import { CHAINSCAN_DEFAULTS } from "./constants.js";

const TX_HASH_RE = /^0x[0-9a-fA-F]{64}$/;

const VALID_TAGS = new Set([
  "latest_state",
  "latest_mined",
  "latest_finalized",
  "latest_confirmed",
  "latest_checkpoint",
  "earliest",
]);

export function validateAddress(input: string, label = "address"): Address {
  if (!input) {
    throw new EchoError(
      ErrorCodes.INVALID_ADDRESS,
      `${label} is required`,
      "Provide a valid Ethereum address (0x...)"
    );
  }
  if (!isAddress(input)) {
    throw new EchoError(
      ErrorCodes.INVALID_ADDRESS,
      `Invalid ${label}: ${input}`,
      "Must be a valid Ethereum address (0x + 40 hex chars)"
    );
  }
  return getAddress(input);
}

export function validateTxHash(input: string): string {
  if (!input) {
    throw new EchoError(
      ErrorCodes.INVALID_AMOUNT,
      "Transaction hash is required",
      "Provide a valid tx hash (0x + 64 hex chars)"
    );
  }
  if (!TX_HASH_RE.test(input)) {
    throw new EchoError(
      ErrorCodes.INVALID_AMOUNT,
      `Invalid transaction hash: ${input}`,
      "Must be 0x followed by 64 hex characters"
    );
  }
  return input.toLowerCase();
}

export function validateAddressBatch(input: string[], maxSize: number): Address[] {
  if (!input.length) {
    throw new EchoError(
      ErrorCodes.INVALID_ADDRESS,
      "At least one address is required"
    );
  }
  if (input.length > maxSize) {
    throw new EchoError(
      ErrorCodes.INVALID_ADDRESS,
      `Too many addresses: ${input.length} (max ${maxSize})`,
      `Provide at most ${maxSize} addresses`
    );
  }
  return input.map((addr, i) => validateAddress(addr, `address[${i}]`));
}

export function validateHashBatch(input: string[], maxSize: number): string[] {
  if (!input.length) {
    throw new EchoError(
      ErrorCodes.INVALID_AMOUNT,
      "At least one hash is required"
    );
  }
  if (input.length > maxSize) {
    throw new EchoError(
      ErrorCodes.INVALID_AMOUNT,
      `Too many hashes: ${input.length} (max ${maxSize})`,
      `Provide at most ${maxSize} hashes`
    );
  }
  return input.map(h => validateTxHash(h));
}

export interface ValidatedPagination {
  page: number;
  offset: number;
  sort: "asc" | "desc";
  startblock?: string;
  endblock?: string;
}

export function validatePagination(opts?: {
  page?: number;
  offset?: number;
  sort?: string;
  startblock?: number;
  endblock?: number;
}): ValidatedPagination {
  const page = opts?.page ?? 1;
  const offset = opts?.offset ?? 25;
  const sort = opts?.sort ?? "desc";

  if (page < 1) {
    throw new EchoError(
      ErrorCodes.INVALID_AMOUNT,
      `Invalid page: ${page}`,
      "Page must be >= 1"
    );
  }

  if (offset < 1 || offset > CHAINSCAN_DEFAULTS.MAX_PAGE_OFFSET) {
    throw new EchoError(
      ErrorCodes.INVALID_AMOUNT,
      `Invalid offset: ${offset}`,
      `Offset must be 1-${CHAINSCAN_DEFAULTS.MAX_PAGE_OFFSET}`
    );
  }

  if (sort !== "asc" && sort !== "desc") {
    throw new EchoError(
      ErrorCodes.INVALID_AMOUNT,
      `Invalid sort: ${sort}`,
      'Sort must be "asc" or "desc"'
    );
  }

  const result: ValidatedPagination = { page, offset, sort };
  if (opts?.startblock !== undefined) result.startblock = String(opts.startblock);
  if (opts?.endblock !== undefined) result.endblock = String(opts.endblock);
  return result;
}

export interface ValidatedStatsPagination {
  skip: number;
  limit: number;
  sort: "asc" | "desc";
  minTimestamp?: string;
  maxTimestamp?: string;
}

export function validateStatsPagination(opts?: {
  skip?: number;
  limit?: number;
  sort?: string;
  minTimestamp?: number;
  maxTimestamp?: number;
}): ValidatedStatsPagination {
  const skip = opts?.skip ?? 0;
  const limit = opts?.limit ?? 30;
  const sort = opts?.sort ?? "desc";

  if (skip < 0 || skip > CHAINSCAN_DEFAULTS.MAX_SKIP) {
    throw new EchoError(
      ErrorCodes.INVALID_AMOUNT,
      `Invalid skip: ${skip}`,
      `Skip must be 0-${CHAINSCAN_DEFAULTS.MAX_SKIP}`
    );
  }

  if (limit < 1 || limit > CHAINSCAN_DEFAULTS.MAX_STATS_LIMIT) {
    throw new EchoError(
      ErrorCodes.INVALID_AMOUNT,
      `Invalid limit: ${limit}`,
      `Limit must be 1-${CHAINSCAN_DEFAULTS.MAX_STATS_LIMIT}`
    );
  }

  if (sort !== "asc" && sort !== "desc") {
    throw new EchoError(
      ErrorCodes.INVALID_AMOUNT,
      `Invalid sort: ${sort}`,
      'Sort must be "asc" or "desc"'
    );
  }

  const result: ValidatedStatsPagination = { skip, limit, sort };
  if (opts?.minTimestamp !== undefined) result.minTimestamp = String(opts.minTimestamp);
  if (opts?.maxTimestamp !== undefined) result.maxTimestamp = String(opts.maxTimestamp);
  return result;
}

export function validateTag(tag?: string): string {
  if (!tag) return "latest_state";
  if (!VALID_TAGS.has(tag)) {
    throw new EchoError(
      ErrorCodes.INVALID_AMOUNT,
      `Invalid tag: ${tag}`,
      `Valid tags: ${[...VALID_TAGS].join(", ")}`
    );
  }
  return tag;
}

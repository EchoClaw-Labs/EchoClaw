import { loadConfig } from "../config/store.js";
import { EchoError, ErrorCodes } from "../errors.js";
import { fetchWithTimeout } from "../utils/http.js";
import type {
  AutocompleteResponse,
  DepositBuildRequest,
  DepositPlan,
  KhalaniChain,
  KhalaniOrder,
  KhalaniToken,
  OrdersResponse,
  QuoteRequest,
  QuoteStreamRoute,
  QuoteResponse,
  SubmitRequest,
  SubmitResponse,
  TokenSearchResponse,
} from "./types.js";
import { mapKhalaniError } from "./errors.js";
import {
  parseKhalaniErrorBody,
  validateAutocompleteResponse,
  validateChainsResponse,
  validateDepositPlan,
  validateOrderResponse,
  validateOrdersResponse,
  validateQuoteResponse,
  validateQuoteStreamRoute,
  validateSubmitResponse,
  validateTokenSearchResponse,
  validateTokensResponse,
} from "./validation.js";

interface RequestOptions {
  method?: "GET" | "POST" | "PUT";
  query?: Record<string, string | undefined>;
  body?: unknown;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function mapTransportError(err: unknown): never {
  if (err instanceof EchoError && err.code.startsWith("KHALANI_")) {
    throw err;
  }
  if (err instanceof EchoError && err.code === ErrorCodes.HTTP_TIMEOUT) {
    throw new EchoError(ErrorCodes.KHALANI_TIMEOUT, err.message, err.hint);
  }
  if (err instanceof EchoError && err.code === ErrorCodes.HTTP_REQUEST_FAILED) {
    throw new EchoError(ErrorCodes.KHALANI_API_ERROR, err.message, err.hint);
  }
  throw err;
}

export class KhalaniClient {
  constructor(private readonly baseUrl: string) {}

  private buildUrl(path: string, query?: Record<string, string | undefined>): string {
    const url = new URL(path, this.baseUrl.endsWith("/") ? this.baseUrl : `${this.baseUrl}/`);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value.length > 0) {
          url.searchParams.set(key, value);
        }
      }
    }
    return url.toString();
  }

  private async request<T>(
    path: string,
    validator: (raw: unknown) => T,
    options: RequestOptions = {},
  ): Promise<T> {
    try {
      const response = await fetchWithTimeout(this.buildUrl(path, options.query), {
        method: options.method ?? "GET",
        headers: options.body === undefined ? undefined : { "Content-Type": "application/json" },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      });

      if (!response.ok) {
        const rawError = await readJson(response);
        const errorBody = parseKhalaniErrorBody(rawError);
        throw mapKhalaniError(response.status, errorBody);
      }

      const raw = await readJson(response);
      return validator(raw);
    } catch (err) {
      mapTransportError(err);
    }
  }

  getChains(): Promise<KhalaniChain[]> {
    return this.request("/v1/chains", validateChainsResponse);
  }

  getTopTokens(chainIds?: number[]): Promise<KhalaniToken[]> {
    return this.request(
      "/v1/tokens",
      validateTokensResponse,
      { query: { chainIds: chainIds?.join(",") } },
    );
  }

  searchTokens(query: string, chainIds?: number[]): Promise<TokenSearchResponse> {
    return this.request(
      "/v1/tokens/search",
      validateTokenSearchResponse,
      {
        query: {
          q: query,
          chainIds: chainIds?.join(","),
        },
      },
    );
  }

  autocompleteToken(keyword: string, opts?: { chainIds?: number[]; limit?: number }): Promise<AutocompleteResponse> {
    return this.request(
      `/v1/tokens/autocomplete/${encodeURIComponent(keyword)}`,
      validateAutocompleteResponse,
      {
        query: {
          chainIds: opts?.chainIds?.join(","),
          limit: opts?.limit != null ? String(opts.limit) : undefined,
        },
      },
    );
  }

  getTokenBalances(address: string, chainIds?: number[]): Promise<KhalaniToken[]> {
    return this.request(
      `/v1/tokens/balances/${encodeURIComponent(address)}`,
      validateTokensResponse,
      { query: { chainIds: chainIds?.join(",") } },
    );
  }

  getQuotes(request: QuoteRequest, opts?: { routes?: string[] }): Promise<QuoteResponse> {
    return this.request(
      "/v1/quotes",
      validateQuoteResponse,
      {
        method: "POST",
        query: { routes: opts?.routes?.join(",") },
        body: request,
      },
    );
  }

  async *streamQuotes(request: QuoteRequest, opts?: { routes?: string[] }): AsyncGenerator<QuoteStreamRoute> {
    try {
      const response = await fetchWithTimeout(
        this.buildUrl("/v1/quotes", {
          mode: "stream",
          routes: opts?.routes?.join(","),
        }),
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/x-ndjson",
          },
          body: JSON.stringify(request),
        },
      );

      if (!response.ok) {
        const rawError = await readJson(response);
        const errorBody = parseKhalaniErrorBody(rawError);
        throw mapKhalaniError(response.status, errorBody);
      }

      if (!response.body) {
        throw new EchoError(ErrorCodes.KHALANI_API_ERROR, "Khalani stream response did not include a body.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });

        let newlineIndex = buffer.indexOf("\n");
        while (newlineIndex !== -1) {
          const line = buffer.slice(0, newlineIndex).trim();
          buffer = buffer.slice(newlineIndex + 1);
          if (line.length > 0) {
            let parsed: unknown;
            try {
              parsed = JSON.parse(line);
            } catch {
              throw new EchoError(ErrorCodes.KHALANI_API_ERROR, `Invalid Khalani NDJSON line: ${line}`);
            }
            yield validateQuoteStreamRoute(parsed);
          }
          newlineIndex = buffer.indexOf("\n");
        }

        if (done) {
          const trailing = buffer.trim();
          if (trailing.length > 0) {
            let parsed: unknown;
            try {
              parsed = JSON.parse(trailing);
            } catch {
              throw new EchoError(ErrorCodes.KHALANI_API_ERROR, `Invalid Khalani NDJSON line: ${trailing}`);
            }
            yield validateQuoteStreamRoute(parsed);
          }
          break;
        }
      }
    } catch (err) {
      mapTransportError(err);
    }
  }

  buildDeposit(request: DepositBuildRequest): Promise<DepositPlan> {
    return this.request(
      "/v1/deposit/build",
      validateDepositPlan,
      {
        method: "POST",
        body: request,
      },
    );
  }

  submitDeposit(request: SubmitRequest): Promise<SubmitResponse> {
    return this.request(
      "/v1/deposit/submit",
      validateSubmitResponse,
      {
        method: "PUT",
        body: request,
      },
    );
  }

  getOrders(
    address: string,
    opts?: {
      limit?: number;
      cursor?: number;
      fromChainId?: number;
      toChainId?: number;
      orderIds?: string;
      txHashSearch?: string;
    },
  ): Promise<OrdersResponse> {
    return this.request(
      `/v1/orders/${encodeURIComponent(address)}`,
      validateOrdersResponse,
      {
        query: {
          limit: opts?.limit != null ? String(opts.limit) : undefined,
          cursor: opts?.cursor != null ? String(opts.cursor) : undefined,
          fromChainId: opts?.fromChainId != null ? String(opts.fromChainId) : undefined,
          toChainId: opts?.toChainId != null ? String(opts.toChainId) : undefined,
          orderIds: opts?.orderIds,
          txHashSearch: opts?.txHashSearch,
        },
      },
    );
  }

  getOrderById(orderId: string): Promise<KhalaniOrder> {
    return this.request(`/v1/orders/by-id/${encodeURIComponent(orderId)}`, validateOrderResponse);
  }
}

let cachedClient: KhalaniClient | null = null;
let cachedBaseUrl: string | null = null;

export function getKhalaniClient(): KhalaniClient {
  const baseUrl = loadConfig().services.khalaniApiUrl;
  if (cachedClient && cachedBaseUrl === baseUrl) {
    return cachedClient;
  }

  cachedClient = new KhalaniClient(baseUrl);
  cachedBaseUrl = baseUrl;
  return cachedClient;
}

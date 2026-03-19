import { EchoError, ErrorCodes } from "../errors.js";
import type {
  Approval,
  AutocompleteResponse,
  DepositPlan,
  KhalaniChain,
  KhalaniErrorBody,
  KhalaniOrder,
  KhalaniToken,
  OrdersResponse,
  QuoteStreamRoute,
  QuoteResponse,
  SubmitResponse,
  TokenSearchResponse,
} from "./types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new EchoError(ErrorCodes.KHALANI_API_ERROR, `Invalid Khalani response: missing ${field}`);
  }
  return value;
}

function asNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    throw new EchoError(ErrorCodes.KHALANI_API_ERROR, `Invalid Khalani response: missing ${field}`);
  }
  return value;
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

function parseNativeCurrencyName(nativeCurrency: Record<string, unknown>): string {
  const name = asOptionalString(nativeCurrency.name);
  if (name) {
    return name;
  }

  // Live Khalani /v1/chains can omit Solana's nativeCurrency.name even though docs show it as required.
  return asString(nativeCurrency.symbol, "chain.nativeCurrency.symbol");
}

function parseChain(raw: unknown): KhalaniChain {
  if (!isRecord(raw)) {
    throw new EchoError(ErrorCodes.KHALANI_API_ERROR, "Invalid Khalani response: chain must be an object");
  }

  const type = asString(raw.type, "chain.type");
  if (type !== "eip155" && type !== "solana") {
    throw new EchoError(ErrorCodes.KHALANI_API_ERROR, `Invalid Khalani response: unsupported chain type ${type}`);
  }

  const nativeCurrency = isRecord(raw.nativeCurrency) ? raw.nativeCurrency : {};
  const rpcUrls = isRecord(raw.rpcUrls) ? raw.rpcUrls : undefined;
  const blockExplorers = isRecord(raw.blockExplorers) ? raw.blockExplorers : undefined;

  return {
    type,
    id: asNumber(raw.id, "chain.id"),
    name: asString(raw.name, "chain.name"),
    nativeCurrency: {
      name: parseNativeCurrencyName(nativeCurrency),
      symbol: asString(nativeCurrency.symbol, "chain.nativeCurrency.symbol"),
      decimals: asNumber(nativeCurrency.decimals, "chain.nativeCurrency.decimals"),
    },
    rpcUrls: rpcUrls as KhalaniChain["rpcUrls"],
    blockExplorers: blockExplorers as KhalaniChain["blockExplorers"],
  };
}

function parseToken(raw: unknown): KhalaniToken {
  if (!isRecord(raw)) {
    throw new EchoError(ErrorCodes.KHALANI_API_ERROR, "Invalid Khalani response: token must be an object");
  }

  return {
    address: asString(raw.address, "token.address"),
    chainId: asNumber(raw.chainId, "token.chainId"),
    name: asString(raw.name, "token.name"),
    symbol: asString(raw.symbol, "token.symbol"),
    decimals: asNumber(raw.decimals, "token.decimals"),
    logoURI: asOptionalString(raw.logoURI),
    extensions: isRecord(raw.extensions) ? raw.extensions as KhalaniToken["extensions"] : undefined,
  };
}

function parseTokenMeta(raw: unknown): KhalaniOrder["fromTokenMeta"] {
  if (!isRecord(raw)) return null;
  if (typeof raw.symbol !== "string" || typeof raw.decimals !== "number") {
    return null;
  }

  return {
    symbol: raw.symbol,
    decimals: raw.decimals,
    logoURI: asOptionalString(raw.logoURI),
  };
}

function parseOrder(raw: unknown): KhalaniOrder {
  if (!isRecord(raw)) {
    throw new EchoError(ErrorCodes.KHALANI_API_ERROR, "Invalid Khalani response: order must be an object");
  }

  return {
    id: asString(raw.id, "order.id"),
    type: asString(raw.type, "order.type"),
    quoteId: asString(raw.quoteId, "order.quoteId"),
    routeId: asString(raw.routeId, "order.routeId"),
    fromChainId: asNumber(raw.fromChainId, "order.fromChainId"),
    fromToken: asString(raw.fromToken, "order.fromToken"),
    toChainId: asNumber(raw.toChainId, "order.toChainId"),
    toToken: asString(raw.toToken, "order.toToken"),
    srcAmount: asString(raw.srcAmount, "order.srcAmount"),
    destAmount: asString(raw.destAmount, "order.destAmount"),
    status: asString(raw.status, "order.status") as KhalaniOrder["status"],
    author: asString(raw.author, "order.author"),
    recipient: typeof raw.recipient === "string" ? raw.recipient : null,
    refundTo: typeof raw.refundTo === "string" ? raw.refundTo : null,
    depositTxHash: asString(raw.depositTxHash, "order.depositTxHash"),
    externalOrderId: asOptionalString(raw.externalOrderId),
    createdAt: asString(raw.createdAt, "order.createdAt"),
    updatedAt: asString(raw.updatedAt, "order.updatedAt"),
    tradeType: asString(raw.tradeType, "order.tradeType") as KhalaniOrder["tradeType"],
    stepsCompleted: asStringArray(raw.stepsCompleted),
    transactions: isRecord(raw.transactions) ? raw.transactions as KhalaniOrder["transactions"] : {},
    fromTokenMeta: parseTokenMeta(raw.fromTokenMeta),
    toTokenMeta: parseTokenMeta(raw.toTokenMeta),
  };
}

export function parseKhalaniErrorBody(raw: unknown): KhalaniErrorBody | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.message !== "string" || typeof raw.name !== "string") return null;
  return {
    message: raw.message,
    name: raw.name,
    details: Array.isArray(raw.details) || isRecord(raw.details) ? raw.details as KhalaniErrorBody["details"] : undefined,
  };
}

export function validateChainsResponse(raw: unknown): KhalaniChain[] {
  if (!Array.isArray(raw)) {
    throw new EchoError(ErrorCodes.KHALANI_API_ERROR, "Invalid Khalani response: expected chains array");
  }
  return raw.map(parseChain);
}

export function validateTokensResponse(raw: unknown): KhalaniToken[] {
  if (!Array.isArray(raw)) {
    throw new EchoError(ErrorCodes.KHALANI_API_ERROR, "Invalid Khalani response: expected token array");
  }
  return raw.map(parseToken);
}

export function validateTokenSearchResponse(raw: unknown): TokenSearchResponse {
  if (!isRecord(raw) || !Array.isArray(raw.data)) {
    throw new EchoError(ErrorCodes.KHALANI_API_ERROR, "Invalid Khalani response: expected token search wrapper");
  }
  return { data: raw.data.map(parseToken) };
}

export function validateAutocompleteResponse(raw: unknown): AutocompleteResponse {
  if (!isRecord(raw) || !Array.isArray(raw.data)) {
    throw new EchoError(ErrorCodes.KHALANI_API_ERROR, "Invalid Khalani response: expected autocomplete wrapper");
  }

  return {
    data: raw.data.map((entry) => {
      if (!isRecord(entry)) {
        throw new EchoError(ErrorCodes.KHALANI_API_ERROR, "Invalid Khalani response: autocomplete entry must be an object");
      }
      return {
        description: asString(entry.description, "autocomplete.description"),
        chain: parseChain(entry.chain),
        token: parseToken(entry.token),
        amount: asOptionalString(entry.amount),
        usdAmount: asOptionalString(entry.usdAmount),
      };
    }),
    parsed: isRecord(raw.parsed) ? raw.parsed : undefined,
    nextSlots: Array.isArray(raw.nextSlots) ? raw.nextSlots.filter((slot): slot is string => typeof slot === "string") : undefined,
  };
}

export function validateQuoteResponse(raw: unknown): QuoteResponse {
  if (!isRecord(raw) || !Array.isArray(raw.routes)) {
    throw new EchoError(ErrorCodes.KHALANI_API_ERROR, "Invalid Khalani response: expected quote routes");
  }

  return {
    quoteId: asString(raw.quoteId, "quote.quoteId"),
    routes: raw.routes.map((entry) => {
      if (!isRecord(entry) || !isRecord(entry.quote)) {
        throw new EchoError(ErrorCodes.KHALANI_API_ERROR, "Invalid Khalani response: route must include quote");
      }
      return {
        routeId: asString(entry.routeId, "route.routeId"),
        type: asString(entry.type, "route.type"),
        icon: asOptionalString(entry.icon),
        exactOutMethod: asOptionalString(entry.exactOutMethod),
        depositMethods: asStringArray(entry.depositMethods) as QuoteResponse["routes"][number]["depositMethods"],
        quote: {
          amountIn: asString(entry.quote.amountIn, "route.quote.amountIn"),
          amountOut: asString(entry.quote.amountOut, "route.quote.amountOut"),
          expectedDurationSeconds: asNumber(entry.quote.expectedDurationSeconds, "route.quote.expectedDurationSeconds"),
          validBefore: asNumber(entry.quote.validBefore, "route.quote.validBefore"),
          quoteExpiresAt: typeof entry.quote.quoteExpiresAt === "number" ? entry.quote.quoteExpiresAt : undefined,
          estimatedGas: asOptionalString(entry.quote.estimatedGas),
          tags: asStringArray(entry.quote.tags),
        },
      };
    }),
  };
}

export function validateQuoteStreamRoute(raw: unknown): QuoteStreamRoute {
  if (!isRecord(raw) || !isRecord(raw.quote)) {
    throw new EchoError(ErrorCodes.KHALANI_API_ERROR, "Invalid Khalani stream response: expected route object");
  }

  return {
    quoteId: asString(raw.quoteId, "stream.quoteId"),
    routeId: asString(raw.routeId, "stream.routeId"),
    type: asString(raw.type, "stream.type"),
    icon: asOptionalString(raw.icon),
    exactOutMethod: asOptionalString(raw.exactOutMethod),
    depositMethods: asStringArray(raw.depositMethods) as QuoteStreamRoute["depositMethods"],
    quote: {
      amountIn: asString(raw.quote.amountIn, "stream.quote.amountIn"),
      amountOut: asString(raw.quote.amountOut, "stream.quote.amountOut"),
      expectedDurationSeconds: asNumber(raw.quote.expectedDurationSeconds, "stream.quote.expectedDurationSeconds"),
      validBefore: asNumber(raw.quote.validBefore, "stream.quote.validBefore"),
      quoteExpiresAt: typeof raw.quote.quoteExpiresAt === "number" ? raw.quote.quoteExpiresAt : undefined,
      estimatedGas: asOptionalString(raw.quote.estimatedGas),
      tags: asStringArray(raw.quote.tags),
    },
  };
}

export function validateDepositPlan(raw: unknown): DepositPlan {
  if (!isRecord(raw)) {
    throw new EchoError(ErrorCodes.KHALANI_API_ERROR, "Invalid Khalani response: expected deposit plan");
  }

  const kind = asString(raw.kind, "deposit.kind");
  if (kind === "CONTRACT_CALL") {
    const approvals = Array.isArray(raw.approvals)
      ? raw.approvals.map((item, idx): Approval => {
          if (!isRecord(item)) {
            throw new EchoError(ErrorCodes.KHALANI_API_ERROR, `Invalid Khalani response: approval[${idx}] must be an object`);
          }
          const type = asString(item.type, `approval[${idx}].type`);
          if (type === "eip1193_request") {
            const request = isRecord(item.request) ? item.request : {};
            return {
              type,
              request: {
                method: asString(request.method, `approval[${idx}].request.method`),
                params: Array.isArray(request.params) ? request.params : undefined,
              },
              waitForReceipt: item.waitForReceipt === true ? true : undefined,
              deposit: item.deposit === true ? true : undefined,
            };
          }
          if (type === "solana_sendTransaction") {
            return {
              type,
              transaction: asString(item.transaction, `approval[${idx}].transaction`),
              deposit: item.deposit === true ? true : undefined,
            };
          }
          throw new EchoError(ErrorCodes.KHALANI_API_ERROR, `Invalid Khalani response: unsupported approval type ${type}`);
        })
      : [];
    return { kind, approvals };
  }
  if (kind === "PERMIT2") {
    if (!isRecord(raw.permit) || !isRecord(raw.transferDetails)) {
      throw new EchoError(ErrorCodes.KHALANI_API_ERROR, "Invalid Khalani response: malformed PERMIT2 plan");
    }
    return {
      kind,
      permit: raw.permit,
      transferDetails: raw.transferDetails,
    };
  }
  if (kind === "TRANSFER") {
    return {
      kind,
      depositAddress: asString(raw.depositAddress, "deposit.depositAddress"),
      amount: asString(raw.amount, "deposit.amount"),
      token: asString(raw.token, "deposit.token"),
      chainId: asNumber(raw.chainId, "deposit.chainId"),
      memo: asOptionalString(raw.memo),
      expiresAt: typeof raw.expiresAt === "number" ? raw.expiresAt : undefined,
    };
  }

  throw new EchoError(ErrorCodes.KHALANI_API_ERROR, `Invalid Khalani response: unsupported deposit kind ${kind}`);
}

export function validateSubmitResponse(raw: unknown): SubmitResponse {
  if (!isRecord(raw)) {
    throw new EchoError(ErrorCodes.KHALANI_API_ERROR, "Invalid Khalani response: expected submit response");
  }
  return {
    orderId: asString(raw.orderId, "submit.orderId"),
    txHash: asString(raw.txHash, "submit.txHash"),
  };
}

export function validateOrdersResponse(raw: unknown): OrdersResponse {
  if (!isRecord(raw) || !Array.isArray(raw.data)) {
    throw new EchoError(ErrorCodes.KHALANI_API_ERROR, "Invalid Khalani response: expected orders wrapper");
  }
  return {
    data: raw.data.map(parseOrder),
    cursor: typeof raw.cursor === "number" ? raw.cursor : undefined,
  };
}

export function validateOrderResponse(raw: unknown): KhalaniOrder {
  return parseOrder(raw);
}

export function isSolanaAddressLike(value: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value);
}

import { EchoError, ErrorCodes } from "../../errors.js";
import { getCachedKhalaniChains, getChainFamily, resolveChainId } from "../../khalani/chains.js";
import type { QuoteRequest, TradeType } from "../../khalani/types.js";
import { formatChainFamily, normalizeAddressForFamily, resolveConfiguredAddress } from "./helpers.js";

export interface QuoteRequestInput {
  fromChain: string;
  fromToken: string;
  toChain: string;
  toToken: string;
  amount: string;
  tradeType?: string;
  fromAddress?: string;
  recipient?: string;
  refundTo?: string;
  referrer?: string;
  referrerFeeBps?: string;
  refreshChains?: boolean;
}

export interface PreparedQuoteRequest {
  chains: Awaited<ReturnType<typeof getCachedKhalaniChains>>;
  fromChainId: number;
  toChainId: number;
  fromFamily: "eip155" | "solana";
  toFamily: "eip155" | "solana";
  request: QuoteRequest;
}

export function resolveQuoteAddress(
  input: string | undefined,
  family: "eip155" | "solana",
  fallbackRole: "from" | "recipient" | "refundTo",
): string {
  const fallback = resolveConfiguredAddress(family);
  const value = input ?? fallback;
  if (!value) {
    throw new EchoError(
      ErrorCodes.WALLET_NOT_CONFIGURED,
      `No ${formatChainFamily(family)} ${fallbackRole} address available.`,
      `Pass --${fallbackRole === "refundTo" ? "refund-to" : fallbackRole} explicitly or configure the matching wallet first.`,
    );
  }
  return normalizeAddressForFamily(value, family, fallbackRole);
}

export function parseTradeType(value: string | undefined): TradeType {
  return value === "EXACT_OUTPUT" ? "EXACT_OUTPUT" : "EXACT_INPUT";
}

export function parseReferrerFeeBps(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 9999) {
    throw new EchoError(ErrorCodes.INVALID_AMOUNT, "referrer-fee-bps must be an integer between 0 and 9999.");
  }
  return parsed;
}

export function parseAmountInSmallestUnits(value: string): string {
  if (!/^\d+$/.test(value) || value === "0") {
    throw new EchoError(ErrorCodes.INVALID_AMOUNT, "amount must be a positive integer in smallest units.");
  }
  return value;
}

export async function prepareQuoteRequest(input: QuoteRequestInput): Promise<PreparedQuoteRequest> {
  const chains = await getCachedKhalaniChains(!!input.refreshChains);
  const fromChainId = resolveChainId(input.fromChain, chains);
  const toChainId = resolveChainId(input.toChain, chains);
  const fromFamily = getChainFamily(fromChainId, chains);
  const toFamily = getChainFamily(toChainId, chains);

  const fromAddress = resolveQuoteAddress(input.fromAddress, fromFamily, "from");
  const recipient = input.recipient
    ? normalizeAddressForFamily(input.recipient, toFamily, "recipient")
    : resolveQuoteAddress(undefined, toFamily, "recipient");
  const refundTo = input.refundTo
    ? normalizeAddressForFamily(input.refundTo, fromFamily, "refundTo")
    : fromAddress;

  const referrer = input.referrer
    ? normalizeAddressForFamily(input.referrer, "eip155", "referrer")
    : undefined;

  return {
    chains,
    fromChainId,
    toChainId,
    fromFamily,
    toFamily,
    request: {
      tradeType: parseTradeType(input.tradeType),
      fromChainId,
      fromToken: input.fromToken,
      toChainId,
      toToken: input.toToken,
      amount: parseAmountInSmallestUnits(input.amount),
      fromAddress,
      recipient,
      refundTo,
      referrer,
      referrerFeeBps: parseReferrerFeeBps(input.referrerFeeBps),
    },
  };
}

import { EchoError, ErrorCodes } from "../errors.js";
import type { KhalaniErrorBody } from "./types.js";

function withMeta(error: EchoError, retryable: boolean, externalName?: string): EchoError {
  error.retryable = retryable;
  if (externalName) error.externalName = externalName;
  return error;
}

export function mapKhalaniError(status: number, body: KhalaniErrorBody | null): EchoError {
  if (status === 404 && body === null) {
    return withMeta(
      new EchoError(ErrorCodes.KHALANI_ORDER_NOT_FOUND, "Khalani resource not found."),
      false,
    );
  }
  if (status === 429) {
    return withMeta(
      new EchoError(
        ErrorCodes.KHALANI_RATE_LIMITED,
        body?.message ?? "Khalani rate limit exceeded.",
        "Retry with backoff."
      ),
      true,
    );
  }

  const message = body?.message ?? `Khalani API error (HTTP ${status})`;
  const name = body?.name;

  switch (name) {
    case "ValidationException":
      return withMeta(
        new EchoError(ErrorCodes.KHALANI_VALIDATION_ERROR, message, "Fix the request parameters and retry."),
        false, name,
      );
    case "CannotFillException":
      return withMeta(
        new EchoError(ErrorCodes.KHALANI_CANNOT_FILL, message, "Try another route, token, chain, or amount."),
        false, name,
      );
    case "QuoteNotFoundException":
      return withMeta(
        new EchoError(
          message.toLowerCase().includes("expired") ? ErrorCodes.KHALANI_QUOTE_EXPIRED : ErrorCodes.KHALANI_QUOTE_NOT_FOUND,
          message,
          "Re-request a quote before building the deposit plan."
        ),
        true, name,
      );
    case "NotSupportedTokenException":
      return withMeta(
        new EchoError(ErrorCodes.KHALANI_UNSUPPORTED_TOKEN, message, "Search supported tokens first."),
        false, name,
      );
    case "NotSupportedChainException":
      return withMeta(
        new EchoError(ErrorCodes.KHALANI_UNSUPPORTED_CHAIN, message, "Check the supported chain list first."),
        false, name,
      );
    case "BroadcastException":
      return withMeta(
        new EchoError(ErrorCodes.KHALANI_BROADCAST_FAILED, message, "Check balances, nonce, or destination chain transaction freshness."),
        false, name,
      );
    case "DuplicateRecordException":
      return withMeta(
        new EchoError(ErrorCodes.KHALANI_API_ERROR, message, "Treat this as already registered and fetch the order state."),
        false, name,
      );
    case "UnexpectedFromAddressException":
      return withMeta(
        new EchoError(ErrorCodes.KHALANI_ADDRESS_MISMATCH, message, "Ensure the wallet address format matches the selected chain family."),
        false, name,
      );
    case "InternalErrorException":
      return withMeta(
        new EchoError(ErrorCodes.KHALANI_API_ERROR, message, "Retry with backoff. The upstream service reported an internal error."),
        true, name,
      );
    default:
      if (status >= 500) {
        return withMeta(
          new EchoError(ErrorCodes.KHALANI_API_ERROR, message, "Retry with backoff. Khalani returned a server-side error."),
          true, name ?? undefined,
        );
      }
      return withMeta(
        new EchoError(ErrorCodes.KHALANI_API_ERROR, message),
        false, name ?? undefined,
      );
  }
}

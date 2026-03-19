import { EchoError, ErrorCodes } from "../errors.js";

export function parseIntSafe(value: string, name: string): number {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) {
    throw new EchoError(ErrorCodes.INVALID_AMOUNT, `Invalid ${name}: ${value}`);
  }
  return n;
}

export function validateSlippage(bps: number): number {
  if (bps < 0 || bps > 5000) {
    throw new EchoError(
      ErrorCodes.INVALID_SLIPPAGE,
      `Invalid slippage: ${bps} bps`,
      "Slippage must be between 0 and 5000 bps (0-50%)"
    );
  }
  return bps;
}

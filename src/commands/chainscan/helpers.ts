import type { Address } from "viem";
import { loadConfig } from "../../config/store.js";
import { EchoError, ErrorCodes } from "../../errors.js";
import { validateAddress } from "../../chainscan/validation.js";

export function resolveAddress(input?: string): Address {
  if (input) return validateAddress(input);
  const cfg = loadConfig();
  if (!cfg.wallet.address) {
    throw new EchoError(
      ErrorCodes.WALLET_NOT_CONFIGURED,
      "No address provided and no wallet configured.",
      "Provide an address argument or run: echoclaw wallet create --json"
    );
  }
  return cfg.wallet.address;
}

export function parseCommaSeparated(val: string): string[] {
  return val.split(",").map(s => s.trim()).filter(Boolean);
}

export function parseIntOpt(val: string): number {
  const n = parseInt(val, 10);
  if (isNaN(n)) throw new EchoError(ErrorCodes.INVALID_AMOUNT, `Invalid number: ${val}`);
  return n;
}

export function formatWei(wei: string): string {
  const n = BigInt(wei);
  const whole = n / 10n ** 18n;
  const frac = n % 10n ** 18n;
  const fracStr = frac.toString().padStart(18, "0").slice(0, 6).replace(/0+$/, "");
  return fracStr ? `${whole}.${fracStr}` : whole.toString();
}

export function formatTimestamp(ts: string): string {
  const n = Number(ts);
  if (!n) return ts;
  return new Date(n * 1000).toISOString().replace("T", " ").slice(0, 19);
}

/**
 * Shared helpers for 0G Compute commands.
 *
 * Validation, serialization, and display utilities extracted from
 * `commands/0g-compute.ts` so they can be reused across modules.
 */

import { isAddress, getAddress } from "viem";
import type { Address } from "viem";
import { EchoError, ErrorCodes } from "../errors.js";

/** Validate and checksum an Ethereum address. */
export function requireAddress(raw: string, label: string): Address {
  if (!isAddress(raw)) {
    throw new EchoError(ErrorCodes.INVALID_ADDRESS, `Invalid ${label} address: ${raw}`);
  }
  return getAddress(raw) as Address;
}

/** Parse a string as a positive finite number or throw. */
export function requirePositiveNumber(raw: string, label: string): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    throw new EchoError(ErrorCodes.INVALID_AMOUNT, `Invalid ${label}: ${raw} (must be > 0)`);
  }
  return n;
}

/** Parse a string as a token ID in [0, 254] or throw. */
export function requireTokenId(raw: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > 254) {
    throw new EchoError(ErrorCodes.INVALID_AMOUNT, `Invalid token-id: ${raw} (must be 0-254)`);
  }
  return n;
}

/** Recursively convert bigint fields to strings for JSON serialization. */
export function serializeBigInts(obj: unknown): unknown {
  if (typeof obj === "bigint") return obj.toString();
  if (Array.isArray(obj)) return obj.map(serializeBigInts);
  if (obj !== null && typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      result[k] = serializeBigInts(v);
    }
    return result;
  }
  return obj;
}

/** Redact an API key for safe display. */
export function redactToken(token: string): string {
  if (token.startsWith("app-sk-")) return "app-sk-***";
  return "***";
}

/**
 * Bridge utilities for 0G SDK integration.
 *
 * - withSuppressedConsole: suppresses SDK console.log pollution
 *   (SDK logs "Detected network: ..." on init)
 *
 * Ethers ↔ SDK interop lives in sdk-bridge.cts (CJS module) to avoid
 * ESM/CJS #private type mismatch. See sdk-bridge.cts for details.
 */

import { isHeadless } from "../utils/output.js";
import logger from "../utils/logger.js";

/**
 * Suppress console.log/warn/error during async SDK calls.
 * - Headless (--json): swallows console output completely (stdout must be clean JSON)
 * - TTY: redirects to logger.debug (log/warn) or logger.warn (error)
 */
export async function withSuppressedConsole<T>(fn: () => Promise<T>): Promise<T> {
  const origLog = console.log;
  const origWarn = console.warn;
  const origError = console.error;

  try {
    if (isHeadless()) {
      console.log = () => {};
      console.warn = () => {};
      console.error = () => {};
    } else {
      console.log = (...args: unknown[]) => logger.debug(`[0G SDK] ${args.join(" ")}`);
      console.warn = (...args: unknown[]) => logger.debug(`[0G SDK warn] ${args.join(" ")}`);
      console.error = (...args: unknown[]) => logger.warn(`[0G SDK error] ${args.join(" ")}`);
    }
    return await fn();
  } finally {
    console.log = origLog;
    console.warn = origWarn;
    console.error = origError;
  }
}

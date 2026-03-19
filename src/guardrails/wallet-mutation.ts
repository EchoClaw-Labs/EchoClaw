/**
 * Wallet mutation guardrail.
 *
 * Blocks wallet create, import, and restore in headless mode
 * unless ECHO_ALLOW_WALLET_MUTATION=1 is set.
 *
 * Scope: ONLY keystore-mutating operations.
 * NOT blocked: setup password and non-keystore runtime/compute configuration.
 */

import { isHeadless } from "../utils/output.js";
import { EchoError, ErrorCodes } from "../errors.js";

export function isWalletMutationAllowed(): boolean {
  return !isHeadless() || process.env.ECHO_ALLOW_WALLET_MUTATION === "1";
}

export function assertWalletMutationAllowed(operation: string): void {
  if (isWalletMutationAllowed()) return;

  throw new EchoError(
    ErrorCodes.WALLET_MUTATION_BLOCKED_HEADLESS,
    `Wallet mutation "${operation}" is blocked in headless mode.`,
    "This protects against accidental keystore overwrites in automation.\n" +
      "To override, set ECHO_ALLOW_WALLET_MUTATION=1 in your environment.\n" +
      "For interactive setup, run: echoclaw echo"
  );
}

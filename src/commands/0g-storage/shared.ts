import { EchoError, ErrorCodes } from "../../errors.js";
import { loadConfig } from "../../config/store.js";

export function requireWallet(): string {
  const cfg = loadConfig();
  if (!cfg.wallet.address) {
    throw new EchoError(
      ErrorCodes.ZG_STORAGE_PERMISSION_DENIED,
      "No wallet configured.",
      "Run: echoclaw wallet create --json"
    );
  }
  return cfg.wallet.address;
}

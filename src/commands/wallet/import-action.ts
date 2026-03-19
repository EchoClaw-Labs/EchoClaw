import { readFileSync } from "node:fs";
import { normalizePrivateKey } from "../../wallet/keystore.js";
import { importWallet } from "../../wallet/import.js";
import { importSolanaWallet } from "../../wallet/solana-import.js";
import { normalizeSolanaSecretKey } from "../../wallet/solana-keystore.js";
import { normalizeWalletChain } from "../../wallet/family.js";
import { EchoError, ErrorCodes } from "../../errors.js";
import { assertWalletMutationAllowed } from "../../guardrails/wallet-mutation.js";
import {
  successBox,
  spinner,
  colors,
} from "../../utils/ui.js";
import { isHeadless, writeJsonSuccess } from "../../utils/output.js";

export async function importPrivateKeyAction(
  privateKeyArg: string | undefined,
  options: { chain?: string; stdin?: boolean; force?: boolean }
): Promise<void> {
  assertWalletMutationAllowed("wallet import");
  const chain = normalizeWalletChain(options.chain);

  // 1. Determine private key source: argument > --stdin > ECHO_IMPORT_KEY env
  let rawKey: string | undefined = privateKeyArg;

  if (!rawKey && options.stdin) {
    try {
      rawKey = readFileSync(0, "utf-8").trim();
    } catch {
      throw new EchoError(
        ErrorCodes.INVALID_PRIVATE_KEY,
        "Failed to read private key from stdin.",
        "Usage: echo $KEY | echoclaw wallet import --stdin"
      );
    }
  }

  if (!rawKey && process.env.ECHO_IMPORT_KEY) {
    rawKey = process.env.ECHO_IMPORT_KEY;
  }

  if (!rawKey) {
    throw new EchoError(
      ErrorCodes.INVALID_PRIVATE_KEY,
      "No private key provided.",
      "Provide via argument, --stdin, or ECHO_IMPORT_KEY env var.\n" +
        "  echoclaw wallet import 0xABC...\n" +
        "  echo $KEY | echoclaw wallet import --stdin\n" +
        "  ECHO_IMPORT_KEY=0x... echoclaw wallet import"
    );
  }

  // 2. Validate key early (before spinner)
  try {
    if (chain === "solana") {
      normalizeSolanaSecretKey(rawKey);
    } else {
      normalizePrivateKey(rawKey);
    }
  } catch (err) {
    throw new EchoError(
      ErrorCodes.INVALID_PRIVATE_KEY,
      `Invalid private key: ${err instanceof Error ? err.message : String(err)}`,
      chain === "solana"
        ? "Solana secret key must be base58 or a 64-byte JSON array."
        : "Private key must be 32 bytes hex (64 characters), optionally prefixed with 0x."
    );
  }

  // 3. Import via shared module
  const spin = spinner("Encrypting and saving keystore...");
  spin.start();

  if (chain === "solana") {
    const result = await importSolanaWallet(rawKey, { force: options.force });
    spin.succeed("Wallet imported");

    if (isHeadless()) {
      writeJsonSuccess({ address: result.address, chain });
    } else {
      successBox(
        "Wallet Imported",
        `Address: ${colors.address(result.address)}\n` +
          `Chain: ${colors.info("Solana")}\n\n` +
          colors.warn("Private key encrypted and stored locally.\n") +
          colors.muted("Tip: Prefer --stdin or env var over argument (avoids shell history).")
      );
    }
    return;
  }

  const result = await importWallet(rawKey, { force: options.force });
  spin.succeed("Wallet imported");

  // 4. Output (NEVER print private key)
  if (isHeadless()) {
    writeJsonSuccess({ address: result.address, chain, chainId: result.chainId });
  } else {
    successBox(
      "Wallet Imported",
      `Address: ${colors.address(result.address)}\n` +
        `Chain: ${colors.info(result.chainId.toString())}\n\n` +
        colors.warn("Private key encrypted and stored locally.\n") +
        colors.muted("Tip: Prefer --stdin or env var over argument (avoids shell history).")
    );
  }
}

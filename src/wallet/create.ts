import type { Address } from "viem";
import { generatePrivateKey, privateKeyToAddress } from "viem/accounts";
import { loadConfig, saveConfig } from "../config/store.js";
import { encryptPrivateKey, saveKeystore, keystoreExists } from "./keystore.js";
import { autoBackup } from "../commands/wallet/index.js";
import { requireKeystorePassword } from "../utils/env.js";
import { EchoError, ErrorCodes } from "../errors.js";

export interface WalletCreateResult {
  address: Address;
  chainId: number;
  overwritten: boolean;
}

/**
 * Core wallet creation logic.
 * Does NOT handle UI output — caller is responsible for display.
 * Does NOT check guardrails — caller must call assertWalletMutationAllowed() first.
 */
export async function createWallet(opts: { force?: boolean } = {}): Promise<WalletCreateResult> {
  const existed = keystoreExists();

  if (existed && !opts.force) {
    throw new EchoError(
      ErrorCodes.KEYSTORE_ALREADY_EXISTS,
      "Keystore already exists.",
      "Use --force to overwrite. Existing keystore will be backed up automatically."
    );
  }

  if (opts.force && existed) {
    await autoBackup();
  }

  const password = requireKeystorePassword();
  const privateKey = generatePrivateKey();
  const address = privateKeyToAddress(privateKey);

  const keystore = encryptPrivateKey(privateKey, password);
  saveKeystore(keystore);

  const cfg = loadConfig();
  cfg.wallet.address = address;
  saveConfig(cfg);

  return { address, chainId: cfg.chain.chainId, overwritten: existed };
}

import { Keypair } from "@solana/web3.js";
import { loadConfig, saveConfig } from "../config/store.js";
import { autoBackup } from "../commands/wallet/index.js";
import { EchoError, ErrorCodes } from "../errors.js";
import { requireKeystorePassword } from "../utils/env.js";
import { deriveSolanaAddress, encryptSolanaSecretKey, saveSolanaKeystore, solanaKeystoreExists } from "./solana-keystore.js";

export interface SolanaWalletCreateResult {
  address: string;
  overwritten: boolean;
}

export async function createSolanaWallet(opts: { force?: boolean } = {}): Promise<SolanaWalletCreateResult> {
  const existed = solanaKeystoreExists();

  if (existed && !opts.force) {
    throw new EchoError(
      ErrorCodes.KEYSTORE_ALREADY_EXISTS,
      "Solana keystore already exists.",
      "Use --force to overwrite. Existing keystore will be backed up automatically.",
    );
  }

  if (opts.force && existed) {
    await autoBackup();
  }

  const password = requireKeystorePassword();
  const keypair = Keypair.generate();
  const address = deriveSolanaAddress(keypair.secretKey);

  saveSolanaKeystore(encryptSolanaSecretKey(keypair.secretKey, password));

  const cfg = loadConfig();
  cfg.wallet.solanaAddress = address;
  saveConfig(cfg);

  return { address, overwritten: existed };
}

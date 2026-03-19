import { Command } from "commander";
import type { Address } from "viem";
import { privateKeyToAddress } from "viem/accounts";
import inquirer from "inquirer";
import { loadConfig, saveConfig } from "../../config/store.js";
import { decryptPrivateKey, loadKeystore, keystoreExists } from "../../wallet/keystore.js";
import { decryptSolanaSecretKey, deriveSolanaAddress, loadSolanaKeystore, solanaKeystoreExists } from "../../wallet/solana-keystore.js";
import { createSolanaWallet } from "../../wallet/solana-create.js";
import { getKeystorePassword } from "../../utils/env.js";
import { isWalletMutationAllowed } from "../../guardrails/wallet-mutation.js";
import {
  successBox,
  warnBox,
  infoBox,
  colors,
  spinner,
} from "../../utils/ui.js";
import { isHeadless, writeJsonSuccess } from "../../utils/output.js";

type EnsureStatus = "ready" | "missing_keystore" | "missing_password" | "password_mismatch" | "not_configured" | "created";

interface WalletEnsureState {
  family: "eip155" | "solana";
  status: EnsureStatus;
  address: string | null;
  hasKeystore: boolean;
  passwordSet: boolean;
  hint?: string;
}

function ensureEvmWallet(passwordSet: boolean): WalletEnsureState {
  const cfg = loadConfig();
  const address = cfg.wallet.address;
  const hasKeystore = keystoreExists();

  if (!hasKeystore) {
    return {
      family: "eip155",
      status: "missing_keystore",
      address: null,
      hasKeystore: false,
      passwordSet,
      hint: "Run: echoclaw wallet create --json OR echoclaw wallet import <key>",
    };
  }

  if (!passwordSet) {
    return {
      family: "eip155",
      status: "missing_password",
      address: address ?? null,
      hasKeystore: true,
      passwordSet: false,
      hint: "Run: echoclaw setup password --from-env",
    };
  }

  const keystore = loadKeystore();
  if (!keystore) {
    return {
      family: "eip155",
      status: "missing_keystore",
      address: null,
      hasKeystore: false,
      passwordSet,
      hint: "Keystore file exists but could not be read. Run: echoclaw wallet create --force --json",
    };
  }

  try {
    const pk = decryptPrivateKey(keystore, getKeystorePassword()!);
    const derivedAddress = privateKeyToAddress(pk as `0x${string}`);

    if (!address || address.toLowerCase() !== derivedAddress.toLowerCase()) {
      cfg.wallet.address = derivedAddress as Address;
      saveConfig(cfg);
    }

    return {
      family: "eip155",
      status: "ready",
      address: derivedAddress,
      hasKeystore: true,
      passwordSet: true,
    };
  } catch {
    return {
      family: "eip155",
      status: "password_mismatch",
      address: address ?? null,
      hasKeystore: true,
      passwordSet: true,
      hint: "Password does not decrypt keystore. Check ECHO_KEYSTORE_PASSWORD.",
    };
  }
}

function ensureSolanaWallet(passwordSet: boolean): WalletEnsureState {
  const cfg = loadConfig();
  const address = cfg.wallet.solanaAddress;
  const hasKeystore = solanaKeystoreExists();

  if (!hasKeystore && !address) {
    return {
      family: "solana",
      status: "not_configured",
      address: null,
      hasKeystore: false,
      passwordSet,
      hint: "Run: echoclaw wallet create --chain solana",
    };
  }

  if (!hasKeystore) {
    return {
      family: "solana",
      status: "missing_keystore",
      address: address ?? null,
      hasKeystore: false,
      passwordSet,
      hint: "Run: echoclaw wallet create --chain solana",
    };
  }

  if (!passwordSet) {
    return {
      family: "solana",
      status: "missing_password",
      address: address ?? null,
      hasKeystore: true,
      passwordSet: false,
      hint: "Run: echoclaw setup password --from-env",
    };
  }

  const keystore = loadSolanaKeystore();
  if (!keystore) {
    return {
      family: "solana",
      status: "missing_keystore",
      address: null,
      hasKeystore: false,
      passwordSet,
      hint: "Solana keystore exists but could not be read. Run: echoclaw wallet create --chain solana --force",
    };
  }

  try {
    const derivedAddress = deriveSolanaAddress(decryptSolanaSecretKey(keystore, getKeystorePassword()!));

    if (!address || address !== derivedAddress) {
      cfg.wallet.solanaAddress = derivedAddress;
      saveConfig(cfg);
    }

    return {
      family: "solana",
      status: "ready",
      address: derivedAddress,
      hasKeystore: true,
      passwordSet: true,
    };
  } catch {
    return {
      family: "solana",
      status: "password_mismatch",
      address: address ?? null,
      hasKeystore: true,
      passwordSet: true,
      hint: "Password does not decrypt Solana keystore. Check ECHO_KEYSTORE_PASSWORD.",
    };
  }
}

async function tryCreateSolanaWallet(): Promise<WalletEnsureState | null> {
  if (isHeadless()) {
    const spin = spinner("Creating Solana wallet...");
    const result = await createSolanaWallet();
    spin.stop();
    return {
      family: "solana",
      status: "created",
      address: result.address,
      hasKeystore: true,
      passwordSet: true,
    };
  }

  const { shouldCreate } = await inquirer.prompt([{
    type: "confirm",
    name: "shouldCreate",
    message: "No Solana wallet found. Create one now?",
    default: true,
  }]);

  if (!shouldCreate) {
    return null;
  }

  const spin = spinner("Creating Solana wallet...");
  const result = await createSolanaWallet();
  spin.stop();
  return {
    family: "solana",
    status: "created",
    address: result.address,
    hasKeystore: true,
    passwordSet: true,
  };
}

export function createEnsureSubcommand(): Command {
  return new Command("ensure")
    .description("Check wallet readiness (idempotent status check; interactive mode may create a missing Solana wallet)")
    .action(async () => {
      const passwordSet = getKeystorePassword() !== null;
      const evm = ensureEvmWallet(passwordSet);
      let solana = ensureSolanaWallet(passwordSet);

      if (
        (solana.status === "not_configured" || solana.status === "missing_keystore")
        && passwordSet
        && isWalletMutationAllowed()
      ) {
        const created = await tryCreateSolanaWallet();
        if (created) {
          solana = created;
        }
      }

      const result = {
        status: evm.status,
        address: evm.address,
        hasKeystore: evm.hasKeystore,
        passwordSet: evm.passwordSet,
        solanaAddress: solana.address,
        hasSolanaKeystore: solana.hasKeystore,
        wallets: {
          eip155: evm,
          solana,
        },
      };
      if (isHeadless()) {
        writeJsonSuccess(result);
      } else {
        const body = [
          `EVM: ${evm.address ? colors.address(evm.address) : colors.muted("not configured")} (${evm.status})`,
          `EVM keystore: ${evm.hasKeystore ? colors.success("OK") : colors.warn("missing")}`,
          `Solana: ${solana.address ? colors.address(solana.address) : colors.muted("not configured")} (${solana.status})`,
          `Solana keystore: ${solana.hasKeystore ? colors.success("OK") : colors.warn("missing")}`,
          `Password: ${passwordSet ? colors.success("OK") : colors.warn("missing")}`,
        ].join("\n");

        if (evm.status === "ready" && (solana.status === "ready" || solana.status === "created")) {
          successBox("Wallet Ready", body);
        } else if (evm.status === "missing_password" || solana.status === "missing_password") {
          warnBox("Missing Password", body);
        } else {
          infoBox("Wallet Status", body);
        }
      }
    });
}

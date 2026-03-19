import inquirer from "inquirer";
import { keystoreExists, normalizePrivateKey, loadKeystore, decryptPrivateKey } from "../../../wallet/keystore.js";
import { createWallet } from "../../../wallet/create.js";
import { importWallet } from "../../../wallet/import.js";
import { loadConfig } from "../../../config/store.js";
import { getKeystorePassword } from "../../../utils/env.js";
import { spinner, colors } from "../../../utils/ui.js";
import { writeStderr } from "../../../utils/output.js";
import { EchoError } from "../../../errors.js";
import type { OnboardState, OnboardStep, StepStatus, StepResult } from "../types.js";

function detect(state: OnboardState): StepStatus {
  const hasKeystore = keystoreExists();
  state.hasKeystore = hasKeystore;

  const cfg = loadConfig();
  const address = cfg.wallet.address;

  if (hasKeystore && address) {
    // Verify password can actually decrypt the keystore
    const pw = getKeystorePassword();
    if (!pw) {
      return { configured: false, summary: "Wallet exists but no password set" };
    }

    const keystore = loadKeystore();
    if (!keystore) {
      return { configured: false, summary: "Keystore file missing or unreadable" };
    }

    try {
      decryptPrivateKey(keystore, pw);
    } catch {
      return {
        configured: false,
        summary: "Wallet keystore exists but decrypt failed (wrong/stale password). " +
          "Fix: unset ECHO_KEYSTORE_PASSWORD && unset -f echoclaw && echoclaw wallet ensure " +
          "(then remove legacy echoclaw() function from ~/.bashrc if present)",
      };
    }

    state.walletAddress = address;
    return { configured: true, summary: `Wallet: ${address}` };
  }
  if (hasKeystore) {
    return { configured: false, summary: "Keystore exists but no address in config" };
  }
  return { configured: false, summary: "No wallet configured" };
}

async function run(state: OnboardState): Promise<StepResult> {
  // Verify password is available
  const pw = getKeystorePassword();
  if (!pw) {
    return {
      action: "failed",
      message: "Keystore password not set. Complete the Password step first.",
    };
  }

  const { walletAction } = await inquirer.prompt([{
    type: "list",
    name: "walletAction",
    message: "Wallet setup:",
    choices: [
      { name: "Generate new wallet", value: "create" },
      { name: "Import existing private key", value: "import" },
      { name: "Skip", value: "skip" },
    ],
  }]);

  if (walletAction === "skip") {
    return { action: "skipped", message: "Wallet setup skipped" };
  }

  if (walletAction === "create") {
    const spin = spinner("Generating wallet and encrypting keystore...");
    spin.start();

    try {
      const result = await createWallet({ force: state.hasKeystore });
      spin.succeed("Wallet created");

      state.walletAddress = result.address;
      state.hasKeystore = true;

      writeStderr(`  ${colors.address(result.address)}`);
      if (result.overwritten) {
        writeStderr(colors.muted("  Previous keystore backed up automatically"));
      }

      return {
        action: "configured",
        message: `Wallet created: ${result.address}`,
      };
    } catch (err) {
      spin.fail("Wallet creation failed");
      const msg = err instanceof EchoError ? err.message : (err instanceof Error ? err.message : String(err));
      return { action: "failed", message: msg };
    }
  }

  // Import flow
  const { privateKey } = await inquirer.prompt([{
    type: "password",
    name: "privateKey",
    message: "Enter private key (hex, 0x-prefix optional):",
    mask: "*",
    validate: (input: string) => {
      try {
        normalizePrivateKey(input);
        return true;
      } catch {
        return "Invalid private key: must be 32 bytes hex (64 chars), optionally 0x-prefixed";
      }
    },
  }]);

  const spin = spinner("Encrypting and saving keystore...");
  spin.start();

  try {
    const result = await importWallet(privateKey, { force: state.hasKeystore });
    spin.succeed("Wallet imported");

    state.walletAddress = result.address;
    state.hasKeystore = true;

    writeStderr(`  ${colors.address(result.address)}`);
    if (result.overwritten) {
      writeStderr(colors.muted("  Previous keystore backed up automatically"));
    }

    return {
      action: "configured",
      message: `Wallet imported: ${result.address}`,
    };
  } catch (err) {
    spin.fail("Wallet import failed");
    const msg = err instanceof EchoError ? err.message : (err instanceof Error ? err.message : String(err));
    return { action: "failed", message: msg };
  }
}

export const walletStep: OnboardStep = {
  name: "Wallet",
  description: "Creates or imports your 0G blockchain wallet. This is your on-chain identity — it holds your tokens and signs every transaction.",
  detect,
  run,
};

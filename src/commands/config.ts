import { Command } from "commander";
import inquirer from "inquirer";
import { privateKeyToAddress } from "viem/accounts";
import type { Address } from "viem";
import {
  loadConfig,
  saveConfig,
  configExists,
  getDefaultConfig,
} from "../config/store.js";
import { CONFIG_DIR, CONFIG_FILE, KEYSTORE_FILE } from "../config/paths.js";
import {
  encryptPrivateKey,
  saveKeystore,
  keystoreExists,
} from "../wallet/keystore.js";
import {
  successBox,
  spinner,
  colors,
} from "../utils/ui.js";
import { writeStderr, isHeadless } from "../utils/output.js";
import { respond } from "../utils/respond.js";
import { EchoError, ErrorCodes } from "../errors.js";

export function createConfigCommand(): Command {
  const config = new Command("config")
    .description("Manage Echo configuration")
    .exitOverride();

  // echoclaw config init
  config
    .command("init")
    .description("Initialize configuration with defaults")
    .action(async () => {
      if (configExists()) {
        respond({
          data: {
            configDir: CONFIG_DIR,
            configFile: CONFIG_FILE,
            status: "exists" as const,
          },
          ui: {
            type: "info",
            title: "Config Exists",
            body:
              `Configuration already exists at:\n${colors.muted(CONFIG_FILE)}\n\n` +
              `Use ${colors.info("echoclaw config show")} to view it.`,
          },
        });
        return;
      }

      const spin = spinner("Initializing configuration...");
      spin.start();

      try {
        const defaultConfig = getDefaultConfig();
        saveConfig(defaultConfig);
        spin.succeed("Configuration initialized");

        respond({
          data: {
            configDir: CONFIG_DIR,
            chainId: defaultConfig.chain.chainId,
            rpcUrl: defaultConfig.chain.rpcUrl,
            status: "created" as const,
          },
          ui: {
            type: "success",
            title: "Config Created",
            body:
              `Config directory: ${colors.muted(CONFIG_DIR)}\n\n` +
              `Chain: ${colors.info("0G Mainnet")} (${defaultConfig.chain.chainId})\n` +
              `RPC: ${colors.muted(defaultConfig.chain.rpcUrl)}\n\n` +
              `Next step: ${colors.info("echoclaw wallet create")} to generate a new wallet`,
          },
        });
      } catch (err) {
        spin.fail("Failed to initialize configuration");
        throw err;
      }
    });

  // echoclaw config set-key
  config
    .command("set-key")
    .description("Set wallet private key (encrypted)")
    .action(async () => {
      // Guard: inquirer requires interactive stdin
      if (isHeadless() || !process.stdin.isTTY) {
        throw new EchoError(
          ErrorCodes.INTERACTIVE_COMMAND_NOT_SUPPORTED,
          "config set-key requires interactive terminal.",
          "Use 'echoclaw wallet create --json' for automation, or run in TTY for manual key import."
        );
      }

      // Check if keystore already exists
      if (keystoreExists()) {
        const { overwrite } = await inquirer.prompt([
          {
            type: "confirm",
            name: "overwrite",
            message: "A keystore already exists. Overwrite it?",
            default: false,
          },
        ]);

        if (!overwrite) {
          writeStderr(colors.muted("Operation cancelled."));
          return;
        }
      }

      // Prompt for private key
      const { privateKey } = await inquirer.prompt([
        {
          type: "password",
          name: "privateKey",
          message: "Enter your private key:",
          mask: "*",
          validate: (input: string) => {
            const cleaned = input.startsWith("0x") ? input.slice(2) : input;
            if (!/^[0-9a-fA-F]{64}$/.test(cleaned)) {
              return "Invalid private key: must be 32 bytes hex (64 characters)";
            }
            return true;
          },
        },
      ]);

      // Prompt for password (twice for confirmation)
      const { password } = await inquirer.prompt([
        {
          type: "password",
          name: "password",
          message: "Enter encryption password:",
          mask: "*",
          validate: (input: string) => {
            if (input.length < 8) {
              return "Password must be at least 8 characters";
            }
            return true;
          },
        },
      ]);

      const { confirmPassword } = await inquirer.prompt([
        {
          type: "password",
          name: "confirmPassword",
          message: "Confirm encryption password:",
          mask: "*",
        },
      ]);

      if (password !== confirmPassword) {
        throw new EchoError(
          ErrorCodes.PASSWORD_MISMATCH,
          "Passwords do not match."
        );
      }

      const spin = spinner("Encrypting private key...");
      spin.start();

      try {
        // Derive address from private key
        const normalizedPk = privateKey.startsWith("0x")
          ? (privateKey as `0x${string}`)
          : (`0x${privateKey}` as `0x${string}`);
        const address = privateKeyToAddress(normalizedPk) as Address;

        // Encrypt and save keystore
        const keystore = encryptPrivateKey(privateKey, password);
        saveKeystore(keystore);

        // Update config with address
        const cfg = loadConfig();
        cfg.wallet.address = address;
        saveConfig(cfg);

        spin.succeed("Wallet configured successfully");

        successBox(
          "Wallet Set Up",
          `Address: ${colors.address(address)}\n` +
            `Keystore: ${colors.muted(KEYSTORE_FILE)}\n\n` +
            `${colors.warn("⚠ Keep your password safe - there is no recovery!")}`
        );
      } catch (err) {
        spin.fail("Failed to set up wallet");
        throw err;
      }
    });

  // echoclaw config set-rpc <url>
  config
    .command("set-rpc <url>")
    .description("Change RPC endpoint")
    .action(async (url: string) => {
      // Basic URL validation
      try {
        new URL(url);
      } catch {
        throw new EchoError(
          ErrorCodes.RPC_ERROR,
          `Invalid URL: ${url}`
        );
      }

      const spin = spinner("Updating RPC endpoint...");
      spin.start();

      try {
        const cfg = loadConfig();
        const oldUrl = cfg.chain.rpcUrl;
        cfg.chain.rpcUrl = url;
        saveConfig(cfg);

        spin.succeed("RPC endpoint updated");

        respond({
          data: {
            oldUrl,
            newUrl: url,
            status: "updated" as const,
          },
          ui: {
            type: "success",
            title: "RPC Updated",
            body: `Old: ${colors.muted(oldUrl)}\nNew: ${colors.info(url)}`,
          },
        });
      } catch (err) {
        spin.fail("Failed to update RPC endpoint");
        throw err;
      }
    });

  // echoclaw config set-solana-rpc <url>
  config
    .command("set-solana-rpc <url>")
    .description("Change Solana RPC endpoint")
    .action(async (url: string) => {
      try { new URL(url); } catch {
        throw new EchoError(ErrorCodes.RPC_ERROR, `Invalid URL: ${url}`);
      }

      const cfg = loadConfig();
      const oldUrl = cfg.solana.rpcUrl;
      cfg.solana.rpcUrl = url;

      // Auto-detect cluster from known RPC URLs
      if (url.includes("devnet")) cfg.solana.cluster = "devnet";
      else if (url.includes("testnet")) cfg.solana.cluster = "testnet";
      else if (url.includes("mainnet")) cfg.solana.cluster = "mainnet-beta";
      else cfg.solana.cluster = "custom";

      saveConfig(cfg);

      respond({
        data: { oldUrl, newUrl: url, cluster: cfg.solana.cluster, status: "updated" as const },
        ui: { type: "success", title: "Solana RPC Updated", body: `Old: ${colors.muted(oldUrl)}\nNew: ${colors.info(url)}\nCluster: ${colors.info(cfg.solana.cluster)}` },
      });
    });

  // echoclaw config set-solana-cluster <cluster>
  config
    .command("set-solana-cluster <cluster>")
    .description("Set Solana cluster (mainnet-beta, devnet, testnet)")
    .action(async (cluster: string) => {
      const clusterMap: Record<string, { rpcUrl: string; explorerUrl: string }> = {
        "mainnet-beta": { rpcUrl: "https://api.mainnet-beta.solana.com", explorerUrl: "https://explorer.solana.com" },
        devnet: { rpcUrl: "https://api.devnet.solana.com", explorerUrl: "https://explorer.solana.com" },
        testnet: { rpcUrl: "https://api.testnet.solana.com", explorerUrl: "https://explorer.solana.com" },
      };

      const preset = clusterMap[cluster];
      if (!preset) {
        throw new EchoError(ErrorCodes.RPC_ERROR, `Unknown cluster: ${cluster}`, "Use: mainnet-beta, devnet, or testnet.");
      }

      const cfg = loadConfig();
      cfg.solana.cluster = cluster as "mainnet-beta" | "devnet" | "testnet";
      cfg.solana.rpcUrl = preset.rpcUrl;
      cfg.solana.explorerUrl = preset.explorerUrl;
      saveConfig(cfg);

      respond({
        data: { cluster, rpcUrl: preset.rpcUrl, explorerUrl: preset.explorerUrl, status: "updated" as const },
        ui: { type: "success", title: "Solana Cluster Updated", body: `Cluster: ${colors.info(cluster)}\nRPC: ${colors.muted(preset.rpcUrl)}` },
      });
    });

  // echoclaw config set-jupiter-key <key>
  config
    .command("set-jupiter-key <key>")
    .description("Set Jupiter API key (for premium rate limits)")
    .action(async (key: string) => {
      const cfg = loadConfig();
      cfg.solana.jupiterApiKey = key;
      saveConfig(cfg);

      respond({
        data: { jupiterApiKey: `${key.slice(0, 8)}…`, status: "updated" as const },
        ui: { type: "success", title: "Jupiter API Key Set", body: `Key: ${colors.muted(`${key.slice(0, 8)}…`)}` },
      });
    });

  // echoclaw config show
  config
    .command("show")
    .description("Show current configuration")
    .action(async () => {
      const cfg = loadConfig();
      const hasKeystore = keystoreExists();

      // Data for JSON output
      const data = {
        chain: {
          id: cfg.chain.chainId,
          rpc: cfg.chain.rpcUrl,
          explorer: cfg.chain.explorerUrl,
        },
        wallet: {
          address: cfg.wallet.address ?? null,
          solanaAddress: cfg.wallet.solanaAddress ?? null,
          hasKeystore,
        },
        solana: {
          cluster: cfg.solana.cluster,
          rpcUrl: cfg.solana.rpcUrl,
          explorerUrl: cfg.solana.explorerUrl,
          commitment: cfg.solana.commitment,
          jupiterApiKey: cfg.solana.jupiterApiKey ? `${cfg.solana.jupiterApiKey.slice(0, 8)}…` : null,
        },
        services: {
          backendApiUrl: cfg.services.backendApiUrl,
          proxyApiUrl: cfg.services.proxyApiUrl,
          chatWsUrl: cfg.services.chatWsUrl,
          khalaniApiUrl: cfg.services.khalaniApiUrl,
          storageIndexerRpcUrl: cfg.services.storageIndexerRpcUrl,
          storageEvmRpcUrl: cfg.services.storageEvmRpcUrl,
          storageFlowContract: cfg.services.storageFlowContract,
        },
      };

      // UI formatting
      const walletInfo = cfg.wallet.address
        ? colors.address(cfg.wallet.address)
        : colors.muted("(not configured)");

      const keystoreInfo = hasKeystore
        ? colors.success("encrypted")
        : colors.muted("(not set)");

      respond({
        data,
        ui: {
          type: "info",
          title: "Configuration",
          body:
            `${colors.bold("Chain (0G)")}\n` +
            `  ID: ${colors.info(cfg.chain.chainId.toString())}\n` +
            `  RPC: ${colors.muted(cfg.chain.rpcUrl)}\n` +
            `  Explorer: ${colors.muted(cfg.chain.explorerUrl)}\n\n` +
            `${colors.bold("Wallet")}\n` +
            `  Address: ${walletInfo}\n` +
            `  Solana: ${cfg.wallet.solanaAddress ? colors.address(cfg.wallet.solanaAddress) : colors.muted("(not configured)")}\n` +
            `  Keystore: ${keystoreInfo}\n\n` +
            `${colors.bold("Solana")}\n` +
            `  Cluster: ${colors.info(cfg.solana.cluster)}\n` +
            `  RPC: ${colors.muted(cfg.solana.rpcUrl)}\n` +
            `  Explorer: ${colors.muted(cfg.solana.explorerUrl)}\n` +
            `  Commitment: ${colors.muted(cfg.solana.commitment)}\n` +
            `  Jupiter Key: ${cfg.solana.jupiterApiKey ? colors.muted(`${cfg.solana.jupiterApiKey.slice(0, 8)}…`) : colors.muted("(not set)")}\n\n` +
            `${colors.bold("Services")}\n` +
            `  Backend:          ${colors.muted(cfg.services.backendApiUrl)}\n` +
            `  Proxy:            ${colors.muted(cfg.services.proxyApiUrl)}\n` +
            `  Chat WS:          ${colors.muted(cfg.services.chatWsUrl)}\n` +
            `  Khalani API:      ${colors.muted(cfg.services.khalaniApiUrl)}\n` +
            `  Storage Indexer:   ${colors.muted(cfg.services.storageIndexerRpcUrl)}\n` +
            `  Storage RPC:       ${colors.muted(cfg.services.storageEvmRpcUrl)}\n` +
            `  Storage Flow:      ${colors.muted(cfg.services.storageFlowContract)}\n\n` +
            `${colors.muted(`Config: ${CONFIG_FILE}`)}`,
        },
      });
    });

  return config;
}

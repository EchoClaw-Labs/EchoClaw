#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Command, CommanderError } from "commander";
import { createConfigCommand } from "./commands/config.js";
import { createWalletCommand, importPrivateKeyAction } from "./commands/wallet/index.js";
import { createSendCommand } from "./commands/send.js";
import { createJaineCommand } from "./commands/jaine/index.js";
import { createSlopCommand } from "./commands/slop/index.js";
import { createSlopAppCommand } from "./commands/slop-app/index.js";
import { createEchoBookCommand } from "./commands/echobook/index.js";
import { createSetupCommand } from "./commands/setup.js";
import { createChainScanCommand } from "./commands/chainscan/index.js";
import { createKhalaniCommand } from "./commands/khalani/index.js";
import { createSlopStreamCommand } from "./commands/slop-stream.js";
import { createBotCommand } from "./commands/marketmaker/index.js";
import { create0gComputeCommand } from "./commands/0g-compute/index.js";
import { create0gStorageCommand } from "./commands/0g-storage/index.js";
import { createSkillCommand, createInstallAlias } from "./commands/skill.js";
import { createEchoCommand } from "./commands/echo/index.js";
import { createSolanaCommand } from "./commands/solana/index.js";
import { printLogo, errorBox } from "./utils/ui.js";
import { setJsonMode, isHeadless, writeJsonError } from "./utils/output.js";
import { EchoError } from "./errors.js";
import { checkForUpdates } from "./update/updater.js";
import { ensureAutoUpdateDefault } from "./update/auto-update-preference.js";
import { runAutoUpdateBootstrap } from "./update/cli-bootstrap.js";
import { retireLegacyUpdateDaemon } from "./update/legacy-runtime.js";
import { createUpdateCommand } from "./commands/update/index.js";
import { maybeResurrectDaemons } from "./utils/daemon-resurrect.js";
import { spawnMonitorFromState, spawnBotDaemon } from "./utils/daemon-spawn.js";
import { ZG_MONITOR_PID_FILE, ZG_MONITOR_STATE_FILE, ZG_MONITOR_STOPPED_FILE } from "./0g-compute/constants.js";
import { BOT_PID_FILE, BOT_ORDERS_FILE, BOT_STOPPED_FILE } from "./config/paths.js";

// Load .env files for standalone CLI usage
// Priority: ~/.config/echoclaw/.env
// (OpenClaw gateway has its own dotenv loader; this covers manual SSH/bash invocations)
import { loadProviderDotenv } from "./providers/env-resolution.js";
loadProviderDotenv();

// Early --json detection BEFORE program.parse()
// This ensures isHeadless() returns true even for Commander parsing errors
const isJsonRequested = process.argv.includes("--json");
if (isJsonRequested) {
  setJsonMode(true);
}

/**
 * Global error handler for consistent error output.
 * Outputs JSON error in headless mode, UI box otherwise.
 */
export function handleError(err: unknown): never {
  // Handle Commander errors (unknown option, missing required, etc.)
  if (err instanceof CommanderError) {
    // Skip help/version exits (exitCode 0)
    if (err.exitCode === 0) {
      process.exit(0);
    }

    // Safety net: detect legacy `bot` command usage
    const firstCmd = process.argv.slice(2).find(a => !a.startsWith("-"));
    if (firstCmd === "bot") {
      if (isHeadless()) {
        writeJsonError("CLI_ERROR", "Command 'bot' is not available", "Use: echoclaw marketmaker ... (alias: echoclaw mm ...)");
      } else {
        process.stderr.write(`\n  Command 'bot' is not available. Use: echoclaw marketmaker ... (alias: echoclaw mm ...)\n\n`);
      }
      process.exit(1);
    }

    if (isHeadless()) {
      writeJsonError("CLI_ERROR", err.message);
    } else {
      errorBox("CLI Error", err.message);
    }
    process.exit(1);
  }

  if (err instanceof EchoError) {
    if (isHeadless()) {
      writeJsonError(err.code, err.message, err.hint, {
        retryable: err.retryable,
        externalName: err.externalName,
      });
    } else {
      const content = err.hint ? `${err.message}\n\nHint: ${err.hint}` : err.message;
      errorBox(err.code, content);
    }
  } else {
    const message = err instanceof Error ? err.message : String(err);
    if (isHeadless()) {
      writeJsonError("UNKNOWN_ERROR", message);
    } else {
      errorBox("Error", message);
    }
  }
  process.exit(1);
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, "../package.json"), "utf-8"));

let updateCheckStarted = false;
function maybeStartUpdateCheck(currentVersion: string): void {
  if (updateCheckStarted) return;
  updateCheckStarted = true;
  void checkForUpdates(currentVersion);
}

const program = new Command();

program
  .name("echoclaw")
  .description("EchoClaw CLI for 0G Network")
  .version(pkg.version)
  .option("--json", "Output in JSON format (implies headless mode)")
  .hook("preAction", async (thisCommand, actionCommand) => {
    // Double-check --json flag (also set early above for parsing errors)
    const opts = program.opts();
    if (opts.json) {
      setJsonMode(true);
    }
    // Print logo only for --help or when no args (and not in JSON mode)
    if (!opts.json && (process.argv.includes("--help") || process.argv.includes("-h") || process.argv.length <= 2)) {
      printLogo();
    }

    const ranAutoUpdateBootstrap = await runAutoUpdateBootstrap({
      thisCommand,
      actionCommand,
      retireLegacyUpdateDaemon,
      ensureAutoUpdateDefault,
      startUpdateCheck: () => maybeStartUpdateCheck(pkg.version),
    });

    // Unified daemon resurrection — respawn daemons that should be running
    // Skip when spawned as a daemon child (prevents recursive spawn)
    // Also skip for commands that manage update preference directly
    if (process.env.ECHO_NO_RESURRECT !== "1" && ranAutoUpdateBootstrap) {
      maybeResurrectDaemons([
        {
          name: "BalanceMonitor",
          pidFile: ZG_MONITOR_PID_FILE,
          shouldBeRunning: () => {
            if (existsSync(ZG_MONITOR_STOPPED_FILE)) return false;
            return existsSync(ZG_MONITOR_STATE_FILE);
          },
          resurrect: () => spawnMonitorFromState(),
        },
        {
          name: "MarketMaker",
          pidFile: BOT_PID_FILE,
          shouldBeRunning: () => {
            if (existsSync(BOT_STOPPED_FILE)) return false;
            if (!existsSync(BOT_ORDERS_FILE)) return false;
            try {
              const data = JSON.parse(readFileSync(BOT_ORDERS_FILE, "utf-8"));
              return Array.isArray(data.orders) && data.orders.some((o: any) => o.state === "armed");
            } catch { return false; }
          },
          resurrect: () => spawnBotDaemon(),
        },
      ]);
    }
  });

// Configure output: in headless mode, route Commander's stdout to stderr
// This keeps stdout clean for JSON data only
program.configureOutput({
  writeOut: (str) => {
    if (isHeadless()) {
      process.stderr.write(str);
    } else {
      process.stdout.write(str);
    }
  },
  writeErr: (str) => process.stderr.write(str),
});

// Exit override: throw CommanderError instead of process.exit()
// This allows handleError to produce JSON output for CLI errors
program.exitOverride();

// Top-level import alias (delegates to wallet import)
const importAlias = new Command("import")
  .description("Import private key (alias for: wallet import)")
  .argument("[privateKey]", "Private key hex (0x-prefixed or raw)")
  .option("--stdin", "Read private key from stdin")
  .option("--force", "Overwrite existing keystore (auto-backup first)")
  .exitOverride()
  .action(importPrivateKeyAction);
program.addCommand(importAlias);

// Register commands
program.addCommand(createConfigCommand());
program.addCommand(createWalletCommand());
program.addCommand(createSendCommand());
program.addCommand(createJaineCommand());
program.addCommand(createSlopCommand());
program.addCommand(createSlopAppCommand());
program.addCommand(createEchoBookCommand());
program.addCommand(createChainScanCommand());
program.addCommand(createKhalaniCommand());
program.addCommand(createSetupCommand());
program.addCommand(createSlopStreamCommand());
program.addCommand(createBotCommand());
program.addCommand(create0gComputeCommand());
program.addCommand(create0gStorageCommand());
program.addCommand(createEchoCommand());
program.addCommand(createSolanaCommand());
program.addCommand(createSkillCommand());
program.addCommand(createInstallAlias());
program.addCommand(createUpdateCommand());

// Global unhandled rejection handler for async command errors
process.on("unhandledRejection", (err) => {
  handleError(err);
});

// Parse and run - use parseAsync + catch for CommanderError handling
program.parseAsync().catch(handleError);

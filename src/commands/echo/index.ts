import { Command } from "commander";
import { createClaudeCommand } from "../claude/index.js";
import { createLauncherSubcommand } from "./launcher-cmd.js";
import { createAgentSubcommand } from "./agent-cmd.js";
import { isHeadless } from "../../utils/output.js";
import { EchoError, ErrorCodes } from "../../errors.js";
import { EXPLORE_ITEMS, ADVANCED_ITEMS } from "./catalog.js";
import { runHeadlessConnect } from "./connect.js";
import { runHeadlessFund } from "./fund.js";
import { runEchoMenu } from "./menu.js";
import { createWalletHubSubcommand } from "./wallet.js";
import { printDoctor, printStatus, printVerify, writeSupportReportToFile } from "./status.js";
import { normalizeRuntime } from "./assessment.js";
import { writeEchoWorkflow } from "./protocol.js";

function assertPlanningMode(options: { plan?: boolean; apply?: boolean }): void {
  if (options.plan && options.apply) {
    throw new EchoError(ErrorCodes.INVALID_AMOUNT, "Use either --plan or --apply, not both.");
  }
}

function createConnectSubcommand(): Command {
  return new Command("connect")
    .description("Connect your AI runtime and link the EchoClaw skill")
    .option("--runtime <runtime>", "Runtime: openclaw, claude-code, codex, other")
    .option("--scope <scope>", "Install scope: user | project")
    .option("--force", "Overwrite existing skill installation")
    .option("--plan", "Return a non-mutating JSON plan")
    .option("--apply", "Apply safe connect actions instead of only planning")
    .option("--allow-wallet-mutation", "Allow safe wallet creation when no wallet exists yet")
    .option("--claude-scope <scope>", "Claude settings scope: project-local | project-shared | user")
    .option("--no-start-proxy", "Do not start the Claude proxy automatically")
    .option("--json", "JSON output")
    .action(async (options: Record<string, unknown>) => {
      assertPlanningMode(options as { plan?: boolean; apply?: boolean });
      if (!(options.json || isHeadless() || options.plan || options.apply)) {
        await runEchoMenu();
        return;
      }
      await runHeadlessConnect(options as {
        runtime?: string;
        scope?: string;
        force?: boolean;
        apply?: boolean;
        allowWalletMutation?: boolean;
        claudeScope?: string;
        startProxy?: boolean;
      });
    });
}

function createFundSubcommand(): Command {
  return new Command("fund")
    .description("Inspect and top up the shared 0G compute wallet/ledger/provider flow")
    .option("--runtime <runtime>", "Runtime hint: openclaw, claude-code, codex, other")
    .option("--provider <addr>", "Provider address")
    .option("--amount <0G>", "Amount to fund to provider")
    .option("--deposit <0G>", "Amount to deposit to ledger")
    .option("--ack", "Acknowledge the provider signer")
    .option("--token-id <n>", "Create an API key with the given token ID")
    .option("--save-claude-token", "Store the created API key in the active Claude runtime config")
    .option("--emit-secrets", "Include raw API keys in JSON output")
    .option("--fresh", "Refresh broker state before reading balances")
    .option("--plan", "Return a non-mutating JSON plan")
    .option("--apply", "Apply the requested funding actions")
    .option("--json", "JSON output")
    .action(async (options: Record<string, unknown>) => {
      assertPlanningMode(options as { plan?: boolean; apply?: boolean });
      if (!(options.json || isHeadless() || options.plan || options.apply)) {
        await runEchoMenu();
        return;
      }
      await runHeadlessFund({ ...(options as object), apply: !!options.apply } as {
        runtime?: string;
        provider?: string;
        amount?: string;
        deposit?: string;
        ack?: boolean;
        tokenId?: string;
        saveClaudeToken?: boolean;
        emitSecrets?: boolean;
        fresh?: boolean;
        apply?: boolean;
      });
    });
}

function createVerifySubcommand(): Command {
  return new Command("verify")
    .description("Verify that the selected runtime and 0G compute path are ready")
    .option("--runtime <runtime>", "Runtime: openclaw, claude-code, codex, other")
    .option("--fresh", "Refresh snapshot data before verification")
    .option("--json", "JSON output")
    .action(async (options: { runtime?: string; fresh?: boolean; json?: boolean }) => {
      await printVerify(!!options.json || isHeadless(), options.runtime ? normalizeRuntime(options.runtime) : undefined, options.fresh !== false);
    });
}

function createListSubcommand(name: "explore" | "advanced", items: typeof EXPLORE_ITEMS): Command {
  return new Command(name)
    .description(name === "explore" ? "List safe starter actions for exploring Echo" : "List low-level advanced surfaces")
    .option("--json", "JSON output")
    .action(async (options: { json?: boolean }) => {
      if (options.json || isHeadless()) {
        writeEchoWorkflow({
          phase: name,
          status: "ready",
          summary: name === "explore" ? "Safe starter actions for exploring Echo." : "Advanced low-level command surfaces.",
          items,
        });
        return;
      }
      await runEchoMenu();
    });
}

export function createEchoCommand(): Command {
  const echo = new Command("echo")
    .description("Human-first EchoClaw launcher for connecting AI, funding 0G compute, and fixing setup")
    .action(runEchoMenu);

  echo.addCommand(createConnectSubcommand());
  echo.addCommand(createFundSubcommand());
  echo.addCommand(createVerifySubcommand());
  echo.addCommand(new Command("status").option("--fresh").option("--json").action(async (options: { fresh?: boolean; json?: boolean }) => {
    await printStatus(!!options.json || isHeadless(), !!options.fresh);
  }));
  echo.addCommand(new Command("doctor").option("--fresh").option("--json").action(async (options: { fresh?: boolean; json?: boolean }) => {
    await printDoctor(!!options.json || isHeadless(), !!options.fresh);
  }));
  echo.addCommand(new Command("support-report").option("--json").action(async (options: { json?: boolean }) => {
    await writeSupportReportToFile(!!options.json || isHeadless());
  }));
  echo.addCommand(createListSubcommand("explore", EXPLORE_ITEMS));
  echo.addCommand(createListSubcommand("advanced", ADVANCED_ITEMS));
  echo.addCommand(createWalletHubSubcommand());
  echo.addCommand(createClaudeCommand());
  echo.addCommand(createLauncherSubcommand());
  echo.addCommand(createAgentSubcommand());

  return echo;
}

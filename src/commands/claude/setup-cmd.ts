/**
 * `echoclaw echo claude` — Interactive Claude Code setup wizard.
 *
 * Guides through: provider selection → funding → ACK → API key →
 * echo config save → Claude settings inject → proxy start → optional skill link.
 *
 * Modelled on `src/commands/0g-compute/wizard.ts` (OpenClaw wizard).
 * No balance monitor in v1.
 */

import inquirer from "inquirer";
import { formatUnits } from "viem";
import type { Address } from "viem";
import { getAuthenticatedBroker } from "../../0g-compute/broker-factory.js";
import { checkComputeReadiness } from "../../0g-compute/readiness.js";
import {
  listChatServices,
  depositToLedger,
  fundProvider,
  getSubAccountBalance,
  getLedgerBalance,
  ackWithReadback,
  createApiKey,
  getServiceMetadata,
  type ServiceDetail,
} from "../../0g-compute/operations.js";
import { calculateProviderPricing, formatPricePerMTokens } from "../../0g-compute/pricing.js";
import { redactToken } from "../../0g-compute/helpers.js";
import { getPublicClient } from "../../wallet/client.js";
import { renderBatBanner } from "../../utils/banner.js";
import { spinner, colors, infoBox, successBox, warnBox } from "../../utils/ui.js";
import { writeStderr, isHeadless } from "../../utils/output.js";
import { EchoError, ErrorCodes } from "../../errors.js";
import { loadConfig, saveConfig } from "../../config/store.js";
import { writeAppEnvValue } from "../../providers/env-resolution.js";
import {
  CLAUDE_PROXY_DEFAULT_PORT,
  CLAUDE_PROXY_PID_FILE,
  getClaudeDisplayModelLabel,
} from "../../claude/constants.js";
import { spawnClaudeProxy, isDaemonAlive } from "../../utils/daemon-spawn.js";
import { injectClaudeSettings } from "./config-cmd.js";
import { handleSkillInstall } from "../skill.js";

export async function runClaudeSetup(): Promise<void> {
  if (isHeadless()) {
    throw new EchoError(
      ErrorCodes.ONBOARD_REQUIRES_TTY,
      "The Claude setup wizard requires an interactive terminal.",
      "Use individual commands for automation:\n" +
        "  echoclaw 0g-compute ledger deposit <amount>\n" +
        "  echoclaw echo fund --provider <addr> --amount <0G> --json\n" +
        "  echoclaw echo claude config inject\n" +
        "  echoclaw echo claude proxy start",
    );
  }

      writeStderr("");
      await renderBatBanner({
        subtitle: "Claude Code Setup",
        description: "Set up 0G Compute inference for Claude Code.\n  Provider selection → funding → proxy start.",
      });

      // ── Step 1: Readiness diagnostics ──────────────────────────────
      const diagSpin = spinner("Running readiness checks...");
      diagSpin.start();

      let readinessOk = false;
      try {
        const result = await checkComputeReadiness();
        readinessOk = result.ready;
        if (readinessOk) {
          diagSpin.succeed("Base compute checks passed");
        } else {
          diagSpin.warn("Some base checks need attention — wizard will handle them");
        }
      } catch {
        diagSpin.warn("Could not run readiness checks — continuing with wizard");
      }

      // ── Step 2: Get broker ─────────────────────────────────────────
      const brokerSpin = spinner("Connecting to 0G network...");
      brokerSpin.start();

      let broker;
      try {
        broker = await getAuthenticatedBroker();
        brokerSpin.succeed("Connected to 0G network");
      } catch (err) {
        brokerSpin.fail("Failed to connect");
        const msg = err instanceof Error ? err.message : String(err);
        throw new EchoError(ErrorCodes.ZG_BROKER_INIT_FAILED, msg, "Check wallet and network configuration.");
      }

      // ── Step 3: Ledger — check balance, deposit if needed ──────────
      writeStderr("");
      writeStderr(colors.bold("  Ledger"));

      let walletBalanceOg = 0;
      try {
        const client = getPublicClient();
        const { requireWalletAndKeystore } = await import("../../bot/executor.js");
        const { address } = requireWalletAndKeystore();
        const balance = await client.getBalance({ address: address as Address });
        walletBalanceOg = parseFloat(formatUnits(balance, 18));
      } catch {
        // best-effort
      }

      const ledgerBalance = await getLedgerBalance(broker);
      const ledgerAvailableOg = ledgerBalance?.availableOg ?? 0;

      writeStderr(`  Wallet:           ${colors.value(walletBalanceOg.toFixed(4) + " 0G")}`);
      if (ledgerBalance) {
        writeStderr(`  Ledger available: ${colors.value(ledgerBalance.availableOg.toFixed(4) + " 0G")}  ${colors.muted(`(total: ${ledgerBalance.totalOg.toFixed(4)}, reserved: ${ledgerBalance.reservedOg.toFixed(4)})`)}`);
      } else {
        writeStderr(`  ${colors.warn("○")} No ledger found`);
      }

      // ── Step 4: Provider selection ─────────────────────────────────
      writeStderr("");
      writeStderr(colors.bold("  Provider Selection"));

      const modelsSpin = spinner("Fetching available chat models...");
      modelsSpin.start();

      let chatServices: ServiceDetail[];
      try {
        chatServices = await listChatServices(broker);
        modelsSpin.succeed(`Found ${chatServices.length} chat model(s)`);
      } catch (err) {
        modelsSpin.fail("Failed to fetch models");
        const msg = err instanceof Error ? err.message : String(err);
        throw new EchoError(ErrorCodes.ZG_READINESS_CHECK_FAILED, `Failed to list services: ${msg}`);
      }

      if (chatServices.length === 0) {
        throw new EchoError(ErrorCodes.ZG_PROVIDER_NOT_FOUND, "No chat models available on the 0G network.");
      }

      const choices = chatServices.map((svc, i) => {
        const inputPriceStr = formatPricePerMTokens(svc.inputPrice);
        const outputPriceStr = formatPricePerMTokens(svc.outputPrice);
        const providerShort = svc.provider.slice(0, 10) + "...";
        return {
          name: `${svc.model}  (${inputPriceStr} / ${outputPriceStr} 0G per M tokens)  [${providerShort}]`,
          value: i,
        };
      });

      const { modelIndex } = await inquirer.prompt([{
        type: "list",
        name: "modelIndex",
        message: "Select a chat model:",
        choices,
      }]);

      const selectedService = chatServices[modelIndex]!;
      const selectedProvider = selectedService.provider;
      const pricing = calculateProviderPricing(selectedService.inputPrice, selectedService.outputPrice);

      infoBox("Selected Model", [
        `Model:    ${colors.bold(selectedService.model)}`,
        `Provider: ${colors.address(selectedProvider)}`,
        `Price:    ${formatPricePerMTokens(selectedService.inputPrice)} / ${formatPricePerMTokens(selectedService.outputPrice)} 0G per M tokens`,
        `Recommended min locked: ${colors.value(pricing.recommendedMinLockedOg.toFixed(3) + " 0G")}`,
      ].join("\n"));

      // ── Step 5: Fund provider ──────────────────────────────────────
      const subAccount = await getSubAccountBalance(broker, selectedProvider);
      const currentLocked = subAccount?.lockedOg ?? 0;
      writeStderr(`  Provider locked:  ${colors.value(currentLocked.toFixed(4) + " 0G")}`);

      let currentAvailable = ledgerAvailableOg;

      if (currentLocked < pricing.recommendedMinLockedOg) {
        const fundNeeded = pricing.recommendedMinLockedOg - currentLocked;
        const suggestedFund = Math.max(0.5, fundNeeded + 1);

        // If ledger available < what we need to fund, prompt for deposit first
        if (currentAvailable < fundNeeded) {
          writeStderr("");
          writeStderr(`  ${colors.warn("⚠")} Ledger available (${currentAvailable.toFixed(4)} 0G) is insufficient to fund ${fundNeeded.toFixed(1)} 0G.`);

          const ledgerExists = ledgerBalance !== null;
          const suggestedDeposit = Math.max(fundNeeded - currentAvailable + 1, 1).toFixed(1);

          const { depositAmount } = await inquirer.prompt([{
            type: "input",
            name: "depositAmount",
            message: "Amount to deposit to ledger (0G):",
            default: ledgerExists ? suggestedDeposit : "10.0",
            validate: (input: string) => {
              const n = Number(input);
              if (!Number.isFinite(n) || n <= 0) return "Must be a positive number";
              return true;
            },
          }]);

          const depositSpin = spinner(`Depositing ${depositAmount} 0G to ledger...`);
          depositSpin.start();
          try {
            await depositToLedger(broker, depositAmount);
            const afterLedger = await getLedgerBalance(broker);
            if (afterLedger) {
              currentAvailable = afterLedger.availableOg;
              depositSpin.succeed(`Deposited ${depositAmount} 0G (available: ${afterLedger.availableOg.toFixed(4)} 0G)`);
            } else {
              currentAvailable += Number(depositAmount);
              depositSpin.warn(`Deposited ${depositAmount} 0G — could not verify`);
            }
          } catch (err) {
            depositSpin.fail("Deposit failed");
            const msg = err instanceof Error ? err.message : String(err);
            throw new EchoError(ErrorCodes.ZG_TRANSFER_FAILED, `Ledger deposit failed: ${msg}`);
          }
        }

        const { fundAmountInput } = await inquirer.prompt([{
          type: "input",
          name: "fundAmountInput",
          message: `Amount to fund to provider (need ${pricing.recommendedMinLockedOg.toFixed(1)} 0G min):`,
          default: suggestedFund.toFixed(1),
          validate: (input: string) => {
            const n = Number(input);
            if (!Number.isFinite(n) || n <= 0) return "Must be a positive number";
            return true;
          },
        }]);

        const fundDisplay = Number(fundAmountInput);

        if (fundDisplay > currentAvailable + 0.001) {
          throw new EchoError(
            ErrorCodes.ZG_TRANSFER_FAILED,
            `Ledger available balance is ${currentAvailable.toFixed(4)} 0G, but you need ${fundAmountInput} 0G.`,
            "Deposit more first: echoclaw 0g-compute ledger deposit <amount> --yes",
          );
        }

        if (currentLocked + fundDisplay < pricing.recommendedMinLockedOg) {
          const { confirmLow } = await inquirer.prompt([{
            type: "confirm",
            name: "confirmLow",
            message: `${fundAmountInput} 0G will result in ${(currentLocked + fundDisplay).toFixed(1)} 0G locked (below ${pricing.recommendedMinLockedOg.toFixed(1)} 0G min). Continue?`,
            default: false,
          }]);
          if (!confirmLow) {
            warnBox("Setup Cancelled", "Funding cancelled by user. Run the wizard again when ready.");
            return;
          }
        }

        const fundSpin = spinner(`Funding ${fundAmountInput} 0G to provider sub-account...`);
        fundSpin.start();
        try {
          await fundProvider(broker, selectedProvider, fundAmountInput);
          const afterBalance = await getSubAccountBalance(broker, selectedProvider);
          if (afterBalance) {
            fundSpin.succeed(`Funded ${fundAmountInput} 0G`);
            writeStderr(`  Post-fund locked balance: ${colors.value(afterBalance.lockedOg.toFixed(4) + " 0G")}`);
          } else {
            fundSpin.warn(`Funded ${fundAmountInput} 0G — could not verify`);
          }
        } catch (err) {
          fundSpin.fail("Fund transfer failed");
          const msg = err instanceof Error ? err.message : String(err);
          throw new EchoError(ErrorCodes.ZG_TRANSFER_FAILED, `Fund failed: ${msg}`);
        }
      } else {
        writeStderr(colors.success(`  Balance OK (${currentLocked.toFixed(4)} 0G >= ${pricing.recommendedMinLockedOg.toFixed(3)} 0G min)`));
      }

      // ── Step 6: ACK ────────────────────────────────────────────────
      const ackSpin = spinner("Acknowledging provider signer...");
      ackSpin.start();

      const ackConfirmed = await ackWithReadback(broker, selectedProvider);
      if (ackConfirmed) {
        ackSpin.succeed("Provider signer acknowledged (verified on-chain)");
      } else {
        ackSpin.warn("ACK sent but not confirmed within timeout — may propagate shortly");
      }

      // ── Step 7: API key ────────────────────────────────────────────
      writeStderr("");
      writeStderr(colors.bold("  API Key"));

      const apiKeySpin = spinner("Creating API key on-chain...");
      apiKeySpin.start();

      let apiKeyInfo;
      try {
        apiKeyInfo = await createApiKey(broker, selectedProvider);
        apiKeySpin.succeed(`API key created: ${redactToken(apiKeyInfo.rawToken)}`);
      } catch (err) {
        apiKeySpin.fail("API key creation failed");
        const msg = err instanceof Error ? err.message : String(err);
        throw new EchoError(ErrorCodes.ZG_API_KEY_FAILED, `API key creation failed: ${msg}`);
      }

      // ── Step 8: Get provider endpoint & save echo config ───────────
      writeStderr("");
      writeStderr(colors.bold("  Configuration"));

      const configSpin = spinner("Saving configuration...");
      configSpin.start();

      let providerEndpoint: string;
      try {
        const metadata = await getServiceMetadata(broker, selectedProvider);
        providerEndpoint = metadata.endpoint;
      } catch (err) {
        configSpin.fail("Failed to get provider endpoint");
        const msg = err instanceof Error ? err.message : String(err);
        throw new EchoError(ErrorCodes.ZG_READINESS_CHECK_FAILED, `Failed to get service metadata: ${msg}`);
      }

      const port = CLAUDE_PROXY_DEFAULT_PORT;
      const config = loadConfig();
      config.claude = {
        provider: selectedProvider,
        model: selectedService.model,
        providerEndpoint,
        proxyPort: port,
      };
      saveConfig(config);

      // Save auth token to app .env
      writeAppEnvValue("ZG_CLAUDE_AUTH_TOKEN", apiKeyInfo.rawToken);
      process.env.ZG_CLAUDE_AUTH_TOKEN = apiKeyInfo.rawToken;

      configSpin.succeed("Echo config + auth token saved");

      // ── Step 9: Inject Claude Code settings ────────────────────────
      const injectSpin = spinner("Injecting Claude Code settings...");
      injectSpin.start();

      try {
        const { settingsPath } = injectClaudeSettings(config, "project-local");
        injectSpin.succeed(`Claude settings injected: ${settingsPath}`);
      } catch (err) {
        injectSpin.fail("Settings injection failed");
        const msg = err instanceof Error ? err.message : String(err);
        writeStderr(colors.warn(`  ⚠ ${msg}`));
        writeStderr(colors.muted("  You can inject manually later: echoclaw echo claude config inject"));
      }

      // ── Step 10: Start proxy ───────────────────────────────────────
      writeStderr("");

      if (isDaemonAlive(CLAUDE_PROXY_PID_FILE)) {
        writeStderr(colors.muted("  Proxy already running — skipping start"));
      } else {
        const { startProxy } = await inquirer.prompt([{
          type: "confirm",
          name: "startProxy",
          message: "Start Claude translation proxy daemon?",
          default: true,
        }]);

        if (startProxy) {
          const proxySpin = spinner("Starting proxy daemon...");
          proxySpin.start();

          const outcome = spawnClaudeProxy();
          if (outcome.status === "spawned") {
            proxySpin.succeed(`Proxy started (PID ${outcome.pid})`);
            writeStderr(colors.muted(`  Log: ${outcome.logFile}`));
          } else if (outcome.status === "already_running") {
            proxySpin.succeed("Proxy already running");
          } else {
            proxySpin.fail(`Proxy start failed: ${outcome.error}`);
            writeStderr(colors.muted("  Start manually: echoclaw echo claude proxy start"));
          }
        }
      }

      // ── Step 11: Link skill (optional) ─────────────────────────────
      writeStderr("");
      const { linkSkill } = await inquirer.prompt([{
        type: "confirm",
        name: "linkSkill",
        message: "Link echoclaw skill to Claude Code?",
        default: true,
      }]);

      if (linkSkill) {
        try {
          await handleSkillInstall({ provider: "claude-code", scope: "user" });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          writeStderr(colors.warn(`  ⚠ Skill link failed: ${msg}`));
          writeStderr(colors.muted("  Link manually: echoclaw skill install --provider claude-code"));
        }
      }

      // ── Final summary ──────────────────────────────────────────────
      writeStderr("");
  successBox("Claude Code Setup Complete", [
    `Provider: ${selectedProvider.slice(0, 10)}...`,
    `Model:    ${selectedService.model}`,
    `Claude:   ${getClaudeDisplayModelLabel(selectedService.model)}`,
    `Endpoint: ${providerEndpoint}`,
    `Proxy:    http://127.0.0.1:${port}`,
    `API key:  ${redactToken(apiKeyInfo.rawToken)}`,
    "",
    "Next steps:",
    `  1. Restart Claude Code (it will route through the 0G proxy)`,
    `  2. Verify: ${colors.bold("echoclaw echo claude proxy status")}`,
    "",
    `Remove later:  ${colors.bold("echoclaw echo claude config remove")}`,
    `Restore:       ${colors.bold("echoclaw echo claude config restore")}`,
  ].join("\n"));
}

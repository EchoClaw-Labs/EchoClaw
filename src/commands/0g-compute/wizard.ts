/**
 * Legacy interactive compute setup/maintenance wizard.
 *
 * Orchestrates existing operations (ledger, provider, API key, OpenClaw, monitor)
 * into a guided flow. Can be re-run for maintenance (top-up, re-ack, switch provider).
 *
 * Unlike the onboard wizard, this is standalone (no OnboardState dependency)
 * and focuses exclusively on compute readiness.
 */

import { existsSync, readFileSync } from "node:fs";
import type { Command } from "commander";
import inquirer from "inquirer";
import { formatUnits } from "viem";
import type { Address } from "viem";
import { getAuthenticatedBroker } from "../../0g-compute/broker-factory.js";
import { checkComputeReadiness, type ReadinessResult } from "../../0g-compute/readiness.js";
import {
  listChatServices,
  depositToLedger,
  fundProvider,
  getSubAccountBalance,
  getLedgerBalance,
  hasLedger as checkHasLedger,
  ackWithReadback,
  createApiKey,
  configureOpenclawProvider,
  type ServiceDetail,
} from "../../0g-compute/operations.js";
import { calculateProviderPricing, formatPricePerMTokens } from "../../0g-compute/pricing.js";
import { redactToken } from "../../0g-compute/helpers.js";
import {
  getMonitorPid,
  isMonitorTrackingProvider,
  stopMonitorDaemon,
} from "../../0g-compute/monitor-lifecycle.js";
import { getPublicClient } from "../../wallet/client.js";
import { renderBatBanner } from "../../utils/banner.js";
import { spinner, colors, infoBox, successBox, warnBox } from "../../utils/ui.js";
import { writeStderr, isHeadless } from "../../utils/output.js";
import { EchoError, ErrorCodes } from "../../errors.js";
import logger from "../../utils/logger.js";

function isInsideContainer(): boolean {
  if (existsSync("/.dockerenv")) return true;
  try {
    const cgroup = readFileSync("/proc/1/cgroup", "utf-8");
    return cgroup.includes("docker") || cgroup.includes("containerd");
  } catch {
    return false;
  }
}

export function register0gComputeWizard(parent: Command): void {
  parent
    .alias("wizard")
    .description("Interactive OpenClaw compute setup & maintenance (TTY only)")
    .action(async () => {
      if (isHeadless()) {
        throw new EchoError(
          ErrorCodes.ONBOARD_REQUIRES_TTY,
          "The wizard requires an interactive terminal.",
          "Use individual 0g-compute commands for automation."
        );
      }

      writeStderr("");
      await renderBatBanner({
        subtitle: "Compute Wizard",
        description: "Check readiness, fix issues, verify configuration.",
      });

      // ── Step 1: Diagnostics ──────────────────────────────────────
      const diagSpin = spinner("Running readiness checks...");
      diagSpin.start();

      let result: ReadinessResult;
      try {
        result = await checkComputeReadiness();
      } catch (err) {
        diagSpin.fail("Readiness check failed");
        const msg = err instanceof Error ? err.message : String(err);
        throw new EchoError(ErrorCodes.ZG_READINESS_CHECK_FAILED, msg);
      }

      if (result.ready) {
        diagSpin.succeed("All checks passed");
        writeStderr("");
        displayChecks(result);

        const { action } = await inquirer.prompt([{
          type: "list",
          name: "action",
          message: "Everything is configured. What would you like to do?",
          choices: [
            { name: "Exit", value: "exit" },
            { name: "Reconfigure (switch provider, re-fund, etc.)", value: "reconfig" },
          ],
        }]);

        if (action === "exit") {
          successBox("0G Compute", "All systems operational.");
          return;
        }
      } else {
        diagSpin.warn("Issues found");
        writeStderr("");
        displayChecks(result);
        writeStderr("");
      }

      // ── Get broker ───────────────────────────────────────────────
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

      // ── Step 2: Ledger — check balance, deposit if needed ─────────
      writeStderr("");
      writeStderr(colors.bold("  Ledger"));

      // Fetch wallet balance
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

      // Fetch ledger balance
      const ledgerBalance = await getLedgerBalance(broker);
      const ledgerExists = ledgerBalance !== null;
      const ledgerAvailableOg = ledgerBalance?.availableOg ?? 0;

      // Display current state
      writeStderr(`  Wallet:           ${colors.value(walletBalanceOg.toFixed(4) + " 0G")}`);
      if (ledgerBalance) {
        writeStderr(`  Ledger available: ${colors.value(ledgerBalance.availableOg.toFixed(4) + " 0G")}  ${colors.muted(`(total: ${ledgerBalance.totalOg.toFixed(4)}, reserved: ${ledgerBalance.reservedOg.toFixed(4)})`)}`);
      } else {
        writeStderr(`  ${colors.warn("○")} No ledger found`);
      }

      // ── Step 3: Provider selection ───────────────────────────────
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

      // ── Step 4: Fund provider ────────────────────────────────────
      const subAccount = await getSubAccountBalance(broker, selectedProvider);
      const currentLocked = subAccount?.lockedOg ?? 0;
      writeStderr(`  Provider locked:  ${colors.value(currentLocked.toFixed(4) + " 0G")}`);

      // Track current ledger available (may be updated by deposit below)
      let currentAvailable = ledgerAvailableOg;

      if (currentLocked < pricing.recommendedMinLockedOg) {
        const fundNeeded = pricing.recommendedMinLockedOg - currentLocked;
        const suggestedFund = Math.max(0.5, fundNeeded + 1);

        // If ledger available < what we need to fund, prompt for deposit first
        if (currentAvailable < fundNeeded) {
          writeStderr("");
          writeStderr(`  ${colors.warn("⚠")} Ledger available (${currentAvailable.toFixed(4)} 0G) is insufficient to fund ${fundNeeded.toFixed(1)} 0G.`);
          writeStderr(`  You need to deposit more from your wallet before funding the provider.`);
          writeStderr("");

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

            // Read-after-write: update available
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

        // Pre-check: ledger available >= fund amount
        if (fundDisplay > currentAvailable + 0.001) {
          throw new EchoError(
            ErrorCodes.ZG_TRANSFER_FAILED,
            `Ledger available balance is ${currentAvailable.toFixed(4)} 0G, but you need ${fundAmountInput} 0G.`,
            "Deposit more first: echoclaw 0g-compute ledger deposit <amount> --yes",
          );
        }

        // Warn if below recommended
        if (currentLocked + fundDisplay < pricing.recommendedMinLockedOg) {
          const { confirmLow } = await inquirer.prompt([{
            type: "confirm",
            name: "confirmLow",
            message: `${fundAmountInput} 0G will result in ${(currentLocked + fundDisplay).toFixed(1)} 0G locked (below ${pricing.recommendedMinLockedOg.toFixed(1)} 0G min). Continue?`,
            default: false,
          }]);
          if (!confirmLow) {
            warnBox("Wizard Cancelled", [
              "Funding cancelled by user.",
              "",
              "Your compute setup is incomplete. Run the wizard again when ready:",
              `  ${colors.bold("echoclaw echo")}`,
            ].join("\n"));
            return;
          }
        }

        const fundSpin = spinner(`Funding ${fundAmountInput} 0G to provider sub-account...`);
        fundSpin.start();
        try {
          await fundProvider(broker, selectedProvider, fundAmountInput);

          // Read-after-write
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

      // ── Step 5: ACK ──────────────────────────────────────────────
      const ackSpin = spinner("Acknowledging provider signer...");
      ackSpin.start();

      const ackConfirmed = await ackWithReadback(broker, selectedProvider);

      if (ackConfirmed) {
        ackSpin.succeed("Provider signer acknowledged (verified on-chain)");
      } else {
        ackSpin.warn("ACK sent but not confirmed within timeout — may propagate shortly");
      }

      // ── Step 6: API key + OpenClaw ───────────────────────────────
      writeStderr("");
      writeStderr(colors.bold("  API Key & OpenClaw Config"));

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

      const configSpin = spinner("Patching OpenClaw config...");
      configSpin.start();

      try {
        await configureOpenclawProvider(broker, selectedProvider, apiKeyInfo.rawToken);
        configSpin.succeed("OpenClaw config patched");
      } catch (err) {
        configSpin.fail("Config patch failed");
        const msg = err instanceof Error ? err.message : String(err);
        throw new EchoError(ErrorCodes.OPENCLAW_CONFIG_WRITE_FAILED, `Config failed: ${msg}`);
      }

      // ── Step 7: Monitor (optional) ───────────────────────────────
      writeStderr("");
      const { startMonitor } = await inquirer.prompt([{
        type: "confirm",
        name: "startMonitor",
        message: "Start balance monitor daemon?",
        default: true,
      }]);

      if (startMonitor) {
        // Check if monitor is already tracking the selected provider
        if (isMonitorTrackingProvider(selectedProvider)) {
          const pid = getMonitorPid();
          writeStderr(colors.muted(`  Monitor already running for this provider (PID ${pid})`));
        } else {
          const existingPid = getMonitorPid();

          // If a monitor is running but for a different provider, stop it first
          if (existingPid !== null) {
            writeStderr(colors.muted(`  Monitor running (PID ${existingPid}) for a different provider — stopping...`));
            const stopResult = await stopMonitorDaemon();
            if (!stopResult.stopped) {
              writeStderr(colors.warn(`  ⚠ ${stopResult.error ?? "Could not stop existing monitor. Stop it manually before reconfiguring."}`));
              return; // bail out of Step 7 — cannot start new monitor while old one is alive
            }
          }

          const { mode } = await inquirer.prompt([{
            type: "list",
            name: "mode",
            message: "Monitor mode:",
            choices: [
              { name: "Recommended (auto-calculates threshold from pricing)", value: "recommended" },
              { name: "Fixed threshold", value: "fixed" },
            ],
          }]);

          let threshold: string | undefined;
          let buffer = "0";

          if (mode === "fixed") {
            const { thresholdInput } = await inquirer.prompt([{
              type: "input",
              name: "thresholdInput",
              message: "Alert threshold (in 0G):",
              default: "1.0",
              validate: (input: string) => {
                const n = Number(input);
                return (Number.isFinite(n) && n > 0) || "Must be a positive number";
              },
            }]);
            threshold = thresholdInput;
          } else {
            const { bufferInput } = await inquirer.prompt([{
              type: "input",
              name: "bufferInput",
              message: "Extra buffer above recommended min (in 0G):",
              default: "0",
              validate: (input: string) => {
                const n = Number(input);
                return (Number.isFinite(n) && n >= 0) || "Must be >= 0";
              },
            }]);
            buffer = bufferInput;
          }

          const { interval } = await inquirer.prompt([{
            type: "input",
            name: "interval",
            message: "Check interval (seconds):",
            default: "300",
            validate: (input: string) => {
              const n = Number(input);
              return (Number.isInteger(n) && n >= 60) || "Must be an integer >= 60";
            },
          }]);

          // Spawn daemon
          const { existsSync: fsExists, openSync, mkdirSync, closeSync } = await import("node:fs");
          const { fileURLToPath } = await import("node:url");
          const { spawn } = await import("node:child_process");
          const { ZG_COMPUTE_DIR, ZG_MONITOR_LOG_FILE } = await import("../../0g-compute/constants.js");

          if (!fsExists(ZG_COMPUTE_DIR)) {
            mkdirSync(ZG_COMPUTE_DIR, { recursive: true });
          }

          const childArgs: string[] = [
            "0g-compute", "monitor", "start",
            "--providers", selectedProvider,
            "--mode", mode,
            "--interval", interval,
            "--buffer", buffer,
          ];
          if (threshold != null) {
            childArgs.push("--threshold", threshold);
          }

          const cliPath = fileURLToPath(new URL("../../cli.js", import.meta.url));
          const logFd = openSync(ZG_MONITOR_LOG_FILE, "a");

          try {
            const child = spawn(process.execPath, [cliPath, ...childArgs], {
              detached: true,
              stdio: ["ignore", logFd, logFd],
            });
            child.unref();
            closeSync(logFd);
            writeStderr(colors.success(`  ✓ Monitor started (PID ${child.pid})`));
            writeStderr(colors.muted(`  Log: ${ZG_MONITOR_LOG_FILE}`));
          } catch (err) {
            try { closeSync(logFd); } catch { /* ignore */ }
            writeStderr(colors.warn(`  ⚠ Failed to start monitor: ${err instanceof Error ? err.message : String(err)}`));
          }
        }
      }

      // ── Step 8: Final verification ───────────────────────────────
      writeStderr("");
      const verifySpin = spinner("Running final verification...");
      verifySpin.start();

      try {
        const finalResult = await checkComputeReadiness();
        if (finalResult.ready) {
          verifySpin.succeed("All checks passed");
        } else {
          verifySpin.warn("Some checks still failing");
          displayChecks(finalResult);
        }
      } catch {
        verifySpin.warn("Could not run final verification");
      }

      writeStderr("");
      const restartLines = isInsideContainer()
        ? [
            `  1. Exit container and run from host:`,
            `     ${colors.bold("docker compose -f ~/openclaw/docker-compose.yml restart")}`,
            `  2. Re-enter container and restore monitor:`,
            `     ${colors.bold("echoclaw 0g-compute monitor start --from-state --daemon")}`,
            `  3. Send ${colors.bold("/restart")} in chat`,
          ]
        : [
            `  1. Restart gateway: ${colors.bold("openclaw gateway restart")}`,
            `  2. Send ${colors.bold("/restart")} in chat`,
          ];

      successBox("0G Compute Wizard Complete", [
        `Provider: ${selectedProvider.slice(0, 10)}...`,
        `Model:    ${selectedService.model}`,
        `API key:  ${redactToken(apiKeyInfo.rawToken)}`,
        "",
        "Next steps:",
        ...restartLines,
      ].join("\n"));
    });
}

// ── Helpers ──────────────────────────────────────────────────────────

function displayChecks(result: ReadinessResult): void {
  const { checks } = result;
  for (const [name, check] of Object.entries(checks)) {
    const icon = check.ok ? colors.success("✓") : colors.warn("✗");
    const detail = check.detail ? ` — ${check.detail}` : "";
    const hint = !check.ok && check.hint ? colors.muted(` (${check.hint})`) : "";
    writeStderr(`  ${icon} ${name}${detail}${hint}`);
  }
}

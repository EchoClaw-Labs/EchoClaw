import inquirer from "inquirer";
import { parseUnits, formatUnits } from "viem";
import type { Address } from "viem";
import { getAuthenticatedBroker } from "../../../0g-compute/broker-factory.js";
import { withSuppressedConsole } from "../../../0g-compute/bridge.js";
import { normalizeSubAccount, normalizeLedger } from "../../../0g-compute/account.js";
import { calculateProviderPricing, formatPricePerMTokens } from "../../../0g-compute/pricing.js";
import { checkComputeReadiness, saveComputeState } from "../../../0g-compute/readiness.js";
import { redactToken } from "../../../0g-compute/helpers.js";
import { patchOpenclawConfig } from "../../../openclaw/config.js";
import { spinner, colors, infoBox } from "../../../utils/ui.js";
import { writeStderr } from "../../../utils/output.js";
import { getPublicClient } from "../../../wallet/client.js";
import logger from "../../../utils/logger.js";
import type { OnboardState, OnboardStep, StepStatus, StepResult } from "../types.js";

// ── Types for SDK responses ─────────────────────────────────────────

interface ServiceDetail {
  provider: string;
  model: string;
  serviceType: string;
  url: string;
  inputPrice: bigint;
  outputPrice: bigint;
  [key: string]: unknown;
}

interface ServiceMetadata {
  model: string;
  endpoint: string;
  [key: string]: unknown;
}

interface ApiKeyInfo {
  tokenId: number;
  createdAt: number;
  expiresAt: number;
  rawToken: string;
}

// ── Detect (strict readiness — on-chain + config checks) ────────────

async function detect(state: OnboardState): Promise<StepStatus> {
  if (!state.walletAddress) {
    return { configured: false, summary: "Wallet required first" };
  }

  try {
    const result = await checkComputeReadiness();

    if (result.ready) {
      state.computeReady = true;
      if (result.provider) state.selectedProvider = result.provider;
      return { configured: true, summary: "0G Compute configured" };
    }

    // Return first failing check as summary
    const { checks } = result;
    if (!checks.wallet.ok) return { configured: false, summary: checks.wallet.hint ?? "Wallet not configured" };
    if (!checks.broker.ok) return { configured: false, summary: "Cannot connect to 0G network" };
    if (!checks.ledger.ok) return { configured: false, summary: "No ledger found" };
    if (!checks.subAccount.ok) return { configured: false, summary: checks.subAccount.detail ?? "Sub-account balance too low" };
    if (!checks.ack.ok) return { configured: false, summary: "Provider signer not acknowledged" };
    if (!checks.openclawConfig.ok) return { configured: false, summary: "OpenClaw config missing 0G provider" };

    return { configured: false, summary: "0G Compute not fully configured" };
  } catch {
    return { configured: false, summary: "0G Compute not configured (check failed)" };
  }
}

// ── Run ─────────────────────────────────────────────────────────────

async function run(state: OnboardState): Promise<StepResult> {
  if (!state.walletAddress) {
    return { action: "failed", message: "Wallet must be configured first." };
  }

  // ── 6a. Connect to 0G network ────────────────────────────────────
  const connectSpin = spinner("Connecting to 0G network...");
  connectSpin.start();

  let broker;
  try {
    broker = await getAuthenticatedBroker();
    connectSpin.succeed("Connected to 0G network");
  } catch (err) {
    connectSpin.fail("Failed to connect to 0G network");
    const msg = err instanceof Error ? err.message : String(err);
    return { action: "failed", message: `Broker init failed: ${msg}` };
  }

  // ── 6b. Fetch models + select (BEFORE deposit) ───────────────────
  const modelsSpin = spinner("Fetching available chat models...");
  modelsSpin.start();

  let chatServices: ServiceDetail[];
  try {
    const allServices = await withSuppressedConsole(() =>
      broker.inference.listServiceWithDetail()
    ) as unknown as ServiceDetail[];

    chatServices = allServices.filter((s) => s.serviceType === "chatbot");
    modelsSpin.succeed(`Found ${chatServices.length} chat model(s)`);
  } catch (err) {
    modelsSpin.fail("Failed to fetch models");
    const msg = err instanceof Error ? err.message : String(err);
    return { action: "failed", message: `Failed to list services: ${msg}` };
  }

  if (chatServices.length === 0) {
    return { action: "failed", message: "No chat models available on the 0G network." };
  }

  writeStderr("");
  writeStderr(colors.bold("  Available chat models:"));
  writeStderr("");

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
  const selectedProvider = selectedService.provider as Address;
  const pricing = calculateProviderPricing(selectedService.inputPrice, selectedService.outputPrice);

  infoBox("Selected Model", [
    `Model:    ${colors.bold(selectedService.model)}`,
    `Provider: ${colors.address(selectedProvider)}`,
    `Price:    ${formatPricePerMTokens(selectedService.inputPrice)} / ${formatPricePerMTokens(selectedService.outputPrice)} 0G per M tokens`,
    `Recommended min locked: ${colors.value(pricing.recommendedMinLockedOg.toFixed(3) + " 0G")}`,
  ].join("\n"));

  // ── 6c. Ledger — check balance, deposit if needed ───────────────
  const recommendedDeposit = Math.max(pricing.recommendedMinLockedOg + 2, 10);

  // Fetch three-layer balances: wallet, ledger, provider sub-account
  let walletBalanceOg = 0;
  try {
    const client = getPublicClient();
    const walletBalance = await client.getBalance({ address: state.walletAddress as Address });
    walletBalanceOg = parseFloat(formatUnits(walletBalance, 18));
  } catch {
    // best-effort
  }

  let ledgerAvailable = 0;
  let ledgerTotal = 0;
  let ledgerReserved = 0;
  let hasLedger = false;
  try {
    const ledgerRaw = await withSuppressedConsole(() => broker.ledger.getLedger());
    hasLedger = true;
    const ledgerNorm = normalizeLedger(ledgerRaw);
    ledgerAvailable = ledgerNorm.availableOg;
    ledgerTotal = ledgerNorm.totalOg;
    ledgerReserved = ledgerNorm.reservedOg;
  } catch {
    // no ledger
  }

  let currentLocked = 0;
  try {
    const account = await withSuppressedConsole(() =>
      broker.inference.getAccount(selectedProvider)
    );
    currentLocked = normalizeSubAccount(account).lockedOg;
  } catch {
    // no sub-account
  }

  // Display three-layer balance summary
  writeStderr(`  Wallet:           ${colors.value(walletBalanceOg.toFixed(4) + " 0G")}`);
  if (hasLedger) {
    writeStderr(`  Ledger available: ${colors.value(ledgerAvailable.toFixed(4) + " 0G")}  ${colors.muted(`(total: ${ledgerTotal.toFixed(4)}, reserved: ${ledgerReserved.toFixed(4)})`)}`);
  } else {
    writeStderr(`  ${colors.warn("○")} No ledger found`);
  }
  writeStderr(`  Provider locked:  ${colors.value(currentLocked.toFixed(4) + " 0G")}`);

  // Determine how much funding the provider needs
  const fundNeeded = Math.max(0, pricing.recommendedMinLockedOg - currentLocked);

  // Auto-deposit if ledger doesn't exist or available < what we'll need to fund
  if (!hasLedger || (fundNeeded > 0 && ledgerAvailable < fundNeeded)) {
    const suggestedDeposit = hasLedger
      ? Math.max(fundNeeded - ledgerAvailable + 1, 1).toFixed(1)
      : recommendedDeposit.toFixed(1);

    writeStderr("");
    if (hasLedger) {
      writeStderr(`  ${colors.warn("⚠")} Ledger available (${ledgerAvailable.toFixed(4)} 0G) is insufficient for funding.`);
      writeStderr(`  You need to deposit more before transferring to the provider.`);
    } else {
      writeStderr(`  Deposit needed for ${colors.bold(selectedService.model)}:`);
      writeStderr(`    Min locked:  ${colors.value(pricing.recommendedMinLockedOg.toFixed(1) + " 0G")}  ${colors.muted("(from provider pricing)")}`);
      writeStderr(`    Buffer:     ${colors.value("+2.0 0G")}`);
      writeStderr(`    Total:      ${colors.value(recommendedDeposit.toFixed(1) + " 0G")}`);
    }
    writeStderr("");

    const { depositAmount } = await inquirer.prompt([{
      type: "input",
      name: "depositAmount",
      message: "Amount to deposit to ledger (0G):",
      default: suggestedDeposit,
      validate: (input: string) => {
        const n = Number(input);
        if (!Number.isFinite(n) || n <= 0) return "Must be a positive number";
        return true;
      },
    }]);

    const depositDisplay = Number(depositAmount);

    // Fail early if wallet balance is clearly insufficient
    if (walletBalanceOg > 0 && walletBalanceOg < depositDisplay + 0.01) {
      return { action: "failed", message: `Insufficient wallet balance (${walletBalanceOg.toFixed(4)} 0G) for deposit of ${depositAmount} 0G + gas` };
    }

    const depositSpin = spinner(`Depositing ${depositAmount} 0G to ledger...`);
    depositSpin.start();
    try {
      // depositFund for existing ledger, addLedger for new
      if (hasLedger) {
        await withSuppressedConsole(() => broker.ledger.depositFund(Number(depositAmount)));
      } else {
        await withSuppressedConsole(() => broker.ledger.addLedger(Number(depositAmount)));
      }

      // Read-after-write: verify + update available balance
      try {
        const ledgerAfter = await withSuppressedConsole(() => broker.ledger.getLedger());
        const afterNorm = normalizeLedger(ledgerAfter);
        ledgerAvailable = afterNorm.availableOg;
        depositSpin.succeed(`Deposited ${depositAmount} 0G to ledger (available: ${afterNorm.availableOg.toFixed(4)} 0G)`);
      } catch {
        depositSpin.warn(`Deposited ${depositAmount} 0G — could not verify ledger on re-read`);
        ledgerAvailable += depositDisplay;
      }
      hasLedger = true;
    } catch (err) {
      depositSpin.fail("Deposit failed");
      const msg = err instanceof Error ? err.message : String(err);
      return { action: "failed", message: `Ledger deposit failed: ${msg}` };
    }
  } else {
    writeStderr(`  ${colors.success("✓")} Ledger OK`);
  }

  // ── 6d. Fund provider sub-account ────────────────────────────────
  if (currentLocked < pricing.recommendedMinLockedOg) {
    const suggestedFund = Math.max(0.5, pricing.recommendedMinLockedOg - currentLocked + 1);

    const { fundAmountInput } = await inquirer.prompt([{
      type: "input",
      name: "fundAmountInput",
      message: `Amount to fund to provider sub-account (0G) (need ${pricing.recommendedMinLockedOg.toFixed(1)} 0G min):`,
      default: suggestedFund.toFixed(1),
      validate: (input: string) => {
        const n = Number(input);
        if (!Number.isFinite(n) || n <= 0) return "Must be a positive number";
        return true;
      },
    }]);

    const fundDisplay = Number(fundAmountInput);

    // Pre-check: ledger available >= fund amount
    if (fundDisplay > ledgerAvailable + 0.001) {
      return {
        action: "failed",
        message: `Ledger available balance is ${ledgerAvailable.toFixed(4)} 0G, but you need ${fundAmountInput} 0G. Deposit more first: echoclaw 0g-compute ledger deposit <amount> --yes`,
      };
    }

    // Warn if resulting locked is below recommended
    if (currentLocked + fundDisplay < pricing.recommendedMinLockedOg) {
      const { confirmLow } = await inquirer.prompt([{
        type: "confirm",
        name: "confirmLow",
        message: `${fundAmountInput} 0G will result in ${(currentLocked + fundDisplay).toFixed(1)} 0G locked (below ${pricing.recommendedMinLockedOg.toFixed(1)} 0G min). Continue anyway?`,
        default: false,
      }]);
      if (!confirmLow) {
        return { action: "failed", message: "Fund amount too low (user cancelled)" };
      }
    }

    const amountWei = parseUnits(fundAmountInput, 18);
    const fundSpin = spinner(`Funding provider sub-account with ${fundAmountInput} 0G...`);
    fundSpin.start();
    try {
      await withSuppressedConsole(() =>
        broker.ledger.transferFund(selectedProvider, "inference", amountWei)
      );

      // Read-after-write: verify sub-account balance
      try {
        const accountAfter = await withSuppressedConsole(() =>
          broker.inference.getAccount(selectedProvider)
        );
        const normalizedAfter = normalizeSubAccount(accountAfter);
        fundSpin.succeed(`Funded ${fundAmountInput} 0G to provider sub-account`);
        writeStderr(`  Post-fund locked balance: ${colors.value(normalizedAfter.lockedOg.toFixed(4) + " 0G")}`);
        if (normalizedAfter.lockedOg < pricing.recommendedMinLockedOg) {
          writeStderr(colors.warn(`  ⚠ Balance still below recommended minimum (${pricing.recommendedMinLockedOg.toFixed(3)} 0G)`));
        }
      } catch {
        fundSpin.warn(`Funded ${fundAmountInput} 0G — could not verify post-fund balance`);
      }
    } catch (err) {
      fundSpin.fail("Fund transfer failed");
      const msg = err instanceof Error ? err.message : String(err);
      return { action: "failed", message: `Fund transfer failed: ${msg}` };
    }
  } else {
    writeStderr(colors.success(`  Balance OK (${currentLocked.toFixed(4)} 0G >= ${pricing.recommendedMinLockedOg.toFixed(3)} 0G min)`));
  }

  // ── 6e. Acknowledge provider signer (with retry/readback) ─────────
  const ackSpin = spinner("Acknowledging provider signer...");
  ackSpin.start();

  let ackWarning = false;

  try {
    await withSuppressedConsole(() =>
      broker.inference.acknowledgeProviderSigner(selectedProvider)
    );
  } catch {
    // May already be acknowledged — continue to readback
  }

  // Readback: poll acknowledged() with timeout
  const ACK_TIMEOUT_MS = 120_000;
  const ACK_POLL_MS = 5_000;
  const ackDeadline = Date.now() + ACK_TIMEOUT_MS;
  let ackConfirmed = false;

  while (Date.now() < ackDeadline) {
    try {
      ackConfirmed = await withSuppressedConsole(() =>
        broker.inference.acknowledged(selectedProvider)
      );
      if (ackConfirmed) break;
    } catch {
      // Retry on error
    }
    await new Promise(r => setTimeout(r, ACK_POLL_MS));
  }

  if (ackConfirmed) {
    ackSpin.succeed("Provider signer acknowledged (verified on-chain)");
  } else {
    ackSpin.warn("Provider signer ACK sent but not confirmed within timeout");
    ackWarning = true;
  }

  // ── 6f. Create API key (token ID 0, auto) ─────────────────────────
  const apiKeySpin = spinner("Creating API key on-chain...");
  apiKeySpin.start();

  let apiKeyInfo: ApiKeyInfo;
  try {
    apiKeyInfo = await withSuppressedConsole(() =>
      broker.inference.requestProcessor.createApiKey(selectedProvider, {
        tokenId: 0,
        expiresIn: 0,
      })
    ) as ApiKeyInfo;
    apiKeySpin.succeed("API key created");
  } catch (err) {
    apiKeySpin.fail("API key creation failed");
    const msg = err instanceof Error ? err.message : String(err);
    return { action: "failed", message: `API key creation failed: ${msg}` };
  }

  // ── 6g. Patch OpenClaw config (auto — set default) ────────────────
  let metadata: ServiceMetadata;
  try {
    metadata = await withSuppressedConsole(() =>
      broker.inference.getServiceMetadata(selectedProvider)
    ) as ServiceMetadata;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { action: "failed", message: `Failed to get provider metadata: ${msg}` };
  }

  const providerConfig = {
    baseUrl: metadata.endpoint,
    apiKey: apiKeyInfo.rawToken,
    api: "openai-completions",
    models: [{
      id: metadata.model,
      name: `${metadata.model} (0G Compute)`,
      contextWindow: 128000,
      maxTokens: 8192,
    }],
  };

  patchOpenclawConfig("models.providers.zg", providerConfig, { force: true });
  patchOpenclawConfig("models.mode", "merge", { force: false });
  patchOpenclawConfig("agents.defaults.model", {
    primary: `zg/${metadata.model}`,
  }, { force: true });

  writeStderr(colors.success("  ✓ OpenClaw config patched"));
  writeStderr(colors.muted(`  Default model: zg/${metadata.model}`));

  // ── Persist provider state for cross-invocation readiness detection ─
  saveComputeState({
    activeProvider: selectedProvider,
    model: metadata.model,
    configuredAt: Date.now(),
  });

  // ── Done ──────────────────────────────────────────────────────────
  state.computeReady = true;
  state.selectedProvider = selectedProvider;

  logger.info(`[Onboard] 0G Compute configured: provider=${selectedProvider}, model=${metadata.model}`);

  const summaryParts = [
    `Provider: ${selectedProvider.slice(0, 10)}...`,
    `Model: ${metadata.model}`,
    `API key: ${redactToken(apiKeyInfo.rawToken)}`,
  ];

  if (ackWarning) {
    summaryParts.push("⚠ ACK not confirmed on-chain (may propagate shortly)");
    return { action: "configured_with_warning", message: summaryParts.join(" | ") };
  }

  return { action: "configured", message: summaryParts.join(" | ") };
}

export const computeStep: OnboardStep = {
  name: "0G Compute",
  description: "Sets up decentralized AI inference. Instead of paying OpenAI/Anthropic, your agent runs through 0G Network — powered and paid with 0G tokens.",
  detect,
  run,
};

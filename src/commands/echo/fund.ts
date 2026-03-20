import { formatUnits } from "viem";
import type { Address } from "viem";
import inquirer from "inquirer";
import { depositToLedger, fundProvider, getLedgerBalance, getSubAccountBalance, isProviderAcked, listChatServices, ackWithReadback } from "../../0g-compute/operations.js";
import { calculateProviderPricing, formatPricePerMTokens } from "../../0g-compute/pricing.js";
import { loadComputeState } from "../../0g-compute/readiness.js";
import { getMonitorPid, isMonitorTrackingProvider, stopMonitorDaemon } from "../../0g-compute/monitor-lifecycle.js";
import { ZG_COMPUTE_DIR, ZG_MONITOR_LOG_FILE } from "../../0g-compute/constants.js";
import { loadConfig } from "../../config/store.js";
import { EchoError, ErrorCodes } from "../../errors.js";
import { writeAppEnvValue } from "../../providers/env-resolution.js";
import { autoDetectProvider } from "../../providers/registry.js";
import type { ProviderName } from "../../providers/types.js";
import { getPublicClient } from "../../wallet/client.js";
import { getAuthenticatedBroker, resetAuthenticatedBroker } from "../../0g-compute/broker-factory.js";
import { spawnDetached } from "../../utils/daemon-spawn.js";
import { colors, infoBox, successBox, warnBox } from "../../utils/ui.js";
import type { FundApplyOptions, FundView } from "./types.js";
import { normalizeRuntime } from "./assessment.js";
import { PROVIDER_LABELS } from "./catalog.js";
import { writeEchoWorkflow } from "./protocol.js";
import { printVerify } from "./status.js";
import { buildFundPayload } from "./fund-assessment.js";
import { checkAuthState, resolvePreferredComputeSelection } from "./compute-selection.js";
import { selectFundProvider, createCanonicalApiKey, createCanonicalApiKeyFromServices } from "./fund-apply.js";

export function readProviderSelection(): string | null {
  return loadComputeState()?.activeProvider ?? loadConfig().claude?.provider ?? null;
}

async function getWalletBalanceOg(): Promise<number> {
  try {
    const client = getPublicClient();
    const { requireWalletAndKeystore } = await import("../../bot/executor.js");
    const { address } = requireWalletAndKeystore();
    const balance = await client.getBalance({ address: address as Address });
    return parseFloat(formatUnits(balance, 18));
  } catch {
    return 0;
  }
}

export async function buildFundView(opts?: {
  provider?: string | null;
  fresh?: boolean;
}): Promise<FundView> {
  if (opts?.fresh) {
    resetAuthenticatedBroker();
  }

  const broker = await getAuthenticatedBroker();
  const walletBalanceOg = await getWalletBalanceOg();
  const ledgerBalance = await getLedgerBalance(broker);
  const services = await listChatServices(broker);
  let selected = opts?.provider
    ? services.find(svc => svc.provider.toLowerCase() === opts.provider!.toLowerCase()) ?? null
    : null;
  if (!selected && services.length > 0) {
    const resolved = resolvePreferredComputeSelection(services);
    if (resolved) {
      selected = services.find(svc => svc.provider.toLowerCase() === resolved.provider.toLowerCase()) ?? null;
    }
  }

  const provider = selected?.provider ?? null;
  const model = selected?.model ?? null;
  const pricing = selected
    ? calculateProviderPricing(selected.inputPrice, selected.outputPrice)
    : null;
  const subAccount = provider ? await getSubAccountBalance(broker, provider) : null;
  const subAccountExists = subAccount !== null;
  const acknowledged = provider && subAccountExists
    ? await isProviderAcked(broker, provider)
    : null;
  const monitorRunning = getMonitorPid() != null;
  const authState = provider && selected
    ? checkAuthState(provider, selected.url)
    : { requiresApiKeyRotation: false, selectionWarning: null };

  return {
    walletBalanceOg,
    ledgerAvailableOg: ledgerBalance?.availableOg ?? 0,
    ledgerReservedOg: ledgerBalance?.reservedOg ?? 0,
    ledgerTotalOg: ledgerBalance?.totalOg ?? 0,
    provider,
    model,
    inputPricePerMTokens: selected ? formatPricePerMTokens(selected.inputPrice) : null,
    outputPricePerMTokens: selected ? formatPricePerMTokens(selected.outputPrice) : null,
    recommendedMinLockedOg: pricing?.recommendedMinLockedOg ?? null,
    currentLockedOg: subAccount?.lockedOg ?? null,
    subAccountExists,
    acknowledged,
    monitorRunning,
    monitorTrackingProvider: provider ? isMonitorTrackingProvider(provider) : false,
    requiresApiKeyRotation: authState.requiresApiKeyRotation,
    selectionWarning: authState.selectionWarning,
    refreshedAt: new Date().toISOString(),
  };
}

export function printFundView(view: FundView, runtimeHint?: ProviderName): void {
  infoBox("Fund my AI in 0G", [
    `Runtime:            ${runtimeHint ? PROVIDER_LABELS[runtimeHint] : colors.muted("auto / not selected")}`,
    `Wallet balance:     ${view.walletBalanceOg.toFixed(4)} 0G`,
    `Ledger available:   ${view.ledgerAvailableOg.toFixed(4)} 0G`,
    `Ledger reserved:    ${view.ledgerReservedOg.toFixed(4)} 0G`,
    `Ledger total:       ${view.ledgerTotalOg.toFixed(4)} 0G`,
    `Provider:           ${view.provider ?? colors.muted("not selected")}`,
    `Model:              ${view.model ?? colors.muted("not selected")}`,
    `Provider locked:    ${view.currentLockedOg != null ? `${view.currentLockedOg.toFixed(4)} 0G` : colors.muted("not funded")}`,
    `Recommended min:    ${view.recommendedMinLockedOg != null ? `${view.recommendedMinLockedOg.toFixed(3)} 0G` : colors.muted("n/a")}`,
    `Price per 1M tok:   ${view.inputPricePerMTokens && view.outputPricePerMTokens ? `${view.inputPricePerMTokens} / ${view.outputPricePerMTokens} 0G` : colors.muted("n/a")}`,
    `ACK:                ${view.acknowledged == null ? colors.muted("unknown") : view.acknowledged ? colors.success("yes") : colors.warn("no")}`,
    `Monitor:            ${view.monitorRunning ? colors.success(view.monitorTrackingProvider ? "running for this provider" : "running for another provider") : colors.muted("not running")}`,
    `Updated at:         ${view.refreshedAt}`,
  ].join("\n"));
}

async function chooseProvider(current?: string | null): Promise<string | null> {
  const broker = await getAuthenticatedBroker();
  const services = await listChatServices(broker);
  if (services.length === 0) {
    warnBox("0G Compute", "No chat providers found on the network.");
    return current ?? null;
  }

  const { provider } = await inquirer.prompt([{
    type: "list",
    name: "provider",
    message: "Select a live 0G provider/model:",
    default: services.findIndex((svc) => svc.provider === current),
    choices: services.map((svc) => ({
      name: `${svc.model} — ${svc.provider.slice(0, 10)}... (${formatPricePerMTokens(svc.inputPrice)} / ${formatPricePerMTokens(svc.outputPrice)} 0G per 1M)`,
      value: svc.provider,
    })),
  }]);

  return provider as string;
}

async function maybeSaveClaudeTokenInteractive(provider: string, token: string): Promise<void> {
  const cfg = loadConfig();
  if (!cfg.claude || cfg.claude.provider.toLowerCase() !== provider.toLowerCase()) {
    return;
  }

  const { saveToken } = await inquirer.prompt([{
    type: "confirm",
    name: "saveToken",
    message: "Save this API key as the active Claude Code auth token?",
    default: true,
  }]);

  if (!saveToken) return;

  writeAppEnvValue("ZG_CLAUDE_AUTH_TOKEN", token);
  process.env.ZG_CLAUDE_AUTH_TOKEN = token;
  successBox("Claude Token Saved", "Stored ZG_CLAUDE_AUTH_TOKEN in ~/.config/echoclaw/.env");
}


async function startMonitorForProvider(provider: string): Promise<void> {
  const result = spawnDetached(["0g-compute", "monitor", "start", "--providers", provider, "--mode", "recommended"], ZG_MONITOR_LOG_FILE, ZG_COMPUTE_DIR);
  if (!result) {
    throw new EchoError(ErrorCodes.ZG_MONITOR_ALREADY_RUNNING, "Failed to spawn the balance monitor daemon.");
  }
  successBox("Balance Monitor", `Started for ${provider}\nLog: ${result.logFile}`);
}

export async function runInteractiveFund(runtimeHint?: ProviderName): Promise<void> {
  let selectedProvider = readProviderSelection();
  let fresh = true;

  while (true) {
    const view = await buildFundView({ provider: selectedProvider, fresh });
    fresh = false;
    selectedProvider = view.provider;
    printFundView(view, runtimeHint);

    const choices = [
      { name: "Switch provider / model", value: "switch" },
      { name: "Deposit to ledger", value: "deposit" },
      { name: "Fund provider", value: "fund" },
      { name: "Acknowledge provider", value: "ack" },
      { name: "Create API key", value: "api-key" },
      { name: "Refresh live balance", value: "refresh" },
      { name: "Verify setup", value: "verify" },
    ] as Array<{ name: string; value: string }>;

    if ((runtimeHint ?? autoDetectProvider().name) === "openclaw" && selectedProvider) {
      choices.push({ name: view.monitorRunning ? "Stop balance monitor" : "Start balance monitor", value: "monitor" });
    }
    choices.push({ name: "Back", value: "back" });

    const { action } = await inquirer.prompt([{ type: "list", name: "action", message: "Funding actions", choices }]);
    if (action === "back") return;
    if (action === "refresh") {
      fresh = true;
      continue;
    }
    if (action === "verify") {
      await printVerify(false, runtimeHint ?? autoDetectProvider().name);
      continue;
    }
    if (action === "switch") {
      const chosen = await chooseProvider(selectedProvider);
      if (chosen) {
        const result = await selectFundProvider(chosen);
        selectedProvider = result.selection.provider;
      }
      fresh = true;
      continue;
    }

    const broker = await getAuthenticatedBroker();
    if (action === "deposit") {
      const { amount } = await inquirer.prompt([{
        type: "input",
        name: "amount",
        message: "How much 0G do you want to deposit to the ledger?",
        default: "1.0",
        validate: (input: string) => Number.isFinite(Number(input)) && Number(input) > 0 ? true : "Enter a positive number.",
      }]);
      await depositToLedger(broker, amount);
      successBox("Ledger Deposit", `Deposited ${amount} 0G to the compute ledger.`);
      fresh = true;
      continue;
    }

    if (!selectedProvider) {
      warnBox("0G Compute", "Select a provider first.");
      continue;
    }

    if (action === "fund") {
      const defaultAmount =
        view.recommendedMinLockedOg != null && view.currentLockedOg != null
          ? Math.max(0.1, view.recommendedMinLockedOg - view.currentLockedOg).toFixed(2)
          : "1.0";
      const { amount } = await inquirer.prompt([{
        type: "input",
        name: "amount",
        message: "How much 0G do you want to lock for this provider?",
        default: defaultAmount,
        validate: (input: string) => Number.isFinite(Number(input)) && Number(input) > 0 ? true : "Enter a positive number.",
      }]);

      const value = Number(amount);
      if (value > view.ledgerAvailableOg + 0.001) {
        warnBox("Ledger Balance", `Ledger available balance is ${view.ledgerAvailableOg.toFixed(4)} 0G, so ${amount} 0G cannot be funded yet.`);
        continue;
      }

      if (view.recommendedMinLockedOg != null && view.currentLockedOg != null && view.currentLockedOg + value < view.recommendedMinLockedOg) {
        const { confirmLow } = await inquirer.prompt([{
          type: "confirm",
          name: "confirmLow",
          message: `This would leave ${(view.currentLockedOg + value).toFixed(3)} 0G locked, below the recommended ${view.recommendedMinLockedOg.toFixed(3)} 0G. Continue anyway?`,
          default: false,
        }]);
        if (!confirmLow) continue;
      }

      await fundProvider(broker, selectedProvider, amount);
      successBox("Provider Funded", `Locked ${amount} 0G for ${selectedProvider}.`);
      fresh = true;
      continue;
    }

    if (action === "ack") {
      const confirmed = await ackWithReadback(broker, selectedProvider);
      if (confirmed) {
        successBox("Provider ACK", "Provider signer acknowledged and confirmed on-chain.");
      } else {
        warnBox("Provider ACK", "ACK was sent, but confirmation did not arrive before timeout.");
      }
      fresh = true;
      continue;
    }

    if (action === "api-key") {
      const { tokenIdInput } = await inquirer.prompt([{
        type: "input",
        name: "tokenIdInput",
        message: "Token ID for the API key",
        default: "0",
        validate: (input: string) => Number.isInteger(Number(input)) && Number(input) >= 0 && Number(input) <= 254 ? true : "Use an integer between 0 and 254.",
      }]);
      const services = await listChatServices(broker);
      const result = await createCanonicalApiKeyFromServices({
        broker,
        services,
        tokenId: Number(tokenIdInput),
      });
      successBox("API Key Created", `Token ID: ${result.apiKey.tokenId}\nToken: ${result.apiKey.rawToken}`);
      if (result.warnings.length > 0) {
        warnBox("API Key Warnings", result.warnings.join("\n"));
      }
      await maybeSaveClaudeTokenInteractive(result.selection.provider, result.apiKey.rawToken);
      fresh = true;
      continue;
    }

    if (action === "monitor") {
      if (view.monitorRunning) {
        const result = await stopMonitorDaemon();
        if (result.stopped) {
          successBox("Balance Monitor", "Stopped.");
        } else {
          warnBox("Balance Monitor", result.error ?? "Failed to stop monitor.");
        }
      } else {
        await startMonitorForProvider(selectedProvider);
      }
      fresh = true;
    }
  }
}

export async function runHeadlessFund(options: FundApplyOptions & { apply?: boolean }): Promise<void> {
  const runtimeHint = options.runtime ? normalizeRuntime(options.runtime) : autoDetectProvider().name;
  const selectedProvider = options.provider ?? readProviderSelection();

  if (!options.apply) {
    const view = await buildFundView({ provider: selectedProvider, fresh: options.fresh });
    writeEchoWorkflow(buildFundPayload(view, runtimeHint));
    return;
  }

  if (options.fresh) {
    resetAuthenticatedBroker();
  }

  const broker = await getAuthenticatedBroker();
  const appliedActions: string[] = [];
  const warnings: string[] = [];

  // Deposit does not require a provider — always first
  if (options.deposit) {
    await depositToLedger(broker, options.deposit);
    appliedActions.push("deposit_ledger");
  }

  // Resolve provider: explicit --provider triggers canonical persist + sync;
  // otherwise resolve from live services without persist.
  const services = await listChatServices(broker);
  let selection = options.provider
    ? (await selectFundProvider(options.provider, services)).selection
    : resolvePreferredComputeSelection(services);

  if (options.provider) {
    appliedActions.push("select_provider");
  }

  const provider = selection?.provider ?? null;

  if (!provider && (options.amount || options.ack || options.tokenId != null)) {
    writeEchoWorkflow({
      phase: "fund",
      status: "blocked",
      runtime: runtimeHint,
      recommendedRuntime: autoDetectProvider().name,
      summary: "Provider-specific funding actions need an explicit provider or an active provider selection.",
      nextAction: "switch_provider",
      reasonCode: ErrorCodes.ZG_PROVIDER_NOT_FOUND,
      requiresApproval: ["funds"],
      allowedAutoActions: ["switch_provider"],
    });
    return;
  }

  if (provider && options.amount) {
    await fundProvider(broker, provider, options.amount);
    appliedActions.push("fund_provider");
  }

  if (provider && options.ack) {
    const confirmed = await ackWithReadback(broker, provider);
    appliedActions.push("ack_provider");
    if (!confirmed) warnings.push("ACK was sent, but confirmation did not arrive before timeout.");
  }

  let apiKeySummary: Record<string, unknown> | null = null;
  if (provider && selection && options.tokenId != null) {
    const result = await createCanonicalApiKey({
      broker,
      selection,
      tokenId: Number(options.tokenId),
      saveClaudeToken: options.saveClaudeToken,
      patchOpenclaw: options.runtime ? normalizeRuntime(options.runtime) === "openclaw" : false,
    });
    appliedActions.push("create_api_key");
    apiKeySummary = options.emitSecrets
      ? { tokenId: result.apiKey.tokenId, token: result.apiKey.rawToken, storedForClaude: result.claudeTokenSaved }
      : { tokenId: result.apiKey.tokenId, storedForClaude: result.claudeTokenSaved };
    if (options.saveClaudeToken && !result.claudeTokenSaved) {
      warnings.push("API key was created, but it did not match the active Claude runtime provider.");
    }
    warnings.push(...result.warnings);
  }

  const view = await buildFundView({ provider, fresh: true });
  const payload = buildFundPayload(view, runtimeHint);
  writeEchoWorkflow({
    ...payload,
    status: payload.status === "ready" ? "applied" : payload.status,
    summary: appliedActions.length > 0 ? "Requested funding actions were applied." : payload.summary,
    appliedActions,
    warnings: [...(payload.warnings ?? []), ...warnings],
    apiKey: apiKeySummary,
  });
}

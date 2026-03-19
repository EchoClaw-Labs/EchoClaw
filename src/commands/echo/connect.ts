import inquirer from "inquirer";
import { loadConfig } from "../../config/store.js";
import { createWallet } from "../../wallet/create.js";
import { autoDetectProvider } from "../../providers/registry.js";
import type { ProviderName } from "../../providers/types.js";
import { injectClaudeSettings } from "../claude/config-cmd.js";
import { spawnClaudeProxy } from "../../utils/daemon-spawn.js";
import { successBox, infoBox, warnBox } from "../../utils/ui.js";
import { buildEchoSnapshot } from "./state.js";
import { buildConnectPayload, defaultScopeForRuntime, normalizeRuntime, runtimeChoiceName } from "./assessment.js";
import type { ClaudeSettingsScope, ConnectApplyOptions, ConnectApplyResult, EchoScope } from "./types.js";
import { PROVIDER_LABELS } from "./catalog.js";
import { printVerify } from "./status.js";
import { runInteractiveFund } from "./fund.js";
import { writeEchoWorkflow } from "./protocol.js";

async function promptRuntime(defaultRuntime?: ProviderName): Promise<ProviderName> {
  const runtimes: ProviderName[] = ["openclaw", "claude-code", "codex", "other"];
  const { runtime } = await inquirer.prompt([{
    type: "list",
    name: "runtime",
    message: "Which AI runtime do you want to connect?",
    default: defaultRuntime ?? autoDetectProvider().name,
    choices: runtimes.map((value) => ({
      name: runtimeChoiceName(value),
      value,
    })),
  }]);

  return runtime as ProviderName;
}

function normalizeClaudeScope(raw?: string): ClaudeSettingsScope {
  if (raw === "project-shared" || raw === "user") return raw;
  return "project-local";
}

async function maybeCreateWalletForConnect(
  allowWalletMutation: boolean,
): Promise<{ address: string | null; warning?: string }> {
  const snapshot = await buildEchoSnapshot({ includeReadiness: false });
  if (snapshot.wallet.configuredAddress || snapshot.wallet.keystorePresent) {
    return { address: null };
  }
  if (!allowWalletMutation) {
    return { address: null };
  }
  if (snapshot.wallet.password.status === "missing") {
    return { address: null, warning: "Cannot auto-create a wallet until ECHO_KEYSTORE_PASSWORD is configured." };
  }
  if (snapshot.wallet.password.status === "invalid") {
    return { address: null, warning: "Cannot auto-create a wallet while the resolved password does not match the current keystore." };
  }

  const created = await createWallet();
  return { address: created.address };
}

export async function performConnectApply(options: ConnectApplyOptions): Promise<ConnectApplyResult> {
  const warnings: string[] = [];
  const appliedActions: string[] = [];
  const adapter = await import("../../providers/registry.js").then((mod) => mod.resolveProvider(options.runtime));

  const walletResult = await maybeCreateWalletForConnect(options.allowWalletMutation);
  if (walletResult.address) {
    appliedActions.push("wallet_create");
  } else if (walletResult.warning) {
    warnings.push(walletResult.warning);
  }

  const skill = adapter.installSkill({ scope: options.scope, force: options.force });
  if (skill.status === "linked") {
    appliedActions.push("link_skill");
  } else {
    warnings.push(skill.message ?? "Manual skill linking is still required.");
  }

  if (options.runtime === "claude-code") {
    const cfg = loadConfig();
    if (cfg.claude) {
      injectClaudeSettings(cfg, options.claudeScope);
      appliedActions.push("inject_claude_config");

      if (options.startProxy) {
        const proxy = spawnClaudeProxy();
        if (proxy.status === "spawned") {
          appliedActions.push("start_claude_proxy");
        } else if (proxy.status === "already_running") {
          warnings.push("Claude proxy was already running.");
        } else {
          warnings.push(proxy.error);
        }
      }
    } else {
      warnings.push("Claude runtime is not configured yet. Fund a provider and create an API key first.");
    }
  }

  const snapshot = await buildEchoSnapshot({ includeReadiness: true, fresh: true });
  const payload = buildConnectPayload(snapshot, options.runtime, options.scope, options.allowWalletMutation);
  payload.warnings = [...(payload.warnings ?? []), ...warnings];

  return {
    payload,
    snapshot,
    appliedActions,
    warnings,
    skill,
    createdWalletAddress: walletResult.address,
  };
}

export async function runInteractiveConnect(): Promise<void> {
  const recommended = autoDetectProvider().name;
  const { mode } = await inquirer.prompt([{
    type: "list",
    name: "mode",
    message: "How do you want to connect your AI?",
    choices: [
      { name: `Recommended setup (${PROVIDER_LABELS[recommended]})`, value: "recommended" },
      { name: "Customize runtime", value: "customize" },
      { name: "Back", value: "back" },
    ],
  }]);
  if (mode === "back") return;

  const runtime = mode === "recommended" ? recommended : await promptRuntime(recommended);
  const snapshot = await buildEchoSnapshot({ includeReadiness: false });
  const { scope } = await inquirer.prompt([{
    type: "list",
    name: "scope",
    message: "Where should EchoClaw install the skill?",
    default: defaultScopeForRuntime(runtime),
    choices: [
      { name: "Project (recommended for repo-specific setup)", value: "project" },
      { name: "User", value: "user" },
    ],
  }]);

  let allowWalletMutation = false;
  if (!snapshot.wallet.configuredAddress && !snapshot.wallet.keystorePresent && snapshot.wallet.password.status !== "missing") {
    const answer = await inquirer.prompt([{
      type: "confirm",
      name: "allowWalletMutation",
      message: "Create a new wallet automatically if none exists yet?",
      default: true,
    }]);
    allowWalletMutation = answer.allowWalletMutation;
  }

  let claudeScope: ClaudeSettingsScope = "project-local";
  let startProxy = true;
  if (runtime === "claude-code") {
    const answer = await inquirer.prompt([
      {
        type: "list",
        name: "claudeScope",
        message: "Where should Claude settings be injected?",
        default: "project-local",
        choices: [
          { name: "Project local (.claude/settings.local.json)", value: "project-local" },
          { name: "Project shared (.claude/settings.json)", value: "project-shared" },
          { name: "User (~/.claude/settings.json)", value: "user" },
        ],
      },
      {
        type: "confirm",
        name: "startProxy",
        message: "Start the local Claude proxy now?",
        default: true,
      },
    ]);
    claudeScope = answer.claudeScope;
    startProxy = answer.startProxy;
  }

  const result = await performConnectApply({
    runtime,
    scope,
    force: false,
    allowWalletMutation,
    claudeScope,
    startProxy,
  });

  if (result.payload.status === "manual_required") {
    warnBox(`${PROVIDER_LABELS[runtime]} Setup`, [
      result.payload.summary,
      ...(result.payload.manualSteps ?? []),
    ].join("\n"));
  } else if (result.payload.status === "ready") {
    successBox(`${PROVIDER_LABELS[runtime]} Connected`, [
      `Skill source: ${result.skill.source}`,
      `Installed to: ${result.skill.target}`,
      `Applied actions: ${result.appliedActions.length > 0 ? result.appliedActions.join(", ") : "none"}`,
      result.createdWalletAddress ? `Created wallet: ${result.createdWalletAddress}` : "",
      ...(result.payload.manualSteps ?? []),
    ].filter(Boolean).join("\n"));
  } else {
    infoBox(`${PROVIDER_LABELS[runtime]} Setup`, [
      result.payload.summary,
      `Next action: ${result.payload.nextAction ?? "review setup"}`,
      `Applied actions: ${result.appliedActions.length > 0 ? result.appliedActions.join(", ") : "none"}`,
      ...(result.payload.warnings ?? []),
    ].join("\n"));
  }

  if (["fund_ai", "deposit_ledger", "fund_provider", "ack_provider"].includes(result.payload.nextAction ?? "")) {
    const { openFunding } = await inquirer.prompt([{
      type: "confirm",
      name: "openFunding",
      message: "Open 'Fund my AI in 0G' now?",
      default: true,
    }]);
    if (openFunding) {
      await runInteractiveFund(runtime);
      return;
    }
  }

  const { verifyNow } = await inquirer.prompt([{ type: "confirm", name: "verifyNow", message: "Verify the setup now?", default: true }]);
  if (verifyNow) {
    await printVerify(false, runtime);
  }
}

export async function runHeadlessConnect(options: {
  runtime?: string;
  scope?: string;
  force?: boolean;
  apply?: boolean;
  allowWalletMutation?: boolean;
  claudeScope?: string;
  startProxy?: boolean;
}): Promise<void> {
  const runtime = options.runtime ? normalizeRuntime(options.runtime) : autoDetectProvider().name;
  const scope: EchoScope = options.scope === "user" || options.scope === "project"
    ? options.scope
    : defaultScopeForRuntime(runtime);

  if (!options.apply) {
    const snapshot = await buildEchoSnapshot({ includeReadiness: true, fresh: true });
    writeEchoWorkflow(buildConnectPayload(snapshot, runtime, scope, !!options.allowWalletMutation));
    return;
  }

  const result = await performConnectApply({
    runtime,
    scope,
    force: !!options.force,
    allowWalletMutation: !!options.allowWalletMutation,
    claudeScope: normalizeClaudeScope(options.claudeScope),
    startProxy: options.startProxy !== false,
  });

  const payload = result.payload.status === "ready"
    ? { ...result.payload, status: "applied" as const, summary: `${PROVIDER_LABELS[runtime]} setup actions applied successfully.` }
    : result.payload;

  writeEchoWorkflow({
    ...payload,
    appliedActions: result.appliedActions,
    skill: {
      status: result.skill.status,
      source: result.skill.source,
      target: result.skill.target,
      linkType: result.skill.linkType,
      additionalTargets: result.skill.additionalTargets ?? [],
      message: result.skill.message ?? null,
    },
    createdWalletAddress: result.createdWalletAddress,
  });
}

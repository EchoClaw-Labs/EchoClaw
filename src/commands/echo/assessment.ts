import { EchoError, ErrorCodes } from "../../errors.js";
import { autoDetectProvider, detectProviders, resolveProvider } from "../../providers/registry.js";
import type { ProviderName } from "../../providers/types.js";
import type { EchoSnapshot, SkillLinkStatus } from "./state.js";
import type { ComputeIssue, EchoScope, LauncherItem } from "./types.js";
import type { EchoWorkflowPayload } from "./protocol.js";
import { PROVIDER_LABELS } from "./catalog.js";

export function normalizeRuntime(raw: string): ProviderName {
  if (raw === "claude") return "claude-code";
  if (raw === "openclaw" || raw === "claude-code" || raw === "codex" || raw === "other") {
    return raw;
  }
  throw new EchoError(
    ErrorCodes.INVALID_AMOUNT,
    `Invalid runtime: ${raw}`,
    "Use one of: openclaw, claude-code, codex, other.",
  );
}

export function defaultScopeForRuntime(runtime: ProviderName): EchoScope {
  return runtime === "openclaw" ? "user" : "project";
}

export function runtimeChoiceName(runtime: ProviderName): string {
  const detected = detectProviders()[runtime];
  const detail = detected?.detail ? ` — ${detected.detail}` : "";
  const suffix = detected?.detected ? " (detected)" : "";
  return `${PROVIDER_LABELS[runtime]}${detail}${suffix}`;
}

export function findSkillStatus(snapshot: EchoSnapshot, runtime: ProviderName): SkillLinkStatus | undefined {
  return snapshot.runtimes.skills.find((entry) => entry.provider === runtime);
}

export function isSkillLinkedForScope(skill: SkillLinkStatus | undefined, scope: EchoScope): boolean {
  if (!skill) return false;
  return scope === "project"
    ? skill.projectLinked || skill.userLinked
    : skill.userLinked;
}

export function hasClaudeSettings(snapshot: EchoSnapshot): boolean {
  return snapshot.claude.settings.projectLocal.exists
    || snapshot.claude.settings.projectShared.exists
    || snapshot.claude.settings.user.exists;
}

export function buildManualSkillSteps(runtime: ProviderName, scope: EchoScope): string[] {
  const adapter = resolveProvider(runtime);
  const result = adapter.installSkill({ scope, force: false });
  const restart = adapter.getRestartInfo();

  return [
    `Skill source: ${result.source}`,
    `Target hint: ${result.target}`,
    ...(result.message ? [result.message] : []),
    ...restart.instructions,
  ];
}

export function getComputeIssue(runtime: ProviderName, snapshot: EchoSnapshot): ComputeIssue | null {
  const readiness = snapshot.compute.readiness;
  if (!readiness) return null;

  const checks = readiness.checks;
  const orderedChecks: Array<ComputeIssue & { ok: boolean }> = [
    {
      ok: checks.wallet.ok,
      nextAction: "wallet_setup",
      reasonCode: ErrorCodes.WALLET_NOT_CONFIGURED,
      summary: checks.wallet.detail ?? "Wallet is not configured.",
      hint: checks.wallet.hint,
    },
    {
      ok: checks.broker.ok,
      nextAction: "connect_compute_broker",
      reasonCode: ErrorCodes.ZG_BROKER_INIT_FAILED,
      summary: checks.broker.detail ?? "0G Compute broker is not reachable.",
      hint: checks.broker.hint,
    },
    {
      ok: checks.ledger.ok,
      nextAction: "deposit_ledger",
      reasonCode: ErrorCodes.ZG_LEDGER_NOT_FOUND,
      summary: checks.ledger.detail ?? "The compute ledger is missing.",
      hint: checks.ledger.hint,
    },
    {
      ok: checks.subAccount.ok,
      nextAction: "fund_provider",
      reasonCode: ErrorCodes.ZG_INSUFFICIENT_BALANCE,
      summary: checks.subAccount.detail ?? "The provider sub-account balance is too low.",
      hint: checks.subAccount.hint,
    },
    {
      ok: checks.ack.ok,
      nextAction: "ack_provider",
      reasonCode: ErrorCodes.ZG_ACKNOWLEDGE_FAILED,
      summary: checks.ack.detail ?? "The provider signer still needs acknowledgment.",
      hint: checks.ack.hint,
    },
  ];

  for (const entry of orderedChecks) {
    if (!entry.ok) {
      return entry;
    }
  }

  if (runtime === "openclaw" && !checks.openclawConfig.ok) {
    return {
      nextAction: "fix_openclaw_runtime",
      reasonCode: "OPENCLAW_RUNTIME_NOT_READY",
      summary: checks.openclawConfig.detail ?? "OpenClaw runtime wiring is not ready yet.",
      hint: checks.openclawConfig.hint,
    };
  }

  return null;
}

export function buildConnectPayload(
  snapshot: EchoSnapshot,
  runtime: ProviderName,
  scope: EchoScope,
  allowWalletMutation = false,
): EchoWorkflowPayload {
  const skill = findSkillStatus(snapshot, runtime);
  const linked = isSkillLinkedForScope(skill, scope);
  const warnings: string[] = [];
  const allowedAutoActions = ["link_skill"];
  const requiresApproval: string[] = [];

  if (runtime === "claude-code") {
    allowedAutoActions.push("inject_claude_config", "start_claude_proxy");
  }

  if (!snapshot.wallet.configuredAddress && !snapshot.wallet.keystorePresent && snapshot.wallet.password.status !== "missing") {
    allowedAutoActions.push("wallet_create");
  }

  if (snapshot.wallet.password.status === "drift") {
    warnings.push(`Keystore password drift detected across: ${snapshot.wallet.password.driftSources.join(", ")}`);
  }

  if (!snapshot.wallet.configuredAddress && !snapshot.wallet.keystorePresent && !allowWalletMutation) {
    requiresApproval.push("wallet_mutation");
  }

  if (runtime === "other") {
    return {
      phase: "connect",
      status: "manual_required",
      runtime,
      recommendedRuntime: snapshot.runtimes.recommended,
      summary: "Other runtime requires manual skill linking.",
      nextAction: "manual_skill_link",
      reasonCode: "MANUAL_SKILL_LINK_REQUIRED",
      allowedAutoActions: [],
      requiresApproval,
      manualSteps: buildManualSkillSteps(runtime, scope),
      warnings,
      scope,
      snapshot,
    };
  }

  if (!linked) {
    return {
      phase: "connect",
      status: "needs_action",
      runtime,
      recommendedRuntime: snapshot.runtimes.recommended,
      summary: `${PROVIDER_LABELS[runtime]} skill is not linked yet.`,
      nextAction: "link_skill",
      reasonCode: "SKILL_NOT_LINKED",
      allowedAutoActions,
      requiresApproval,
      warnings,
      manualSteps: [],
      scope,
      snapshot,
    };
  }

  if (runtime === "claude-code") {
    if (!snapshot.claude.configured) {
      return {
        phase: "connect",
        status: "needs_action",
        runtime,
        recommendedRuntime: snapshot.runtimes.recommended,
        summary: "Claude Code skill is linked, but the Claude runtime config is not set yet.",
        nextAction: "fund_ai",
        reasonCode: ErrorCodes.CLAUDE_CONFIG_NOT_CONFIGURED,
        allowedAutoActions,
        requiresApproval,
        warnings,
        manualSteps: [
          "Open 'Fund my AI in 0G' to choose a provider, fund it, ACK it, and create an API key.",
          "Then inject Claude settings and start the local proxy.",
        ],
        scope,
        snapshot,
      };
    }

    if (!hasClaudeSettings(snapshot)) {
      return {
        phase: "connect",
        status: "needs_action",
        runtime,
        recommendedRuntime: snapshot.runtimes.recommended,
        summary: "Claude Code still needs managed settings injection.",
        nextAction: "inject_claude_config",
        reasonCode: "CLAUDE_SETTINGS_NOT_INJECTED",
        allowedAutoActions,
        requiresApproval,
        warnings,
        manualSteps: [],
        scope,
        snapshot,
      };
    }

    if (!snapshot.claude.running) {
      return {
        phase: "connect",
        status: "needs_action",
        runtime,
        recommendedRuntime: snapshot.runtimes.recommended,
        summary: "Claude Code settings are present, but the local proxy is not running.",
        nextAction: "start_claude_proxy",
        reasonCode: ErrorCodes.CLAUDE_PROXY_NOT_RUNNING,
        allowedAutoActions,
        requiresApproval,
        warnings,
        manualSteps: [],
        scope,
        snapshot,
      };
    }

    if (!snapshot.claude.healthy) {
      return {
        phase: "connect",
        status: "needs_action",
        runtime,
        recommendedRuntime: snapshot.runtimes.recommended,
        summary: "Claude proxy is running, but the health endpoint is not reachable yet.",
        nextAction: "repair_claude_proxy",
        reasonCode: "CLAUDE_PROXY_UNHEALTHY",
        allowedAutoActions,
        requiresApproval,
        warnings,
        manualSteps: [],
        scope,
        snapshot,
      };
    }
  }

  const computeIssue = getComputeIssue(runtime, snapshot);
  if (computeIssue) {
    return {
      phase: "connect",
      status: "needs_action",
      runtime,
      recommendedRuntime: snapshot.runtimes.recommended,
      summary: computeIssue.summary,
      nextAction: computeIssue.nextAction,
      reasonCode: computeIssue.reasonCode,
      allowedAutoActions,
      requiresApproval,
      warnings,
      manualSteps: computeIssue.hint ? [computeIssue.hint] : [],
      scope,
      snapshot,
    };
  }

  return {
    phase: "connect",
    status: "ready",
    runtime,
    recommendedRuntime: snapshot.runtimes.recommended,
    summary: `${PROVIDER_LABELS[runtime]} is connected and ready to verify.`,
    nextAction: "verify_setup",
    reasonCode: null,
    allowedAutoActions,
    requiresApproval,
    warnings,
    manualSteps: resolveProvider(runtime).getRestartInfo().instructions,
    scope,
    snapshot,
  };
}

export function buildVerifyPayload(snapshot: EchoSnapshot, runtime: ProviderName): EchoWorkflowPayload {
  const connectPayload = buildConnectPayload(snapshot, runtime, defaultScopeForRuntime(runtime));
  if (connectPayload.status === "ready") {
    return {
      ...connectPayload,
      phase: "verify",
      summary: `${PROVIDER_LABELS[runtime]} passed the current verification checks.`,
      nextAction: null,
    };
  }

  return {
    ...connectPayload,
    phase: "verify",
    summary: `Verification still needs action: ${connectPayload.summary}`,
  };
}

export function describeLauncherItem(item: LauncherItem): string {
  return [
    `Badge: ${item.badge}`,
    item.description,
    "",
    "Starter command:",
    item.command,
  ].join("\n");
}

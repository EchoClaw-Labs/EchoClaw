import { Command, Option } from "commander";
import inquirer from "inquirer";
import { isHeadless, writeStderr } from "../utils/output.js";
import { colors } from "../utils/ui.js";
import { resolveProvider, autoDetectProvider, detectProviders } from "../providers/registry.js";
import { getSkillSourcePath } from "../providers/link-utils.js";
import type { ProviderName } from "../providers/types.js";

const ALLOWED_PROVIDERS = ["openclaw", "claude", "claude-code", "codex", "other"] as const;
const ALLOWED_SCOPES = ["user", "project"] as const;
type SkillScope = (typeof ALLOWED_SCOPES)[number];

function normalizeProvider(rawProvider: string): ProviderName {
  if (!ALLOWED_PROVIDERS.includes(rawProvider as (typeof ALLOWED_PROVIDERS)[number])) {
    throw new Error(`Invalid --provider "${rawProvider}". Valid: openclaw, claude, claude-code, codex, other`);
  }
  return (rawProvider === "claude" ? "claude-code" : rawProvider) as ProviderName;
}

function normalizeScope(rawScope?: string): SkillScope {
  const scope = rawScope ?? "user";
  if (!ALLOWED_SCOPES.includes(scope as SkillScope)) {
    throw new Error(`Invalid --scope "${scope}". Valid: user, project`);
  }
  return scope as SkillScope;
}

/**
 * Shared handler for skill installation.
 * Used by both `echoclaw skill install` and `echoclaw install` alias.
 */
export async function handleSkillInstall(opts: {
  provider?: string;
  scope?: string;
  force?: boolean;
}): Promise<void> {
  const scope = normalizeScope(opts.scope);

  // 1. Resolve provider
  let adapter;
  let providerName: ProviderName;

  if (opts.provider) {
    providerName = normalizeProvider(opts.provider);
    adapter = resolveProvider(providerName);
  } else if (isHeadless()) {
    adapter = autoDetectProvider();
    providerName = adapter.name;
  } else {
    providerName = await pickProvider();
    adapter = resolveProvider(providerName);
  }

  // 2. Install skill
  try {
    const result = adapter.installSkill({ scope, force: !!opts.force });

    if (result.status === "manual_required") {
      outputManualRequired(providerName, result.source, result.message);
      return;
    }

    const restart = adapter.getRestartInfo();

    if (isHeadless()) {
      process.stdout.write(JSON.stringify({
        success: true,
        status: "linked",
        provider: adapter.name,
        target: result.target,
        linkType: result.linkType,
        sourcePath: result.source,
        restart: restart.instructions.join(" "),
      }) + "\n");
    } else {
      writeStderr(colors.success(`  ✓ Skill linked: ${result.target}`));
      if (result.additionalTargets) {
        for (const at of result.additionalTargets) {
          if (at.linked) {
            writeStderr(colors.success(`  ✓ Also linked: ${at.target}`));
          }
        }
      }
      writeStderr(colors.info(`  ℹ ${restart.instructions.join("\n  ")}`));
    }
  } catch {
    // 3. Graceful fallback: link failure → manual_required
    const sourcePath = getSkillSourcePath("echoclaw");
    outputManualRequired(providerName, sourcePath);
  }
}

function outputManualRequired(
  providerName: string,
  sourcePath: string,
  message?: string,
): void {
  const msg = message ?? "Move or symlink this directory into your framework's skills directory.";
  if (isHeadless()) {
    process.stdout.write(JSON.stringify({
      success: true,
      status: "manual_required",
      provider: providerName,
      sourcePath,
      message: msg,
    }) + "\n");
  } else {
    writeStderr(colors.warn("  ⚠ Could not auto-link skill."));
    writeStderr(`  Source: ${colors.bold(sourcePath)}`);
    writeStderr(`  ${msg}`);
  }
}

async function pickProvider(): Promise<ProviderName> {
  const detected = detectProviders();

  const choices: Array<{ name: string; value: ProviderName }> = [];

  const providerList: Array<{ name: ProviderName; display: string; dir: string }> = [
    { name: "openclaw", display: "OpenClaw", dir: "~/.openclaw/skills/echoclaw" },
    { name: "claude-code", display: "Claude Code", dir: "~/.claude/skills/echoclaw" },
    { name: "codex", display: "Codex", dir: "~/.agents/skills/echoclaw" },
    { name: "other", display: "Other", dir: "show path for manual setup" },
  ];

  for (const p of providerList) {
    const det = detected[p.name];
    const suffix = det?.detected && p.name !== "other"
      ? colors.success(" (detected)")
      : "";
    choices.push({
      name: `${p.display.padEnd(12)} (${p.dir})${suffix}`,
      value: p.name,
    });
  }

  const { provider } = await inquirer.prompt([{
    type: "list",
    name: "provider",
    message: "Which AI agent platform?",
    choices,
  }]);

  return provider as ProviderName;
}

export function createSkillCommand(): Command {
  const root = new Command("skill")
    .description("Manage echoclaw skill installation for AI agent platforms");

  root.command("install")
    .description("Link echoclaw skill to your AI agent platform")
    .addOption(new Option("--provider <name>", "Provider: openclaw, claude, claude-code, codex, other").choices([...ALLOWED_PROVIDERS]))
    .addOption(new Option("--scope <scope>", "Install scope: user (default) or project").choices([...ALLOWED_SCOPES]).default("user"))
    .option("--force", "Overwrite existing skill installation")
    .action(handleSkillInstall);

  root.command("path")
    .description("Show the path to echoclaw skill source directory")
    .action(() => {
      const sourcePath = getSkillSourcePath("echoclaw");
      if (isHeadless()) {
        process.stdout.write(JSON.stringify({ sourcePath }) + "\n");
      } else {
        writeStderr(sourcePath);
      }
    });

  return root;
}

export function createInstallAlias(): Command {
  return new Command("install")
    .description("Alias for: echoclaw skill install")
    .addOption(new Option("--provider <name>", "Provider: openclaw, claude, claude-code, codex, other").choices([...ALLOWED_PROVIDERS]))
    .addOption(new Option("--scope <scope>", "Install scope: user (default) or project").choices([...ALLOWED_SCOPES]).default("user"))
    .option("--force", "Overwrite existing skill installation")
    .action(handleSkillInstall);
}

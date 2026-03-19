import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { Command } from "commander";
import { EchoError, ErrorCodes } from "../../errors.js";
import { respond } from "../../utils/respond.js";
import { loadConfig } from "../../config/store.js";
import {
  CLAUDE_CONFIG_BACKUP_DIR,
  CLAUDE_PROXY_DEFAULT_PORT,
  getClaudeDisplayModelLabel,
} from "../../claude/constants.js";
import logger from "../../utils/logger.js";

type ClaudeSettingsScope = "project-local" | "project-shared" | "user";

interface PathSnapshot {
  exists: boolean;
  value?: unknown;
}

interface BackupMeta {
  originalPath: string;
  backupFile: string;
  timestamp: number;
  originalHash: string;
  injectedHash: string;
  fileExistedBefore: boolean;
  managedKeys: string[];
  originalValues: Record<string, PathSnapshot>;
  managedValues: Record<string, unknown>;
}

const DEFAULT_ALIAS = "sonnet";
const MANAGED_MODEL_KEY_PATHS = [
  "env.ANTHROPIC_DEFAULT_SONNET_MODEL",
  "env.ANTHROPIC_DEFAULT_OPUS_MODEL",
  "env.ANTHROPIC_DEFAULT_HAIKU_MODEL",
  "env.CLAUDE_CODE_SUBAGENT_MODEL",
] as const;
const MANAGED_KEYS = [
  "model",
  "env.ANTHROPIC_BASE_URL",
  "env.ANTHROPIC_AUTH_TOKEN",
  ...MANAGED_MODEL_KEY_PATHS,
] as const;

function normalizeScope(scope: string): ClaudeSettingsScope {
  if (scope === "project-local" || scope === "project-shared" || scope === "user") {
    return scope;
  }

  throw new EchoError(
    ErrorCodes.CLAUDE_CONFIG_WRITE_FAILED,
    `Invalid Claude settings scope: ${scope}`,
    "Use one of: project-local, project-shared, user.",
  );
}

export function getSettingsPath(scope = "project-local"): string {
  const projectRoot = process.env.ECHOCLAW_CLAUDE_PROJECT_ROOT
    ? resolve(process.env.ECHOCLAW_CLAUDE_PROJECT_ROOT)
    : process.cwd();

  switch (normalizeScope(scope)) {
    case "user":
      return join(process.env.HOME ?? homedir(), ".claude", "settings.json");
    case "project-shared":
      return resolve(projectRoot, ".claude", "settings.json");
    case "project-local":
      return resolve(projectRoot, ".claude", "settings.local.json");
  }
}

function fileHash(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function getMetaId(settingsPath: string): string {
  return fileHash(resolve(settingsPath));
}

function getMetaPath(settingsPath: string): string {
  return join(CLAUDE_CONFIG_BACKUP_DIR, `${getMetaId(settingsPath)}.meta.json`);
}

function getBackupPath(settingsPath: string): string {
  return join(CLAUDE_CONFIG_BACKUP_DIR, `${getMetaId(settingsPath)}.settings.bak`);
}

function ensureBackupDir(): void {
  if (!existsSync(CLAUDE_CONFIG_BACKUP_DIR)) {
    mkdirSync(CLAUDE_CONFIG_BACKUP_DIR, { recursive: true });
  }
}

function readJsonFile(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};

  try {
    return JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
  } catch (err) {
    throw new EchoError(
      ErrorCodes.CLAUDE_CONFIG_PARSE_FAILED,
      `Failed to parse ${path}: ${err instanceof Error ? err.message : String(err)}`,
      "Fix the JSON file manually or restore it from backup before retrying.",
    );
  }
}

function readRawFile(path: string): string {
  return existsSync(path) ? readFileSync(path, "utf-8") : "";
}

function writeJsonAtomic(path: string, data: Record<string, unknown>): void {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const tmp = join(dir, `.tmp.${Date.now()}.json`);
  try {
    writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n", "utf-8");
    renameSync(tmp, path);
  } catch (err) {
    try {
      if (existsSync(tmp)) unlinkSync(tmp);
    } catch {
      // ignore cleanup
    }
    throw new EchoError(
      ErrorCodes.CLAUDE_CONFIG_WRITE_FAILED,
      `Failed to write ${path}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

function loadMeta(settingsPath: string): BackupMeta | null {
  const metaPath = getMetaPath(settingsPath);
  if (!existsSync(metaPath)) return null;

  try {
    return JSON.parse(readFileSync(metaPath, "utf-8")) as BackupMeta;
  } catch (err) {
    throw new EchoError(
      ErrorCodes.CLAUDE_CONFIG_PARSE_FAILED,
      `Failed to parse backup metadata for ${settingsPath}: ${err instanceof Error ? err.message : String(err)}`,
      "Delete the corrupt metadata file or restore manually.",
    );
  }
}

function saveMeta(settingsPath: string, meta: BackupMeta): void {
  ensureBackupDir();
  writeFileSync(getMetaPath(settingsPath), JSON.stringify(meta, null, 2) + "\n", "utf-8");
}

function cleanupBackupArtifacts(settingsPath: string): void {
  const backupPath = getBackupPath(settingsPath);
  const metaPath = getMetaPath(settingsPath);

  try {
    if (existsSync(backupPath)) unlinkSync(backupPath);
    if (existsSync(metaPath)) unlinkSync(metaPath);
  } catch {
    // ignore cleanup failures
  }
}

function getPathSnapshot(data: Record<string, unknown>, dotPath: string): PathSnapshot {
  const segments = dotPath.split(".");
  let cursor: unknown = data;

  for (const segment of segments) {
    if (cursor == null || typeof cursor !== "object" || Array.isArray(cursor) || !(segment in cursor)) {
      return { exists: false };
    }
    cursor = (cursor as Record<string, unknown>)[segment];
  }

  return { exists: true, value: cursor };
}

function setPathValue(data: Record<string, unknown>, dotPath: string, value: unknown): void {
  const segments = dotPath.split(".");
  let cursor: Record<string, unknown> = data;

  for (let i = 0; i < segments.length - 1; i++) {
    const segment = segments[i]!;
    const next = cursor[segment];
    if (next == null || typeof next !== "object" || Array.isArray(next)) {
      cursor[segment] = {};
    }
    cursor = cursor[segment] as Record<string, unknown>;
  }

  cursor[segments[segments.length - 1]!] = value;
}

function deletePathValue(data: Record<string, unknown>, dotPath: string): boolean {
  const segments = dotPath.split(".");
  const parents: Array<{ key: string; value: Record<string, unknown> }> = [];
  let cursor: Record<string, unknown> = data;

  for (let i = 0; i < segments.length - 1; i++) {
    const segment = segments[i]!;
    const next = cursor[segment];
    if (next == null || typeof next !== "object" || Array.isArray(next)) {
      return false;
    }
    parents.push({ key: segment, value: cursor });
    cursor = next as Record<string, unknown>;
  }

  const leaf = segments[segments.length - 1]!;
  if (!(leaf in cursor)) return false;
  delete cursor[leaf];

  for (let i = parents.length - 1; i >= 0; i--) {
    const { key, value } = parents[i]!;
    const child = value[key];
    if (child != null && typeof child === "object" && !Array.isArray(child) && Object.keys(child as Record<string, unknown>).length === 0) {
      delete value[key];
    }
  }

  return true;
}

function captureManagedValues(data: Record<string, unknown>): Record<string, PathSnapshot> {
  const result: Record<string, PathSnapshot> = {};
  for (const key of MANAGED_KEYS) {
    result[key] = getPathSnapshot(data, key);
  }
  return result;
}

function backfillManagedSnapshots(meta: BackupMeta, data: Record<string, unknown>): void {
  for (const key of MANAGED_KEYS) {
    if (!(key in meta.originalValues)) {
      meta.originalValues[key] = getPathSnapshot(data, key);
    }
  }
}

function buildManagedValues(cfg: ReturnType<typeof loadConfig>): Record<string, unknown> {
  if (!cfg.claude) {
    throw new EchoError(
      ErrorCodes.CLAUDE_CONFIG_NOT_CONFIGURED,
      "Claude integration not configured.",
      "Run: echoclaw echo first, or set Claude config manually under `echoclaw echo claude`.",
    );
  }

  const port = cfg.claude.proxyPort ?? CLAUDE_PROXY_DEFAULT_PORT;
  const displayModelLabel = getClaudeDisplayModelLabel(cfg.claude.model);
  const managedValues: Record<string, unknown> = {
    model: DEFAULT_ALIAS,
    "env.ANTHROPIC_BASE_URL": `http://127.0.0.1:${port}`,
    "env.ANTHROPIC_AUTH_TOKEN": "passthrough",
  };

  for (const key of MANAGED_MODEL_KEY_PATHS) {
    managedValues[key] = displayModelLabel;
  }

  return managedValues;
}

function applyManagedValues(
  target: Record<string, unknown>,
  managedValues: Record<string, unknown>,
): void {
  for (const [key, value] of Object.entries(managedValues)) {
    setPathValue(target, key, value);
  }
}

function updateInjectedHash(settingsPath: string, meta: BackupMeta): void {
  meta.injectedHash = fileHash(readRawFile(settingsPath));
  saveMeta(settingsPath, meta);
}

/**
 * Inject Claude Code settings for 0G proxy into a settings file.
 * Reusable by both `config inject` and the `claude` root wizard.
 */
export function injectClaudeSettings(
  cfg: ReturnType<typeof loadConfig>,
  scope = "project-local",
): { settingsPath: string; port: number; managedValues: Record<string, unknown> } {
  if (!cfg.claude) {
    throw new EchoError(
      ErrorCodes.CLAUDE_CONFIG_NOT_CONFIGURED,
      "Claude integration not configured.",
      "Run: echoclaw echo first, or set Claude config manually under `echoclaw echo claude`.",
    );
  }

  const settingsPath = getSettingsPath(scope);
  const fileExisted = existsSync(settingsPath);
  const originalContent = readRawFile(settingsPath);
  const existing = readJsonFile(settingsPath);
  const managedValues = buildManagedValues(cfg);

  let meta = loadMeta(settingsPath);
  if (!meta) {
    ensureBackupDir();
    meta = {
      originalPath: settingsPath,
      backupFile: getBackupPath(settingsPath),
      timestamp: Date.now(),
      originalHash: fileExisted ? fileHash(originalContent) : "",
      injectedHash: "",
      fileExistedBefore: fileExisted,
      managedKeys: [...MANAGED_KEYS],
      originalValues: captureManagedValues(existing),
      managedValues,
    };

    if (fileExisted) {
      copyFileSync(settingsPath, meta.backupFile);
      logger.debug(`[claude-config] Backed up ${settingsPath}`);
    }
  } else {
    backfillManagedSnapshots(meta, existing);
    meta.managedKeys = [...MANAGED_KEYS];
    meta.managedValues = managedValues;
  }

  applyManagedValues(existing, managedValues);
  writeJsonAtomic(settingsPath, existing);
  updateInjectedHash(settingsPath, meta);

  return {
    settingsPath,
    port: cfg.claude.proxyPort ?? CLAUDE_PROXY_DEFAULT_PORT,
    managedValues,
  };
}

export function removeClaudeSettings(scope = "project-local"): {
  changed: boolean;
  path: string;
  removed: string[];
  restored: string[];
  skipped: string[];
  reason?: string;
} {
  const settingsPath = getSettingsPath(scope);
  if (!existsSync(settingsPath)) {
    return { changed: false, path: settingsPath, removed: [], restored: [], skipped: [], reason: "file_not_found" };
  }

  const meta = loadMeta(settingsPath);
  if (!meta) {
    return { changed: false, path: settingsPath, removed: [], restored: [], skipped: [], reason: "no_backup_metadata" };
  }

  const existing = readJsonFile(settingsPath);
  const removed: string[] = [];
  const restored: string[] = [];
  const skipped: string[] = [];
  let changed = false;

  for (const key of meta.managedKeys) {
    const current = getPathSnapshot(existing, key);
    if (!current.exists) continue;

    if (!deepEqual(current.value, meta.managedValues[key])) {
      skipped.push(key);
      continue;
    }

    const original = meta.originalValues[key] ?? { exists: false };
    if (original.exists) {
      setPathValue(existing, key, original.value);
      restored.push(key);
    } else if (deletePathValue(existing, key)) {
      removed.push(key);
    }
    changed = true;
  }

  if (changed) {
    writeJsonAtomic(settingsPath, existing);
    updateInjectedHash(settingsPath, meta);
  }

  return { changed, path: settingsPath, removed, restored, skipped };
}

export function restoreClaudeSettings(
  scope = "project-local",
  opts?: { force?: boolean },
): { path: string; fileExistedBefore: boolean } {
  const settingsPath = getSettingsPath(scope);
  const meta = loadMeta(settingsPath);

  if (!meta) {
    throw new EchoError(
      ErrorCodes.CLAUDE_CONFIG_RESTORE_FAILED,
      `No backup found for ${settingsPath}.`,
      "Config inject must be run for this scope before restore is available.",
    );
  }

  if (existsSync(settingsPath) && meta.injectedHash) {
    const currentHash = fileHash(readRawFile(settingsPath));
    if (currentHash !== meta.injectedHash && !opts?.force) {
      throw new EchoError(
        ErrorCodes.CLAUDE_CONFIG_RESTORE_FAILED,
        `${settingsPath} was modified after echoclaw injection.`,
        "Re-run with --force if you want to overwrite those changes.",
      );
    }
  }

  if (!meta.fileExistedBefore) {
    if (existsSync(settingsPath)) {
      unlinkSync(settingsPath);
    }
  } else if (!existsSync(meta.backupFile)) {
    throw new EchoError(
      ErrorCodes.CLAUDE_CONFIG_RESTORE_FAILED,
      `Backup file not found: ${meta.backupFile}`,
    );
  } else {
    const dir = dirname(settingsPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    copyFileSync(meta.backupFile, settingsPath);
  }

  cleanupBackupArtifacts(settingsPath);

  return { path: settingsPath, fileExistedBefore: meta.fileExistedBefore };
}

export function createConfigSubcommand(): Command {
  const config = new Command("config").description("Claude Code settings management");

  config
    .command("show")
    .description("Show current Claude integration config")
    .option("--scope <scope>", "Settings scope: project-local, user, project-shared", "project-local")
    .option("--json", "JSON output")
    .action(async (options: { scope: string }) => {
      const cfg = loadConfig();
      const settingsPath = getSettingsPath(options.scope);
      const meta = loadMeta(settingsPath);
      const authConfigured = !!process.env.ZG_CLAUDE_AUTH_TOKEN;

      respond({
        data: {
          configured: !!cfg.claude,
          provider: cfg.claude?.provider ?? null,
          model: cfg.claude?.model ?? null,
          displayModelLabel: cfg.claude ? getClaudeDisplayModelLabel(cfg.claude.model) : null,
          providerEndpoint: cfg.claude?.providerEndpoint ?? null,
          proxyPort: cfg.claude?.proxyPort ?? CLAUDE_PROXY_DEFAULT_PORT,
          authConfigured,
          scope: normalizeScope(options.scope),
          settingsPath,
          settingsExists: existsSync(settingsPath),
          backupExists: !!meta,
        },
        ui: {
          type: cfg.claude ? "info" : "warn",
          title: "Claude Integration",
          body: cfg.claude
            ? [
                `Provider: ${cfg.claude.provider.slice(0, 10)}...`,
                `Model:    ${cfg.claude.model}`,
                `Claude:   ${getClaudeDisplayModelLabel(cfg.claude.model)}`,
                `Endpoint: ${cfg.claude.providerEndpoint}`,
                `Port:     ${cfg.claude.proxyPort ?? CLAUDE_PROXY_DEFAULT_PORT}`,
                `Auth:     ${authConfigured ? "configured" : "NOT SET"}`,
                `Scope:    ${normalizeScope(options.scope)}`,
                `Settings: ${settingsPath}`,
                `Backup:   ${meta ? "present" : "none"}`,
              ].join("\n")
            : "Not configured. Use echoclaw echo first.",
        },
      });
    });

  config
    .command("inject")
    .description("Write Claude Code settings for 0G proxy")
    .option("--scope <scope>", "Settings scope: project-local, user, project-shared", "project-local")
    .option("--json", "JSON output")
    .action(async (options: { scope: string }) => {
      const cfg = loadConfig();
      const { settingsPath, port } = injectClaudeSettings(cfg, options.scope);

      respond({
        data: {
          path: settingsPath,
          scope: normalizeScope(options.scope),
          model: DEFAULT_ALIAS,
          targetModel: getClaudeDisplayModelLabel(cfg.claude!.model),
          providerModel: cfg.claude!.model,
          baseUrl: `http://127.0.0.1:${port}`,
        },
        ui: {
          type: "success",
          title: "Claude Config Injected",
          body: [
            `File:  ${settingsPath}`,
            `Model: ${DEFAULT_ALIAS} → ${getClaudeDisplayModelLabel(cfg.claude!.model)}`,
            `0G:    ${cfg.claude!.model}`,
            `URL:   http://127.0.0.1:${port}`,
            "",
            "Next: echoclaw echo claude proxy start",
          ].join("\n"),
        },
      });
    });

  config
    .command("remove")
    .description("Remove only echoclaw-managed Claude settings")
    .option("--scope <scope>", "Settings scope: project-local, user, project-shared", "project-local")
    .option("--json", "JSON output")
    .action(async (options: { scope: string }) => {
      const result = removeClaudeSettings(options.scope);

      respond({
        data: {
          removed: result.changed,
          path: result.path,
          removedKeys: result.removed,
          restoredKeys: result.restored,
          skippedKeys: result.skipped,
          reason: result.reason ?? null,
        },
        ui: {
          type: result.changed ? "success" : "info",
          title: "Claude Config Remove",
          body: result.changed
            ? [
                `File: ${result.path}`,
                ...(result.restored.length > 0 ? [`Restored: ${result.restored.join(", ")}`] : []),
                ...(result.removed.length > 0 ? [`Removed:  ${result.removed.join(", ")}`] : []),
                ...(result.skipped.length > 0 ? [`Skipped:  ${result.skipped.join(", ")}`] : []),
              ].join("\n")
            : result.reason === "no_backup_metadata"
              ? `No echoclaw backup metadata found for ${result.path}`
              : `No removable echoclaw-managed settings found in ${result.path}`,
        },
      });
    });

  config
    .command("restore")
    .description("Restore Claude settings from backup snapshot")
    .option("--scope <scope>", "Settings scope: project-local, user, project-shared", "project-local")
    .option("--force", "Overwrite changes made after echoclaw injection")
    .option("--json", "JSON output")
    .action(async (options: { scope: string; force?: boolean }) => {
      const restored = restoreClaudeSettings(options.scope, { force: options.force });

      respond({
        data: {
          restored: true,
          path: restored.path,
          fileExistedBefore: restored.fileExistedBefore,
        },
        ui: {
          type: "success",
          title: "Claude Config Restored",
          body: restored.fileExistedBefore
            ? `Restored original ${restored.path}`
            : `Removed ${restored.path} (it did not exist before injection)`,
        },
      });
    });

  return config;
}

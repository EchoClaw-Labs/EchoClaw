import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import JSON5 from "json5";
import { EchoError, ErrorCodes } from "../errors.js";
import logger from "../utils/logger.js";

export interface PatchResult {
  status: "created" | "updated" | "exists";
  path: string;
  keysSet: string[];
  keysSkipped: string[];
}

/**
 * Resolve the path to openclaw.json.
 * Priority:
 *   1. OPENCLAW_CONFIG_PATH (full path to file)
 *   2. OPENCLAW_HOME → join(OPENCLAW_HOME, "openclaw.json")
 *   3. fallback: ~/.openclaw/openclaw.json
 */
export function getOpenclawConfigPath(): string {
  if (process.env.OPENCLAW_CONFIG_PATH) {
    return process.env.OPENCLAW_CONFIG_PATH;
  }
  if (process.env.OPENCLAW_HOME) {
    return join(process.env.OPENCLAW_HOME, "openclaw.json");
  }
  return join(homedir(), ".openclaw", "openclaw.json");
}

/**
 * Load openclaw.json (supports JSON5: comments, trailing commas).
 * Returns null if file does not exist.
 * Throws EchoError on parse failure.
 */
export function loadOpenclawConfig(): Record<string, any> | null {
  const configPath = getOpenclawConfigPath();
  if (!existsSync(configPath)) {
    return null;
  }

  try {
    const raw = readFileSync(configPath, "utf-8");
    return JSON5.parse(raw) as Record<string, any>;
  } catch (err) {
    throw new EchoError(
      ErrorCodes.OPENCLAW_CONFIG_PARSE_FAILED,
      `Failed to parse ${configPath}: ${err instanceof Error ? err.message : String(err)}`,
      "Check that openclaw.json is valid JSON or JSON5."
    );
  }
}

/**
 * Patch env vars in openclaw.json at skills.entries.<skillKey>.env.
 * Per-key: existing keys are skipped unless force=true.
 * Writes standard JSON (JSON5 comments/formatting are lost — intentional).
 */
export function patchOpenclawSkillEnv(
  skillKey: string,
  env: Record<string, string>,
  opts?: { force?: boolean }
): PatchResult {
  const configPath = getOpenclawConfigPath();
  const fileExisted = existsSync(configPath);
  const force = opts?.force ?? false;

  // Load or start fresh
  let data: Record<string, any>;
  if (fileExisted) {
    data = loadOpenclawConfig() ?? {};
  } else {
    data = {};
  }

  // Ensure nested path: skills.entries.<skillKey>.env
  if (!data.skills || typeof data.skills !== "object") {
    data.skills = {};
  }
  if (!data.skills.entries || typeof data.skills.entries !== "object") {
    data.skills.entries = {};
  }
  if (!data.skills.entries[skillKey] || typeof data.skills.entries[skillKey] !== "object") {
    data.skills.entries[skillKey] = {};
  }
  if (!data.skills.entries[skillKey].env || typeof data.skills.entries[skillKey].env !== "object") {
    data.skills.entries[skillKey].env = {};
  }

  const envTarget = data.skills.entries[skillKey].env as Record<string, string>;
  const keysSet: string[] = [];
  const keysSkipped: string[] = [];

  for (const [key, value] of Object.entries(env)) {
    if (key in envTarget && !force) {
      keysSkipped.push(key);
    } else {
      envTarget[key] = value;
      keysSet.push(key);
    }
  }

  // Log keys only (never values)
  if (keysSet.length > 0) {
    logger.debug(`OpenClaw config: setting keys [${keysSet.join(", ")}] for skill "${skillKey}"`);
  }
  if (keysSkipped.length > 0) {
    logger.debug(`OpenClaw config: skipped existing keys [${keysSkipped.join(", ")}] (use --force to overwrite)`);
  }

  // Determine status before write
  let status: PatchResult["status"];
  if (!fileExisted) {
    status = "created";
  } else if (keysSet.length > 0) {
    status = "updated";
  } else {
    status = "exists";
  }

  // Only write if something changed
  if (status !== "exists") {
    const dir = dirname(configPath);
    mkdirSync(dir, { recursive: true });

    const tmpFile = join(dir, `.openclaw.tmp.${Date.now()}.json`);
    try {
      writeFileSync(tmpFile, JSON.stringify(data, null, 2), { encoding: "utf-8", mode: 0o600 });
      renameSync(tmpFile, configPath);
    } catch (err) {
      try {
        if (existsSync(tmpFile)) unlinkSync(tmpFile);
      } catch {
        // ignore cleanup
      }
      throw new EchoError(
        ErrorCodes.OPENCLAW_CONFIG_WRITE_FAILED,
        `Failed to write ${configPath}: ${err instanceof Error ? err.message : String(err)}`,
        "Check file permissions on the .openclaw directory."
      );
    }
  }

  return { status, path: configPath, keysSet, keysSkipped };
}

/**
 * Generic deep-set patcher for openclaw.json.
 * Sets a value at an arbitrary dot-separated path (e.g. "models.providers.zg").
 *
 * Options:
 * - force: overwrite existing value (default: false — skip if path already exists)
 * - merge: shallow-merge object values at the target path (default: true for objects)
 *
 * JSON5 input → standard JSON output (comments/formatting lost — intentional).
 */
export function patchOpenclawConfig(
  dotPath: string,
  value: unknown,
  opts?: { force?: boolean; merge?: boolean }
): PatchResult {
  const configPath = getOpenclawConfigPath();
  const fileExisted = existsSync(configPath);
  const force = opts?.force ?? false;
  const merge = opts?.merge ?? true;

  let data: Record<string, any>;
  if (fileExisted) {
    data = loadOpenclawConfig() ?? {};
  } else {
    data = {};
  }

  const segments = dotPath.split(".");
  const lastKey = segments[segments.length - 1]!;
  let cursor: Record<string, any> = data;

  // Walk path, create intermediate objects as needed
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i]!;
    if (!cursor[seg] || typeof cursor[seg] !== "object") {
      cursor[seg] = {};
    }
    cursor = cursor[seg] as Record<string, any>;
  }

  const keysSet: string[] = [];
  const keysSkipped: string[] = [];

  const existing = cursor[lastKey];
  const pathExists = lastKey in cursor;

  if (pathExists && !force && !merge) {
    keysSkipped.push(dotPath);
  } else if (
    pathExists &&
    !force &&
    merge &&
    typeof existing === "object" &&
    existing !== null &&
    !Array.isArray(existing) &&
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  ) {
    // Shallow merge: only set keys that don't already exist
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k in existing) {
        keysSkipped.push(`${dotPath}.${k}`);
      } else {
        existing[k] = v;
        keysSet.push(`${dotPath}.${k}`);
      }
    }
  } else if (pathExists && force) {
    cursor[lastKey] = value;
    keysSet.push(dotPath);
  } else if (!pathExists) {
    cursor[lastKey] = value;
    keysSet.push(dotPath);
  } else {
    keysSkipped.push(dotPath);
  }

  if (keysSet.length > 0) {
    logger.debug(`OpenClaw config: set [${keysSet.join(", ")}] at "${dotPath}"`);
  }
  if (keysSkipped.length > 0) {
    logger.debug(`OpenClaw config: skipped [${keysSkipped.join(", ")}] at "${dotPath}" (use --force to overwrite)`);
  }

  let status: PatchResult["status"];
  if (!fileExisted) {
    status = "created";
  } else if (keysSet.length > 0) {
    status = "updated";
  } else {
    status = "exists";
  }

  if (status !== "exists") {
    const dir = dirname(configPath);
    mkdirSync(dir, { recursive: true });

    const tmpFile = join(dir, `.openclaw.tmp.${Date.now()}.json`);
    try {
      writeFileSync(tmpFile, JSON.stringify(data, null, 2), { encoding: "utf-8", mode: 0o600 });
      renameSync(tmpFile, configPath);
    } catch (err) {
      try {
        if (existsSync(tmpFile)) unlinkSync(tmpFile);
      } catch {
        // ignore cleanup
      }
      throw new EchoError(
        ErrorCodes.OPENCLAW_CONFIG_WRITE_FAILED,
        `Failed to write ${configPath}: ${err instanceof Error ? err.message : String(err)}`,
        "Check file permissions on the .openclaw directory."
      );
    }
  }

  return { status, path: configPath, keysSet, keysSkipped };
}

/**
 * Remove a key at a dot-separated path from openclaw.json.
 * Idempotent: returns false if file or key does not exist.
 */
export function removeOpenclawConfigKey(dotPath: string): boolean {
  const configPath = getOpenclawConfigPath();
  if (!existsSync(configPath)) return false;

  const data = loadOpenclawConfig();
  if (!data) return false;

  const segments = dotPath.split(".");
  const lastKey = segments[segments.length - 1]!;
  let cursor: Record<string, any> = data;

  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i]!;
    if (!cursor[seg] || typeof cursor[seg] !== "object") return false;
    cursor = cursor[seg] as Record<string, any>;
  }

  if (!(lastKey in cursor)) return false;
  delete cursor[lastKey];

  const dir = dirname(configPath);
  const tmpFile = join(dir, `.openclaw.tmp.${Date.now()}.json`);
  try {
    writeFileSync(tmpFile, JSON.stringify(data, null, 2), { encoding: "utf-8", mode: 0o600 });
    renameSync(tmpFile, configPath);
  } catch (err) {
    try { if (existsSync(tmpFile)) unlinkSync(tmpFile); } catch { /* ignore */ }
    throw new EchoError(
      ErrorCodes.OPENCLAW_CONFIG_WRITE_FAILED,
      `Failed to write ${configPath}: ${err instanceof Error ? err.message : String(err)}`,
      "Check file permissions on the .openclaw directory."
    );
  }

  logger.debug(`OpenClaw config: removed key "${dotPath}"`);
  return true;
}

/** Resolve OpenClaw home directory. */
export function getOpenclawHome(): string {
  return process.env.OPENCLAW_HOME ?? join(homedir(), ".openclaw");
}
// ── Env var extraction ──────────────────────────────────────────────

/**
 * Read OPENCLAW_HOOKS_* entries from the skill env in openclaw.json.
 * Returns a plain object suitable for merging into a child process env.
 * Returns empty object if config is missing or skill has no env.
 */
export function getSkillHooksEnv(skillKey = "echoclaw"): Record<string, string> {
  try {
    const config = loadOpenclawConfig();
    if (!config) return {};
    const skillEnv = (config.skills?.entries?.[skillKey]?.env ?? {}) as Record<string, unknown>;
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(skillEnv)) {
      if (key.startsWith("OPENCLAW_HOOKS_") && typeof value === "string") {
        result[key] = value;
      }
    }
    return result;
  } catch {
    return {};
  }
}

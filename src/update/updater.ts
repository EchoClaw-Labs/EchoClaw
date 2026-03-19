/**
 * Reusable update-check logic.
 * Extracted from cli.ts for shared use by one-shot CLI bootstrap
 * and explicit `echoclaw update check`.
 */

import {
  existsSync,
  openSync,
  closeSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";
import { CONFIG_DIR } from "../config/paths.js";
import { ensureConfigDir } from "../config/store.js";
import { fetchJson } from "../utils/http.js";
import { isHeadless } from "../utils/output.js";
import { isAutoUpdateEnabled } from "./auto-update-preference.js";
import logger from "../utils/logger.js";

// ── Constants ────────────────────────────────────────────────────────

export const UPDATE_CHECK_FILE = join(CONFIG_DIR, "update-check.json");
export const UPDATE_LOCK_FILE = join(CONFIG_DIR, "update-check.lock");
export const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;
export const UPDATE_CHECK_TIMEOUT_MS = 1500;
export const AUTO_UPDATE_LOCK_STALE_MS = 10 * 60 * 1000;

const NPM_REGISTRY_URL = "https://registry.npmjs.org/@echoclaw%2Fecho/latest";
const NPM_PACKAGE_SPEC = "@echoclaw/echo@latest";

// ── Types ────────────────────────────────────────────────────────────

export interface UpdateCheckState {
  lastCheckedAtMs: number;
  lastNotifiedVersion?: string;
  lastAutoUpdateAttemptAtMs?: number;
}

export interface UpdateCheckResult {
  checked: boolean;
  currentVersion: string;
  latestVersion: string | null;
  isNewer: boolean;
  action: "skipped" | "up-to-date" | "notified" | "already-notified" | "auto-updated" | "rate-limited" | "disabled";
}

// ── Pure helpers ─────────────────────────────────────────────────────

export function compareSemver(a: string, b: string): number {
  const aMain = a.split("-")[0] ?? a;
  const bMain = b.split("-")[0] ?? b;

  const aParts = aMain.split(".").map((p) => Number(p));
  const bParts = bMain.split(".").map((p) => Number(p));

  for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
    const av = aParts[i] ?? 0;
    const bv = bParts[i] ?? 0;
    if (av > bv) return 1;
    if (av < bv) return -1;
  }

  return 0;
}

export function loadUpdateCheckState(): UpdateCheckState | null {
  if (!existsSync(UPDATE_CHECK_FILE)) return null;
  try {
    const raw = readFileSync(UPDATE_CHECK_FILE, "utf-8");
    const parsed = JSON.parse(raw) as UpdateCheckState;
    if (typeof parsed.lastCheckedAtMs !== "number") return null;
    if (parsed.lastNotifiedVersion && typeof parsed.lastNotifiedVersion !== "string") return null;
    if (parsed.lastAutoUpdateAttemptAtMs && typeof parsed.lastAutoUpdateAttemptAtMs !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveUpdateCheckState(state: UpdateCheckState): void {
  ensureConfigDir();
  const dir = dirname(UPDATE_CHECK_FILE);
  const tmpFile = join(dir, `.update-check.tmp.${Date.now()}.json`);

  try {
    writeFileSync(tmpFile, JSON.stringify(state, null, 2), "utf-8");
    renameSync(tmpFile, UPDATE_CHECK_FILE);
  } catch {
    try {
      if (existsSync(tmpFile)) unlinkSync(tmpFile);
    } catch {
      // ignore
    }
  }
}

export function tryAcquireUpdateLock(): boolean {
  ensureConfigDir();

  try {
    const fd = openSync(UPDATE_LOCK_FILE, "wx");
    try {
      writeFileSync(fd, String(Date.now()), "utf-8");
    } finally {
      closeSync(fd);
    }
    return true;
  } catch {
    // Lock exists; if stale, best-effort remove and retry once.
    try {
      const raw = readFileSync(UPDATE_LOCK_FILE, "utf-8");
      const ts = Number(raw.trim());
      if (Number.isFinite(ts) && Date.now() - ts > AUTO_UPDATE_LOCK_STALE_MS) {
        unlinkSync(UPDATE_LOCK_FILE);
        const fd = openSync(UPDATE_LOCK_FILE, "wx");
        try {
          writeFileSync(fd, String(Date.now()), "utf-8");
        } finally {
          closeSync(fd);
        }
        return true;
      }
    } catch {
      // ignore
    }
    return false;
  }
}

export function releaseUpdateLock(): void {
  try {
    if (existsSync(UPDATE_LOCK_FILE)) {
      unlinkSync(UPDATE_LOCK_FILE);
    }
  } catch {
    // ignore
  }
}

// ── Registry fetch ───────────────────────────────────────────────────

export async function fetchLatestVersion(): Promise<string | null> {
  try {
    const latest = await fetchJson<{ version?: string }>(
      NPM_REGISTRY_URL,
      { timeoutMs: UPDATE_CHECK_TIMEOUT_MS },
    );
    return typeof latest.version === "string" ? latest.version : null;
  } catch {
    return null;
  }
}

// ── npm install spawn ────────────────────────────────────────────────

export function spawnNpmInstall(): number | null {
  try {
    const child = spawn(
      "npm",
      ["install", "-g", NPM_PACKAGE_SPEC, "--no-fund", "--no-audit"],
      {
        stdio: "ignore",
        windowsHide: true,
        detached: true,
        shell: process.platform === "win32",
      },
    );
    // Async spawn errors (e.g. ENOENT on Windows) come via event, not throw
    child.on("error", (err) => {
      logger.warn(`Auto-update spawn failed (async): ${err.message}`);
    });
    child.unref();
    return child.pid ?? null;
  } catch (err) {
    logger.warn(`Auto-update spawn failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

// ── Main check function ──────────────────────────────────────────────

export async function checkForUpdates(
  currentVersion: string,
  opts?: { forceCheck?: boolean; readOnly?: boolean },
): Promise<UpdateCheckResult> {
  const result: UpdateCheckResult = {
    checked: false,
    currentVersion,
    latestVersion: null,
    isNewer: false,
    action: "skipped",
  };

  if (process.env.ECHO_DISABLE_UPDATE_CHECK === "1") {
    result.action = "disabled";
    return result;
  }

  const readOnly = opts?.readOnly ?? false;
  const autoUpdateEnabled = readOnly ? false : isAutoUpdateEnabled();
  if (!readOnly && isHeadless() && !autoUpdateEnabled) return result;

  const argv = process.argv;
  if (argv.includes("--help") || argv.includes("-h") || argv.includes("--version") || argv.includes("-V")) {
    return result;
  }

  // Rate limiting (skip if forced)
  if (!opts?.forceCheck) {
    const state = loadUpdateCheckState();
    if (state && Date.now() - state.lastCheckedAtMs < UPDATE_CHECK_INTERVAL_MS) {
      result.action = "rate-limited";
      return result;
    }
  }

  const latestVersion = await fetchLatestVersion();
  result.checked = true;
  result.latestVersion = latestVersion;

  if (!latestVersion) {
    if (!readOnly) saveUpdateCheckState({ lastCheckedAtMs: Date.now() });
    return result;
  }

  const isNewer = compareSemver(latestVersion, currentVersion) > 0;
  result.isNewer = isNewer;

  if (!isNewer) {
    if (!readOnly) saveUpdateCheckState({ lastCheckedAtMs: Date.now() });
    result.action = "up-to-date";
    return result;
  }

  if (autoUpdateEnabled) {
    const state = loadUpdateCheckState();
    const lastAttempt = state?.lastAutoUpdateAttemptAtMs ?? 0;
    if (!opts?.forceCheck && lastAttempt && Date.now() - lastAttempt < UPDATE_CHECK_INTERVAL_MS) {
      saveUpdateCheckState({ lastCheckedAtMs: Date.now(), lastAutoUpdateAttemptAtMs: lastAttempt });
      result.action = "rate-limited";
      return result;
    }

    if (!tryAcquireUpdateLock()) {
      saveUpdateCheckState({ lastCheckedAtMs: Date.now(), lastAutoUpdateAttemptAtMs: Date.now() });
      result.action = "rate-limited";
      return result;
    }

    saveUpdateCheckState({ lastCheckedAtMs: Date.now(), lastAutoUpdateAttemptAtMs: Date.now() });

    logger.info(`Auto-updating echoclaw to ${latestVersion} (current ${currentVersion}) via npm...`);
    const pid = spawnNpmInstall();
    if (pid == null) {
      releaseUpdateLock();
      return result;
    }

    result.action = "auto-updated";
    return result;
  }

  // Non-auto-update: just notify
  const state = loadUpdateCheckState();
  const nextState: UpdateCheckState = {
    lastCheckedAtMs: Date.now(),
    lastNotifiedVersion: latestVersion,
  };

  if (state?.lastNotifiedVersion === latestVersion) {
    if (!readOnly) saveUpdateCheckState(nextState);
    result.action = "already-notified";
    return result;
  }

  logger.info(
    `New echoclaw version available: ${latestVersion} (current ${currentVersion}). Update: npm i -g @echoclaw/echo@latest`,
  );
  if (!readOnly) saveUpdateCheckState(nextState);
  result.action = "notified";
  return result;
}

/**
 * Centralized auto-update preference management.
 * Single source of truth for reading/writing ECHO_AUTO_UPDATE preference.
 *
 * Preference sources (checked in order):
 *   1. ECHO_DISABLE_UPDATE_CHECK=1
 *   2. process.env.ECHO_AUTO_UPDATE
 *   3. App .env (~/.config/echoclaw/.env)
 */

import { ENV_FILE } from "../config/paths.js";
import {
  readEnvValue,
  writeAppEnvValue,
} from "../providers/env-resolution.js";
import logger from "../utils/logger.js";

export type AutoUpdatePreferenceSource =
  | "disable-flag"
  | "process-env"
  | "app-env"
  | "none";

export interface AutoUpdatePreferenceState {
  enabled: boolean;
  explicit: boolean;
  source: AutoUpdatePreferenceSource;
  value: string | null;
}

function buildPreferenceState(
  source: AutoUpdatePreferenceSource,
  value: string | null,
  explicit: boolean,
): AutoUpdatePreferenceState {
  return {
    enabled: value === "1" && source !== "disable-flag",
    explicit,
    source,
    value,
  };
}

export function getAutoUpdatePreference(): AutoUpdatePreferenceState {
  if (process.env.ECHO_DISABLE_UPDATE_CHECK === "1") {
    return buildPreferenceState("disable-flag", "0", true);
  }

  if (process.env.ECHO_AUTO_UPDATE !== undefined) {
    return buildPreferenceState("process-env", process.env.ECHO_AUTO_UPDATE, true);
  }

  const appValue = readEnvValue("ECHO_AUTO_UPDATE", ENV_FILE);
  if (appValue !== null) {
    return buildPreferenceState("app-env", appValue, true);
  }

  return buildPreferenceState("none", null, false);
}

/**
 * Check whether the user has set an explicit auto-update preference
 * through any supported channel. Returns true if any explicit signal exists,
 * meaning we should NOT seed a default.
 */
export function hasExplicitAutoUpdatePreference(): boolean {
  return getAutoUpdatePreference().explicit;
}

export function hasExplicitNonLegacyAutoUpdatePreference(): boolean {
  return getAutoUpdatePreference().explicit;
}

export function setAutoUpdatePreference(enabled: boolean): string {
  const value = enabled ? "1" : "0";
  const appPath = writeAppEnvValue("ECHO_AUTO_UPDATE", value);
  process.env.ECHO_AUTO_UPDATE = value;
  return appPath;
}

/**
 * Seed ECHO_AUTO_UPDATE=1 if no explicit preference exists.
 * Idempotent — safe to call on every CLI start.
 * Best-effort: write failure logs a warning but does not break CLI.
 */
export function ensureAutoUpdateDefault(): void {
  if (hasExplicitAutoUpdatePreference()) return;

  try {
    setAutoUpdatePreference(true);
    logger.info("Auto-update enabled by default. Opt out: ECHO_AUTO_UPDATE=0 or echoclaw update disable");
  } catch (err) {
    logger.warn(
      `Failed to seed auto-update default: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * Single source of truth for whether auto-install should run.
 * Returns true only when the preference resolves to enabled.
 */
export function isAutoUpdateEnabled(): boolean {
  return getAutoUpdatePreference().enabled;
}

import { existsSync, readFileSync, writeFileSync, accessSync, constants } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import logger from "./logger.js";

export interface CleanupResult {
  found: string[];
  cleaned: string[];
  errors: string[];
}

/**
 * Match the legacy echoclaw() bash function block injected by old onboard.
 * Pattern: comment line with "echoclaw alias" + at most 3 intermediate lines + echoclaw() { ... } block.
 * The {0,3} limit prevents matching unrelated sections if the rc file is unusually structured.
 */
const LEGACY_ALIAS_PATTERN =
  /\n?# echoclaw alias[^\n]*\n(?:[^\n]*\n){0,3}?echoclaw\s*\(\)\s*\{[^}]*\}\n?/g;

const RC_FILES = [".bashrc", ".zshrc"];

/**
 * Scan ~/.bashrc and ~/.zshrc for legacy echoclaw() function blocks
 * injected by old onboard, and remove them.
 *
 * Idempotent — safe to call multiple times.
 * Does NOT remove unrelated aliases or functions.
 */
export function cleanLegacyBashrcAlias(): CleanupResult {
  const result: CleanupResult = { found: [], cleaned: [], errors: [] };

  for (const rcFile of RC_FILES) {
    const rcPath = join(homedir(), rcFile);
    if (!existsSync(rcPath)) continue;

    let content: string;
    try {
      content = readFileSync(rcPath, "utf-8");
    } catch {
      continue;
    }

    if (!LEGACY_ALIAS_PATTERN.test(content)) continue;

    result.found.push(rcPath);

    // Reset regex lastIndex after test()
    LEGACY_ALIAS_PATTERN.lastIndex = 0;

    // Check write permission before attempting
    try {
      accessSync(rcPath, constants.W_OK);
    } catch {
      result.errors.push(
        `No write permission for ${rcPath}. ` +
        `Remove the echoclaw() function manually: sed -i '/# echoclaw alias/,/^}/d' ${rcPath}`
      );
      continue;
    }

    const cleaned = content.replace(LEGACY_ALIAS_PATTERN, "\n");
    try {
      writeFileSync(rcPath, cleaned, "utf-8");
      result.cleaned.push(rcPath);
    } catch (err) {
      result.errors.push(
        `Failed to write ${rcPath}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  return result;
}

/**
 * Run cleanup and log results to stderr (non-blocking, informational).
 */
export function runLegacyCleanupWithLog(): void {
  try {
    const result = cleanLegacyBashrcAlias();

    if (result.cleaned.length > 0) {
      logger.info(
        `Removed legacy echoclaw() function from: ${result.cleaned.join(", ")}. ` +
        `Open a new shell for changes to take effect.`
      );
    }
    for (const err of result.errors) {
      logger.warn(err);
    }
  } catch {
    // Non-critical — don't block onboard/setup
  }
}

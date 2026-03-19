/**
 * Shared filesystem linking logic for skill installation.
 * Extracted from setup/openclaw-link.ts to be reusable across providers.
 */

import { existsSync, lstatSync, mkdirSync, symlinkSync, unlinkSync, rmSync, cpSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { platform } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Resolve the skill source directory from the installed package. */
export function getSkillSourcePath(skillName = "echoclaw"): string {
  // From dist/providers/link-utils.js → ../../skills/<skillName>
  return resolve(__dirname, "..", "..", "skills", skillName);
}

/** Safe lstat that returns null instead of throwing. */
function lstatSafe(p: string) {
  try {
    return lstatSync(p);
  } catch {
    return null;
  }
}

export interface LinkToTargetResult {
  linkType: "symlink" | "junction" | "copy";
}

/**
 * Link a source directory to a target path.
 * Strategy: symlink → junction (win32) → copy fallback.
 * Throws on failure (caller handles graceful fallback).
 */
export function linkToTarget(
  source: string,
  target: string,
  opts: { force?: boolean },
): LinkToTargetResult {
  if (!existsSync(source)) {
    throw new Error(`Skill source not found at ${source}. Reinstall: npm i -g @echoclaw/echo`);
  }

  // Ensure parent dir exists
  mkdirSync(dirname(target), { recursive: true });

  // Handle existing target
  if (existsSync(target) || lstatSafe(target)) {
    if (!opts.force) {
      throw new Error(`Target already exists: ${target}. Use --force to overwrite.`);
    }
    const stat = lstatSafe(target);
    if (stat?.isSymbolicLink()) {
      unlinkSync(target);
    } else if (stat) {
      rmSync(target, { recursive: true });
    }
  }

  // Symlink → junction (win32) → copy fallback
  try {
    const symlinkType = platform() === "win32" ? "junction" : "dir";
    symlinkSync(source, target, symlinkType);
    return { linkType: symlinkType === "junction" ? "junction" : "symlink" };
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EPERM" || code === "EACCES") {
      cpSync(source, target, { recursive: true });
      return { linkType: "copy" };
    }
    throw err;
  }
}

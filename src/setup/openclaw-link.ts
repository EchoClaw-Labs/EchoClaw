/**
 * Shared module for linking the OpenClaw skill into the managed and workspace skill directories.
 * Extracted from commands/setup.ts to allow reuse from other entry points.
 */

import { existsSync, lstatSync, mkdirSync, symlinkSync, unlinkSync, rmSync, cpSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir, platform } from "node:os";
import { EchoError, ErrorCodes } from "../errors.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface LinkResult {
  source: string;
  target: string;
  linkType: "symlink" | "junction" | "copy";
  workspaceTarget: string;
  workspaceLinked: boolean;
}

/**
 * Link an OpenClaw skill into ~/.openclaw/skills/<skillName> (symlink, junction, or copy)
 * and create a workspace symlink for agent discovery.
 */
export function linkOpenclawSkill(skillName: string, opts: { force?: boolean }): LinkResult {
  // 1. Resolve source — from dist/setup/openclaw-link.js → ../../skills/<skillName>
  const source = resolve(__dirname, "..", "..", "skills", skillName);
  if (!existsSync(source)) {
    throw new EchoError(
      ErrorCodes.SETUP_SOURCE_NOT_FOUND,
      `Skill source not found at ${source}`,
      "Reinstall: npm i -g @echoclaw/echo"
    );
  }

  // 2. Resolve target — ~/.openclaw/skills/<skillName>
  const openclawSkillsDir = join(homedir(), ".openclaw", "skills");
  const target = join(openclawSkillsDir, skillName);

  // Ensure parent dir exists
  mkdirSync(openclawSkillsDir, { recursive: true });

  // 3. Handle existing target
  if (existsSync(target) || lstatSafe(target)) {
    if (!opts.force) {
      throw new EchoError(
        ErrorCodes.SETUP_TARGET_EXISTS,
        `Target already exists: ${target}`,
        "Use --force to overwrite"
      );
    }
    // Remove existing — distinguish symlink vs directory
    const stat = lstatSafe(target);
    if (stat && stat.isSymbolicLink()) {
      unlinkSync(target);
    } else if (stat) {
      rmSync(target, { recursive: true });
    }
  }

  // 4. Link strategy: symlink → fallback to copy
  let linkType: "symlink" | "junction" | "copy";

  try {
    const symlinkType = platform() === "win32" ? "junction" : "dir";
    symlinkSync(source, target, symlinkType);
    linkType = symlinkType === "junction" ? "junction" : "symlink";
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EPERM" || code === "EACCES") {
      // Fallback to copy
      try {
        cpSync(source, target, { recursive: true });
        linkType = "copy";
      } catch {
        throw new EchoError(
          ErrorCodes.SETUP_LINK_FAILED,
          `Failed to link or copy skill to ${target}`,
          "Check permissions on ~/.openclaw/skills/"
        );
      }
    } else {
      throw new EchoError(
        ErrorCodes.SETUP_LINK_FAILED,
        `Failed to create symlink: ${(err as Error).message}`,
        "Try running with --force or check permissions"
      );
    }
  }

  // 5. Create workspace symlink for agent discovery
  const ws = linkToWorkspace(skillName, target, opts);

  return {
    source,
    target,
    linkType,
    workspaceTarget: ws.workspaceTarget,
    workspaceLinked: ws.linked,
  };
}

/** Safe lstat that returns null instead of throwing for non-existent paths */
function lstatSafe(p: string) {
  try {
    return lstatSync(p);
  } catch {
    return null;
  }
}

/** Link managed skill into workspace/skills/ for agent discovery. Non-fatal on failure. */
function linkToWorkspace(
  skillName: string,
  managedTarget: string,
  opts: { force?: boolean },
): { workspaceTarget: string; linked: boolean } {
  const workspaceSkillsDir = join(homedir(), ".openclaw", "workspace", "skills");
  const workspaceTarget = join(workspaceSkillsDir, skillName);

  mkdirSync(workspaceSkillsDir, { recursive: true });

  // Handle existing
  if (existsSync(workspaceTarget) || lstatSafe(workspaceTarget)) {
    if (opts.force) {
      const stat = lstatSafe(workspaceTarget);
      if (stat?.isSymbolicLink()) unlinkSync(workspaceTarget);
      else if (stat) rmSync(workspaceTarget, { recursive: true });
    } else {
      return { workspaceTarget, linked: false };
    }
  }

  if (!existsSync(workspaceTarget) && !lstatSafe(workspaceTarget)) {
    try {
      symlinkSync(managedTarget, workspaceTarget, platform() === "win32" ? "junction" : "dir");
      return { workspaceTarget, linked: true };
    } catch {
      // Non-fatal — workspace link is optional
    }
  }

  return { workspaceTarget, linked: false };
}

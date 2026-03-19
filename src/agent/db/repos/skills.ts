/**
 * Skill reference repo — read-only reference data synced from package files.
 *
 * Uses content hash (SHA-256) to detect changes — only UPSERTs when content differs.
 * Full content preserved, no trimming or splitting.
 */

import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { query, queryOne, execute } from "../client.js";
import { PACKAGE_ROOT, SKILLS_REFERENCES_DIR } from "../../constants.js";
import logger from "../../../utils/logger.js";

function contentHash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

export async function getSkillReference(path: string): Promise<string | null> {
  const row = await queryOne<{ content: string }>("SELECT content FROM skill_references WHERE path = $1", [path]);
  return row?.content ?? null;
}

export async function listSkillReferences(): Promise<Array<{ path: string; sizeBytes: number }>> {
  return query<{ path: string; sizeBytes: number }>(
    "SELECT path, size_bytes AS \"sizeBytes\" FROM skill_references ORDER BY path",
  );
}

/**
 * Seed SKILL.md + all reference files into DB.
 * Compares content hash — only writes when content actually changed.
 * Preserves FULL content — zero trimming, zero splitting.
 */
export async function seedSkills(): Promise<{ total: number; updated: number }> {
  // Collect all skill files from filesystem
  const files: Array<{ path: string; content: string }> = [];

  // SKILL.md
  const skillMdPath = join(PACKAGE_ROOT, "skills", "echoclaw", "SKILL.md");
  try {
    files.push({ path: "SKILL.md", content: readFileSync(skillMdPath, "utf-8") });
  } catch { /* not found in dev mode */ }

  // references/**/*.md — recursive walk
  try {
    walkDir(SKILLS_REFERENCES_DIR, (fullPath) => {
      const relPath = relative(join(PACKAGE_ROOT, "skills", "echoclaw"), fullPath);
      files.push({ path: relPath, content: readFileSync(fullPath, "utf-8") });
    });
  } catch { /* references dir not found */ }

  // Batch UPSERT with hash comparison
  let updated = 0;
  for (const file of files) {
    const hash = contentHash(file.content);
    const existing = await queryOne<{ content_hash: string | null }>(
      "SELECT content_hash FROM skill_references WHERE path = $1",
      [file.path],
    );

    // Skip if hash matches — no change
    if (existing?.content_hash === hash) continue;

    const sizeBytes = Buffer.byteLength(file.content, "utf-8");
    await execute(
      `INSERT INTO skill_references (path, content, size_bytes, content_hash)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (path) DO UPDATE SET content = $2, size_bytes = $3, content_hash = $4, seeded_at = NOW()`,
      [file.path, file.content, sizeBytes, hash],
    );
    updated++;
  }

  if (updated > 0) {
    logger.info(`[agent-db] skills: ${updated}/${files.length} updated`);
  } else {
    logger.debug(`[agent-db] skills: ${files.length} files, all up to date`);
  }

  return { total: files.length, updated };
}

function walkDir(dir: string, callback: (fullPath: string) => void): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) { walkDir(fullPath, callback); continue; }
    if (entry.name.endsWith(".md")) callback(fullPath);
  }
}

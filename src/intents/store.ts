import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, renameSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { INTENTS_DIR } from "../config/paths.js";
import type { BaseIntent } from "./types.js";

const INTENT_TTL_MS = 10 * 60 * 1000; // 10 minutes

function ensureIntentsDir(): void {
  if (!existsSync(INTENTS_DIR)) {
    mkdirSync(INTENTS_DIR, { recursive: true });
  }
}

/**
 * Create a new intent with auto-generated ID and timestamps.
 * Generic over any intent type extending BaseIntent.
 */
export function createIntent<T extends BaseIntent>(
  data: Omit<T, "version" | "intentId" | "createdAt" | "expiresAt">,
): T {
  const now = new Date();
  return {
    version: 1,
    intentId: randomUUID(),
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + INTENT_TTL_MS).toISOString(),
    ...data,
  } as T;
}

/**
 * Save intent to disk (atomic write).
 */
export function saveIntent(intent: BaseIntent): void {
  ensureIntentsDir();
  const filePath = join(INTENTS_DIR, `${intent.intentId}.json`);
  const tmpFile = join(INTENTS_DIR, `.${intent.intentId}.tmp.json`);

  try {
    writeFileSync(tmpFile, JSON.stringify(intent, null, 2), "utf-8");
    renameSync(tmpFile, filePath);
  } catch (err) {
    try {
      if (existsSync(tmpFile)) {
        unlinkSync(tmpFile);
      }
    } catch {
      // Ignore cleanup errors
    }
    throw err;
  }
}

/**
 * Load intent from disk by ID. Returns null if not found.
 * Caller is responsible for narrowing the type via `intent.type` discriminant.
 */
export function loadIntent<T extends BaseIntent = BaseIntent>(intentId: string): T | null {
  const filePath = join(INTENTS_DIR, `${intentId}.json`);
  if (!existsSync(filePath)) return null;

  try {
    return JSON.parse(readFileSync(filePath, "utf-8")) as T;
  } catch {
    return null;
  }
}

/**
 * Delete intent file (used after confirm or expiry).
 */
export function deleteIntent(intentId: string): void {
  const filePath = join(INTENTS_DIR, `${intentId}.json`);
  if (existsSync(filePath)) {
    unlinkSync(filePath);
  }
}

/**
 * Check if intent has expired (10 minute TTL).
 */
export function isIntentExpired(intent: BaseIntent): boolean {
  return new Date(intent.expiresAt).getTime() < Date.now();
}

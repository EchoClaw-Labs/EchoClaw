/**
 * Telegram config + session mapping repository.
 *
 * Config is a singleton row (id=1), same pattern as agent_soul / loop_state.
 * Bot token is encrypted at rest with AES-256-GCM, key derived from AGENT_AUTH_TOKEN.
 */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { queryOne, execute } from "../client.js";
import { AGENT_DIR } from "../../constants.js";
import logger from "../../../utils/logger.js";

// ── Encryption helpers (AES-256-GCM) ─────────────────────────────────

const ALGO = "aes-256-gcm";
const KEY_LEN = 32;
const IV_LEN = 12;
const TAG_LEN = 16;
const AGENT_TOKEN_FILE = join(AGENT_DIR, "agent.token");

/**
 * Derive encryption key from AGENT_AUTH_TOKEN.
 *
 * Resolution order:
 *   1. process.env.AGENT_AUTH_TOKEN (set by Docker, env, or server.ts on boot)
 *   2. Persisted agent.token file (survives restart even without env var)
 *   3. Throw — cannot encrypt/decrypt without a stable key
 */
function deriveKey(): Buffer {
  let secret = process.env.AGENT_AUTH_TOKEN;
  if (!secret) {
    // Fallback: read persisted token file (written by server.ts:generateAuthToken)
    if (existsSync(AGENT_TOKEN_FILE)) {
      secret = readFileSync(AGENT_TOKEN_FILE, "utf-8").trim();
    }
  }
  if (!secret) throw new Error("No AGENT_AUTH_TOKEN in env or token file — cannot derive encryption key");
  return scryptSync(secret, "echoclaw-telegram-salt", KEY_LEN);
}

function encrypt(plaintext: string): string {
  const key = deriveKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Format: base64(iv + tag + ciphertext)
  return Buffer.concat([iv, tag, encrypted]).toString("base64");
}

function decrypt(encoded: string): string {
  const key = deriveKey();
  const buf = Buffer.from(encoded, "base64");
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ciphertext = buf.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(ciphertext) + decipher.final("utf8");
}

// ── Config CRUD ──────────────────────────────────────────────────────

export interface TelegramConfigRow {
  enabled: boolean;
  botToken: string | null;
  authorizedChatIds: number[];
  loopMode: string;
  /** True if a token was saved but decryption failed (key mismatch). */
  decryptionFailed?: boolean;
}

export async function getConfig(): Promise<TelegramConfigRow> {
  const row = await queryOne<Record<string, unknown>>(
    "SELECT enabled, bot_token_encrypted, authorized_chat_ids, loop_mode FROM telegram_config WHERE id = 1",
  );
  if (!row) {
    return { enabled: false, botToken: null, authorizedChatIds: [], loopMode: "restricted" };
  }
  const hasEncryptedToken = !!row.bot_token_encrypted && typeof row.bot_token_encrypted === "string";
  let botToken: string | null = null;
  let decryptionFailed = false;
  if (hasEncryptedToken) {
    try {
      botToken = decrypt(row.bot_token_encrypted as string);
    } catch (err) {
      decryptionFailed = true;
      logger.warn("telegram.config.decrypt_failed", {
        error: err instanceof Error ? err.message : String(err),
        hint: "Encryption key may have changed — reconfigure Telegram bot token",
      });
    }
  }
  return {
    enabled: row.enabled as boolean,
    botToken,
    authorizedChatIds: (row.authorized_chat_ids as number[]) ?? [],
    loopMode: (row.loop_mode as string) ?? "restricted",
    decryptionFailed,
  };
}

export async function saveConfig(
  botToken: string,
  chatIds: number[],
  loopMode: string,
): Promise<void> {
  const encrypted = encrypt(botToken);
  await execute(
    `UPDATE telegram_config SET bot_token_encrypted = $1, authorized_chat_ids = $2, loop_mode = $3, updated_at = NOW() WHERE id = 1`,
    [encrypted, JSON.stringify(chatIds), loopMode],
  );
}

export async function setEnabled(enabled: boolean): Promise<void> {
  await execute("UPDATE telegram_config SET enabled = $1, updated_at = NOW() WHERE id = 1", [enabled]);
}

export async function clearConfig(): Promise<void> {
  await execute(
    "UPDATE telegram_config SET enabled = FALSE, bot_token_encrypted = NULL, authorized_chat_ids = '[]', updated_at = NOW() WHERE id = 1",
  );
}

// ── Session mapping ──────────────────────────────────────────────────

export interface TelegramSessionRow {
  chatId: number;
  sessionId: string;
  username: string | null;
  firstName: string | null;
}

export async function getSessionForChat(chatId: number): Promise<TelegramSessionRow | null> {
  const row = await queryOne<Record<string, unknown>>(
    "SELECT chat_id, session_id, username, first_name FROM telegram_sessions WHERE chat_id = $1",
    [chatId],
  );
  if (!row) return null;
  return {
    chatId: Number(row.chat_id),
    sessionId: row.session_id as string,
    username: row.username as string | null,
    firstName: row.first_name as string | null,
  };
}

export async function upsertSession(
  chatId: number, sessionId: string, username?: string, firstName?: string,
): Promise<void> {
  await execute(
    `INSERT INTO telegram_sessions (chat_id, session_id, username, first_name, last_active_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (chat_id) DO UPDATE SET session_id = $2, username = COALESCE($3, telegram_sessions.username), first_name = COALESCE($4, telegram_sessions.first_name), last_active_at = NOW()`,
    [chatId, sessionId, username ?? null, firstName ?? null],
  );
}

export async function updateSessionId(chatId: number, newSessionId: string): Promise<void> {
  await execute(
    "UPDATE telegram_sessions SET session_id = $1, last_active_at = NOW() WHERE chat_id = $2",
    [newSessionId, chatId],
  );
}

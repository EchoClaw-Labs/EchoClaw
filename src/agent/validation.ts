/**
 * Endpoint-specific request validation parsers.
 *
 * Each parser extracts and validates fields from the raw body / path params,
 * returning a strongly-typed result or throwing RequestValidationError.
 */

export class RequestValidationError extends Error {
  constructor(
    public field: string,
    message: string,
  ) {
    super(message);
    this.name = "RequestValidationError";
  }
}

// ── Chat ─────────────────────────────────────────────────────────────

const LOOP_MODES = ["full", "restricted", "off"] as const;
type LoopMode = (typeof LOOP_MODES)[number];

export function parseChatRequest(
  body: Record<string, unknown> | null,
): { message: string; loopMode: LoopMode; sessionId?: string } {
  const message = body?.message;
  if (!message || typeof message !== "string" || message.trim().length === 0) {
    throw new RequestValidationError("message", "message is required (non-empty string)");
  }

  const rawLoopMode = body?.loopMode ?? "off";
  if (typeof rawLoopMode !== "string" || !LOOP_MODES.includes(rawLoopMode as LoopMode)) {
    throw new RequestValidationError("loopMode", "loopMode must be: full, restricted, or off");
  }

  const sessionId = body?.sessionId;
  if (sessionId !== undefined && typeof sessionId !== "string") {
    throw new RequestValidationError("sessionId", "sessionId must be a string");
  }

  return {
    message: message.trim(),
    loopMode: rawLoopMode as LoopMode,
    ...(sessionId ? { sessionId } : {}),
  };
}

// ── Approve ──────────────────────────────────────────────────────────

const APPROVE_ACTIONS = ["approve", "reject"] as const;
type ApproveAction = (typeof APPROVE_ACTIONS)[number];

export function parseApproveRequest(
  body: Record<string, unknown> | null,
  pathParams: Record<string, string>,
): { id: string; action: ApproveAction } {
  const id = pathParams.id;
  if (!id || id.trim().length === 0) {
    throw new RequestValidationError("id", "id path parameter is required");
  }

  const rawAction = body?.action ?? "approve";
  if (typeof rawAction !== "string" || !APPROVE_ACTIONS.includes(rawAction as ApproveAction)) {
    throw new RequestValidationError("action", "action must be: approve or reject");
  }

  return { id, action: rawAction as ApproveAction };
}

// ── Toggle Task ──────────────────────────────────────────────────────

export function parseToggleTaskRequest(
  body: Record<string, unknown> | null,
  pathParams: Record<string, string>,
): { id: string; enabled: boolean } {
  const id = pathParams.id;
  if (!id || id.trim().length === 0) {
    throw new RequestValidationError("id", "id path parameter is required");
  }

  const rawEnabled = body?.enabled;
  let enabled = true;
  if (rawEnabled !== undefined) {
    if (typeof rawEnabled !== "boolean") {
      throw new RequestValidationError("enabled", "enabled must be a boolean");
    }
    enabled = rawEnabled;
  }

  return { id, enabled };
}

// ── Telegram Config ─────────────────────────────────────────────────

const TELEGRAM_LOOP_MODES = ["full", "restricted", "off"] as const;
type TelegramLoopMode = (typeof TELEGRAM_LOOP_MODES)[number];

const TELEGRAM_TOKEN_RE = /^\d+:[A-Za-z0-9_-]+$/;

export function parseTelegramConfigRequest(
  body: Record<string, unknown> | null,
): { botToken: string; chatIds: number[]; loopMode: string } {
  const botToken = body?.botToken;
  if (!botToken || typeof botToken !== "string" || !TELEGRAM_TOKEN_RE.test(botToken)) {
    throw new RequestValidationError("botToken", "botToken is required and must match Telegram token format (e.g. 123456:ABC-DEF...)");
  }

  const rawChatIds = body?.chatIds;
  if (!Array.isArray(rawChatIds) || rawChatIds.length === 0) {
    throw new RequestValidationError("chatIds", "chatIds is required (non-empty array of numbers)");
  }
  const chatIds = rawChatIds.map((id, i) => {
    const n = Number(id);
    if (!Number.isFinite(n) || !Number.isInteger(n)) {
      throw new RequestValidationError("chatIds", `chatIds[${i}] must be an integer`);
    }
    return n;
  });

  const rawLoopMode = body?.loopMode ?? "restricted";
  if (typeof rawLoopMode !== "string" || !TELEGRAM_LOOP_MODES.includes(rawLoopMode as TelegramLoopMode)) {
    throw new RequestValidationError("loopMode", "loopMode must be: full, restricted, or off");
  }

  return { botToken, chatIds, loopMode: rawLoopMode };
}

// ── Loop Start ───────────────────────────────────────────────────────

const ACTIVE_LOOP_MODES = ["full", "restricted"] as const;
type ActiveLoopMode = (typeof ACTIVE_LOOP_MODES)[number];

const DEFAULT_INTERVAL_MS = 300_000;
const MIN_INTERVAL_MS = 30_000;
const MAX_INTERVAL_MS = 86_400_000;

export function parseLoopStartRequest(
  body: Record<string, unknown> | null,
): { mode: ActiveLoopMode; intervalMs: number } {
  const rawMode = body?.mode;
  if (!rawMode || typeof rawMode !== "string" || !ACTIVE_LOOP_MODES.includes(rawMode as ActiveLoopMode)) {
    throw new RequestValidationError("mode", "mode is required and must be: full or restricted");
  }

  const rawInterval = body?.intervalMs;
  let intervalMs = DEFAULT_INTERVAL_MS;
  if (rawInterval !== undefined) {
    if (typeof rawInterval !== "number" || !Number.isFinite(rawInterval)) {
      throw new RequestValidationError("intervalMs", "intervalMs must be a number");
    }
    if (rawInterval < MIN_INTERVAL_MS || rawInterval > MAX_INTERVAL_MS) {
      throw new RequestValidationError(
        "intervalMs",
        `intervalMs must be between ${MIN_INTERVAL_MS} and ${MAX_INTERVAL_MS}`,
      );
    }
    intervalMs = rawInterval;
  }

  return { mode: rawMode as ActiveLoopMode, intervalMs };
}

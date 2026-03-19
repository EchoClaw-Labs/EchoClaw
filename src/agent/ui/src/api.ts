/** Typed API wrappers for agent endpoints. */

import type { AgentStatus, SessionListEntry, FileTreeEntry, ApprovalItem, TradeEntry, TradeSummary, ScheduledTask, PortfolioSnapshot, ChainBalance, BillingState } from "./types";

/** Bootstrap auth — call before any other API request. Sets HttpOnly cookie. */
export async function initAuth(): Promise<void> {
  await fetch("/api/agent/auth-init", { credentials: "include" });
}

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { credentials: "include", ...init });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: { message?: string } };
    throw new Error(body.error?.message ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export async function getStatus(): Promise<AgentStatus> {
  return fetchJson("/api/agent/status");
}

export async function getUsage(): Promise<AgentStatus["usage"]> {
  return fetchJson("/api/agent/usage");
}

export async function getSoul(): Promise<{ content: string | null; exists: boolean }> {
  return fetchJson("/api/agent/memory/soul");
}

export async function getMemory(): Promise<{ content: string }> {
  return fetchJson("/api/agent/memory/core");
}

export async function getSessions(): Promise<{ sessions: SessionListEntry[] }> {
  return fetchJson("/api/agent/sessions");
}

export async function getSessionMessages(id: string): Promise<{ id: string; messages: Array<{ role: string; content: string; created_at: string }> }> {
  return fetchJson(`/api/agent/session/${encodeURIComponent(id)}`);
}

export async function getFiles(path = ""): Promise<{ path: string; entries: FileTreeEntry[] }> {
  return fetchJson(`/api/agent/files?path=${encodeURIComponent(path)}`);
}

export async function getFile(path: string): Promise<{ path: string; content: string }> {
  return fetchJson(`/api/agent/file?path=${encodeURIComponent(path)}`);
}

export async function getApprovalQueue(): Promise<{ items: ApprovalItem[]; count: number }> {
  return fetchJson("/api/agent/queue");
}

export async function getTrades(type?: string, limit = 50): Promise<{ trades: TradeEntry[]; total: number }> {
  const params = new URLSearchParams();
  if (type) params.set("type", type);
  params.set("limit", String(limit));
  return fetchJson(`/api/agent/trades?${params}`);
}

export async function getTradesSummary(): Promise<TradeSummary> {
  return fetchJson("/api/agent/trades/summary");
}

export async function getRecentTrades(count = 5): Promise<{ trades: TradeEntry[]; summary: TradeSummary }> {
  return fetchJson(`/api/agent/trades/recent?count=${count}`);
}

// ── Portfolio ────────────────────────────────────────────────────────

export async function getPortfolio(): Promise<PortfolioSnapshot> {
  return fetchJson("/api/agent/portfolio");
}

export async function getPortfolioHistory(range = "24h"): Promise<{ snapshots: PortfolioSnapshot[] }> {
  return fetchJson(`/api/agent/portfolio/history?range=${range}`);
}

export async function getPortfolioChains(): Promise<{ chains: ChainBalance[] }> {
  return fetchJson("/api/agent/portfolio/chains");
}

// ── Scheduled tasks ──────────────────────────────────────────────────

export async function getScheduledTasks(): Promise<{ tasks: ScheduledTask[] }> {
  return fetchJson("/api/agent/tasks");
}

export async function toggleScheduledTask(id: string, enabled: boolean): Promise<void> {
  await fetchJson(`/api/agent/tasks/${id}/toggle`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled }),
  });
}

export async function deleteScheduledTask(id: string): Promise<void> {
  await fetchJson(`/api/agent/tasks/${id}`, { method: "DELETE" });
}

// ── Billing ──────────────────────────────────────────────────────────

export async function getBilling(): Promise<BillingState> {
  return fetchJson("/api/agent/billing");
}

// ── Skills ───────────────────────────────────────────────────────────

export async function getSkillReferences(): Promise<{ references: Array<{ path: string; sizeBytes: number }>; count: number }> {
  return fetchJson("/api/agent/skills");
}

export async function getSkillContent(path: string): Promise<{ path: string; content: string }> {
  return fetchJson(`/api/agent/skill?path=${encodeURIComponent(path)}`);
}

// ── Loop control ────────────────────────────────────────────────────

export async function startLoop(mode: "full" | "restricted", intervalMs?: number): Promise<void> {
  await fetchJson("/api/agent/loop/start", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode, ...(intervalMs ? { intervalMs } : {}) }),
  });
}

export async function stopLoop(): Promise<void> {
  await fetchJson("/api/agent/loop/stop", { method: "POST" });
}

// ── Approvals ────────────────────────────────────────────────────────

export async function approveAction(id: string, action: "approve" | "reject" = "approve"): Promise<Response> {
  return fetch(`/api/agent/approve/${id}`, {
    method: "POST", credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action }),
  });
}

// ── Backup / Restore ────────────────────────────────────────────────

export async function triggerBackup(): Promise<Record<string, unknown>> {
  return fetchJson("/api/agent/backup", { method: "POST" });
}

export async function triggerRestore(rootHash: string): Promise<Record<string, unknown>> {
  return fetchJson("/api/agent/restore", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ root: rootHash }),
  });
}

export async function getBackups(): Promise<{ backups: Array<Record<string, unknown>>; count: number }> {
  return fetchJson("/api/agent/backups");
}

// ── Soul admin ──────────────────────────────────────────────────────

export async function updateSoul(content: string): Promise<void> {
  await fetchJson("/api/agent/memory/soul", {
    method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });
}

// ── Config ──────────────────────────────────────────────────────────

export async function getAgentConfig(): Promise<{ tavilyConfigured: boolean }> {
  return fetchJson("/api/agent/config");
}

/**
 * Parse an SSE response stream, dispatching events via callback.
 * Shared transport layer — used by both chat and approval resume.
 */
export async function parseSSEStream(
  response: Response,
  onEvent: (type: string, data: Record<string, unknown>) => void,
  signal?: AbortSignal,
): Promise<void> {
  if (!response.ok || !response.body) {
    onEvent("error", { message: `HTTP ${response.status}` });
    onEvent("done", {});
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (signal?.aborted) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      let currentEventType = "";
      for (const line of lines) {
        if (line.startsWith("event: ")) {
          currentEventType = line.slice(7).trim();
        } else if (line.startsWith("data: ") && currentEventType) {
          try {
            const data = JSON.parse(line.slice(6));
            onEvent(currentEventType, data);
          } catch { /* expected: malformed SSE data line */ }
          currentEventType = "";
        }
      }
    }
  } finally {
    try { reader.cancel(); } catch { /* already closed */ }
  }
}

/**
 * Send a chat message and consume SSE events via callback.
 * Returns an AbortController for cancellation.
 */
export function sendMessage(
  message: string,
  loopMode: string,
  onEvent: (type: string, data: Record<string, unknown>) => void,
  sessionId?: string,
): AbortController {
  const controller = new AbortController();

  (async () => {
    try {
      const res = await fetch("/api/agent/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, loopMode, sessionId }),
        credentials: "include",
        signal: controller.signal,
      });

      await parseSSEStream(res, onEvent, controller.signal);
    } catch (err) {
      if (!controller.signal.aborted) {
        onEvent("error", { message: err instanceof Error ? err.message : "Network error" });
        onEvent("done", {});
      }
    }
  })();

  return controller;
}

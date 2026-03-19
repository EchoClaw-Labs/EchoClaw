/**
 * Typed API client for launcher backend.
 * All fetch calls go to same-origin /api/*.
 */

async function fetchApi<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });

  const data = await res.json();

  if (!res.ok) {
    const err = data as { error?: { code?: string; message?: string } };
    throw new Error(err.error?.message ?? `API error ${res.status}`);
  }

  return data as T;
}

// ── Status & Routing ─────────────────────────────────────────────

export interface RoutingDecision {
  mode: "wizard" | "dashboard";
  reason: string;
}

export function getRouting(): Promise<RoutingDecision> {
  return fetchApi("/api/routing");
}

export function getSnapshot(fresh = false): Promise<Record<string, unknown>> {
  const qs = fresh ? "?fresh=1" : "";
  return fetchApi(`/api/snapshot${qs}`);
}

// ── Catalog ──────────────────────────────────────────────────────

export interface CatalogItem {
  id: string;
  title: string;
  badge: string;
  description: string;
  command: string;
}

export function getExplore(): Promise<{ items: CatalogItem[] }> {
  return fetchApi("/api/explore");
}

export function getAdvanced(): Promise<{ items: CatalogItem[] }> {
  return fetchApi("/api/advanced");
}

// ── Daemons ──────────────────────────────────────────────────────

export interface DaemonStatus {
  name: string;
  running: boolean;
  pid: number | null;
}

export function getDaemons(): Promise<{ daemons: DaemonStatus[] }> {
  return fetchApi("/api/daemons");
}

export function startDaemon(name: string): Promise<Record<string, unknown>> {
  return fetchApi(`/api/daemons/${name}/start`, { method: "POST" });
}

export function stopDaemon(name: string): Promise<Record<string, unknown>> {
  return fetchApi(`/api/daemons/${name}/stop`, { method: "POST" });
}

// ── Agent ───────────────────────────────────────────────────────

export interface AgentReadiness {
  ready: boolean;
  checks: {
    docker: { installed: boolean; running: boolean; composeAvailable: boolean; version: string | null };
    wallet: boolean;
    password: boolean;
    passwordInfo: {
      status: "ready" | "missing" | "drift" | "invalid";
      source: "env" | "app-env" | "openclaw-env" | "legacy-openclaw" | "none";
      migrationNeeded: boolean;
    };
    compute: { ready: boolean; detail: string | null };
  };
  agentRunning: boolean;
  agentUrl: string | null;
  installDockerUrl: string;
}

export function getAgentReadiness(): Promise<AgentReadiness> {
  return fetchApi("/api/agent/readiness");
}

export function startAgent(): Promise<{ started: boolean; healthy: boolean; url: string }> {
  return fetchApi("/api/agent/start", { method: "POST" });
}

// ── Tavily (web search) ─────────────────────────────────────────

export function getTavilyStatus(): Promise<{ configured: boolean }> {
  return fetchApi("/api/tavily/status");
}

export function setTavilyKey(key: string): Promise<{ saved: boolean; agentRestarted: boolean; agentWasRunning: boolean }> {
  return fetchApi("/api/tavily/key", { method: "POST", body: JSON.stringify({ key }) });
}

// ── Agent password ──────────────────────────────────────────────

export function setAgentPassword(password: string): Promise<{ saved: boolean; verified: boolean }> {
  return fetchApi("/api/agent/password", { method: "POST", body: JSON.stringify({ password }) });
}

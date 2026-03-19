import { type FC, useEffect, useState, useCallback } from "react";
import { SetupCard } from "../components/SetupCard";
import { WaveSpinner } from "../components/WaveSpinner";
import { HugeiconsIcon, WalletIcon, CpuIcon, LinkIcon, ServerIcon, ActivityIcon, ShieldIcon, CheckmarkCircle02Icon, BotIcon } from "../components/Icons";
import { getSnapshot, getDaemons, getAgentReadiness, startAgent, getTavilyStatus, setTavilyKey, setAgentPassword, type DaemonStatus, type AgentReadiness } from "../api";

interface Snapshot {
  version: string;
  configExists: boolean;
  wallet: {
    configuredAddress: string | null;
    evmAddress: string | null;
    evmKeystorePresent: boolean;
    solanaAddress: string | null;
    solanaKeystorePresent: boolean;
    password: { status: string };
    decryptable: boolean;
  };
  runtimes: {
    recommended: string;
    detected: Record<string, { detected: boolean }>;
  };
  compute: {
    state: { activeProvider?: string; model?: string } | null;
    readiness: { overall: boolean; checks: Record<string, { ok: boolean }> } | null;
  };
  claude: {
    configured: boolean;
    running: boolean;
    healthy: boolean;
    model: string | null;
    port: number;
  };
  monitor: { running: boolean; pid: number | null };
}

function trunc(addr: string | null): string {
  if (!addr) return "—";
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

type CardStatus = "done" | "needed" | "error" | "pending";

function walletStatus(s: Snapshot) {
  if (!s.wallet.configuredAddress && !s.wallet.evmKeystorePresent) {
    return { status: "needed" as CardStatus, summary: "No wallet configured", detail: "Create or import a wallet to get started" };
  }
  if (s.wallet.password.status === "missing") {
    return { status: "error" as CardStatus, summary: "Password not set", detail: trunc(s.wallet.evmAddress) };
  }
  if (!s.wallet.decryptable) {
    return { status: "error" as CardStatus, summary: "Keystore cannot be decrypted", detail: trunc(s.wallet.evmAddress) };
  }
  const parts = [trunc(s.wallet.evmAddress)];
  if (s.wallet.solanaAddress) parts.push(`SOL: ${trunc(s.wallet.solanaAddress)}`);
  return { status: "done" as CardStatus, summary: "Wallet ready", detail: parts.join(" · ") };
}

function computeStatus(s: Snapshot) {
  if (!s.compute.state?.activeProvider) {
    return { status: "needed" as CardStatus, summary: "No provider selected", detail: "Select and fund a provider" };
  }
  const model = s.compute.state.model ?? "unknown";
  if (s.compute.readiness && !s.compute.readiness.overall) {
    return { status: "needed" as CardStatus, summary: "Compute needs attention", detail: model };
  }
  return { status: "done" as CardStatus, summary: "Provider active", detail: model };
}

function runtimeStatus(s: Snapshot) {
  const detected = Object.entries(s.runtimes.detected).filter(([, v]) => v.detected).map(([k]) => k);
  if (detected.length === 0) {
    return { status: "needed" as CardStatus, summary: "No runtime detected", detail: "Connect an AI runtime" };
  }
  return { status: "done" as CardStatus, summary: `${detected.length} runtime(s) detected`, detail: `Recommended: ${s.runtimes.recommended}` };
}

function claudeStatus(s: Snapshot) {
  if (!s.claude.configured) return { status: "pending" as CardStatus, summary: "Not configured", detail: "" };
  if (!s.claude.running) return { status: "needed" as CardStatus, summary: "Proxy stopped", detail: `Port ${s.claude.port}` };
  if (!s.claude.healthy) return { status: "error" as CardStatus, summary: "Proxy unhealthy", detail: `Port ${s.claude.port}` };
  return { status: "done" as CardStatus, summary: "Proxy running & healthy", detail: s.claude.model ?? "" };
}

function monitorStatus(s: Snapshot, daemons: DaemonStatus[]) {
  const mon = daemons.find(d => d.name === "monitor");
  if (!mon?.running) return { status: "pending" as CardStatus, summary: "Not running", detail: "Optional balance monitoring" };
  return { status: "done" as CardStatus, summary: "Monitoring active", detail: `PID ${mon.pid}` };
}

// Fallback when readiness API fails — card still renders
const AGENT_FALLBACK: AgentReadiness = {
  ready: false,
  checks: {
    docker: { installed: false, running: false, composeAvailable: false, version: null },
    wallet: false,
    password: false,
    passwordInfo: { status: "missing", source: "none", migrationNeeded: false },
    compute: { ready: false, detail: null },
  },
  agentRunning: false,
  agentUrl: null,
  installDockerUrl: "https://docs.docker.com/get-docker/",
};

export const DashboardView: FC<{ onNavigate: (path: string) => void }> = ({ onNavigate }) => {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [daemons, setDaemons] = useState<DaemonStatus[]>([]);
  const [agentReady, setAgentReady] = useState<AgentReadiness | null>(null);
  const [tavilyConfigured, setTavilyConfigured] = useState(false);
  const [tavilyInput, setTavilyInput] = useState("");
  const [tavilySaving, setTavilySaving] = useState(false);
  const [tavilyMessage, setTavilyMessage] = useState<string | null>(null);
  const [passwordInput, setPasswordInput] = useState("");
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const [snap, dmnResult, agentResult, tavilyResult] = await Promise.all([
        getSnapshot(), getDaemons(), getAgentReadiness().catch(() => null), getTavilyStatus().catch(() => null),
      ]);
      setSnapshot(snap as unknown as Snapshot);
      setDaemons(dmnResult.daemons);
      if (agentResult) setAgentReady(agentResult);
      if (tavilyResult) setTavilyConfigured(tavilyResult.configured);
    } catch { /* keep stale data */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 5000);
    return () => clearInterval(interval);
  }, [refresh]);

  if (loading || !snapshot) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <WaveSpinner size="lg" />
      </div>
    );
  }

  const w = walletStatus(snapshot);
  const c = computeStatus(snapshot);
  const r = runtimeStatus(snapshot);
  const cl = claudeStatus(snapshot);
  const m = monitorStatus(snapshot, daemons);

  const cards = [
    { ...w, title: "Wallet", icon: <HugeiconsIcon icon={WalletIcon} size={18} />, path: "/wallet", actionLabel: w.status === "done" ? "Manage" : "Setup" },
    { ...c, title: "Compute", icon: <HugeiconsIcon icon={CpuIcon} size={18} />, path: "/fund", actionLabel: c.status === "done" ? "View" : "Fund" },
    { ...r, title: "Runtime", icon: <HugeiconsIcon icon={LinkIcon} size={18} />, path: "/connect", actionLabel: r.status === "done" ? "View" : "Connect" },
    { ...cl, title: "Claude Proxy", icon: <HugeiconsIcon icon={ServerIcon} size={18} />, path: "/claude", actionLabel: "Manage" },
    { ...m, title: "Monitor", icon: <HugeiconsIcon icon={ActivityIcon} size={18} />, path: "/manage", actionLabel: m.status === "done" ? "View" : "Setup" },
    { status: "pending" as CardStatus, title: "Doctor", summary: "Run diagnostics", detail: "Check system health", icon: <HugeiconsIcon icon={ShieldIcon} size={18} />, path: "/manage", actionLabel: "Check" },
  ];

  // Always render agent card — use fallback when API failed
  const agent = agentReady ?? AGENT_FALLBACK;
  const passwordInfo = agent.checks.passwordInfo;
  const passwordNeedsAttention = agent.checks.wallet && !agent.checks.password;
  const passwordTitle = passwordInfo.status === "drift"
    ? "Password Sources Conflict"
    : passwordInfo.status === "invalid"
      ? "Stored Password Is Invalid"
      : "Keystore Password";
  const passwordSubtitle = passwordInfo.status === "drift"
    ? "EchoClaw found conflicting password sources. Save the correct password again."
    : passwordInfo.status === "invalid"
      ? "Stored password does not decrypt the wallet. Save the correct password."
      : "Required to decrypt wallet";

  return (
    <div className="mx-auto max-w-5xl px-5 py-8">
      <div className="mb-10">
        <h1 className="text-3xl font-semibold tracking-tight text-white">Dashboard</h1>
        <p className="mt-2 text-base text-zinc-500">System status at a glance</p>
      </div>

      {/* Echo Agent — hero card (always visible) */}
      <div className="mb-6 rounded-2xl border border-white/[0.06] bg-zinc-950/50 backdrop-blur-md p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 mb-2">
              <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-neon-blue/20 to-purple-500/20 flex items-center justify-center">
                <HugeiconsIcon icon={agent.agentRunning ? CheckmarkCircle02Icon : BotIcon} size={22} className={agent.agentRunning ? "text-status-ok" : "text-zinc-400"} />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-white">Echo Agent</h2>
                <p className="text-xs text-zinc-500">AI Trading Assistant — powered by 0G Compute</p>
              </div>
            </div>

            {/* Checklist */}
            <div className="flex flex-wrap gap-3 mt-3">
              <CheckPill ok={agent.checks.docker.installed && agent.checks.docker.running} label="Docker" />
              <CheckPill ok={agent.checks.wallet} label="Wallet" />
              <CheckPill ok={agent.checks.password} label="Password" />
              <CheckPill ok={agent.checks.compute.ready} label="Compute" />
            </div>

            {passwordInfo.migrationNeeded && (
              <div className="mt-4 rounded-xl border border-neon-blue/20 bg-neon-blue/5 px-4 py-3 text-xs text-zinc-300">
                Legacy OpenClaw password detected. EchoClaw will migrate it into the new app config automatically on first agent start.
              </div>
            )}

            {/* Password setup — inline (when wallet exists but password missing) */}
            {passwordNeedsAttention && (
              <div className="mt-4 rounded-xl border border-white/[0.04] bg-white/[0.02] px-4 py-3">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-zinc-600" />
                  <span className="text-xs font-medium text-zinc-300">{passwordTitle}</span>
                  <span className="text-2xs text-zinc-600">{passwordSubtitle}</span>
                </div>
                <div className="mt-2 flex gap-2">
                  <input
                    type="password"
                    value={passwordInput}
                    onChange={e => { setPasswordInput(e.target.value); setPasswordMessage(null); }}
                    placeholder="Enter keystore password"
                    className="flex-1 px-3 py-1.5 text-xs rounded-lg bg-zinc-900 border border-zinc-800 text-white placeholder:text-zinc-600 focus:outline-none focus:border-zinc-600"
                  />
                  <button
                    disabled={passwordSaving || !passwordInput.trim()}
                    onClick={async () => {
                      setPasswordSaving(true);
                      setPasswordMessage(null);
                      try {
                        const res = await setAgentPassword(passwordInput.trim());
                        setPasswordInput("");
                        setPasswordMessage(
                          res.verified ? "Saved — keystore decrypted successfully" : "Saved — will verify on next check"
                        );
                        refresh();
                      } catch (err) {
                        setPasswordMessage(err instanceof Error ? err.message : "Failed to save");
                      } finally {
                        setPasswordSaving(false);
                      }
                    }}
                    className="px-3 py-1.5 text-xs rounded-lg bg-neon-blue/15 text-neon-blue hover:bg-neon-blue/25 transition disabled:opacity-40"
                  >
                    {passwordSaving ? "..." : "Save"}
                  </button>
                </div>
                {passwordMessage && (
                  <p className={`mt-1.5 text-2xs ${passwordMessage.includes("Failed") ? "text-status-error" : "text-status-ok"}`}>{passwordMessage}</p>
                )}
              </div>
            )}

            {/* Web Search (Tavily) — optional */}
            <div className="mt-4 rounded-xl border border-white/[0.04] bg-white/[0.02] px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className={`h-2 w-2 rounded-full ${tavilyConfigured ? "bg-status-ok" : "bg-zinc-600"}`} />
                  <span className="text-xs font-medium text-zinc-300">Web Search</span>
                  <span className="text-2xs text-zinc-600">{tavilyConfigured ? "Connected" : "Not configured (optional)"}</span>
                </div>
                {!tavilyConfigured && (
                  <a href="https://tavily.com" target="_blank" rel="noopener noreferrer" className="text-2xs text-neon-blue hover:underline">
                    1,000 free/month
                  </a>
                )}
              </div>
              {!tavilyConfigured && (
                <div className="mt-2 flex gap-2">
                  <input
                    type="password"
                    value={tavilyInput}
                    onChange={e => { setTavilyInput(e.target.value); setTavilyMessage(null); }}
                    placeholder="tvly-... (get key at tavily.com)"
                    className="flex-1 px-3 py-1.5 text-xs rounded-lg bg-zinc-900 border border-zinc-800 text-white placeholder:text-zinc-600 focus:outline-none focus:border-zinc-600"
                  />
                  <button
                    disabled={tavilySaving || !tavilyInput.trim()}
                    onClick={async () => {
                      setTavilySaving(true);
                      setTavilyMessage(null);
                      try {
                        const res = await setTavilyKey(tavilyInput.trim()) as { saved: boolean; agentRestarted: boolean; agentWasRunning: boolean };
                        setTavilyConfigured(true);
                        setTavilyInput("");
                        setTavilyMessage(
                          res.agentRestarted ? "Saved — agent restarted with web search" :
                          res.agentWasRunning ? "Saved — restart failed, restart agent manually" :
                          "Saved — will apply on next agent start"
                        );
                      } catch (err) {
                        setTavilyMessage(err instanceof Error ? err.message : "Failed to save");
                      } finally {
                        setTavilySaving(false);
                      }
                    }}
                    className="px-3 py-1.5 text-xs rounded-lg bg-neon-blue/15 text-neon-blue hover:bg-neon-blue/25 transition disabled:opacity-40"
                  >
                    {tavilySaving ? "..." : "Save"}
                  </button>
                </div>
              )}
              {tavilyMessage && (
                <p className={`mt-1.5 text-2xs ${tavilyMessage.includes("Failed") ? "text-status-error" : "text-status-ok"}`}>{tavilyMessage}</p>
              )}
            </div>

            {/* Docker not installed — install guide */}
            {!agent.checks.docker.installed && (
              <div className="mt-4 rounded-xl border border-status-warn/20 bg-status-warn/5 px-4 py-3">
                <p className="text-xs text-status-warn font-medium">Docker is required to run Echo Agent</p>
                <p className="text-2xs text-zinc-500 mt-1">Docker enables isolated deployment of the agent + database.</p>
                <a
                  href={agent.installDockerUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 inline-block rounded-lg bg-status-warn/15 px-4 py-1.5 text-xs font-medium text-status-warn hover:bg-status-warn/25 transition"
                >
                  Install Docker
                </a>
              </div>
            )}

            {/* Docker installed but not running */}
            {agent.checks.docker.installed && !agent.checks.docker.running && (
              <p className="mt-3 text-xs text-status-warn">Docker is installed but not running. Start Docker Desktop first.</p>
            )}

            {/* Missing setup steps */}
            {agent.checks.docker.installed && agent.checks.docker.running && !agent.ready && (
              <div className="mt-3 space-y-1 text-xs text-zinc-400">
                {!agent.checks.wallet && <p>→ <button onClick={() => onNavigate("/wallet")} className="text-neon-blue hover:underline">Setup wallet</button></p>}
                {!agent.checks.password && <p>→ <button onClick={() => onNavigate("/wallet")} className="text-neon-blue hover:underline">Set password</button></p>}
                {!agent.checks.compute.ready && <p>→ <button onClick={() => onNavigate("/fund")} className="text-neon-blue hover:underline">Fund compute</button></p>}
                {passwordInfo.migrationNeeded && <p>→ Legacy OpenClaw password will be migrated on first launch</p>}
              </div>
            )}
          </div>

          {/* Action button */}
          <div className="flex-shrink-0">
            {agent.agentRunning ? (
              <a
                href={agent.agentUrl ?? "http://127.0.0.1:4201"}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-xl bg-status-ok/15 px-5 py-2.5 text-sm font-medium text-status-ok hover:bg-status-ok/25 transition"
              >
                Open Agent
              </a>
            ) : agent.ready ? (
              <button
                onClick={async () => {
                  try {
                    const result = await startAgent();
                    if (result.healthy && result.url) {
                      window.open(result.url, "_blank");
                    }
                    refresh();
                  } catch { /* start failed — will show in next readiness poll */ }
                }}
                className="rounded-xl bg-neon-blue/15 px-5 py-2.5 text-sm font-medium text-neon-blue hover:bg-neon-blue/25 transition animate-pulse"
              >
                Launch Agent
              </button>
            ) : (
              <div className="rounded-xl bg-zinc-800/50 px-5 py-2.5 text-sm font-medium text-zinc-600">
                Setup Required
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 stagger-children">
        {cards.map(card => (
          <SetupCard
            key={card.title}
            title={card.title}
            status={card.status}
            summary={card.summary}
            detail={card.detail}
            action={{ label: card.actionLabel, onClick: () => onNavigate(card.path) }}
          >
            <div className="flex items-center gap-2 text-zinc-600">
              {card.icon}
              <span className="text-xs">{card.title} module</span>
            </div>
          </SetupCard>
        ))}
      </div>
    </div>
  );
};

const CheckPill: FC<{ ok: boolean; label: string }> = ({ ok, label }) => (
  <span className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-2xs font-medium ${
    ok ? "bg-status-ok/10 text-status-ok" : "bg-zinc-800 text-zinc-500"
  }`}>
    <span className={`h-1.5 w-1.5 rounded-full ${ok ? "bg-status-ok" : "bg-zinc-600"}`} />
    {label}
  </span>
);

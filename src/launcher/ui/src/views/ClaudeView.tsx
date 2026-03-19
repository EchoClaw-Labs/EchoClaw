import { type FC, useEffect, useState, useCallback } from "react";
import { PageHeader } from "../components/PageHeader";
import { SetupCard } from "../components/SetupCard";
import { ActionModal } from "../components/ActionModal";
import { WaveSpinner } from "../components/WaveSpinner";
import { postApi } from "../api";

interface ClaudeHealth {
  configured: boolean; running: boolean; healthy: boolean;
  model: string | null; port: number; provider: string | null;
  authConfigured: boolean; logFile: string; pid: number | null;
  providerEndpoint: string | null;
  settings: { projectLocal: { exists: boolean }; projectShared: { exists: boolean }; user: { exists: boolean } };
}

type ModalType = "inject" | "remove" | "restore" | null;

interface Props { onNavigate: (p: string) => void }

export const ClaudeView: FC<Props> = ({ onNavigate }) => {
  const [health, setHealth] = useState<ClaudeHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<ModalType>(null);
  const [scope, setScope] = useState("project-local");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/claude/health");
      setHealth(await res.json() as ClaudeHealth);
    } catch { /* */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 4000); };

  const doAction = async (path: string, body: Record<string, unknown> = {}) => {
    setBusy(true);
    try {
      const r = await postApi(path, body);
      showToast((r.summary as string) ?? "Done");
      setModal(null);
      await refresh();
    } catch { showToast("Error"); }
    finally { setBusy(false); }
  };

  if (loading) return <div className="flex justify-center py-20"><WaveSpinner size="lg" /></div>;

  return (
    <div className="mx-auto max-w-5xl px-5 py-8">
      <PageHeader title="Claude Proxy" description="Manage Claude Code integration and translation proxy" onBack={() => onNavigate("/")} />

      {toast && <div className="fixed bottom-6 right-6 z-50 rounded-xl border border-white/[0.1] bg-zinc-900 px-4 py-3 text-sm text-zinc-200 shadow-lg">{toast}</div>}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 mb-6">
        <SetupCard
          title="Configuration"
          status={health?.configured ? "done" : "needed"}
          summary={health?.configured ? `Model: ${health.model}` : "Not configured"}
          detail={health?.providerEndpoint ? `${health.providerEndpoint.slice(0, 30)}...` : ""}
        />
        <SetupCard
          title="Proxy"
          status={health?.running && health?.healthy ? "done" : health?.running ? "error" : "pending"}
          summary={health?.running ? (health?.healthy ? "Running & healthy" : "Unhealthy") : "Stopped"}
          detail={`Port ${health?.port ?? 4101}${health?.pid ? ` · PID ${health.pid}` : ""}`}
          action={{
            label: health?.running ? "Stop" : "Start",
            onClick: () => doAction(health?.running ? "/api/claude/proxy/stop" : "/api/claude/proxy/start"),
          }}
        />
        <SetupCard
          title="Auth"
          status={health?.authConfigured ? "done" : "needed"}
          summary={health?.authConfigured ? "Token set" : "No auth token"}
          detail="ZG_CLAUDE_AUTH_TOKEN"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 mb-6">
        <SetupCard
          title="Settings"
          status={health?.settings.projectLocal.exists || health?.settings.user.exists ? "done" : "pending"}
          summary={[
            health?.settings.projectLocal.exists && "project-local",
            health?.settings.projectShared.exists && "project-shared",
            health?.settings.user.exists && "user",
          ].filter(Boolean).join(", ") || "No settings injected"}
        />
      </div>

      <div className="flex gap-3 flex-wrap">
        <button onClick={() => { setScope("project-local"); setModal("inject"); }}
          className="rounded-lg bg-neon-blue/15 px-4 py-2 text-xs font-medium text-neon-blue hover:bg-neon-blue/25 transition">Inject Config</button>
        <button onClick={() => { setScope("project-local"); setModal("remove"); }}
          className="rounded-lg bg-zinc-800/80 px-4 py-2 text-xs font-medium text-zinc-300 hover:bg-zinc-700 transition">Remove Config</button>
        <button onClick={() => { setScope("project-local"); setModal("restore"); }}
          className="rounded-lg bg-zinc-800/80 px-4 py-2 text-xs font-medium text-zinc-300 hover:bg-zinc-700 transition">Restore Previous</button>
        <button onClick={() => refresh()}
          className="rounded-lg bg-zinc-800/80 px-4 py-2 text-xs font-medium text-zinc-300 hover:bg-zinc-700 transition">Refresh</button>
      </div>

      {/* Scope-based modals */}
      {(["inject", "remove", "restore"] as const).map(action => (
        <ActionModal key={action} open={modal === action} onClose={() => setModal(null)} title={`${action.charAt(0).toUpperCase() + action.slice(1)} Claude Config`}>
          <div className="space-y-4">
            <div>
              <label className="block text-xs text-zinc-400 mb-2">Settings scope</label>
              <div className="space-y-2">
                {["project-local", "project-shared", "user"].map(s => (
                  <label key={s} className={`flex items-center gap-3 rounded-xl border p-3 cursor-pointer transition ${scope === s ? "border-neon-blue/50 bg-neon-blue/5" : "border-white/[0.06]"}`}>
                    <input type="radio" name="scope" checked={scope === s} onChange={() => setScope(s)} className="accent-neon-blue" />
                    <span className="text-sm text-white">{s}</span>
                  </label>
                ))}
              </div>
            </div>
            <button disabled={busy} onClick={() => doAction(`/api/claude/${action}`, { scope, ...(action === "restore" ? { force: true } : {}) })}
              className="w-full rounded-lg bg-neon-blue/20 py-2 text-sm font-medium text-neon-blue hover:bg-neon-blue/30 transition disabled:opacity-40">
              {busy ? "Processing..." : action.charAt(0).toUpperCase() + action.slice(1)}
            </button>
          </div>
        </ActionModal>
      ))}
    </div>
  );
};

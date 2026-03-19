import { type FC, useEffect, useState, useCallback } from "react";
import { PageHeader } from "../components/PageHeader";
import { SetupCard } from "../components/SetupCard";
import { ActionModal } from "../components/ActionModal";
import { WaveSpinner } from "../components/WaveSpinner";
import { getSnapshot } from "../api";

interface Props { onNavigate: (p: string) => void }

async function postApi(path: string, body: Record<string, unknown>) {
  const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return res.json() as Promise<Record<string, unknown>>;
}

export const ConnectView: FC<Props> = ({ onNavigate }) => {
  const [snapshot, setSnapshot] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [showApply, setShowApply] = useState(false);
  const [runtime, setRuntime] = useState("openclaw");
  const [scope, setScope] = useState("project");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);

  const refresh = useCallback(async () => {
    try { setSnapshot(await getSnapshot(true)); } catch { /* */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 4000); };

  const runtimes = (snapshot?.runtimes as { detected: Record<string, { detected: boolean }>; recommended: string }) ?? { detected: {}, recommended: "openclaw" };
  const detected = Object.entries(runtimes.detected);

  const doPlan = async () => {
    setBusy(true);
    try {
      const r = await postApi("/api/connect/plan", { runtime, scope });
      setResult(r);
    } catch { showToast("Error"); }
    finally { setBusy(false); }
  };

  const doApply = async () => {
    setBusy(true);
    try {
      const r = await postApi("/api/connect/apply", {
        runtime, scope, force: false,
        allowWalletMutation: true, claudeScope: "project-local", startProxy: true,
      });
      setResult(r);
      showToast((r.summary as string) ?? "Applied");
      setShowApply(false);
      await refresh();
    } catch { showToast("Error"); }
    finally { setBusy(false); }
  };

  if (loading) return <div className="flex justify-center py-20"><WaveSpinner size="lg" /></div>;

  return (
    <div className="mx-auto max-w-5xl px-5 py-8">
      <PageHeader title="Connect my AI" description="Link your AI runtime to EchoClaw" onBack={() => onNavigate("/")} />

      {toast && <div className="fixed bottom-6 right-6 z-50 rounded-xl border border-white/[0.1] bg-zinc-900 px-4 py-3 text-sm text-zinc-200 shadow-lg">{toast}</div>}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 mb-6">
        {detected.map(([name, info]) => (
          <SetupCard
            key={name}
            title={name === "claude-code" ? "Claude Code" : name === "openclaw" ? "OpenClaw" : name.charAt(0).toUpperCase() + name.slice(1)}
            status={(info as { detected: boolean }).detected ? "done" : "pending"}
            summary={(info as { detected: boolean }).detected ? "Detected" : "Not detected"}
            detail={name === runtimes.recommended ? "Recommended" : ""}
          />
        ))}
      </div>

      <div className="rounded-2xl border border-white/[0.06] bg-zinc-950/50 p-6 mb-6">
        <h3 className="text-sm font-semibold text-white mb-4">Connect Runtime</h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 mb-4">
          <div>
            <label className="block text-xs text-zinc-400 mb-2">Runtime</label>
            <div className="space-y-2">
              {["openclaw", "claude-code", "codex", "other"].map(rt => (
                <label key={rt} className={`flex items-center gap-3 rounded-xl border p-2.5 cursor-pointer transition text-sm ${runtime === rt ? "border-neon-blue/50 bg-neon-blue/5 text-white" : "border-white/[0.06] text-zinc-400"}`}>
                  <input type="radio" name="rt" checked={runtime === rt} onChange={() => setRuntime(rt)} className="accent-neon-blue" />
                  {rt === "openclaw" ? "OpenClaw" : rt === "claude-code" ? "Claude Code" : rt === "codex" ? "Codex" : "Other"}
                </label>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs text-zinc-400 mb-2">Scope</label>
            <div className="space-y-2">
              {["project", "user"].map(s => (
                <label key={s} className={`flex items-center gap-3 rounded-xl border p-2.5 cursor-pointer transition text-sm ${scope === s ? "border-neon-blue/50 bg-neon-blue/5 text-white" : "border-white/[0.06] text-zinc-400"}`}>
                  <input type="radio" name="scope" checked={scope === s} onChange={() => setScope(s)} className="accent-neon-blue" />
                  {s.charAt(0).toUpperCase() + s.slice(1)}
                </label>
              ))}
            </div>
          </div>
        </div>
        <div className="flex gap-3">
          <button disabled={busy} onClick={doPlan}
            className="rounded-lg bg-zinc-800/80 px-4 py-2 text-xs font-medium text-zinc-300 hover:bg-zinc-700 transition disabled:opacity-40">
            {busy ? "..." : "Preview Plan"}
          </button>
          <button disabled={busy} onClick={() => setShowApply(true)}
            className="rounded-lg bg-neon-blue/20 px-4 py-2 text-xs font-medium text-neon-blue hover:bg-neon-blue/30 transition disabled:opacity-40">
            Apply
          </button>
        </div>
      </div>

      {result && (
        <div className="rounded-2xl border border-white/[0.06] bg-zinc-950/50 p-5">
          <h3 className="text-sm font-semibold text-white mb-2">Result</h3>
          <div className="text-xs space-y-1">
            <div><span className="text-zinc-500">Status:</span> <span className="text-zinc-300">{result.status as string}</span></div>
            <div><span className="text-zinc-500">Summary:</span> <span className="text-zinc-300">{result.summary as string}</span></div>
            {result.nextAction && <div><span className="text-zinc-500">Next:</span> <span className="text-neon-blue">{result.nextAction as string}</span></div>}
            {(result.warnings as string[])?.length > 0 && (
              <div className="text-status-warn">{(result.warnings as string[]).join(", ")}</div>
            )}
          </div>
        </div>
      )}

      <ActionModal open={showApply} onClose={() => setShowApply(false)} title="Apply Connection">
        <div className="space-y-4">
          <p className="text-sm text-zinc-400">
            This will link the EchoClaw skill for <strong className="text-white">{runtime}</strong> in <strong className="text-white">{scope}</strong> scope.
            {runtime === "claude-code" && " It will also inject Claude settings and start the proxy."}
          </p>
          <button disabled={busy} onClick={doApply}
            className="w-full rounded-lg bg-neon-blue/20 py-2 text-sm font-medium text-neon-blue hover:bg-neon-blue/30 transition disabled:opacity-40">
            {busy ? "Applying..." : "Confirm"}
          </button>
        </div>
      </ActionModal>
    </div>
  );
};

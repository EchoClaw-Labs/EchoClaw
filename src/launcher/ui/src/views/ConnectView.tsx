import { type FC, useEffect, useState, useCallback, useRef } from "react";
import { PageHeader } from "../components/PageHeader";
import { SetupCard } from "../components/SetupCard";
import { ActionModal } from "../components/ActionModal";
import { WaveSpinner } from "../components/WaveSpinner";
import { getSnapshot, postApi } from "../api";
import { runtimeLabel, RUNTIME_OPTIONS } from "../utils/runtime-meta";

interface Props { onNavigate: (p: string) => void }
type EchoScope = "project" | "user";

interface RuntimeSnapshot {
  runtimes?: { detected: Record<string, { detected: boolean }>; recommended: string };
}

interface ConnectResult extends Record<string, unknown> {
  defaultScope?: EchoScope;
}

function isEchoScope(value: unknown): value is EchoScope {
  return value === "project" || value === "user";
}

export const ConnectView: FC<Props> = ({ onNavigate }) => {
  const [snapshot, setSnapshot] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [showApply, setShowApply] = useState(false);
  const [runtime, setRuntime] = useState("openclaw");
  const [scope, setScope] = useState<EchoScope>("project");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [result, setResult] = useState<ConnectResult | null>(null);
  const [allowWalletMutation, setAllowWalletMutation] = useState(false);
  const [claudeScope, setClaudeScope] = useState<string>("project-local");
  const [startProxy, setStartProxy] = useState(true);
  const [bootstrapped, setBootstrapped] = useState(false);
  const scopeTouchedRef = useRef(false);

  const refresh = useCallback(async () => {
    try { setSnapshot(await getSnapshot(true)); } catch { /* */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 4000); };

  const runtimes = (snapshot?.runtimes as { detected: Record<string, { detected: boolean }>; recommended: string }) ?? { detected: {}, recommended: "openclaw" };
  const detected = Object.entries(runtimes.detected);

  useEffect(() => {
    if (bootstrapped || !snapshot) return;
    const recommended = (snapshot as RuntimeSnapshot).runtimes?.recommended;
    if (typeof recommended === "string" && recommended.length > 0) {
      scopeTouchedRef.current = false;
      setRuntime(recommended);
    }
    setBootstrapped(true);
  }, [bootstrapped, snapshot]);

  useEffect(() => {
    if (!bootstrapped) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await postApi<ConnectResult>("/api/connect/plan", { runtime });
        if (cancelled || scopeTouchedRef.current) return;
        if (isEchoScope(r.defaultScope)) {
          setScope(r.defaultScope);
        }
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [runtime, bootstrapped]);

  const doPlan = async () => {
    setBusy(true);
    try {
      const r = await postApi<ConnectResult>("/api/connect/plan", { runtime, scope });
      setResult(r);
    } catch { showToast("Error"); }
    finally { setBusy(false); }
  };

  const doApply = async () => {
    setBusy(true);
    try {
      const r = await postApi<ConnectResult>("/api/connect/apply", {
        runtime, scope, force: false,
        ...(allowWalletMutation ? { allowWalletMutation: true } : {}),
        ...(runtime === "claude-code" ? { claudeScope, startProxy } : {}),
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
            title={runtimeLabel(name)}
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
              {RUNTIME_OPTIONS.map(opt => (
                <label key={opt.key} className={`flex items-center gap-3 rounded-xl border p-2.5 cursor-pointer transition text-sm ${runtime === opt.key ? "border-neon-blue/50 bg-neon-blue/5 text-white" : "border-white/[0.06] text-zinc-400"}`}>
                  <input type="radio" name="rt" checked={runtime === opt.key} onChange={() => {
                    scopeTouchedRef.current = false;
                    setResult(null);
                    setRuntime(opt.key);
                  }} className="accent-neon-blue" />
                  {opt.label}
                </label>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs text-zinc-400 mb-2">Scope</label>
            <div className="space-y-2">
              {["project", "user"].map(s => (
                <label key={s} className={`flex items-center gap-3 rounded-xl border p-2.5 cursor-pointer transition text-sm ${scope === s ? "border-neon-blue/50 bg-neon-blue/5 text-white" : "border-white/[0.06] text-zinc-400"}`}>
                  <input type="radio" name="scope" checked={scope === s} onChange={() => {
                    scopeTouchedRef.current = true;
                    setResult(null);
                    setScope(s as EchoScope);
                  }} className="accent-neon-blue" />
                  {s.charAt(0).toUpperCase() + s.slice(1)}
                </label>
              ))}
            </div>
          </div>
        </div>

        {/* Wallet mutation checkbox */}
        <div className="mb-4">
          <label className="flex items-center gap-3 text-sm text-zinc-400 cursor-pointer">
            <input type="checkbox" checked={allowWalletMutation} onChange={e => setAllowWalletMutation(e.target.checked)} className="accent-neon-blue" />
            Create wallet if needed
          </label>
        </div>

        {/* Claude-code specific options */}
        {runtime === "claude-code" && (
          <div className="rounded-xl border border-white/[0.06] bg-zinc-900/40 p-4 mb-4 space-y-4">
            <h4 className="text-xs font-semibold text-zinc-300">Claude Code Options</h4>
            <div>
              <label className="block text-xs text-zinc-400 mb-2">Claude Scope</label>
              <div className="space-y-2">
                {(["project-local", "project-shared", "user"] as const).map(cs => (
                  <label key={cs} className={`flex items-center gap-3 rounded-xl border p-2.5 cursor-pointer transition text-sm ${claudeScope === cs ? "border-neon-blue/50 bg-neon-blue/5 text-white" : "border-white/[0.06] text-zinc-400"}`}>
                    <input type="radio" name="claudeScope" checked={claudeScope === cs} onChange={() => setClaudeScope(cs)} className="accent-neon-blue" />
                    {cs}
                  </label>
                ))}
              </div>
            </div>
            <label className="flex items-center gap-3 text-sm text-zinc-400 cursor-pointer">
              <input type="checkbox" checked={startProxy} onChange={e => setStartProxy(e.target.checked)} className="accent-neon-blue" />
              Start proxy
            </label>
          </div>
        )}

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
            {result.createdWalletAddress && (
              <div className="flex items-center gap-2">
                <span className="text-zinc-500">Wallet created:</span>
                <code className="text-xs text-white font-mono">{result.createdWalletAddress as string}</code>
                <button onClick={() => navigator.clipboard.writeText(result.createdWalletAddress as string)}
                  className="text-xs text-zinc-500 hover:text-white transition">Copy</button>
              </div>
            )}
            {(result.warnings as string[])?.length > 0 && (
              <div className="text-status-warn">{(result.warnings as string[]).join(", ")}</div>
            )}
          </div>
        </div>
      )}

      <ActionModal open={showApply} onClose={() => setShowApply(false)} title="Apply Connection">
        <div className="space-y-4">
          <p className="text-sm text-zinc-400">
            This will link the EchoClaw skill for <strong className="text-white">{runtimeLabel(runtime)}</strong> in <strong className="text-white">{scope}</strong> scope.
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

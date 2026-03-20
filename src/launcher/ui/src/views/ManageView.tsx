import { type FC, useState } from "react";
import { PageHeader } from "../components/PageHeader";
import { SetupCard } from "../components/SetupCard";
import { WaveSpinner } from "../components/WaveSpinner";
import { getVerify, getSnapshot, type VerifyResult } from "../api";

interface Props { onNavigate: (p: string) => void }

interface DoctorCheck { id: string; ok: boolean; title: string; detail: string; hint?: string }

interface SnapshotStatus {
  wallet: string;
  compute: string;
  runtime: string;
  monitor: string;
}

export const ManageView: FC<Props> = ({ onNavigate }) => {
  const [doctorChecks, setDoctorChecks] = useState<DoctorCheck[] | null>(null);
  const [doctorLoading, setDoctorLoading] = useState(false);
  const [supportReport, setSupportReport] = useState<string | null>(null);

  const [verifyResult, setVerifyResult] = useState<VerifyResult | null>(null);
  const [verifyLoading, setVerifyLoading] = useState(false);

  const [statusResult, setStatusResult] = useState<SnapshotStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);

  const [refreshDone, setRefreshDone] = useState(false);
  const [refreshLoading, setRefreshLoading] = useState(false);

  const runDoctor = async () => {
    setDoctorLoading(true);
    try {
      const res = await fetch("/api/doctor");
      const data = await res.json() as { checks: DoctorCheck[] };
      setDoctorChecks(data.checks);
    } catch { /* ignore */ }
    setDoctorLoading(false);
  };

  const runVerify = async () => {
    setVerifyLoading(true);
    setVerifyResult(null);
    try {
      const result = await getVerify();
      setVerifyResult(result);
    } catch { /* ignore */ }
    setVerifyLoading(false);
  };

  const runStatus = async () => {
    setStatusLoading(true);
    setStatusResult(null);
    try {
      const snap = await getSnapshot(true) as Record<string, unknown>;
      const wallet = snap.wallet as Record<string, unknown> | undefined;
      const compute = snap.compute as Record<string, unknown> | undefined;
      const runtimes = snap.runtimes as Record<string, unknown> | undefined;
      const monitor = snap.monitor as Record<string, unknown> | undefined;

      setStatusResult({
        wallet: wallet?.configuredAddress
          ? `${String(wallet.configuredAddress).slice(0, 10)}...`
          : wallet?.keystorePresent ? "Keystore present" : "Not configured",
        compute: (() => {
          const r = compute?.readiness as { ready?: boolean; provider?: string; checks?: Record<string, { ok?: boolean; detail?: string }> } | null | undefined;
          if (!r) return "Unknown";
          if (r.ready) return `Ready${r.provider ? ` (${r.provider.slice(0, 10)}...)` : ""}`;
          const failedCheck = r.checks ? Object.entries(r.checks).find(([, c]) => !c.ok) : null;
          return failedCheck ? `Not ready: ${failedCheck[1].detail ?? failedCheck[0]}` : "Not ready";
        })(),
        runtime: runtimes?.recommended ? String(runtimes.recommended) : "Unknown",
        monitor: monitor?.running ? `Running (PID ${monitor.pid ?? "?"})` : "Stopped",
      });
    } catch { /* ignore */ }
    setStatusLoading(false);
  };

  const runRefresh = async () => {
    setRefreshLoading(true);
    setRefreshDone(false);
    try {
      await getSnapshot(true);
      setRefreshDone(true);
      setTimeout(() => setRefreshDone(false), 4000);
    } catch { /* ignore */ }
    setRefreshLoading(false);
  };

  const generateReport = async () => {
    try {
      const res = await fetch("/api/support-report");
      const data = await res.json();
      setSupportReport(JSON.stringify(data, null, 2));
    } catch { /* ignore */ }
  };

  const actions = [
    { title: "Resume Setup", summary: "Continue from where you left off", action: { label: "Go", onClick: () => onNavigate("/connect") } },
    { title: "Verify", summary: "Check that everything works", action: { label: "Run", onClick: runVerify } },
    { title: "Status", summary: "View wallet, compute, runtime, and monitor status", action: { label: "Check", onClick: runStatus } },
    { title: "Doctor", summary: "Run diagnostic checks", action: { label: "Check", onClick: runDoctor } },
    { title: "Refresh from Network", summary: "Force refresh all status from on-chain data", action: { label: "Refresh", onClick: runRefresh } },
    { title: "Support Report", summary: "Generate redacted report for support", action: { label: "Generate", onClick: generateReport } },
    { title: "Fix Claude", summary: "Manage Claude proxy and config", action: { label: "Open", onClick: () => onNavigate("/claude") } },
    { title: "Fix OpenClaw", summary: "Run OpenClaw 8-step onboard", action: { label: "Open", onClick: () => onNavigate("/openclaw") } },
    { title: "Fix Skill Linking", summary: "Re-link EchoClaw skill to runtime", action: { label: "Open", onClick: () => onNavigate("/connect") } },
    { title: "Fix Compute Funding", summary: "Top up ledger or fund provider", action: { label: "Open", onClick: () => onNavigate("/fund") } },
  ];

  return (
    <div className="mx-auto max-w-5xl px-5 py-8">
      <PageHeader title="Manage / Fix" description="Diagnose issues and fix setup problems" onBack={() => onNavigate("/")} />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {actions.map(a => (
          <SetupCard key={a.title} title={a.title} status="pending" summary={a.summary} action={a.action} />
        ))}
      </div>

      {(verifyLoading || doctorLoading || statusLoading || refreshLoading) && (
        <div className="flex justify-center py-8"><WaveSpinner size="md" /></div>
      )}

      {refreshDone && (
        <div className="fixed bottom-6 right-6 z-50 rounded-xl border border-white/[0.1] bg-zinc-900 px-4 py-3 text-sm text-zinc-200 shadow-lg">
          Refreshed from network
        </div>
      )}

      {verifyResult && (
        <div className="mt-6 rounded-2xl border border-white/[0.06] bg-zinc-950/50 p-5">
          <h3 className="text-sm font-semibold text-white mb-3">Verify Results</h3>
          <div className="space-y-2">
            <div className="flex items-start gap-2 text-xs">
              <span className={verifyResult.status === "ready" ? "text-status-ok" : "text-status-error"}>
                {verifyResult.status === "ready" ? "\u2713" : "\u2717"}
              </span>
              <div>
                <span className="text-zinc-300">{verifyResult.summary}</span>
                {verifyResult.runtime && (
                  <p className="text-zinc-500 mt-0.5">Runtime: {verifyResult.runtime}</p>
                )}
              </div>
            </div>
            {verifyResult.warnings && verifyResult.warnings.length > 0 && (
              <div className="mt-2 space-y-1">
                {verifyResult.warnings.map((w, i) => (
                  <p key={i} className="text-xs text-status-error/80">{w}</p>
                ))}
              </div>
            )}
            {verifyResult.manualSteps && verifyResult.manualSteps.length > 0 && (
              <div className="mt-2 space-y-1">
                <p className="text-xs font-medium text-zinc-400">Manual steps needed:</p>
                {verifyResult.manualSteps.map((s, i) => (
                  <p key={i} className="text-xs text-zinc-500 pl-3">{s}</p>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {statusResult && (
        <div className="mt-6 rounded-2xl border border-white/[0.06] bg-zinc-950/50 p-5">
          <h3 className="text-sm font-semibold text-white mb-3">Status</h3>
          <div className="space-y-1.5">
            {([
              ["Wallet", statusResult.wallet],
              ["Compute", statusResult.compute],
              ["Runtime", statusResult.runtime],
              ["Monitor", statusResult.monitor],
            ] as const).map(([label, value]) => (
              <div key={label} className="flex items-center gap-2 text-xs">
                <span className="text-zinc-500 w-16">{label}</span>
                <span className="text-zinc-300">{value}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {doctorChecks && (
        <div className="mt-6 rounded-2xl border border-white/[0.06] bg-zinc-950/50 p-5">
          <h3 className="text-sm font-semibold text-white mb-3">Doctor Results</h3>
          <div className="space-y-1.5">
            {doctorChecks.map(c => (
              <div key={c.id} className="flex items-start gap-2 text-xs">
                <span className={c.ok ? "text-status-ok" : "text-status-error"}>{c.ok ? "\u2713" : "\u2717"}</span>
                <div>
                  <span className="text-zinc-300">{c.title}</span>
                  <span className="text-zinc-500 ml-2">{c.detail}</span>
                  {c.hint && !c.ok && <p className="text-zinc-600 mt-0.5">{c.hint}</p>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {supportReport && (
        <div className="mt-6 rounded-2xl border border-white/[0.06] bg-zinc-950/50 p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-white">Support Report</h3>
            <button
              onClick={() => navigator.clipboard.writeText(supportReport)}
              className="rounded-lg bg-zinc-800/80 px-3 py-1 text-xs text-zinc-400 hover:text-zinc-200 transition"
            >
              Copy
            </button>
          </div>
          <pre className="text-xs text-zinc-500 overflow-auto max-h-64 font-mono">{supportReport}</pre>
        </div>
      )}
    </div>
  );
};

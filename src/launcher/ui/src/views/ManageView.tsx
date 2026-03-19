import { type FC, useState } from "react";
import { PageHeader } from "../components/PageHeader";
import { SetupCard } from "../components/SetupCard";
import { WaveSpinner } from "../components/WaveSpinner";

interface Props { onNavigate: (p: string) => void }

interface DoctorCheck { id: string; ok: boolean; title: string; detail: string; hint?: string }

export const ManageView: FC<Props> = ({ onNavigate }) => {
  const [doctorChecks, setDoctorChecks] = useState<DoctorCheck[] | null>(null);
  const [doctorLoading, setDoctorLoading] = useState(false);
  const [supportReport, setSupportReport] = useState<string | null>(null);

  const runDoctor = async () => {
    setDoctorLoading(true);
    try {
      const res = await fetch("/api/doctor");
      const data = await res.json() as { checks: DoctorCheck[] };
      setDoctorChecks(data.checks);
    } catch { /* ignore */ }
    setDoctorLoading(false);
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
    { title: "Verify", summary: "Check that everything works", action: { label: "Run", onClick: () => onNavigate("/connect") } },
    { title: "Doctor", summary: "Run diagnostic checks", action: { label: "Check", onClick: runDoctor } },
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

      {doctorLoading && <div className="flex justify-center py-8"><WaveSpinner size="md" /></div>}

      {doctorChecks && (
        <div className="mt-6 rounded-2xl border border-white/[0.06] bg-zinc-950/50 p-5">
          <h3 className="text-sm font-semibold text-white mb-3">Doctor Results</h3>
          <div className="space-y-1.5">
            {doctorChecks.map(c => (
              <div key={c.id} className="flex items-start gap-2 text-xs">
                <span className={c.ok ? "text-status-ok" : "text-status-error"}>{c.ok ? "✓" : "✗"}</span>
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

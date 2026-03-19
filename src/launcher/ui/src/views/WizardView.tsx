import { type FC, useState, useEffect, useCallback } from "react";
import { WaveSpinner } from "../components/WaveSpinner";
import { getRouting, getSnapshot, postApi } from "../api";
import { RUNTIME_OPTIONS } from "../utils/runtime-meta";
import { deriveWizardBootstrapStep, type WizardStep } from "../utils/wizard-bootstrap";

const STEPS: { key: WizardStep; title: string; num: number }[] = [
  { key: "password", title: "Set Password", num: 1 },
  { key: "wallet", title: "Create Wallet", num: 2 },
  { key: "runtime", title: "Select Runtime", num: 3 },
  { key: "provider", title: "Choose Provider", num: 4 },
  { key: "fund", title: "Fund Compute", num: 5 },
  { key: "finalize", title: "Finalize", num: 6 },
];

interface Provider { provider: string; model: string; inputPricePerMTokens: string; outputPricePerMTokens: string }

interface Props { onComplete: () => void }

export const WizardView: FC<Props> = ({ onComplete }) => {
  const [step, setStep] = useState<WizardStep>("password");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [password, setPassword] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [walletChain, setWalletChain] = useState<"evm" | "both">("evm");
  const [runtime, setRuntime] = useState("openclaw");
  const [providers, setProviders] = useState<Provider[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
  const [fundAmount, setFundAmount] = useState("1.0");

  // Skip already-done steps based on snapshot
  useEffect(() => {
    let cancelled = false;
    Promise.allSettled([getSnapshot(), getRouting()]).then(([snapshotResult, routingResult]) => {
      if (cancelled) return;
      const snapshot = snapshotResult.status === "fulfilled"
        ? snapshotResult.value as {
          wallet?: { password?: { status?: string }; evmKeystorePresent?: boolean };
          runtimes?: { recommended?: string };
        }
        : null;
      const routing = routingResult.status === "fulfilled" ? routingResult.value : null;

      const recommended = snapshot?.runtimes?.recommended;
      if (typeof recommended === "string" && recommended.length > 0) {
        setRuntime(recommended);
      }

      setStep(deriveWizardBootstrapStep(snapshot, routing));
      setLoading(false);
    }).catch(() => setLoading(false));
    return () => { cancelled = true; };
  }, []);

  const doStep = useCallback(async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try { await action(); } catch (e) { setError(e instanceof Error ? e.message : "Error"); }
    finally { setBusy(false); }
  }, []);

  if (loading) return <div className="flex justify-center py-20"><WaveSpinner size="lg" /></div>;
  if (step === "done") { onComplete(); return null; }

  const currentStep = STEPS.find(s => s.key === step)!;
  const stepIdx = STEPS.findIndex(s => s.key === step);

  return (
    <div className="mx-auto max-w-lg px-5 py-12">
      {/* Progress */}
      <div className="flex items-center justify-center gap-2 mb-8">
        {STEPS.map((s, i) => (
          <div key={s.key} className={`h-1.5 w-8 rounded-full transition-colors ${i <= stepIdx ? "bg-neon-blue" : "bg-zinc-800"}`} />
        ))}
      </div>

      <h2 className="text-xl font-semibold text-white text-center mb-1">
        Step {currentStep.num}: {currentStep.title}
      </h2>
      <p className="text-sm text-zinc-500 text-center mb-8">
        {step === "password" && "Set a password to encrypt your keystore."}
        {step === "wallet" && "Create an EVM wallet (and optionally Solana)."}
        {step === "runtime" && "Choose which AI runtime you'll connect."}
        {step === "provider" && "Pick an AI provider on the 0G network."}
        {step === "fund" && "Deposit 0G tokens to fund your AI compute."}
        {step === "finalize" && "Finishing setup..."}
      </p>

      {error && <div className="mb-4 rounded-xl border border-status-error/30 bg-status-error/10 px-4 py-3 text-sm text-status-error">{error}</div>}

      <div className="rounded-2xl border border-white/[0.06] bg-zinc-950/50 p-6 space-y-4">
        {/* Password step */}
        {step === "password" && (
          <>
            <div>
              <label className="block text-xs text-zinc-400 mb-1">Password (min 8 chars)</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                className="w-full rounded-lg border border-white/[0.1] bg-zinc-900 px-3 py-2 text-sm text-white focus:border-neon-blue focus:outline-none" />
            </div>
            <div>
              <label className="block text-xs text-zinc-400 mb-1">Confirm password</label>
              <input type="password" value={confirmPw} onChange={e => setConfirmPw(e.target.value)}
                className="w-full rounded-lg border border-white/[0.1] bg-zinc-900 px-3 py-2 text-sm text-white focus:border-neon-blue focus:outline-none" />
            </div>
            <button disabled={busy || password.length < 8 || password !== confirmPw}
              onClick={() => doStep(async () => {
                await postApi("/api/wallet/password", { password });
                setStep("wallet");
              })}
              className="w-full rounded-lg bg-neon-blue/20 py-2.5 text-sm font-medium text-neon-blue hover:bg-neon-blue/30 transition disabled:opacity-40">
              {busy ? "Saving..." : "Continue"}
            </button>
          </>
        )}

        {/* Wallet step */}
        {step === "wallet" && (
          <>
            <div className="space-y-2">
              {(["evm", "both"] as const).map(opt => (
                <label key={opt} className={`flex items-center gap-3 rounded-xl border p-3 cursor-pointer transition ${walletChain === opt ? "border-neon-blue/50 bg-neon-blue/5" : "border-white/[0.06]"}`}>
                  <input type="radio" name="chain" checked={walletChain === opt} onChange={() => setWalletChain(opt)} className="accent-neon-blue" />
                  <span className="text-sm text-white">{opt === "evm" ? "EVM only" : "EVM + Solana"}</span>
                </label>
              ))}
            </div>
            <button disabled={busy}
              onClick={() => doStep(async () => {
                await postApi("/api/wallet/create", { chain: "evm" });
                if (walletChain === "both") await postApi("/api/wallet/create", { chain: "solana" });
                setStep("runtime");
              })}
              className="w-full rounded-lg bg-neon-blue/20 py-2.5 text-sm font-medium text-neon-blue hover:bg-neon-blue/30 transition disabled:opacity-40">
              {busy ? "Creating..." : "Create Wallet"}
            </button>
          </>
        )}

        {/* Runtime step */}
        {step === "runtime" && (
          <>
            <div className="space-y-2">
              {RUNTIME_OPTIONS.map(opt => (
                <label key={opt.key} className={`flex items-center gap-3 rounded-xl border p-3 cursor-pointer transition ${runtime === opt.key ? "border-neon-blue/50 bg-neon-blue/5" : "border-white/[0.06]"}`}>
                  <input type="radio" name="runtime" checked={runtime === opt.key} onChange={() => setRuntime(opt.key)} className="accent-neon-blue" />
                  <span className="text-sm text-white">{opt.label}</span>
                </label>
              ))}
            </div>
            <button onClick={() => doStep(async () => {
              const res = await fetch("/api/fund/providers");
              const data = await res.json() as { providers?: Provider[]; error?: { message?: string } };
              if (!res.ok) {
                throw new Error(data.error?.message ?? "Failed to load providers.");
              }
              setProviders(data.providers ?? []);
              setStep("provider");
            })} className="w-full rounded-lg bg-neon-blue/20 py-2.5 text-sm font-medium text-neon-blue hover:bg-neon-blue/30 transition">
              Continue
            </button>
          </>
        )}

        {/* Provider step */}
        {step === "provider" && (
          <>
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {providers.map(p => (
                <label key={p.provider} className={`flex items-center gap-3 rounded-xl border p-3 cursor-pointer transition ${selectedProvider === p.provider ? "border-neon-blue/50 bg-neon-blue/5" : "border-white/[0.06]"}`}>
                  <input type="radio" name="provider" checked={selectedProvider === p.provider} onChange={() => setSelectedProvider(p.provider)} className="accent-neon-blue" />
                  <div>
                    <div className="text-sm font-medium text-white">{p.model}</div>
                    <div className="text-xs text-zinc-500">{p.inputPricePerMTokens} / {p.outputPricePerMTokens} per 1M</div>
                  </div>
                </label>
              ))}
              {providers.length === 0 && <p className="text-sm text-zinc-500 py-4 text-center">No providers. Check wallet and network.</p>}
            </div>
            <button disabled={!selectedProvider}
              onClick={() => setStep("fund")}
              className="w-full rounded-lg bg-neon-blue/20 py-2.5 text-sm font-medium text-neon-blue hover:bg-neon-blue/30 transition disabled:opacity-40">
              Continue
            </button>
          </>
        )}

        {/* Fund step */}
        {step === "fund" && (
          <>
            <div>
              <label className="block text-xs text-zinc-400 mb-1">Amount to deposit + fund (0G)</label>
              <input type="text" value={fundAmount} onChange={e => setFundAmount(e.target.value)}
                className="w-full rounded-lg border border-white/[0.1] bg-zinc-900 px-3 py-2 text-sm text-white focus:border-neon-blue focus:outline-none" />
            </div>
            <button disabled={busy}
              onClick={() => doStep(async () => {
                await postApi("/api/fund/deposit", { amount: fundAmount });
                if (selectedProvider) await postApi("/api/fund/provider", { provider: selectedProvider, amount: fundAmount });
                setStep("finalize");
              })}
              className="w-full rounded-lg bg-neon-blue/20 py-2.5 text-sm font-medium text-neon-blue hover:bg-neon-blue/30 transition disabled:opacity-40">
              {busy ? "Funding..." : "Deposit & Fund"}
            </button>
          </>
        )}

        {/* Finalize step */}
        {step === "finalize" && (
          <>
            <div className="text-center py-4">
              {busy ? <WaveSpinner size="md" /> : <p className="text-sm text-zinc-400">Finalizing setup...</p>}
            </div>
            <button disabled={busy}
              onClick={() => doStep(async () => {
                if (selectedProvider) {
                  await postApi("/api/fund/ack", { provider: selectedProvider });

                  // Runtime-specific finalize
                  const isClaude = runtime === "claude-code";
                  await postApi("/api/fund/api-key", {
                    provider: selectedProvider,
                    tokenId: 0,
                    saveClaudeToken: isClaude,
                  });
                }

                await postApi("/api/connect/apply", {
                  runtime,
                  allowWalletMutation: false,
                  claudeScope: "project-local",
                  startProxy: runtime === "claude-code",
                });

                setStep("done");
              })}
              className="w-full rounded-lg bg-neon-blue/20 py-2.5 text-sm font-medium text-neon-blue hover:bg-neon-blue/30 transition disabled:opacity-40">
              {busy ? "Finalizing..." : "Complete Setup"}
            </button>
          </>
        )}
      </div>

      {/* Back button */}
      {stepIdx > 0 && (
        <button onClick={() => setStep(STEPS[stepIdx - 1].key)}
          className="mt-4 w-full text-center text-xs text-zinc-500 hover:text-zinc-300 transition">
          ← Back
        </button>
      )}
    </div>
  );
};

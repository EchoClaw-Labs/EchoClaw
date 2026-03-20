import { type FC, useState, useEffect, useCallback } from "react";
import { WaveSpinner } from "../components/WaveSpinner";
import { getRouting, getSnapshot } from "../api";
import { deriveWizardBootstrapStep } from "../utils/wizard-bootstrap";
import { WIZARD_STEPS, STEP_DESCRIPTIONS, type WizardStep, type WizardPath, type WizardProvider, type WalletAddresses } from "./wizard/types";
import { PasswordStep } from "./wizard/steps/PasswordStep";
import { WalletStep } from "./wizard/steps/WalletStep";
import { RuntimeStep } from "./wizard/steps/RuntimeStep";
import { ProviderStep } from "./wizard/steps/ProviderStep";
import { FundStep } from "./wizard/steps/FundStep";
import { FinalizeStep } from "./wizard/steps/FinalizeStep";

interface Props { onComplete: () => void }

export const WizardView: FC<Props> = ({ onComplete }) => {
  const [step, setStep] = useState<WizardStep>("password");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Wizard path: our Docker agent vs external runtime
  const [path, setPath] = useState<WizardPath>("echoclaw-agent");
  const [runtime, setRuntime] = useState("");

  // Shared state across steps
  const [walletAddresses, setWalletAddresses] = useState<WalletAddresses | null>(null);
  const [providers, setProviders] = useState<WizardProvider[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
  const [fundDefaults, setFundDefaults] = useState({ deposit: "3.0", fund: "3.0" });

  // Done with warning
  const [doneWarning, setDoneWarning] = useState<string | null>(null);

  // Bootstrap from snapshot
  useEffect(() => {
    let cancelled = false;
    Promise.allSettled([getSnapshot(), getRouting()]).then(([snapRes, routeRes]) => {
      if (cancelled) return;
      const snap = snapRes.status === "fulfilled"
        ? snapRes.value as {
          wallet?: { password?: { status?: string }; evmKeystorePresent?: boolean; evmAddress?: string; solanaAddress?: string };
          runtimes?: { recommended?: string };
        }
        : null;
      const routing = routeRes.status === "fulfilled" ? routeRes.value : null;

      // If snapshot recommends an external runtime, pre-select it
      const recommended = snap?.runtimes?.recommended;
      if (typeof recommended === "string" && recommended.length > 0) {
        setRuntime(recommended);
        setPath("external-runtime");
      }

      // Populate wallet addresses for bootstrap to step 3+
      if (snap?.wallet?.evmAddress) {
        setWalletAddresses({ evm: snap.wallet.evmAddress, solana: snap.wallet.solanaAddress || undefined });
      }

      if (snap?.wallet?.password?.status === "drift") {
        setError("Password drift detected. Your keystore password may not match. Consider resetting it in Wallet & Keys.");
      }

      setStep(deriveWizardBootstrapStep(snap, routing));
      setLoading(false);
    }).catch(() => setLoading(false));
    return () => { cancelled = true; };
  }, []);

  // Wrap step actions with busy/error handling
  const onAction = useCallback(async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try { await action(); }
    catch (e) { setError(e instanceof Error ? e.message : "Error"); }
    finally { setBusy(false); }
  }, []);

  // Transition to dashboard when done
  useEffect(() => { if (step === "done" && !doneWarning) onComplete(); }, [step, doneWarning, onComplete]);

  if (loading) return <div className="flex justify-center py-20"><WaveSpinner size="lg" /></div>;
  if (step === "done" && !doneWarning) return null;

  // Done with warning — agent failed to start
  if (doneWarning) return (
    <div className="mx-auto max-w-2xl px-5 py-12 text-center space-y-6">
      <h2 className="text-xl font-semibold text-white">Setup Complete</h2>
      <div className="rounded-xl border border-status-warn/30 bg-status-warn/10 px-4 py-3 text-sm text-status-warn">{doneWarning}</div>
      <button onClick={onComplete}
        className="rounded-lg bg-neon-blue/20 px-6 py-2.5 text-sm font-medium text-neon-blue hover:bg-neon-blue/30 transition">
        Go to Dashboard
      </button>
    </div>
  );

  const currentStep = WIZARD_STEPS.find(s => s.key === step)!;
  const stepIdx = WIZARD_STEPS.findIndex(s => s.key === step);

  // Compute recommended fund from selected provider pricing
  const updateFundDefaults = (prov: WizardProvider | undefined) => {
    if (!prov) return;
    const rec = prov.recommendedMinLockedOg;
    if (typeof rec === "number" && rec > 0) {
      const amt = Math.max(rec + 2, 3).toFixed(1);
      setFundDefaults({ deposit: amt, fund: amt });
    }
  };

  return (
    <div className="mx-auto max-w-2xl px-5 py-12">
      {/* Progress bar */}
      <div className="flex items-center justify-center gap-2 mb-8">
        {WIZARD_STEPS.map((s, i) => (
          <div key={s.key} className={`h-1.5 w-8 rounded-full transition-colors ${i <= stepIdx ? "bg-neon-blue" : "bg-zinc-800"}`} />
        ))}
      </div>

      <h2 className="text-xl font-semibold text-white text-center mb-1">Step {currentStep.num}: {currentStep.title}</h2>
      <p className="text-sm text-zinc-500 text-center mb-8">{STEP_DESCRIPTIONS[step]}</p>

      {error && <div className="mb-4 rounded-xl border border-status-error/30 bg-status-error/10 px-4 py-3 text-sm text-status-error">{error}</div>}

      <div className="rounded-2xl border border-white/[0.06] bg-zinc-950/50 p-6 space-y-4">
        {step === "password" && <PasswordStep busy={busy} onAction={onAction} onNext={() => setStep("wallet")} />}

        {step === "wallet" && (
          <WalletStep busy={busy} onAction={onAction}
            onNext={() => setStep("runtime")} onError={setError}
            walletAddresses={walletAddresses} setWalletAddresses={setWalletAddresses} />
        )}

        {step === "runtime" && (
          <RuntimeStep busy={busy} onAction={onAction}
            path={path} runtime={runtime}
            onSelectRuntime={(rt) => { setRuntime(rt); setPath("external-runtime"); }}
            onSelectAgent={() => { setPath("echoclaw-agent"); setRuntime(""); }}
            onNext={(provs) => { setProviders(provs); setStep("provider"); }} />
        )}

        {step === "provider" && (
          <ProviderStep busy={busy} onAction={onAction}
            providers={providers} selectedProvider={selectedProvider}
            onSelect={setSelectedProvider}
            onNext={() => {
              updateFundDefaults(providers.find(p => p.provider === selectedProvider));
              setStep("fund");
            }}
            onRetry={async () => {
              const res = await fetch("/api/fund/providers");
              const data = await res.json() as { providers?: WizardProvider[] };
              setProviders(data.providers ?? []);
            }} />
        )}

        {step === "fund" && (
          <FundStep busy={busy} onAction={onAction}
            walletAddresses={walletAddresses} selectedProvider={selectedProvider}
            initialDeposit={fundDefaults.deposit} initialFund={fundDefaults.fund}
            onNext={() => setStep("finalize")} />
        )}

        {step === "finalize" && (
          <FinalizeStep busy={busy} onAction={onAction}
            path={path} runtime={runtime} selectedProvider={selectedProvider}
            onDone={() => setStep("done")}
            onDoneWithWarning={setDoneWarning} />
        )}
      </div>

      {/* Back button */}
      {stepIdx > 0 && (
        <button onClick={() => {
          const prev = WIZARD_STEPS[stepIdx - 1].key;
          if (step === "provider" || step === "fund") { setProviders([]); setSelectedProvider(null); }
          setStep(prev);
        }} className="mt-4 w-full text-center text-xs text-zinc-500 hover:text-zinc-300 transition">
          &larr; Back
        </button>
      )}
    </div>
  );
};

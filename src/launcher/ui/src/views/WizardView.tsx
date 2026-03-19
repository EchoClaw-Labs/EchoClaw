import { type FC, useState, useEffect, useCallback } from "react";
import { WaveSpinner } from "../components/WaveSpinner";
import { getRouting, getSnapshot, postApi, startAgent as launchAgent } from "../api";
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
  const [fundAmount, setFundAmount] = useState("3.0");

  // Step 2: wallet addresses after creation
  const [walletAddresses, setWalletAddresses] = useState<{ evm: string; solana?: string } | null>(null);
  const [walletCreated, setWalletCreated] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  // Step 3: EchoClaw Agent toggle
  const [startAgent, setStartAgent] = useState(true);

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

  const copyToClipboard = useCallback((text: string, label: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(label);
      setTimeout(() => setCopied(null), 2000);
    });
  }, []);

  if (loading) return <div className="flex justify-center py-20"><WaveSpinner size="lg" /></div>;
  if (step === "done") { onComplete(); return null; }

  const currentStep = STEPS.find(s => s.key === step)!;
  const stepIdx = STEPS.findIndex(s => s.key === step);

  return (
    <div className="mx-auto max-w-2xl px-5 py-12">
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
            {!walletCreated ? (
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
                    // Fetch fresh snapshot to get wallet addresses
                    const snap = await getSnapshot(true) as { wallet?: { evmAddress?: string; solanaAddress?: string } };
                    const evm = snap?.wallet?.evmAddress ?? "";
                    const solana = snap?.wallet?.solanaAddress;
                    setWalletAddresses({ evm, solana: solana || undefined });
                    setWalletCreated(true);
                  })}
                  className="w-full rounded-lg bg-neon-blue/20 py-2.5 text-sm font-medium text-neon-blue hover:bg-neon-blue/30 transition disabled:opacity-40">
                  {busy ? "Creating..." : "Create Wallet"}
                </button>
              </>
            ) : (
              <>
                {/* Success screen with addresses */}
                <div className="flex flex-col items-center gap-3">
                  <div className="flex items-center justify-center w-12 h-12 rounded-full bg-emerald-500/20">
                    <svg className="w-6 h-6 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <p className="text-sm font-medium text-emerald-400">Wallet created successfully</p>
                </div>

                {walletAddresses?.evm && (
                  <div className="space-y-1">
                    <label className="block text-xs text-zinc-400">EVM Address</label>
                    <div className="flex items-center gap-2 rounded-lg border border-white/[0.06] bg-zinc-900 px-3 py-2">
                      <code className="flex-1 text-xs text-white font-mono break-all">{walletAddresses.evm}</code>
                      <button
                        onClick={() => copyToClipboard(walletAddresses.evm, "evm")}
                        className="shrink-0 rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-700 transition">
                        {copied === "evm" ? "Copied!" : "Copy"}
                      </button>
                    </div>
                  </div>
                )}

                {walletAddresses?.solana && (
                  <div className="space-y-1">
                    <label className="block text-xs text-zinc-400">Solana Address</label>
                    <div className="flex items-center gap-2 rounded-lg border border-white/[0.06] bg-zinc-900 px-3 py-2">
                      <code className="flex-1 text-xs text-white font-mono break-all">{walletAddresses.solana}</code>
                      <button
                        onClick={() => copyToClipboard(walletAddresses.solana!, "solana")}
                        className="shrink-0 rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-700 transition">
                        {copied === "solana" ? "Copied!" : "Copy"}
                      </button>
                    </div>
                  </div>
                )}

                <p className="text-xs text-amber-400/80 text-center">
                  Fund this address with at least 3 0G before proceeding to compute setup
                </p>

                <button
                  onClick={() => setStep("runtime")}
                  className="w-full rounded-lg bg-neon-blue/20 py-2.5 text-sm font-medium text-neon-blue hover:bg-neon-blue/30 transition">
                  Continue
                </button>
              </>
            )}
          </>
        )}

        {/* Runtime step */}
        {step === "runtime" && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Left column — External Runtimes */}
              <div className="space-y-2">
                {RUNTIME_OPTIONS.map(opt => (
                  <label key={opt.key} className={`flex items-center gap-3 rounded-xl border p-3 cursor-pointer transition ${!startAgent && runtime === opt.key ? "border-neon-blue/50 bg-neon-blue/5" : "border-white/[0.06]"}`}>
                    <input type="radio" name="runtime" checked={!startAgent && runtime === opt.key}
                      onChange={() => { setRuntime(opt.key); setStartAgent(false); }}
                      className="accent-neon-blue" />
                    <div>
                      <span className="text-sm text-white">{opt.label}</span>
                      <p className="text-xs text-zinc-500">{opt.description}</p>
                    </div>
                  </label>
                ))}
              </div>

              {/* Right column — EchoClaw Agent featured card */}
              <button
                type="button"
                onClick={() => { setRuntime("openclaw"); setStartAgent(true); }}
                className={`flex flex-col items-center gap-3 rounded-2xl border-2 p-5 cursor-pointer transition text-left
                  ${startAgent
                    ? "border-neon-blue bg-neon-blue/5 shadow-[0_0_20px_rgba(56,189,248,0.15)]"
                    : "border-white/[0.06] hover:border-white/[0.12]"}`}>
                <img src="/echoclaw-logo.png" alt="EchoClaw Agent" className="w-16 h-16 rounded-xl object-contain" />
                <div className="text-center">
                  <div className="text-sm font-semibold text-white">EchoClaw Agent</div>
                  <span className="inline-block mt-1 rounded-full bg-neon-blue/20 px-2 py-0.5 text-[10px] font-medium text-neon-blue">
                    Recommended
                  </span>
                  <p className="mt-2 text-xs text-zinc-400 leading-relaxed">
                    AI Trading Assistant powered by 0G Compute. Run locally in Docker.
                  </p>
                </div>
              </button>
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
            {/* Show wallet address */}
            {walletAddresses?.evm && (
              <div className="space-y-1">
                <label className="block text-xs text-zinc-400">Your Wallet Address</label>
                <div className="flex items-center gap-2 rounded-lg border border-white/[0.06] bg-zinc-900 px-3 py-2">
                  <code className="flex-1 text-xs text-white font-mono break-all">{walletAddresses.evm}</code>
                  <button
                    onClick={() => copyToClipboard(walletAddresses.evm, "fund-evm")}
                    className="shrink-0 rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-700 transition">
                    {copied === "fund-evm" ? "Copied!" : "Copy"}
                  </button>
                </div>
              </div>
            )}

            <p className="text-xs text-zinc-500">Minimum 3 0G required to create a compute ledger</p>

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

                // Best-effort agent launch if EchoClaw Agent was selected
                if (startAgent) {
                  try { await launchAgent(); } catch { /* agent start is best-effort */ }
                }

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
          &larr; Back
        </button>
      )}
    </div>
  );
};

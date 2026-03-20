import { type FC, useEffect, useState, useCallback } from "react";
import { PageHeader } from "../components/PageHeader";
import { FundProgress, type FundStep } from "../components/FundProgress";
import { ActionModal } from "../components/ActionModal";
import { WaveSpinner } from "../components/WaveSpinner";
import { postApi } from "../api";

interface FundData {
  walletBalanceOg: number;
  ledgerAvailableOg: number;
  ledgerReservedOg: number;
  ledgerTotalOg: number;
  provider: string | null;
  model: string | null;
  inputPricePerMTokens: string | null;
  outputPricePerMTokens: string | null;
  recommendedMinLockedOg: number | null;
  currentLockedOg: number | null;
  acknowledged: boolean | null;
  subAccountExists?: boolean;
  monitorRunning: boolean;
  requiresApiKeyRotation: boolean;
  selectionWarning: string | null;
  refreshedAt: string;
}

interface Provider {
  provider: string;
  model: string;
  inputPricePerMTokens: string;
  outputPricePerMTokens: string;
}

type ModalType = "deposit" | "fund" | "ack" | "apikey" | "providers" | null;

interface Props { onNavigate: (p: string) => void }

// ── Step status derivation ──────────────────────────────────────

function deriveSteps(view: FundData, actions: {
  onDeposit: () => void;
  onSwitch: () => void;
  onFund: () => void;
  onAck: () => void;
  onApiKey: () => void;
}): FundStep[] {
  const hasLedger = view.ledgerTotalOg > 0;
  const hasProvider = !!view.provider;
  const lockedOk = view.currentLockedOg != null && view.currentLockedOg > 0
    && (view.recommendedMinLockedOg == null || view.currentLockedOg >= view.recommendedMinLockedOg);
  const acked = view.acknowledged === true;
  const hasApiKey = !view.requiresApiKeyRotation;

  // Determine first incomplete step
  const completedBits = [hasLedger, hasProvider, lockedOk, acked, hasApiKey];
  const firstIncomplete = completedBits.indexOf(false);

  function status(idx: number): "done" | "active" | "pending" {
    if (completedBits[idx]) return "done";
    if (idx === firstIncomplete) return "active";
    return "pending";
  }

  // Fund step detail
  const fundSummary = view.subAccountExists === false
    ? "Not funded yet"
    : view.currentLockedOg != null
      ? `${view.currentLockedOg.toFixed(4)} 0G locked`
      : "Not funded";

  const fundDetail = view.recommendedMinLockedOg != null
    ? `Min: ${view.recommendedMinLockedOg.toFixed(3)} 0G`
    : undefined;

  const fundDeficit = view.recommendedMinLockedOg != null
    && view.currentLockedOg != null
    && view.currentLockedOg < view.recommendedMinLockedOg
    ? `(need ${(view.recommendedMinLockedOg - view.currentLockedOg).toFixed(3)} more)`
    : undefined;

  return [
    {
      num: 1,
      title: "Deposit to Ledger",
      status: status(0),
      summary: hasLedger
        ? `${view.ledgerAvailableOg.toFixed(4)} avail / ${view.ledgerTotalOg.toFixed(4)} total`
        : "Deposit 0G tokens to compute ledger",
      action: { label: "Deposit", onClick: actions.onDeposit },
    },
    {
      num: 2,
      title: "Select Provider",
      status: status(1),
      summary: view.model ?? "No provider selected",
      action: { label: "Switch", onClick: actions.onSwitch },
    },
    {
      num: 3,
      title: "Fund Provider",
      status: status(2),
      summary: fundSummary,
      detail: fundDetail,
      deficit: fundDeficit,
      action: { label: "Fund", onClick: actions.onFund },
    },
    {
      num: 4,
      title: "Acknowledge Provider",
      status: status(3),
      summary: acked ? "Confirmed" : (view.subAccountExists === false ? "Fund provider first" : "Acknowledge provider signer"),
      action: view.subAccountExists === false ? undefined : { label: "ACK", onClick: actions.onAck },
    },
    {
      num: 5,
      title: "Create API Key",
      status: status(4),
      summary: hasApiKey
        ? `${view.inputPricePerMTokens ?? "?"} / ${view.outputPricePerMTokens ?? "?"} per 1M tokens`
        : "Create an API key to activate compute",
      action: { label: hasApiKey ? "New Key" : "Create", onClick: actions.onApiKey },
    },
  ];
}

function getNextStepBanner(steps: FundStep[]): { message: string; stepNum: number } | null {
  const active = steps.find(s => s.status === "active");
  if (!active) return null;
  const messages: Record<number, string> = {
    1: "Deposit 0G tokens to your compute ledger to get started.",
    2: "Select an AI model provider on the 0G network.",
    3: "Lock tokens for your selected provider.",
    4: "Acknowledge your provider's TEE signer.",
    5: "Create an API key to activate your compute provider.",
  };
  return { message: messages[active.num] ?? "Complete this step to continue.", stepNum: active.num };
}

// ── Component ───────────────────────────────────────────────────

export const FundView: FC<Props> = ({ onNavigate }) => {
  const [view, setView] = useState<FundData | null>(null);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalType>(null);
  const [amount, setAmount] = useState("1.0");
  const [tokenId, setTokenId] = useState("0");
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // Runtime picker state for API key modal
  const [saveOpenclaw, setSaveOpenclaw] = useState(true);
  const [saveClaude, setSaveClaude] = useState(false);

  const refresh = useCallback(async (fresh = false) => {
    try {
      const qs = fresh ? "?fresh=1" : "";
      const res = await fetch(`/api/fund/view${qs}`);
      if (res.ok) { setView(await res.json() as FundData); setError(null); }
      else { const e = await res.json() as { error?: { message?: string } }; setError(e.error?.message ?? "Error"); }
    } catch (e) { setError(e instanceof Error ? e.message : "Network error"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 4000); };

  const doAction = async (path: string, body: Record<string, unknown>) => {
    setBusy(true);
    try {
      const result = await postApi(path, body) as { summary?: string; error?: { message?: string } };
      if (result.error) { showToast(`Error: ${result.error.message}`); }
      else { showToast(result.summary ?? "Done"); }
      setModal(null);
      await refresh(true);
    } catch { showToast("Network error"); }
    finally { setBusy(false); }
  };

  const loadProviders = async () => {
    try {
      const res = await fetch("/api/fund/providers");
      const data = await res.json() as { providers: Provider[] };
      setProviders(data.providers ?? []);
      setModal("providers");
    } catch { showToast("Failed to load providers"); }
  };

  if (loading) return <div className="flex justify-center py-20"><WaveSpinner size="lg" /></div>;

  const steps = view ? deriveSteps(view, {
    onDeposit: () => { setAmount("1.0"); setModal("deposit"); },
    onSwitch: loadProviders,
    onFund: () => {
      const def = view.recommendedMinLockedOg && view.currentLockedOg != null
        ? Math.max(0.1, view.recommendedMinLockedOg - view.currentLockedOg).toFixed(2) : "1.0";
      setAmount(def); setModal("fund");
    },
    onAck: () => setModal("ack"),
    onApiKey: () => setModal("apikey"),
  }) : [];

  const allDone = steps.length > 0 && steps.every(s => s.status === "done");
  const nextStep = getNextStepBanner(steps);

  return (
    <div className="mx-auto max-w-3xl px-5 py-8">
      <PageHeader title="Fund my AI in 0G" description="Manage compute ledger, providers, and API keys" onBack={() => onNavigate("/")} />

      {error && <div className="mb-6 rounded-xl border border-status-error/30 bg-status-error/10 px-4 py-3 text-sm text-status-error">{error}</div>}

      {toast && (
        <div className="fixed bottom-6 right-6 z-50 rounded-xl border border-white/[0.1] bg-zinc-900 px-4 py-3 text-sm text-zinc-200 shadow-lg">
          {toast}
        </div>
      )}

      {view && (
        <>
          {/* Next-step banner or success banner */}
          {allDone ? (
            <div className="mb-6 rounded-xl border border-status-ok/30 bg-status-ok/[0.06] px-5 py-4">
              <div className="flex items-center gap-2 text-sm font-medium text-status-ok">
                <span className="text-base">{"\u2713"}</span>
                Provider funded and ready!
              </div>
              <p className="mt-1 text-xs text-zinc-400">Your compute provider is fully configured. Go to Connect to link a runtime.</p>
            </div>
          ) : nextStep ? (
            <div className="mb-6 rounded-xl border border-neon-blue/20 bg-neon-blue/[0.04] px-5 py-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 text-sm font-medium text-neon-blue">
                    <span className="text-base">{"\u2192"}</span>
                    Step {nextStep.stepNum}: {nextStep.message}
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {/* Numbered progress */}
          <div className="mb-6">
            <FundProgress steps={steps} />
          </div>

          {/* Provider address */}
          {view.provider && (
            <div className="mb-6 flex items-center gap-2 rounded-xl border border-white/[0.06] bg-zinc-950/30 px-4 py-3">
              <span className="text-[11px] text-zinc-500">Provider:</span>
              <span className="font-mono text-[11px] text-zinc-400 truncate flex-1">{view.provider}</span>
              <button
                onClick={() => { navigator.clipboard.writeText(view.provider!); showToast("Copied!"); }}
                className="shrink-0 text-xs text-zinc-500 hover:text-white transition"
              >Copy</button>
            </div>
          )}

          {/* Footer */}
          <div className="flex items-center gap-3 flex-wrap">
            <span className={`text-xs ${view.monitorRunning ? "text-status-ok" : "text-zinc-600"}`}>
              Monitor: {view.monitorRunning ? "running" : "stopped"}
            </span>
            <span className="text-xs text-zinc-600">Updated: {new Date(view.refreshedAt).toLocaleTimeString()}</span>
            <button onClick={() => refresh(true)} className="rounded-lg bg-zinc-800/80 px-4 py-2 text-xs font-medium text-zinc-300 hover:bg-zinc-700 transition">Refresh</button>
          </div>
        </>
      )}

      {/* Deposit modal */}
      <ActionModal open={modal === "deposit"} onClose={() => setModal(null)} title="Deposit to Ledger">
        <div className="space-y-4">
          <div>
            <label className="block text-xs text-zinc-400 mb-1">Amount (0G)</label>
            <input type="text" value={amount} onChange={e => setAmount(e.target.value)}
              className="w-full rounded-lg border border-white/[0.1] bg-zinc-900 px-3 py-2 text-sm text-white focus:border-neon-blue focus:outline-none" />
          </div>
          <button disabled={busy} onClick={() => doAction("/api/fund/deposit", { amount })}
            className="w-full rounded-lg bg-neon-blue/20 py-2 text-sm font-medium text-neon-blue hover:bg-neon-blue/30 transition disabled:opacity-50">
            {busy ? "Processing..." : "Deposit"}
          </button>
        </div>
      </ActionModal>

      {/* Fund provider modal */}
      <ActionModal open={modal === "fund"} onClose={() => setModal(null)} title="Fund Provider">
        <div className="space-y-4">
          {view && view.ledgerAvailableOg != null && (
            <p className="text-xs text-zinc-500">Ledger available: {view.ledgerAvailableOg.toFixed(4)} 0G</p>
          )}
          <div>
            <label className="block text-xs text-zinc-400 mb-1">Amount (0G)</label>
            <input type="number" min="0" step="0.1" value={amount} onChange={e => setAmount(e.target.value)}
              className="w-full rounded-lg border border-white/[0.1] bg-zinc-900 px-3 py-2 text-sm text-white focus:border-neon-blue focus:outline-none" />
          </div>
          {view && Number(amount) > view.ledgerAvailableOg + 0.001 && (
            <p className="text-xs text-status-error">Amount exceeds available ledger balance.</p>
          )}
          <button disabled={busy || !amount || isNaN(Number(amount)) || Number(amount) <= 0 || (view != null && Number(amount) > view.ledgerAvailableOg + 0.001)}
            onClick={() => doAction("/api/fund/provider", { provider: view?.provider, amount })}
            className="w-full rounded-lg bg-neon-blue/20 py-2 text-sm font-medium text-neon-blue hover:bg-neon-blue/30 transition disabled:opacity-50">
            {busy ? "Processing..." : "Fund"}
          </button>
        </div>
      </ActionModal>

      {/* ACK modal */}
      <ActionModal open={modal === "ack"} onClose={() => setModal(null)} title="Acknowledge Provider">
        <div className="space-y-4">
          <p className="text-sm text-zinc-400">This will acknowledge the provider's TEE signer on-chain.</p>
          <button disabled={busy} onClick={() => doAction("/api/fund/ack", { provider: view?.provider })}
            className="w-full rounded-lg bg-neon-blue/20 py-2 text-sm font-medium text-neon-blue hover:bg-neon-blue/30 transition disabled:opacity-50">
            {busy ? "Processing..." : "Acknowledge"}
          </button>
        </div>
      </ActionModal>

      {/* API Key modal with runtime picker */}
      <ActionModal open={modal === "apikey"} onClose={() => { setModal(null); setCreatedToken(null); }} title={createdToken ? "API Key Created" : "Create API Key"}>
        <div className="space-y-4">
          {createdToken ? (
            <>
              <div className="rounded-lg bg-status-warn/10 border border-status-warn/30 px-3 py-2 text-xs text-status-warn">
                Save this token — it will not be shown again.
              </div>
              <div className="flex items-center gap-2 rounded-lg bg-zinc-900 px-3 py-2">
                <code className="flex-1 text-xs text-white font-mono break-all">{createdToken}</code>
                <button onClick={() => navigator.clipboard.writeText(createdToken)}
                  className="shrink-0 rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-700 transition">Copy</button>
              </div>
              <button onClick={() => { setModal(null); setCreatedToken(null); }}
                className="w-full rounded-lg bg-neon-blue/20 py-2 text-sm font-medium text-neon-blue hover:bg-neon-blue/30 transition">Done</button>
            </>
          ) : (
            <>
              <div>
                <label className="block text-xs text-zinc-400 mb-1">Token ID (0-254)</label>
                <input type="number" min="0" max="254" step="1" value={tokenId} onChange={e => setTokenId(e.target.value)}
                  className="w-full rounded-lg border border-white/[0.1] bg-zinc-900 px-3 py-2 text-sm text-white focus:border-neon-blue focus:outline-none" />
              </div>

              {/* Runtime picker */}
              <div className="border-t border-white/[0.06] pt-3 space-y-2">
                <p className="text-xs text-zinc-400 font-medium">Save API key to runtimes:</p>
                <label className="flex items-center gap-2.5 text-sm text-zinc-300 cursor-pointer">
                  <input type="checkbox" checked disabled className="accent-neon-blue rounded" />
                  <span>EchoClaw Agent</span>
                  <span className="text-[10px] text-zinc-500 ml-auto">always</span>
                </label>
                <label className="flex items-center gap-2.5 text-sm text-zinc-300 cursor-pointer">
                  <input type="checkbox" checked={saveOpenclaw} onChange={e => setSaveOpenclaw(e.target.checked)} className="accent-neon-blue rounded" />
                  <span>OpenClaw</span>
                </label>
                <label className="flex items-center gap-2.5 text-sm text-zinc-300 cursor-pointer">
                  <input type="checkbox" checked={saveClaude} onChange={e => setSaveClaude(e.target.checked)} className="accent-neon-blue rounded" />
                  <span>Claude Code</span>
                </label>
              </div>

              <button disabled={busy || isNaN(Number(tokenId)) || Number(tokenId) < 0 || Number(tokenId) > 254 || !Number.isInteger(Number(tokenId))}
                onClick={async () => {
                  setBusy(true);
                  try {
                    const result = await postApi("/api/fund/api-key", {
                      tokenId: Number(tokenId),
                      saveClaudeToken: saveClaude,
                      patchOpenclaw: saveOpenclaw,
                    }) as { rawToken?: string; summary?: string; warnings?: string[] };
                    if (result.rawToken) {
                      setCreatedToken(result.rawToken);
                      if (Array.isArray(result.warnings) && result.warnings.length > 0) {
                        showToast(result.warnings[0]!);
                      }
                    } else {
                      showToast(result.summary ?? "API key created");
                      setModal(null);
                    }
                    await refresh(true);
                  } catch { showToast("Failed to create API key"); }
                  finally { setBusy(false); }
                }}
                className="w-full rounded-lg bg-neon-blue/20 py-2 text-sm font-medium text-neon-blue hover:bg-neon-blue/30 transition disabled:opacity-50">
                {busy ? "Processing..." : "Create"}
              </button>
            </>
          )}
        </div>
      </ActionModal>

      {/* Provider picker modal */}
      <ActionModal open={modal === "providers"} onClose={() => setModal(null)} title="Select Provider">
        <div className="space-y-2 max-h-80 overflow-y-auto">
          {providers.map(p => (
            <button key={p.provider} onClick={async () => {
              setModal(null);
              setBusy(true);
              try {
                const res = await postApi("/api/fund/select-provider", { provider: p.provider }) as { selectionWarning?: string | null; summary?: string };
                showToast(res.selectionWarning ?? res.summary ?? "Provider selected");
              } catch { showToast("Failed to save selection"); }
              setBusy(false);
              await refresh(true);
            }}
              className="w-full rounded-xl border border-white/[0.06] bg-zinc-900/50 px-4 py-3 text-left hover:border-white/20 transition">
              <div className="text-sm font-medium text-white">{p.model}</div>
              <div className="text-xs text-zinc-500 mt-0.5">{p.inputPricePerMTokens} / {p.outputPricePerMTokens} per 1M · {p.provider.slice(0, 12)}...</div>
            </button>
          ))}
          {providers.length === 0 && <p className="text-sm text-zinc-500 text-center py-4">No providers found</p>}
        </div>
      </ActionModal>
    </div>
  );
};

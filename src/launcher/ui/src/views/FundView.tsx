import { type FC, useEffect, useState, useCallback } from "react";
import { PageHeader } from "../components/PageHeader";
import { SetupCard } from "../components/SetupCard";
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

export const FundView: FC<Props> = ({ onNavigate }) => {
  const [view, setView] = useState<FundData | null>(null);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalType>(null);
  const [amount, setAmount] = useState("1.0");
  const [tokenId, setTokenId] = useState("0");
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const refresh = useCallback(async (fresh = false) => {
    try {
      const params = new URLSearchParams();
      if (fresh) params.set("fresh", "1");
      if (selectedProvider) params.set("provider", selectedProvider);
      const qs = params.toString() ? `?${params}` : "";
      const res = await fetch(`/api/fund/view${qs}`);
      if (res.ok) { setView(await res.json() as FundData); setError(null); }
      else { const e = await res.json() as { error?: { message?: string } }; setError(e.error?.message ?? "Error"); }
    } catch (e) { setError(e instanceof Error ? e.message : "Network error"); }
    finally { setLoading(false); }
  }, [selectedProvider]);

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

  return (
    <div className="mx-auto max-w-5xl px-5 py-8">
      <PageHeader title="Fund my AI in 0G" description="Manage compute ledger, providers, and API keys" onBack={() => onNavigate("/")} />

      {error && <div className="mb-6 rounded-xl border border-status-error/30 bg-status-error/10 px-4 py-3 text-sm text-status-error">{error}</div>}

      {toast && (
        <div className="fixed bottom-6 right-6 z-50 rounded-xl border border-white/[0.1] bg-zinc-900 px-4 py-3 text-sm text-zinc-200 shadow-lg">
          {toast}
        </div>
      )}

      {view && (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 mb-6">
            <SetupCard title="Wallet" status="done" summary={`${view.walletBalanceOg.toFixed(4)} 0G`} detail="Your on-chain 0G token balance" />
            <SetupCard
              title="Ledger"
              status={view.ledgerTotalOg > 0 ? "done" : "needed"}
              summary={`${view.ledgerAvailableOg.toFixed(4)} avail / ${view.ledgerTotalOg.toFixed(4)} total`}
              detail={`Compute budget for AI inference \u00b7 Reserved: ${view.ledgerReservedOg.toFixed(4)} 0G`}
              action={{ label: "Deposit", onClick: () => { setAmount("1.0"); setModal("deposit"); } }}
            />
            <SetupCard
              title="Provider"
              status={view.provider ? "done" : "needed"}
              summary={view.model ?? "No provider"}
              detail={view.provider ? `Selected AI model on 0G \u00b7 ${view.provider.slice(0, 10)}...` : "Select an AI model on 0G"}
              action={{ label: "Switch", onClick: loadProviders }}
            />
          </div>

          {view.provider && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 mb-6">
              <SetupCard
                title="Locked"
                status={view.subAccountExists === false ? "needed" : (view.currentLockedOg != null && view.currentLockedOg > 0 ? "done" : "needed")}
                summary={view.subAccountExists === false ? "Not funded yet" : (view.currentLockedOg != null ? `${view.currentLockedOg.toFixed(4)} 0G` : "Not funded")}
                detail={view.subAccountExists === false ? "Tokens reserved for this model \u00b7 Fund provider to create sub-account" : (view.recommendedMinLockedOg != null ? `Tokens reserved for this model \u00b7 Min: ${view.recommendedMinLockedOg.toFixed(3)} 0G` : "Tokens reserved for this model")}
                action={{ label: "Fund", onClick: () => {
                  const def = view.recommendedMinLockedOg && view.currentLockedOg != null
                    ? Math.max(0.1, view.recommendedMinLockedOg - view.currentLockedOg).toFixed(2) : "1.0";
                  setAmount(def); setModal("fund");
                }}}
              />
              <SetupCard
                title="ACK"
                status={view.subAccountExists === false ? "pending" : (view.acknowledged === true ? "done" : "needed")}
                summary={view.subAccountExists === false ? "Fund model first" : (view.acknowledged ? "Acknowledged" : "ACK needed")}
                detail={view.subAccountExists === false ? "Provider signer acknowledgment \u00b7 Requires funded sub-account" : "Provider TEE signer acknowledgment"}
                action={view.subAccountExists === false ? undefined : (view.acknowledged ? undefined : { label: "ACK", onClick: () => setModal("ack") })}
              />
              <SetupCard
                title="Pricing"
                status="done"
                summary={`${view.inputPricePerMTokens ?? "?"} / ${view.outputPricePerMTokens ?? "?"}`}
                detail="Per-token inference costs \u00b7 per 1M tokens"
                action={{ label: "API Key", onClick: () => setModal("apikey") }}
              />
            </div>
          )}

          <div className="flex gap-3">
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
          <div>
            <label className="block text-xs text-zinc-400 mb-1">Amount (0G)</label>
            <input type="text" value={amount} onChange={e => setAmount(e.target.value)}
              className="w-full rounded-lg border border-white/[0.1] bg-zinc-900 px-3 py-2 text-sm text-white focus:border-neon-blue focus:outline-none" />
          </div>
          <button disabled={busy} onClick={() => doAction("/api/fund/provider", { provider: view?.provider, amount })}
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

      {/* API Key modal */}
      <ActionModal open={modal === "apikey"} onClose={() => setModal(null)} title="Create API Key">
        <div className="space-y-4">
          <div>
            <label className="block text-xs text-zinc-400 mb-1">Token ID (0-254)</label>
            <input type="text" value={tokenId} onChange={e => setTokenId(e.target.value)}
              className="w-full rounded-lg border border-white/[0.1] bg-zinc-900 px-3 py-2 text-sm text-white focus:border-neon-blue focus:outline-none" />
          </div>
          <button disabled={busy} onClick={() => doAction("/api/fund/api-key", { provider: view?.provider, tokenId: Number(tokenId), saveClaudeToken: true })}
            className="w-full rounded-lg bg-neon-blue/20 py-2 text-sm font-medium text-neon-blue hover:bg-neon-blue/30 transition disabled:opacity-50">
            {busy ? "Processing..." : "Create"}
          </button>
        </div>
      </ActionModal>

      {/* Provider picker modal */}
      <ActionModal open={modal === "providers"} onClose={() => setModal(null)} title="Select Provider">
        <div className="space-y-2 max-h-80 overflow-y-auto">
          {providers.map(p => (
            <button key={p.provider} onClick={() => { setSelectedProvider(p.provider); setModal(null); setTimeout(() => refresh(true), 100); }}
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

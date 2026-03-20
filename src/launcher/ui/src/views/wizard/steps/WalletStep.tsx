import { type FC, useState } from "react";
import { getSnapshot, postApi } from "../../../api";
import { ActionModal } from "../../../components/ActionModal";
import { CopyField } from "../../../components/CopyField";
import type { StepProps, WalletAddresses, WalletMutationResponse } from "../types";

interface Props extends StepProps {
  onNext: () => void;
  onError: (msg: string) => void;
  walletAddresses: WalletAddresses | null;
  setWalletAddresses: (a: WalletAddresses) => void;
}

export const WalletStep: FC<Props> = ({ busy, onAction, onNext, onError, walletAddresses, setWalletAddresses }) => {
  const [walletChain, setWalletChain] = useState<"evm" | "both">("evm");
  const [walletMode, setWalletMode] = useState<"create" | "import">("create");
  const [importKey, setImportKey] = useState("");
  const [created, setCreated] = useState(false);

  // Overwrite confirmation
  const [showConfirm, setShowConfirm] = useState(false);
  const [pendingForce, setPendingForce] = useState<{ path: string; body: Record<string, unknown> } | null>(null);

  const fetchAddresses = async () => {
    const snap = await getSnapshot(true) as { wallet?: { evmAddress?: string; solanaAddress?: string } };
    setWalletAddresses({ evm: snap?.wallet?.evmAddress ?? "", solana: snap?.wallet?.solanaAddress || undefined });
  };

  const createSolanaIfNeeded = async () => {
    if (walletChain !== "both") return;
    try {
      const r = await postApi<WalletMutationResponse>("/api/wallet/create", { chain: "solana" });
      if (r.status === "confirm_required") {
        await postApi("/api/wallet/create", { chain: "solana", force: true });
      }
    } catch {
      onError("EVM wallet created but Solana wallet failed. You can create it later in Wallet & Keys.");
    }
  };

  const handleCreate = async () => {
    const path = walletMode === "import" ? "/api/wallet/import" : "/api/wallet/create";
    const body: Record<string, unknown> = walletMode === "import"
      ? { chain: "evm", privateKey: importKey, force: false }
      : { chain: "evm" };

    const r = await postApi<WalletMutationResponse>(path, body);
    if (r.status === "confirm_required") {
      setPendingForce({ path, body: { ...body, force: true } });
      setShowConfirm(true);
      return;
    }
    await createSolanaIfNeeded();
    await fetchAddresses();
    setCreated(true);
  };

  const handleConfirmOverwrite = async () => {
    setShowConfirm(false);
    if (!pendingForce) return;
    await postApi(pendingForce.path, pendingForce.body);
    setPendingForce(null);
    await createSolanaIfNeeded();
    await fetchAddresses();
    setCreated(true);
  };

  if (created && walletAddresses) {
    return (
      <>
        <div className="flex flex-col items-center gap-3">
          <div className="flex items-center justify-center w-12 h-12 rounded-full bg-emerald-500/20">
            <svg className="w-6 h-6 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <p className="text-sm font-medium text-emerald-400">Wallet created successfully</p>
        </div>
        {walletAddresses.evm && <CopyField label="EVM Address" value={walletAddresses.evm} />}
        {walletAddresses.solana && <CopyField label="Solana Address" value={walletAddresses.solana} />}
        <p className="text-xs text-amber-400/80 text-center">
          Fund this address with at least 3 0G before proceeding to compute setup
        </p>
        <button onClick={onNext}
          className="w-full rounded-lg bg-neon-blue/20 py-2.5 text-sm font-medium text-neon-blue hover:bg-neon-blue/30 transition">
          Continue
        </button>
      </>
    );
  }

  return (
    <>
      <div className="flex gap-2 mb-2">
        {(["create", "import"] as const).map(m => (
          <button key={m} onClick={() => setWalletMode(m)}
            className={`flex-1 rounded-lg py-1.5 text-xs font-medium transition ${walletMode === m ? "bg-neon-blue/20 text-neon-blue" : "bg-zinc-800 text-zinc-500 hover:text-zinc-300"}`}>
            {m === "create" ? "Create New" : "Import Key"}
          </button>
        ))}
      </div>

      <div className="space-y-2">
        {(["evm", "both"] as const).map(opt => (
          <label key={opt} className={`flex items-center gap-3 rounded-xl border p-3 cursor-pointer transition ${walletChain === opt ? "border-neon-blue/50 bg-neon-blue/5" : "border-white/[0.06]"}`}>
            <input type="radio" name="chain" checked={walletChain === opt} onChange={() => setWalletChain(opt)} className="accent-neon-blue" />
            <span className="text-sm text-white">{opt === "evm" ? "EVM only" : "EVM + Solana"}</span>
          </label>
        ))}
      </div>

      {walletMode === "import" && (
        <div>
          <label className="block text-xs text-zinc-400 mb-1">Private Key</label>
          <input type="password" value={importKey} onChange={e => setImportKey(e.target.value)} placeholder="0x..."
            className="w-full rounded-lg border border-white/[0.1] bg-zinc-900 px-3 py-2 text-sm text-white focus:border-neon-blue focus:outline-none" />
        </div>
      )}

      <button disabled={busy || (walletMode === "import" && !importKey)}
        onClick={() => onAction(handleCreate)}
        className="w-full rounded-lg bg-neon-blue/20 py-2.5 text-sm font-medium text-neon-blue hover:bg-neon-blue/30 transition disabled:opacity-40">
        {busy ? "Processing..." : walletMode === "create" ? "Create Wallet" : "Import Wallet"}
      </button>

      <ActionModal open={showConfirm} onClose={() => { setShowConfirm(false); setPendingForce(null); }} title="Overwrite existing wallet?">
        <div className="space-y-4">
          <p className="text-sm text-zinc-400">A keystore already exists. Importing will overwrite it. A backup will be created automatically.</p>
          <div className="flex gap-2">
            <button onClick={() => { setShowConfirm(false); setPendingForce(null); }}
              className="flex-1 rounded-lg bg-zinc-800 py-2 text-sm text-zinc-300 hover:bg-zinc-700 transition">Cancel</button>
            <button onClick={() => onAction(handleConfirmOverwrite)}
              className="flex-1 rounded-lg bg-status-error/20 py-2 text-sm font-medium text-status-error hover:bg-status-error/30 transition">
              Overwrite
            </button>
          </div>
        </div>
      </ActionModal>
    </>
  );
};

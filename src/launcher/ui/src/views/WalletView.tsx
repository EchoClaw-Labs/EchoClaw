import { type FC, useEffect, useState, useCallback } from "react";
import { PageHeader } from "../components/PageHeader";
import { SetupCard } from "../components/SetupCard";
import { ActionModal } from "../components/ActionModal";
import { WaveSpinner } from "../components/WaveSpinner";
import { getSnapshot } from "../api";

function trunc(addr: string | null): string {
  if (!addr) return "—";
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

interface Wallet {
  evmAddress: string | null; solanaAddress: string | null;
  evmKeystorePresent: boolean; solanaKeystorePresent: boolean;
  password: { status: string; source: string };
  decryptable: boolean;
}

interface BackupEntry { dir: string; manifest: { createdAt: string; walletAddress: string | null; solanaWalletAddress: string | null } }

type ModalType = "password" | "createEvm" | "createSol" | "importEvm" | "importSol" | "backups" | "export" | null;

async function postApi(path: string, body: Record<string, unknown>) {
  const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return res.json() as Promise<Record<string, unknown>>;
}

interface Props { onNavigate: (p: string) => void }

export const WalletView: FC<Props> = ({ onNavigate }) => {
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<ModalType>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [backups, setBackups] = useState<BackupEntry[]>([]);

  // Form state
  const [password, setPassword] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [importKey, setImportKey] = useState("");
  const [exportChain, setExportChain] = useState<"evm" | "solana">("evm");

  const refresh = useCallback(async () => {
    try {
      const snap = await getSnapshot();
      setWallet((snap as { wallet: Wallet }).wallet);
    } catch { /* */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 4000); };

  const doAction = async (path: string, body: Record<string, unknown>) => {
    setBusy(true);
    try {
      const r = await postApi(path, body);
      showToast((r.summary as string) ?? "Done");
      setModal(null);
      await refresh();
    } catch { showToast("Error"); }
    finally { setBusy(false); }
  };

  const loadBackups = async () => {
    try {
      const res = await fetch("/api/wallet/backups");
      const data = await res.json() as { backups: BackupEntry[] };
      setBackups(data.backups ?? []);
      setModal("backups");
    } catch { showToast("Failed to load backups"); }
  };

  if (loading) return <div className="flex justify-center py-20"><WaveSpinner size="lg" /></div>;

  return (
    <div className="mx-auto max-w-5xl px-5 py-8">
      <PageHeader title="Wallet & Keys" description="Manage EVM and Solana wallets, backups, and passwords" onBack={() => onNavigate("/")} />

      {toast && <div className="fixed bottom-6 right-6 z-50 rounded-xl border border-white/[0.1] bg-zinc-900 px-4 py-3 text-sm text-zinc-200 shadow-lg">{toast}</div>}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 mb-6">
        <SetupCard
          title="Password"
          status={wallet?.password.status === "ready" ? "done" : wallet?.password.status === "missing" ? "needed" : "error"}
          summary={wallet?.password.status === "ready" ? "Set" : wallet?.password.status === "drift" ? "Drift" : wallet?.password.status === "missing" ? "Not set" : "Invalid"}
          detail={wallet?.password.source !== "none" ? `Source: ${wallet?.password.source}` : ""}
          action={{ label: "Set", onClick: () => { setPassword(""); setConfirmPw(""); setModal("password"); } }}
        />
        <SetupCard
          title="EVM Wallet"
          status={wallet?.evmKeystorePresent ? "done" : "needed"}
          summary={wallet?.evmKeystorePresent ? "Present" : "No keystore"}
          detail={trunc(wallet?.evmAddress ?? null)}
          action={{ label: wallet?.evmKeystorePresent ? "Import New" : "Create", onClick: () => setModal(wallet?.evmKeystorePresent ? "importEvm" : "createEvm") }}
        />
        <SetupCard
          title="Solana Wallet"
          status={wallet?.solanaKeystorePresent ? "done" : "pending"}
          summary={wallet?.solanaKeystorePresent ? "Present" : "Not configured"}
          detail={trunc(wallet?.solanaAddress ?? null)}
          action={{ label: wallet?.solanaKeystorePresent ? "Import New" : "Create", onClick: () => setModal(wallet?.solanaKeystorePresent ? "importSol" : "createSol") }}
        />
      </div>

      <div className="flex gap-3 flex-wrap">
        <button onClick={loadBackups} className="rounded-lg bg-zinc-800/80 px-4 py-2 text-xs font-medium text-zinc-300 hover:bg-zinc-700 transition">Backups</button>
        <button onClick={() => doAction("/api/wallet/backup", {})} className="rounded-lg bg-zinc-800/80 px-4 py-2 text-xs font-medium text-zinc-300 hover:bg-zinc-700 transition">Create Backup</button>
        <button onClick={() => { setExportChain("evm"); setModal("export"); }} className="rounded-lg bg-zinc-800/80 px-4 py-2 text-xs font-medium text-zinc-300 hover:bg-zinc-700 transition">Export Key</button>
      </div>

      {/* Password modal */}
      <ActionModal open={modal === "password"} onClose={() => setModal(null)} title="Set Keystore Password">
        <div className="space-y-4">
          <input type="password" placeholder="Password (min 8 chars)" value={password} onChange={e => setPassword(e.target.value)}
            className="w-full rounded-lg border border-white/[0.1] bg-zinc-900 px-3 py-2 text-sm text-white focus:border-neon-blue focus:outline-none" />
          <input type="password" placeholder="Confirm password" value={confirmPw} onChange={e => setConfirmPw(e.target.value)}
            className="w-full rounded-lg border border-white/[0.1] bg-zinc-900 px-3 py-2 text-sm text-white focus:border-neon-blue focus:outline-none" />
          <button disabled={busy || password.length < 8 || password !== confirmPw}
            onClick={() => doAction("/api/wallet/password", { password })}
            className="w-full rounded-lg bg-neon-blue/20 py-2 text-sm font-medium text-neon-blue hover:bg-neon-blue/30 transition disabled:opacity-40">
            {busy ? "Saving..." : "Set Password"}
          </button>
        </div>
      </ActionModal>

      {/* Create EVM */}
      <ActionModal open={modal === "createEvm"} onClose={() => setModal(null)} title="Create EVM Wallet">
        <div className="space-y-4">
          <p className="text-sm text-zinc-400">Generate a new EVM wallet encrypted with your keystore password.</p>
          <button disabled={busy} onClick={() => doAction("/api/wallet/create", { chain: "evm" })}
            className="w-full rounded-lg bg-neon-blue/20 py-2 text-sm font-medium text-neon-blue hover:bg-neon-blue/30 transition disabled:opacity-40">
            {busy ? "Creating..." : "Create"}
          </button>
        </div>
      </ActionModal>

      {/* Create Solana */}
      <ActionModal open={modal === "createSol"} onClose={() => setModal(null)} title="Create Solana Wallet">
        <div className="space-y-4">
          <p className="text-sm text-zinc-400">Generate a new Solana wallet encrypted with your keystore password.</p>
          <button disabled={busy} onClick={() => doAction("/api/wallet/create", { chain: "solana" })}
            className="w-full rounded-lg bg-neon-blue/20 py-2 text-sm font-medium text-neon-blue hover:bg-neon-blue/30 transition disabled:opacity-40">
            {busy ? "Creating..." : "Create"}
          </button>
        </div>
      </ActionModal>

      {/* Import EVM */}
      <ActionModal open={modal === "importEvm"} onClose={() => setModal(null)} title="Import EVM Private Key">
        <div className="space-y-4">
          <input type="password" placeholder="0x... private key" value={importKey} onChange={e => setImportKey(e.target.value)}
            className="w-full rounded-lg border border-white/[0.1] bg-zinc-900 px-3 py-2 text-sm text-white font-mono focus:border-neon-blue focus:outline-none" />
          <button disabled={busy || !importKey} onClick={() => doAction("/api/wallet/import", { chain: "evm", privateKey: importKey, force: true })}
            className="w-full rounded-lg bg-neon-blue/20 py-2 text-sm font-medium text-neon-blue hover:bg-neon-blue/30 transition disabled:opacity-40">
            {busy ? "Importing..." : "Import"}
          </button>
        </div>
      </ActionModal>

      {/* Import Solana */}
      <ActionModal open={modal === "importSol"} onClose={() => setModal(null)} title="Import Solana Secret Key">
        <div className="space-y-4">
          <input type="password" placeholder="Base58 or JSON byte array" value={importKey} onChange={e => setImportKey(e.target.value)}
            className="w-full rounded-lg border border-white/[0.1] bg-zinc-900 px-3 py-2 text-sm text-white font-mono focus:border-neon-blue focus:outline-none" />
          <button disabled={busy || !importKey} onClick={() => doAction("/api/wallet/import", { chain: "solana", privateKey: importKey, force: true })}
            className="w-full rounded-lg bg-neon-blue/20 py-2 text-sm font-medium text-neon-blue hover:bg-neon-blue/30 transition disabled:opacity-40">
            {busy ? "Importing..." : "Import"}
          </button>
        </div>
      </ActionModal>

      {/* Backups modal */}
      <ActionModal open={modal === "backups"} onClose={() => setModal(null)} title="Wallet Backups">
        <div className="space-y-2 max-h-60 overflow-y-auto">
          {backups.map((b, i) => (
            <div key={i} className="flex items-center justify-between rounded-xl border border-white/[0.06] p-3">
              <div>
                <div className="text-xs text-zinc-300">{new Date(b.manifest.createdAt).toLocaleString()}</div>
                <div className="text-xs text-zinc-500 font-mono truncate max-w-[200px]">{trunc(b.manifest.walletAddress)}</div>
              </div>
              <button onClick={() => doAction("/api/wallet/restore", { backupDir: b.dir })}
                className="rounded-lg bg-zinc-800 px-3 py-1 text-xs text-zinc-400 hover:text-zinc-200 transition">
                Restore
              </button>
            </div>
          ))}
          {backups.length === 0 && <p className="text-sm text-zinc-500 text-center py-4">No backups found</p>}
        </div>
      </ActionModal>

      {/* Export modal */}
      <ActionModal open={modal === "export"} onClose={() => setModal(null)} title="Export Private Key">
        <div className="space-y-4">
          <p className="text-sm text-status-warn">Key will be saved to a local file. It will NOT be shown in the browser.</p>
          <div className="flex gap-2">
            {(["evm", "solana"] as const).map(c => (
              <label key={c} className={`flex-1 rounded-lg border p-2 text-center text-sm cursor-pointer transition ${exportChain === c ? "border-neon-blue/50 bg-neon-blue/5 text-white" : "border-white/[0.06] text-zinc-500"}`}>
                <input type="radio" name="exportChain" checked={exportChain === c} onChange={() => setExportChain(c)} className="sr-only" />
                {c.toUpperCase()}
              </label>
            ))}
          </div>
          <button disabled={busy} onClick={() => doAction("/api/wallet/export", { chain: exportChain })}
            className="w-full rounded-lg bg-status-warn/20 py-2 text-sm font-medium text-status-warn hover:bg-status-warn/30 transition disabled:opacity-40">
            {busy ? "Exporting..." : "Export to File"}
          </button>
        </div>
      </ActionModal>
    </div>
  );
};

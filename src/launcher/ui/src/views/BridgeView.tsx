import { type FC, useEffect, useState } from "react";
import { PageHeader } from "../components/PageHeader";
import { WaveSpinner } from "../components/WaveSpinner";

interface Chain { id: number; name: string; type: string }
interface Token { address: string; symbol: string; name: string; decimals: number }
interface Route { routeId: string; quote: { amountOut: string; expectedDurationSeconds: number }; depositMethods: string[] }

type Step = "chains" | "quoting" | "routes" | "preview";

async function postApi(path: string, body: Record<string, unknown>) {
  const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return res.json() as Promise<Record<string, unknown>>;
}

interface Props { onNavigate: (p: string) => void }

export const BridgeView: FC<Props> = ({ onNavigate }) => {
  const [chains, setChains] = useState<Chain[]>([]);
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState<Step>("chains");

  // Form state
  const [srcChain, setSrcChain] = useState<number | null>(null);
  const [srcTokens, setSrcTokens] = useState<Token[]>([]);
  const [srcToken, setSrcToken] = useState<string>("");
  const [srcTokenSearch, setSrcTokenSearch] = useState("");
  const [dstChain, setDstChain] = useState<number | null>(null);
  const [dstTokens, setDstTokens] = useState<Token[]>([]);
  const [dstToken, setDstToken] = useState<string>("");
  const [dstTokenSearch, setDstTokenSearch] = useState("");
  const [amount, setAmount] = useState("1");
  const [routes, setRoutes] = useState<Route[]>([]);
  const [bestIdx, setBestIdx] = useState(0);
  const [selectedRoute, setSelectedRoute] = useState<string>("");
  const [depositMethod, setDepositMethod] = useState("");
  const [quoteId, setQuoteId] = useState("");
  const [walletAddress, setWalletAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetch("/api/bridge/chains").then(r => r.json()) as Promise<{ chains: Chain[] }>,
      fetch("/api/snapshot").then(r => r.json()) as Promise<{ wallet?: { configuredAddress?: string } }>,
    ]).then(([chainData, snapData]) => {
      setChains(chainData.chains.sort((a, b) => a.name.localeCompare(b.name)));
      setWalletAddress(snapData.wallet?.configuredAddress ?? "");
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const searchTokens = async (chainId: number, query: string, setter: (t: Token[]) => void) => {
    const data = await postApi("/api/bridge/tokens", { chainId, query: query || undefined });
    setter((data.tokens as Token[]) ?? []);
  };

  const getQuotes = async () => {
    setBusy(true);
    try {
      const data = await postApi("/api/bridge/quote", {
        fromChain: String(srcChain), fromToken: srcToken,
        toChain: String(dstChain), toToken: dstToken,
        amount, tradeType: "EXACT_INPUT",
      });
      setRoutes((data.routes as Route[]) ?? []);
      setBestIdx((data.bestIndex as number) ?? 0);
      setQuoteId((data.quoteId as string) ?? "");
      if ((data.routes as Route[])?.length > 0) {
        setSelectedRoute((data.routes as Route[])[0].routeId);
        setDepositMethod((data.routes as Route[])[0].depositMethods[0] ?? "");
        setStep("routes");
      } else {
        setToast("No routes found"); setTimeout(() => setToast(null), 3000);
      }
    } catch { setToast("Quote failed"); setTimeout(() => setToast(null), 3000); }
    finally { setBusy(false); }
  };

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 4000); };

  if (loading) return <div className="flex justify-center py-20"><WaveSpinner size="lg" /></div>;

  const srcChainName = chains.find(c => c.id === srcChain)?.name ?? "";
  const dstChainName = chains.find(c => c.id === dstChain)?.name ?? "";
  const srcTokenSym = srcTokens.find(t => t.address === srcToken)?.symbol ?? "";
  const dstTokenSym = dstTokens.find(t => t.address === dstToken)?.symbol ?? "";

  return (
    <div className="mx-auto max-w-3xl px-5 py-8">
      <PageHeader title="Bridge / Cross-Chain" description="Bridge assets between chains via Khalani" onBack={() => onNavigate("/")} />

      {toast && <div className="fixed bottom-6 right-6 z-50 rounded-xl border border-white/[0.1] bg-zinc-900 px-4 py-3 text-sm text-zinc-200 shadow-lg">{toast}</div>}

      <div className="rounded-2xl border border-white/[0.06] bg-zinc-950/50 p-6 space-y-5">
        {/* Source chain */}
        <div>
          <label className="block text-xs text-zinc-400 mb-2">Source Chain</label>
          <select value={srcChain ?? ""} onChange={e => { setSrcChain(Number(e.target.value)); setSrcToken(""); setSrcTokens([]); }}
            className="w-full rounded-lg border border-white/[0.1] bg-zinc-900 px-3 py-2 text-sm text-white focus:border-neon-blue focus:outline-none">
            <option value="">Select chain...</option>
            {chains.map(c => <option key={c.id} value={c.id}>{c.name} ({c.type === "solana" ? "Solana" : `EVM ${c.id}`})</option>)}
          </select>
        </div>

        {/* Source token */}
        {srcChain && (
          <div>
            <label className="block text-xs text-zinc-400 mb-2">Source Token</label>
            <div className="flex gap-2 mb-2">
              <input type="text" placeholder="Search token..." value={srcTokenSearch} onChange={e => setSrcTokenSearch(e.target.value)}
                className="flex-1 rounded-lg border border-white/[0.1] bg-zinc-900 px-3 py-2 text-sm text-white focus:border-neon-blue focus:outline-none" />
              <button onClick={() => searchTokens(srcChain, srcTokenSearch, setSrcTokens)}
                className="rounded-lg bg-zinc-800 px-3 py-2 text-xs text-zinc-300 hover:bg-zinc-700 transition">Search</button>
            </div>
            <div className="space-y-1 max-h-40 overflow-y-auto">
              {srcTokens.map(t => (
                <label key={t.address} className={`flex items-center gap-2 rounded-lg border p-2 cursor-pointer text-sm transition ${srcToken === t.address ? "border-neon-blue/50 bg-neon-blue/5" : "border-white/[0.06]"}`}>
                  <input type="radio" name="srcToken" checked={srcToken === t.address} onChange={() => setSrcToken(t.address)} className="accent-neon-blue" />
                  <span className="text-white font-medium">{t.symbol}</span>
                  <span className="text-zinc-500 truncate">{t.name}</span>
                </label>
              ))}
            </div>
          </div>
        )}

        {/* Destination chain */}
        {srcToken && (
          <div>
            <label className="block text-xs text-zinc-400 mb-2">Destination Chain</label>
            <select value={dstChain ?? ""} onChange={e => { setDstChain(Number(e.target.value)); setDstToken(""); setDstTokens([]); }}
              className="w-full rounded-lg border border-white/[0.1] bg-zinc-900 px-3 py-2 text-sm text-white focus:border-neon-blue focus:outline-none">
              <option value="">Select chain...</option>
              {chains.map(c => <option key={c.id} value={c.id}>{c.name} ({c.type === "solana" ? "Solana" : `EVM ${c.id}`})</option>)}
            </select>
          </div>
        )}

        {/* Destination token */}
        {dstChain && (
          <div>
            <label className="block text-xs text-zinc-400 mb-2">Destination Token</label>
            <div className="flex gap-2 mb-2">
              <input type="text" placeholder="Search token..." value={dstTokenSearch} onChange={e => setDstTokenSearch(e.target.value)}
                className="flex-1 rounded-lg border border-white/[0.1] bg-zinc-900 px-3 py-2 text-sm text-white focus:border-neon-blue focus:outline-none" />
              <button onClick={() => searchTokens(dstChain, dstTokenSearch, setDstTokens)}
                className="rounded-lg bg-zinc-800 px-3 py-2 text-xs text-zinc-300 hover:bg-zinc-700 transition">Search</button>
            </div>
            <div className="space-y-1 max-h-40 overflow-y-auto">
              {dstTokens.map(t => (
                <label key={t.address} className={`flex items-center gap-2 rounded-lg border p-2 cursor-pointer text-sm transition ${dstToken === t.address ? "border-neon-blue/50 bg-neon-blue/5" : "border-white/[0.06]"}`}>
                  <input type="radio" name="dstToken" checked={dstToken === t.address} onChange={() => setDstToken(t.address)} className="accent-neon-blue" />
                  <span className="text-white font-medium">{t.symbol}</span>
                  <span className="text-zinc-500 truncate">{t.name}</span>
                </label>
              ))}
            </div>
          </div>
        )}

        {/* Amount + Quote */}
        {dstToken && step === "chains" && (
          <div>
            <label className="block text-xs text-zinc-400 mb-2">Amount</label>
            <input type="text" value={amount} onChange={e => setAmount(e.target.value)}
              className="w-full rounded-lg border border-white/[0.1] bg-zinc-900 px-3 py-2 text-sm text-white focus:border-neon-blue focus:outline-none mb-3" />
            <button disabled={busy} onClick={getQuotes}
              className="w-full rounded-lg bg-neon-blue/20 py-2.5 text-sm font-medium text-neon-blue hover:bg-neon-blue/30 transition disabled:opacity-40">
              {busy ? "Quoting..." : "Get Quotes"}
            </button>
          </div>
        )}

        {/* Routes */}
        {step === "routes" && (
          <div>
            <label className="block text-xs text-zinc-400 mb-2">Routes</label>
            <div className="space-y-2 mb-4">
              {routes.map((r, i) => (
                <label key={r.routeId} className={`flex items-center justify-between rounded-xl border p-3 cursor-pointer transition ${selectedRoute === r.routeId ? "border-neon-blue/50 bg-neon-blue/5" : "border-white/[0.06]"}`}>
                  <div className="flex items-center gap-2">
                    <input type="radio" name="route" checked={selectedRoute === r.routeId} onChange={() => { setSelectedRoute(r.routeId); setDepositMethod(r.depositMethods[0] ?? ""); }} className="accent-neon-blue" />
                    <span className="text-sm text-white">{i === bestIdx ? "[best] " : ""}{r.routeId.slice(0, 12)}...</span>
                  </div>
                  <div className="text-xs text-zinc-500">out: {r.quote.amountOut} · ETA {r.quote.expectedDurationSeconds}s</div>
                </label>
              ))}
            </div>

            {selectedRoute && (
              <div className="mb-4">
                <label className="block text-xs text-zinc-400 mb-2">Deposit Method</label>
                <div className="flex gap-2">
                  {routes.find(r => r.routeId === selectedRoute)?.depositMethods.map(m => (
                    <label key={m} className={`rounded-lg border px-3 py-2 text-xs cursor-pointer transition ${depositMethod === m ? "border-neon-blue/50 bg-neon-blue/5 text-white" : "border-white/[0.06] text-zinc-500"}`}>
                      <input type="radio" name="deposit" checked={depositMethod === m} onChange={() => setDepositMethod(m)} className="sr-only" />
                      {m}
                    </label>
                  ))}
                </div>
              </div>
            )}

            {/* Preview */}
            <div className="rounded-xl border border-white/[0.06] bg-zinc-900/50 p-4 mb-4 text-xs space-y-1">
              <div><span className="text-zinc-500">From:</span> <span className="text-white">{srcChainName} / {srcTokenSym}</span></div>
              <div><span className="text-zinc-500">To:</span> <span className="text-white">{dstChainName} / {dstTokenSym}</span></div>
              <div><span className="text-zinc-500">Amount:</span> <span className="text-white">{amount}</span></div>
              <div><span className="text-zinc-500">Route:</span> <span className="text-white">{selectedRoute.slice(0, 16)}...</span></div>
              <div><span className="text-zinc-500">Method:</span> <span className="text-white">{depositMethod}</span></div>
            </div>

            <div className="flex gap-3">
              <button onClick={() => setStep("chains")} className="flex-1 rounded-lg bg-zinc-800/80 py-2 text-sm text-zinc-300 hover:bg-zinc-700 transition">Back</button>
              <button disabled={busy} onClick={async () => {
                setBusy(true);
                try {
                  const r = await postApi("/api/bridge/deposit-submit", { quoteId, routeId: selectedRoute, depositMethod, sourceChainId: srcChain, from: walletAddress });
                  showToast((r.summary as string) ?? "Bridge submitted");
                } catch { showToast("Bridge failed"); }
                finally { setBusy(false); }
              }}
                className="flex-1 rounded-lg bg-neon-blue/20 py-2 text-sm font-medium text-neon-blue hover:bg-neon-blue/30 transition disabled:opacity-40">
                {busy ? "Executing..." : "Execute Bridge"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

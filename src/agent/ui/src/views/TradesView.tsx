import { type FC, useEffect, useState, useCallback } from "react";
import { TradeCard } from "../components/TradeCard";
import { TradeSummaryBar } from "../components/TradeSummary";
import { getTrades, getTradesSummary } from "../api";
import type { TradeEntry, TradeSummary, TradeType } from "../types";
import { cn } from "../utils";
import { HugeiconsIcon, ChartLineData01Icon } from "../components/icons";

interface TradesViewProps {
  onBack: () => void;
}

const FILTERS: Array<{ key: TradeType | "all"; label: string }> = [
  { key: "all", label: "All" },
  { key: "swap", label: "Swaps" },
  { key: "prediction", label: "Predictions" },
  { key: "bonding", label: "Bonding" },
  { key: "bridge", label: "Bridges" },
  { key: "lp", label: "LP" },
  { key: "stake", label: "Staking" },
  { key: "lend", label: "Lending" },
];

export const TradesView: FC<TradesViewProps> = ({ onBack }) => {
  const [trades, setTrades] = useState<TradeEntry[]>([]);
  const [summary, setSummary] = useState<TradeSummary | null>(null);
  const [filter, setFilter] = useState<string>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const [tradesRes, summaryRes] = await Promise.all([
        getTrades(filter === "all" ? undefined : filter, 100),
        getTradesSummary(),
      ]);
      if (signal?.aborted) return;
      setTrades(tradesRes.trades);
      setSummary(summaryRes);
    } catch (err) {
      if (signal?.aborted) return;
      console.warn("[TradesView] fetch failed:", err);
      setError(err instanceof Error ? err.message : "Failed to load trades");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    const ac = new AbortController();
    refresh(ac.signal);
    return () => ac.abort();
  }, [refresh]);

  // Separate open predictions from history
  const openPredictions = trades.filter(t => t.type === "prediction" && (t.status === "open" || t.status === "pending"));
  const historyTrades = trades.filter(t => !(t.type === "prediction" && (t.status === "open" || t.status === "pending")));

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-4 px-5 py-3 border-b border-border">
        <button onClick={onBack} className="text-muted-foreground hover:text-foreground text-sm transition">&larr; Back</button>
        <h2 className="text-sm font-semibold text-foreground">Trade History</h2>
        <button onClick={() => refresh()} className="ml-auto text-2xs text-muted-foreground hover:text-foreground transition">Refresh</button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
        {/* Summary */}
        {summary && summary.totalTrades > 0 && <TradeSummaryBar summary={summary} />}

        {/* Filter tabs */}
        <div className="flex gap-1 flex-wrap">
          {FILTERS.map(f => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={cn(
                "px-3 py-1.5 text-xs rounded-lg transition",
                filter === f.key
                  ? "bg-accent/20 text-accent border border-accent/20"
                  : "text-muted-foreground hover:text-foreground border border-transparent hover:border-border",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* Open predictions section */}
        {openPredictions.length > 0 && (
          <div>
            <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Open Positions</h3>
            <div className="space-y-2">
              {openPredictions.map(t => <TradeCard key={t.id} trade={t} />)}
            </div>
          </div>
        )}

        {/* Trade history */}
        {historyTrades.length > 0 && (
          <div>
            {openPredictions.length > 0 && (
              <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">History</h3>
            )}
            <div className="space-y-2">
              {historyTrades.map(t => <TradeCard key={t.id} trade={t} />)}
            </div>
          </div>
        )}

        {/* Error state */}
        {error && !loading && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="text-sm text-status-error mb-2">{error}</div>
            <button onClick={() => refresh()} className="text-xs text-accent hover:underline">Retry</button>
          </div>
        )}

        {/* Empty state */}
        {!loading && !error && trades.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <HugeiconsIcon icon={ChartLineData01Icon} size={32} className="text-muted-foreground mb-3" />
            <div className="text-sm text-muted-foreground">No trades yet</div>
            <div className="text-xs text-muted-foreground mt-1">Ask your agent to make a trade to see it here</div>
          </div>
        )}

        {loading && (
          <div className="flex justify-center py-12">
            <div className="h-6 w-6 rounded-full border-2 border-accent/30 border-t-accent animate-spin" />
          </div>
        )}
      </div>
    </div>
  );
};

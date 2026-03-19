import { type FC, useEffect, useState, useCallback } from "react";
import { getPortfolioChains, getPortfolioHistory, getScheduledTasks, toggleScheduledTask, deleteScheduledTask } from "../api";
import type { ChainBalance, PortfolioSnapshot, ScheduledTask } from "../types";
import { cn } from "../utils";

interface PortfolioViewProps {
  onBack: () => void;
}

export const PortfolioView: FC<PortfolioViewProps> = ({ onBack }) => {
  const [chains, setChains] = useState<ChainBalance[]>([]);
  const [history, setHistory] = useState<PortfolioSnapshot[]>([]);
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [range, setRange] = useState<string>("24h");
  const [tab, setTab] = useState<"portfolio" | "tasks">("portfolio");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const [chainsRes, historyRes, tasksRes] = await Promise.all([
        getPortfolioChains(), getPortfolioHistory(range), getScheduledTasks(),
      ]);
      if (signal?.aborted) return;
      setChains(chainsRes.chains);
      setHistory(historyRes.snapshots);
      setTasks(tasksRes.tasks);
    } catch (err) {
      if (signal?.aborted) return;
      console.warn("[PortfolioView] fetch failed:", err);
      setError(err instanceof Error ? err.message : "Failed to load portfolio");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [range]);

  useEffect(() => {
    const ac = new AbortController();
    refresh(ac.signal);
    return () => ac.abort();
  }, [refresh]);

  const totalUsd = chains.reduce((s, c) => s + c.totalUsd, 0);
  const latestSnapshot = history[history.length - 1];
  const prevSnapshot = history.length > 1 ? history[0] : null;
  const pnl24h = latestSnapshot && prevSnapshot ? latestSnapshot.totalUsd - prevSnapshot.totalUsd : null;
  const pnlPct = pnl24h != null && prevSnapshot && prevSnapshot.totalUsd > 0 ? (pnl24h / prevSnapshot.totalUsd) * 100 : null;

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-4 px-5 py-3 border-b border-border">
        <button onClick={onBack} className="text-muted-foreground hover:text-foreground text-sm transition">&larr; Back</button>
        <h2 className="text-sm font-semibold text-foreground">Portfolio & Tasks</h2>
        <div className="ml-auto flex gap-1">
          {(["portfolio", "tasks"] as const).map(t => (
            <button key={t} onClick={() => setTab(t)} className={cn(
              "px-3 py-1.5 text-xs rounded-lg transition",
              tab === t ? "bg-accent/20 text-accent" : "text-muted-foreground hover:text-foreground",
            )}>{t === "portfolio" ? "Portfolio" : "Scheduled Tasks"}</button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
        {error && !loading && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="text-sm text-status-error mb-2">{error}</div>
            <button onClick={() => refresh()} className="text-xs text-accent hover:underline">Retry</button>
          </div>
        )}

        {tab === "portfolio" && !error && (
          <>
            {/* Total value header */}
            <div className="rounded-2xl border border-border bg-card/50 backdrop-blur-md px-5 py-4">
              <div className="text-2xs text-muted-foreground font-medium uppercase tracking-wide">Total Portfolio Value</div>
              <div className="flex items-baseline gap-3 mt-1">
                <span className="text-2xl font-bold text-foreground">${totalUsd.toFixed(2)}</span>
                {pnl24h != null && (
                  <span className={cn("text-sm font-medium", pnl24h >= 0 ? "text-status-ok" : "text-status-error")}>
                    {pnl24h >= 0 ? "+" : ""}${pnl24h.toFixed(2)} ({pnlPct?.toFixed(1)}%)
                  </span>
                )}
              </div>

              {/* Mini chart from snapshot history */}
              <div className="flex gap-1 mt-2">
                {(["24h", "7d", "30d"] as const).map(r => (
                  <button key={r} onClick={() => setRange(r)} className={cn(
                    "px-2 py-0.5 text-2xs rounded transition",
                    range === r ? "bg-accent/20 text-accent" : "text-muted-foreground hover:text-muted-foreground",
                  )}>{r}</button>
                ))}
              </div>

              {history.length > 1 && (
                <div className="flex items-end gap-px mt-3 h-12">
                  {history.map((s, i) => {
                    const min = Math.min(...history.map(h => h.totalUsd));
                    const max = Math.max(...history.map(h => h.totalUsd));
                    const range = max - min || 1;
                    const height = ((s.totalUsd - min) / range) * 100;
                    const isLast = i === history.length - 1;
                    return (
                      <div key={s.id} className="flex-1 flex items-end" title={`$${s.totalUsd.toFixed(2)} · ${s.timestamp.slice(0, 16)}`}>
                        <div className={cn("w-full rounded-t-sm min-h-[2px] transition-all", isLast ? "bg-accent" : "bg-muted-foreground")}
                          style={{ height: `${Math.max(4, height)}%` }} />
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Chain cards */}
            {chains.map(chain => (
              <div key={chain.chain} className="rounded-2xl border border-border bg-card/50 backdrop-blur-md px-4 py-3">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs font-semibold text-foreground uppercase bg-card px-2 py-0.5 rounded-md">{chain.chain}</span>
                  <span className="flex-1" />
                  <span className="text-sm font-medium text-foreground">${chain.totalUsd.toFixed(2)}</span>
                </div>
                <div className="space-y-1">
                  {chain.tokens.map((t, i) => (
                    <div key={i} className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">{t.amount} <span className="text-foreground font-medium">{t.symbol}</span></span>
                      <span className="text-muted-foreground">${t.usdValue.toFixed(2)}</span>
                    </div>
                  ))}
                </div>
                {chain.tradeCount > 0 && (
                  <div className="text-2xs text-muted-foreground mt-2">{chain.tradeCount} trade{chain.tradeCount !== 1 ? "s" : ""} on this chain</div>
                )}
              </div>
            ))}

            {chains.length === 0 && !loading && (
              <div className="text-center text-sm text-muted-foreground py-12">No portfolio data yet. Agent will snapshot balances every hour.</div>
            )}
          </>
        )}

        {tab === "tasks" && !error && (
          <>
            {tasks.map(task => (
              <div key={task.id} className="rounded-2xl border border-border bg-card/50 backdrop-blur-md px-4 py-3">
                <div className="flex items-center gap-2">
                  <button onClick={async () => { await toggleScheduledTask(task.id, !task.enabled); refresh(); }}
                    className={cn("text-2xs font-bold px-2 py-0.5 rounded-md transition",
                      task.enabled ? "bg-status-ok/20 text-status-ok" : "bg-card text-muted-foreground",
                    )}>{task.enabled ? "ON" : "OFF"}</button>
                  <span className="text-sm font-medium text-foreground flex-1">{task.name}</span>
                  <code className="text-2xs text-muted-foreground font-mono">{task.cronExpression}</code>
                </div>
                {task.description && <div className="text-xs text-muted-foreground mt-1">{task.description}</div>}
                <div className="flex items-center gap-3 mt-2 text-2xs text-muted-foreground">
                  <span>Last: {task.lastRunAt ? new Date(task.lastRunAt).toLocaleString() : "never"}</span>
                  <span>Runs: {task.runCount}</span>
                  <span className="text-muted-foreground">{task.taskType}</span>
                  {task.id !== "builtin-portfolio-snapshot" && (
                    <button onClick={async () => { await deleteScheduledTask(task.id); refresh(); }}
                      className="ml-auto text-status-error/60 hover:text-status-error transition">Delete</button>
                  )}
                </div>
              </div>
            ))}
            {tasks.length === 0 && !loading && (
              <div className="text-center text-sm text-muted-foreground py-12">No scheduled tasks. Ask your agent to set one up.</div>
            )}
          </>
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

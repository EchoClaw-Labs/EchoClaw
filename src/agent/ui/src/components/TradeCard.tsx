import { type FC, useState } from "react";
import { cn } from "../utils";
import type { TradeEntry } from "../types";

interface TradeCardProps {
  trade: TradeEntry;
  compact?: boolean;
}

const TYPE_STYLES: Record<string, { label: string; color: string; bg: string }> = {
  swap: { label: "SWAP", color: "text-accent", bg: "bg-accent/10" },
  prediction: { label: "PREDICT", color: "text-purple-400", bg: "bg-purple-400/10" },
  bonding: { label: "BONDING", color: "text-pink-400", bg: "bg-pink-400/10" },
  bridge: { label: "BRIDGE", color: "text-cyan-400", bg: "bg-cyan-400/10" },
  lp: { label: "LP", color: "text-emerald-400", bg: "bg-emerald-400/10" },
  stake: { label: "STAKE", color: "text-amber-400", bg: "bg-amber-400/10" },
  lend: { label: "LEND", color: "text-orange-400", bg: "bg-orange-400/10" },
};

const STATUS_STYLES: Record<string, { dot: string; text: string }> = {
  executed: { dot: "bg-status-ok", text: "text-status-ok" },
  open: { dot: "bg-accent animate-pulse", text: "text-accent" },
  pending: { dot: "bg-status-warn animate-pulse", text: "text-status-warn" },
  closed: { dot: "bg-muted-foreground", text: "text-muted-foreground" },
  claimed: { dot: "bg-status-ok", text: "text-status-ok" },
  failed: { dot: "bg-status-error", text: "text-status-error" },
};

function timeAgo(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export const TradeCard: FC<TradeCardProps> = ({ trade, compact }) => {
  const [expanded, setExpanded] = useState(false);
  const typeStyle = TYPE_STYLES[trade.type] ?? TYPE_STYLES.swap;
  const statusStyle = STATUS_STYLES[trade.status] ?? STATUS_STYLES.executed;
  const hasPnl = trade.pnl != null;
  const isProfit = hasPnl && trade.pnl!.amountUsd >= 0;
  const isPrediction = trade.type === "prediction";

  return (
    <div
      onClick={() => !compact && setExpanded(!expanded)}
      className={cn(
        "rounded-2xl border border-border bg-card/50 backdrop-blur-md transition-all duration-200",
        !compact && "cursor-pointer hover:border-border hover:bg-card",
        compact ? "px-3 py-2.5" : "px-4 py-3.5",
      )}
    >
      {/* Header row */}
      <div className="flex items-center gap-2">
        <span className={cn("text-2xs font-semibold px-2 py-0.5 rounded-md", typeStyle.color, typeStyle.bg)}>
          {typeStyle.label}
        </span>
        <span className="text-2xs text-muted-foreground font-medium uppercase">{trade.chain}</span>
        <span className="flex-1" />
        <span className="text-2xs text-muted-foreground">{timeAgo(trade.timestamp)}</span>
        {!compact && (
          <div className="flex items-center gap-1.5">
            <div className={cn("h-1.5 w-1.5 rounded-full", statusStyle.dot)} />
            <span className={cn("text-2xs font-medium", statusStyle.text)}>{trade.status}</span>
          </div>
        )}
      </div>

      {/* Trade content */}
      {isPrediction && trade.meta.marketTitle ? (
        <div className="mt-2">
          <div className="text-sm text-foreground leading-snug">{String(trade.meta.marketTitle)}</div>
          <div className="flex items-center gap-2 mt-1.5 text-xs text-muted-foreground">
            <span>Side: <span className={trade.meta.side === "yes" ? "text-status-ok font-medium" : "text-status-error font-medium"}>
              {String(trade.meta.side ?? "").toUpperCase()}
            </span></span>
            {trade.meta.contracts != null && <span>· {String(trade.meta.contracts)} contracts</span>}
            {trade.meta.buyPrice != null && <span>@ ${Number(trade.meta.buyPrice).toFixed(2)}</span>}
          </div>
          {trade.meta.currentPrice != null && (
            <div className="text-xs text-muted-foreground mt-1">
              Current: <span className="text-foreground">${Number(trade.meta.currentPrice).toFixed(2)}</span>
            </div>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-2 mt-2">
          <span className="text-sm text-foreground font-medium">{trade.input.amount} {trade.input.token}</span>
          <span className="text-muted-foreground text-xs">→</span>
          <span className="text-sm text-foreground font-medium">{trade.output.amount} {trade.output.token}</span>
          {trade.meta.dex && (
            <span className="ml-auto text-2xs text-muted-foreground bg-card px-2 py-0.5 rounded-md">{String(trade.meta.dex)}</span>
          )}
        </div>
      )}

      {/* P&L pill */}
      {hasPnl && (
        <div className={cn(
          "inline-flex items-center gap-1 mt-2 px-2.5 py-1 rounded-lg text-xs font-medium",
          isProfit ? "bg-status-ok/10 text-status-ok" : "bg-status-error/10 text-status-error",
        )}>
          <span>{isProfit ? "+" : ""}{trade.pnl!.amountUsd < 0.01 && trade.pnl!.amountUsd > -0.01 ? trade.pnl!.amountUsd.toFixed(4) : `$${trade.pnl!.amountUsd.toFixed(2)}`}</span>
          <span className="opacity-60">({isProfit ? "+" : ""}{trade.pnl!.percentChange.toFixed(1)}%)</span>
          {!trade.pnl!.realized && <span className="opacity-50 text-2xs">(unrealized)</span>}
        </div>
      )}

      {/* Expanded details */}
      {expanded && !compact && (
        <div className="mt-3 pt-3 border-t border-border space-y-2 animate-fade-in">
          {trade.reasoning && (
            <div className="text-xs text-muted-foreground">
              <span className="text-muted-foreground font-medium">Reasoning:</span> {trade.reasoning}
            </div>
          )}
          {trade.signature && (
            <div className="text-xs">
              <span className="text-muted-foreground font-medium">Tx:</span>{" "}
              {trade.explorerUrl ? (
                <a href={trade.explorerUrl} target="_blank" rel="noopener" className="text-accent/70 hover:text-accent transition font-mono">
                  {trade.signature.slice(0, 8)}...{trade.signature.slice(-6)}
                </a>
              ) : (
                <span className="text-muted-foreground font-mono">{trade.signature.slice(0, 12)}...</span>
              )}
            </div>
          )}
          {trade.input.valueUsd != null && (
            <div className="text-2xs text-muted-foreground">
              Value: ${trade.input.valueUsd.toFixed(2)} → ${(trade.output.valueUsd ?? 0).toFixed(2)}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

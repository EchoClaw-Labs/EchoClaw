import { type FC } from "react";
import { cn } from "../utils";
import type { TradeSummary as TradeSummaryType } from "../types";

interface TradeSummaryProps {
  summary: TradeSummaryType;
  compact?: boolean;
}

export const TradeSummaryBar: FC<TradeSummaryProps> = ({ summary, compact }) => {
  const isProfit = summary.totalPnlUsd >= 0;

  if (compact) {
    return (
      <div className="flex items-center gap-3 text-xs">
        <span className={cn("font-semibold", isProfit ? "text-status-ok" : "text-status-error")}>
          {isProfit ? "+" : ""}${summary.totalPnlUsd.toFixed(2)}
        </span>
        <span className="text-muted-foreground">{summary.totalTrades} trades</span>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-border bg-card/50 backdrop-blur-md px-5 py-4">
      <div className="flex items-center gap-6">
        {/* Total P&L */}
        <div>
          <div className="text-2xs text-muted-foreground font-medium uppercase tracking-wide">Total P&L</div>
          <div className={cn("text-xl font-bold mt-0.5", isProfit ? "text-status-ok" : "text-status-error")}>
            {isProfit ? "+" : ""}${Math.abs(summary.totalPnlUsd).toFixed(2)}
          </div>
        </div>

        <div className="h-8 w-px bg-white/[0.06]" />

        {/* Win Rate */}
        <div>
          <div className="text-2xs text-muted-foreground font-medium uppercase tracking-wide">Win Rate</div>
          <div className="text-lg font-semibold text-foreground mt-0.5">
            {summary.winRate.toFixed(0)}%
          </div>
        </div>

        <div className="h-8 w-px bg-white/[0.06]" />

        {/* W/L */}
        <div>
          <div className="text-2xs text-muted-foreground font-medium uppercase tracking-wide">W / L</div>
          <div className="text-sm font-medium mt-0.5">
            <span className="text-status-ok">{summary.winCount}</span>
            <span className="text-muted-foreground mx-1">/</span>
            <span className="text-status-error">{summary.lossCount}</span>
          </div>
        </div>

        <div className="h-8 w-px bg-white/[0.06]" />

        {/* Total Trades */}
        <div>
          <div className="text-2xs text-muted-foreground font-medium uppercase tracking-wide">Total</div>
          <div className="text-sm font-medium text-foreground mt-0.5">{summary.totalTrades}</div>
        </div>

        {/* Type breakdown */}
        <div className="ml-auto flex gap-2">
          {Object.entries(summary.byType).map(([type, count]) => (
            <span key={type} className="text-2xs text-muted-foreground bg-card px-2 py-0.5 rounded-md">
              {type}: {count}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
};

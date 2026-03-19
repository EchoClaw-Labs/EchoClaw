import { type FC } from "react";
import { cn } from "../utils";
import { HugeiconsIcon, CpuIcon } from "./icons";

interface BurnIndicatorProps {
  sessionCostOg: number;
  ledgerLockedOg: number | null;
  estimatedRemaining: number;
  isLowBalance: boolean;
  model: string | null;
  className?: string;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export const BurnIndicator: FC<BurnIndicatorProps> = ({
  sessionCostOg,
  ledgerLockedOg,
  estimatedRemaining,
  isLowBalance,
  model,
  className,
}) => {
  const locked = ledgerLockedOg ?? 0;
  const cost = sessionCostOg ?? 0;
  const total = cost + locked;
  const pct = total > 0 ? clamp((cost / total) * 100, 0, 100) : 0;

  const barGradient = isLowBalance || pct > 75
    ? "from-status-error/80 to-status-error"
    : pct > 40
      ? "from-status-warn/80 to-status-warn"
      : "from-accent/60 to-accent";

  return (
    <div className={cn("flex flex-col gap-1.5 w-full max-w-sm mx-auto", className)}>
      <div className="flex items-center justify-between text-[10px] text-muted-foreground/60 px-1">
        <div className="flex items-center gap-1.5">
          <HugeiconsIcon icon={CpuIcon} size={12} className={cn(isLowBalance ? "text-status-error animate-pulse" : "text-muted-foreground")} />
          <span className="font-mono">{model ?? "Model"}</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="font-mono" title="Session burn">{cost.toFixed(4)} 0G</span>
          <span className="font-mono text-muted-foreground/40">|</span>
          <span className={cn("font-mono", isLowBalance && "text-status-error")}>
            ~{estimatedRemaining} req
          </span>
        </div>
      </div>
      
      {/* Horizontal progress bar */}
      <div className="h-1 w-full bg-border/20 rounded-full overflow-hidden relative">
        <div
          className={cn("absolute top-0 left-0 h-full rounded-full transition-all duration-700 ease-out bg-gradient-to-r", barGradient)}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
};

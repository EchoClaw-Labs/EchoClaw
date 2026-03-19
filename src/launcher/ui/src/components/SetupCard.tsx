import { type FC, type ReactNode, useState } from "react";
import { cn } from "../utils";

type CardStatus = "done" | "needed" | "error" | "pending";

const STATUS_CONFIG: Record<CardStatus, { icon: string; color: string; glow: string; pulse: boolean }> = {
  done:    { icon: "✓", color: "text-status-ok",    glow: "shadow-status-ok/5",    pulse: false },
  needed:  { icon: "→", color: "text-neon-blue",    glow: "shadow-neon-blue/5",    pulse: true },
  error:   { icon: "✗", color: "text-status-error", glow: "shadow-status-error/5", pulse: false },
  pending: { icon: "○", color: "text-zinc-500",     glow: "",                       pulse: false },
};

interface SetupCardProps {
  title: string;
  status: CardStatus;
  summary: string;
  detail?: string;
  action?: { label: string; onClick: () => void };
  children?: ReactNode;
  className?: string;
}

export const SetupCard: FC<SetupCardProps> = ({
  title, status, summary, detail, action, children, className,
}) => {
  const cfg = STATUS_CONFIG[status];
  const [hovered, setHovered] = useState(false);

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={cn(
        "group relative rounded-2xl border bg-zinc-950/50 backdrop-blur-md p-5 overflow-hidden",
        "shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]",
        "transition-all duration-300 ease-out",
        hovered ? "border-white/20 bg-zinc-900/60 -translate-y-0.5 shadow-lg" : "border-white/[0.06]",
        cfg.glow && hovered && cfg.glow,
        className,
      )}
    >
      {/* Subtle top-edge gradient accent */}
      <div className={cn(
        "absolute top-0 left-0 right-0 h-px transition-opacity duration-300",
        status === "done" ? "bg-gradient-to-r from-transparent via-status-ok/40 to-transparent" :
        status === "needed" ? "bg-gradient-to-r from-transparent via-neon-blue/40 to-transparent" :
        status === "error" ? "bg-gradient-to-r from-transparent via-status-error/40 to-transparent" :
        "bg-transparent",
        hovered ? "opacity-100" : "opacity-0",
      )} />

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex items-center gap-2.5">
            <span className={cn(
              "flex h-6 w-6 items-center justify-center rounded-lg text-xs font-bold transition-transform duration-200",
              cfg.color,
              status === "done" ? "bg-status-ok/10" :
              status === "needed" ? "bg-neon-blue/10" :
              status === "error" ? "bg-status-error/10" : "bg-zinc-800",
              cfg.pulse && "animate-pulse",
              hovered && "scale-110",
            )}>
              {cfg.icon}
            </span>
            <h3 className="text-[14px] font-semibold leading-tight text-white tracking-tight">{title}</h3>
          </div>
          <p className="text-[13px] text-zinc-400 leading-relaxed">{summary}</p>
          {detail && (
            <p className="font-mono text-[11px] text-zinc-600 truncate">{detail}</p>
          )}
        </div>

        {action && (
          <button
            type="button"
            onClick={action.onClick}
            className={cn(
              "flex-shrink-0 rounded-lg px-3.5 py-1.5 text-xs font-medium transition-all duration-200",
              status === "needed"
                ? "bg-neon-blue/15 text-neon-blue hover:bg-neon-blue/25 hover:shadow-md hover:shadow-neon-blue/10"
                : status === "error"
                  ? "bg-status-error/10 text-status-error hover:bg-status-error/20"
                  : "bg-zinc-800/60 text-zinc-400 hover:bg-zinc-700/80 hover:text-zinc-200",
            )}
          >
            {action.label}
          </button>
        )}
      </div>

      {children && (
        <div className="mt-3.5 border-t border-white/[0.04] pt-3.5">
          {children}
        </div>
      )}
    </div>
  );
};

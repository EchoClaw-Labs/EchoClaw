import type { FC, ReactNode } from "react";
import { cn } from "../utils";

type StepStatus = "done" | "active" | "pending";

export interface FundStep {
  num: number;
  title: string;
  status: StepStatus;
  summary: string;
  detail?: string;
  deficit?: string;
  action?: { label: string; onClick: () => void };
  children?: ReactNode;
}

interface Props {
  steps: FundStep[];
}

const STATUS_ICON: Record<StepStatus, { icon: string; bg: string; text: string }> = {
  done:    { icon: "\u2713", bg: "bg-status-ok/15",  text: "text-status-ok" },
  active:  { icon: "\u2192", bg: "bg-neon-blue/15",  text: "text-neon-blue" },
  pending: { icon: "\u25CB", bg: "bg-zinc-800/60",   text: "text-zinc-500" },
};

export const FundProgress: FC<Props> = ({ steps }) => (
  <div className="space-y-2">
    {steps.map((step) => {
      const s = STATUS_ICON[step.status];
      return (
        <div
          key={step.num}
          className={cn(
            "rounded-xl border p-4 transition-all duration-200",
            step.status === "active"
              ? "border-neon-blue/30 bg-neon-blue/[0.03]"
              : step.status === "done"
                ? "border-white/[0.06] bg-zinc-950/30"
                : "border-white/[0.04] bg-zinc-950/20 opacity-60",
          )}
        >
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className={cn(
                "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-xs font-bold",
                s.bg, s.text,
                step.status === "active" && "animate-pulse",
              )}>
                {s.icon}
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className={cn(
                    "text-sm font-medium",
                    step.status === "pending" ? "text-zinc-500" : "text-white",
                  )}>
                    {step.title}
                  </span>
                </div>
                <p className={cn(
                  "text-[13px] leading-relaxed",
                  step.status === "done" ? "text-zinc-500" : "text-zinc-400",
                )}>
                  {step.summary}
                </p>
              </div>
            </div>

            {step.action && step.status === "active" && (
              <button
                type="button"
                onClick={step.action.onClick}
                className="shrink-0 rounded-lg bg-neon-blue/15 px-4 py-1.5 text-xs font-medium text-neon-blue hover:bg-neon-blue/25 transition"
              >
                {step.action.label}
              </button>
            )}

            {step.action && step.status === "done" && (
              <button
                type="button"
                onClick={step.action.onClick}
                className="shrink-0 rounded-lg bg-zinc-800/60 px-3 py-1.5 text-xs font-medium text-zinc-400 hover:bg-zinc-700/80 hover:text-zinc-200 transition"
              >
                {step.action.label}
              </button>
            )}
          </div>

          {(step.detail || step.deficit) && (
            <div className="mt-2 ml-10 flex items-center gap-2 text-xs">
              {step.detail && (
                <span className="font-bold text-zinc-300">{step.detail}</span>
              )}
              {step.deficit && (
                <span className="text-status-warn">{step.deficit}</span>
              )}
            </div>
          )}

          {step.children && (
            <div className="mt-3 ml-10">
              {step.children}
            </div>
          )}
        </div>
      );
    })}
  </div>
);

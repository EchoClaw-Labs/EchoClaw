import type { FC } from "react";
import { cn } from "../utils";

type Status = "ok" | "warn" | "error" | "pending";

const STATUS_STYLES: Record<Status, { bg: string; dot: string; text: string }> = {
  ok:      { bg: "bg-status-ok/10",    dot: "bg-status-ok",    text: "text-status-ok" },
  warn:    { bg: "bg-status-warn/10",  dot: "bg-status-warn",  text: "text-status-warn" },
  error:   { bg: "bg-status-error/10", dot: "bg-status-error", text: "text-status-error" },
  pending: { bg: "bg-zinc-800/50",     dot: "bg-zinc-500",     text: "text-zinc-500" },
};

interface StatusPillProps {
  status: Status;
  label: string;
  className?: string;
}

export const StatusPill: FC<StatusPillProps> = ({ status, label, className }) => {
  const s = STATUS_STYLES[status];
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium", s.bg, s.text, className)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", s.dot)} />
      {label}
    </span>
  );
};

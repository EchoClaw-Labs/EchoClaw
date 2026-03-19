import { type FC, useState } from "react";
import { cn } from "../utils";
import type { AssistantActivityItem, ToolCallState } from "../types";
import {
  HugeiconsIcon,
  Wallet01Icon,
  CoinsSwapIcon,
  Globe02Icon,
  Search01Icon,
  FileCodeIcon,
  Database01Icon,
  Clock01Icon,
  ChartLineData01Icon,
  CpuIcon,
  type IconSvgElement,
} from "./icons";

interface ToolCallsSectionProps {
  activities: AssistantActivityItem[];
  className?: string;
  collapseAfterTools?: number;
}

const ICON_MAP: Array<[prefix: string, icon: IconSvgElement]> = [
  ["wallet_", Wallet01Icon],
  ["solana_", CoinsSwapIcon],
  ["khalani_", Globe02Icon],
  ["web_search", Search01Icon],
  ["web_fetch", Globe02Icon],
  ["file_", FileCodeIcon],
  ["0g_storage_", Database01Icon],
  ["schedule_", Clock01Icon],
  ["trade_log", ChartLineData01Icon],
];

function iconForCommand(command: string): IconSvgElement {
  for (const [prefix, icon] of ICON_MAP) {
    if (command.startsWith(prefix)) return icon;
  }
  return CpuIcon;
}

const ToolRow: FC<{ call: ToolCallState }> = ({ call }) => {
  const [open, setOpen] = useState(false);

  return (
    <div className="flex flex-col mb-1.5 last:mb-0 w-full group">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-3 px-0 py-1 transition-opacity opacity-80 hover:opacity-100 text-left w-fit max-w-full"
      >
        <div className={cn("relative flex items-center justify-center shrink-0 w-5 h-5 rounded-full transition-colors", open ? "bg-white/10 border-white/20" : "bg-white/5 border border-white/10 group-hover:bg-white/10")}>
          {call.status === "running" && (
            <>
              <div className="absolute inset-0 rounded-full border border-accent/30 animate-pulse" />
              <div className="absolute inset-[-2px] rounded-full border-t border-accent animate-spin" />
            </>
          )}
          <HugeiconsIcon 
            icon={iconForCommand(call.command)} 
            size={12} 
            className={cn(
              "relative z-10", 
              call.status === "error" ? "text-status-error" : 
              call.status === "running" ? "text-accent" : 
              "text-muted-foreground"
            )} 
          />
        </div>
        
        <span className={cn("font-mono text-[11px] tracking-wide truncate transition-colors", call.status === "running" ? "text-accent/90" : "text-muted-foreground group-hover:text-foreground/90")}>
          {call.command.replace(/_/g, " ")}
        </span>
        
        <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
          {call.durationMs != null && (
            <span className="text-[9px] text-muted-foreground/50 tabular-nums">{call.durationMs}ms</span>
          )}
          <span className={cn("text-muted-foreground/50 text-[10px] transition-transform", open && "rotate-90")}>
            &#9656;
          </span>
        </div>
      </button>

      {/* Expanding details section using grid for smooth height transition */}
      <div className={cn("grid transition-[grid-template-rows,opacity] duration-300 ease-out", open ? "grid-rows-[1fr] opacity-100 mt-2" : "grid-rows-[0fr] opacity-0 mt-0")}>
        <div className="pl-8 space-y-2 max-w-full overflow-hidden">
          {Object.keys(call.args).length > 0 && (
            <div className="flex flex-col gap-1 bg-white/5 rounded-md p-2 border border-white/10">
              <span className="text-[9px] font-medium text-muted-foreground/40 uppercase tracking-wider">Payload</span>
              <pre className="text-[10px] font-mono text-muted-foreground/80 break-all whitespace-pre-wrap leading-relaxed">
                {JSON.stringify(call.args, null, 2)}
              </pre>
            </div>
          )}
          {call.output && (
            <div className={cn(
              "flex flex-col gap-1 rounded-md p-2 border shadow-sm backdrop-blur-sm transition-colors",
              call.status === "success" ? "bg-status-ok/5 border-status-ok/20 border-l-2 border-l-status-ok" : 
              call.status === "error" ? "bg-status-error/5 border-status-error/20 border-l-2 border-l-status-error" : 
              "bg-white/5 border-white/10"
            )}>
              <span className="text-[9px] font-medium text-muted-foreground/50 uppercase tracking-wider flex items-center justify-between">
                Result
                <span className={cn("text-[8px] px-1.5 py-0.5 rounded-full font-semibold tracking-widest", 
                  call.status === "success" ? "bg-status-ok/10 text-status-ok" : "bg-status-error/10 text-status-error"
                )}>{call.status}</span>
              </span>
              <pre className="text-[10px] font-mono text-foreground/80 max-h-48 overflow-y-auto break-words whitespace-pre-wrap leading-relaxed">
                {call.output}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const FileRow: FC<{ activity: Extract<AssistantActivityItem, { kind: "file" }> }> = ({ activity }) => {
  const [open, setOpen] = useState(false);

  return (
    <div className="flex flex-col mb-1.5 last:mb-0 w-full group">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-3 px-0 py-1 transition-opacity opacity-80 hover:opacity-100 text-left w-fit max-w-full"
      >
        <div className="relative flex items-center justify-center shrink-0 w-5 h-5 rounded-full bg-accent/10 border border-accent/20">
          <HugeiconsIcon icon={FileCodeIcon} size={12} className="relative z-10 text-accent" />
        </div>

        <span className="font-mono text-[11px] text-muted-foreground tracking-wide truncate">
          {activity.file.action} {activity.file.path}
        </span>

        <span className={cn("text-muted-foreground/50 text-[10px] transition-transform", open && "rotate-90")}>
          &#9656;
        </span>
      </button>

      <div className={cn("grid transition-[grid-template-rows,opacity] duration-300 ease-out", open ? "grid-rows-[1fr] opacity-100 mt-2" : "grid-rows-[0fr] opacity-0 mt-0")}>
        <div className="pl-8 space-y-2 max-w-full overflow-hidden">
          <div className="flex flex-col gap-1 bg-white/5 rounded-md p-2 border border-white/10 border-l-2 border-l-accent/50 shadow-sm backdrop-blur-sm">
            <span className="text-[9px] font-medium text-muted-foreground/40 uppercase tracking-wider">File Activity</span>
            <pre className="text-[10px] font-mono text-foreground/80 break-words whitespace-pre-wrap leading-relaxed">
              {JSON.stringify({ action: activity.file.action, path: activity.file.path }, null, 2)}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
};

const ActivityList: FC<{ activities: AssistantActivityItem[] }> = ({ activities }) => (
  <div className="flex flex-col gap-0.5 w-full">
    {activities.map((activity) => activity.kind === "tool"
      ? <ToolRow key={activity.id} call={activity.tool} />
      : <FileRow key={activity.id} activity={activity} />)}
  </div>
);

const CollapsibleActivityList: FC<{ activities: AssistantActivityItem[]; toolCount: number; className?: string }> = ({ activities, toolCount, className }) => {
  const [collapsed, setCollapsed] = useState(true);

  return (
    <div className={cn("flex flex-col gap-2 w-full", className)}>
      <button
        type="button"
        onClick={() => setCollapsed((value) => !value)}
        className="group flex items-center gap-3 w-fit py-1.5 px-3 rounded-full bg-white/5 border border-white/10 hover:bg-white/10 transition-all shadow-sm backdrop-blur-md cursor-pointer"
      >
        <div className="relative flex items-center justify-center shrink-0 w-4 h-4 rounded-full bg-white/10">
          <HugeiconsIcon icon={CpuIcon} size={10} className="text-foreground/80 group-hover:text-accent transition-colors" />
        </div>

        <span className="font-mono text-[10px] font-medium text-foreground/80 group-hover:text-foreground tracking-wide">
          {toolCount} Tools
        </span>

        <span className={cn("text-foreground/50 text-[9px] transition-transform duration-300", !collapsed && "rotate-90")}>
          &#9656;
        </span>
      </button>

      <div className={cn("grid transition-[grid-template-rows,opacity] duration-300 ease-out", !collapsed ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0")}>
        <div className="overflow-hidden w-full pt-1">
          <ActivityList activities={activities} />
        </div>
      </div>
    </div>
  );
};

export const ToolCallsSection: FC<ToolCallsSectionProps> = ({ activities, className, collapseAfterTools = Number.POSITIVE_INFINITY }) => {
  if (activities.length === 0) return null;

  const orderedActivities = [...activities].sort((a, b) => a.order - b.order);
  const toolCount = orderedActivities.filter((activity) => activity.kind === "tool").length;
  const shouldCollapse = toolCount > collapseAfterTools;

  if (!shouldCollapse) {
    return (
      <div className={className}>
        <ActivityList activities={orderedActivities} />
      </div>
    );
  }

  return (
    <CollapsibleActivityList activities={orderedActivities} toolCount={toolCount} className={className} />
  );
};

import { type FC, useState, useEffect, useCallback } from "react";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { FloatingWidget } from "./components/FloatingWidget";
import { ChatView } from "./views/ChatView";
import { TradesView } from "./views/TradesView";
import { PortfolioView } from "./views/PortfolioView";
import { MemoryView } from "./views/MemoryView";
import { OpsWidget } from "./views/OpsWidget";
import {
  HugeiconsIcon, MessageMultiple01Icon, Activity01Icon,
  Wallet01Icon, BrainIcon, Settings01Icon,
} from "./components/icons";
import { initAuth, getStatus, getRecentTrades } from "./api";
import type { AgentStatus, TradeEntry, TradeSummary } from "./types";
import { cn } from "./utils";

const STATUS_POLL_MS = 10_000;

type WidgetType = "trades" | "portfolio" | "memory" | "ops";

export const App: FC = () => {
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [openWidgets, setOpenWidgets] = useState<Set<WidgetType>>(new Set());
  const [liveBurn, setLiveBurn] = useState({ sessionCostOg: 0, ledgerLockedOg: null as number | null, estimatedRemaining: 0, isLowBalance: false, model: null as string | null });
  const [liveSessionId, setLiveSessionId] = useState<string | undefined>(undefined);
  const [recentTrades, setRecentTrades] = useState<TradeEntry[]>([]);
  const [tradeSummary, setTradeSummary] = useState<TradeSummary | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [isOffline, setIsOffline] = useState(false);

  useEffect(() => { initAuth().then(() => setAuthReady(true)).catch(() => setAuthReady(true)); }, []);

  const refreshStatus = useCallback(async () => {
    if (!authReady) return;
    try { setStatus(await getStatus()); setIsOffline(false); } catch { setIsOffline(true); }
    try {
      const res = await getRecentTrades(3);
      setRecentTrades(res.trades); setTradeSummary(res.summary);
    } catch (err) { console.warn("[App] trade fetch failed:", err); }
  }, [authReady]);

  useEffect(() => { if (authReady) refreshStatus(); }, [authReady, refreshStatus]);
  useEffect(() => { const id = setInterval(refreshStatus, STATUS_POLL_MS); return () => clearInterval(id); }, [refreshStatus]);

  const toggleWidget = (w: WidgetType) => {
    setOpenWidgets(prev => {
      const next = new Set(prev);
      if (next.has(w)) next.delete(w); else next.add(w);
      return next;
    });
  };

  const navItems: Array<{ key: WidgetType | "chat"; label: string; icon: unknown }> = [
    { key: "chat", label: "Chat", icon: MessageMultiple01Icon },
    { key: "trades", label: "Trades", icon: Activity01Icon },
    { key: "portfolio", label: "Portfolio", icon: Wallet01Icon },
    { key: "memory", label: "Memory", icon: BrainIcon },
    { key: "ops", label: "Ops", icon: Settings01Icon },
  ];

  return (
    <div className="dark h-screen flex overflow-hidden bg-background text-foreground relative">
      {/* ── Sidebar ──────────────────────────────────────── */}
      <aside
        onMouseEnter={() => setSidebarOpen(true)}
        onMouseLeave={() => setSidebarOpen(false)}
        className={cn(
          "relative z-20 flex flex-col bg-[#0a0a0a]/90 backdrop-blur-3xl transition-all duration-300 shrink-0 border-r border-white/5",
          sidebarOpen ? "w-64 shadow-[10px_0_30px_rgba(0,0,0,0.5)]" : "w-[68px]",
        )}
      >
        {/* Agent avatar / Logo area */}
        <div className="flex items-center gap-3 px-4 py-6 border-b border-white/5 shrink-0">
          <div className="relative shrink-0 flex items-center justify-center w-9 h-9">
            <div className="absolute inset-0 bg-accent/20 blur-md rounded-full" />
            <img src="/new_echo_solo.png" alt="Echo" className="w-8 h-8 object-contain relative z-10 drop-shadow-lg" draggable={false} />
          </div>
          {sidebarOpen && (
            <div className="animate-fade-in min-w-0">
              <div className="text-[15px] font-medium text-foreground tracking-tight truncate">
                EchoClaw
              </div>
              <div className="text-[11px] text-muted-foreground/60 font-mono truncate tracking-wide uppercase mt-0.5">{status?.model ?? "Connecting..."}</div>
            </div>
          )}
        </div>

        {/* Nav */}
        <nav className="flex-1 py-4 px-2 space-y-1">
          {navItems.map(item => {
            const isChat = item.key === "chat";
            const isActive = isChat || openWidgets.has(item.key as WidgetType);
            return (
              <button
                key={item.key}
                onClick={() => !isChat && toggleWidget(item.key as WidgetType)}
                className={cn(
                  "flex items-center gap-3.5 w-full px-3 py-2.5 rounded-xl transition-all group",
                  isActive 
                    ? "bg-white/10 text-white shadow-sm" 
                    : "text-muted-foreground hover:bg-white/5 hover:text-foreground",
                )}
              >
                <div className="flex items-center justify-center w-6 h-6 shrink-0">
                  <HugeiconsIcon 
                    icon={item.icon as never} 
                    size={20} 
                    className={cn(
                      "transition-transform duration-200",
                      isActive ? "text-white" : "text-muted-foreground group-hover:text-foreground group-hover:scale-110"
                    )} 
                    strokeWidth={isActive ? 2 : 1.5}
                  />
                </div>
                {sidebarOpen && <span className="animate-fade-in truncate text-[13px] font-medium tracking-wide">{item.label}</span>}
              </button>
            );
          })}
        </nav>

        {/* Bottom info */}
        {sidebarOpen && status && (
          <div className="px-5 py-4 border-t border-white/5 text-[10px] text-muted-foreground/50 animate-fade-in space-y-1.5 font-mono">
            <div className="flex items-center justify-between">
              <span>Lifetime</span>
              <span className="text-foreground/70">{(status.usage.lifetimeTokens / 1000).toFixed(0)}k</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Knowledge</span>
              <span className="text-foreground/70">{status.knowledgeFileCount} files</span>
            </div>
          </div>
        )}
      </aside>

      {/* ── Main area ────────────────────────────────────── */}
      <main className="flex-1 relative z-10 flex flex-col min-w-0">
        {/* Top bar */}
        <div className="flex items-center gap-3 px-4 py-2 shrink-0">
          {(liveSessionId || status?.sessionId) && (
            <span className="text-2xs text-muted-foreground font-mono truncate">
              {liveSessionId || status?.sessionId}
            </span>
          )}
          <span className="flex-1" />
        </div>

        {/* Offline banner */}
        {isOffline && (
          <div className="flex items-center justify-center gap-2 px-4 py-2 bg-status-warn/10 border-b border-status-warn/20 text-status-warn text-xs font-medium shrink-0">
            <div className="h-2 w-2 rounded-full bg-status-warn animate-pulse" />
            Agent offline — retrying...
          </div>
        )}

        {/* Chat — always visible (wait for auth before rendering to avoid 401) */}
        {authReady && (
          <ErrorBoundary>
            <ChatView status={status} onRefreshStatus={refreshStatus} onBurnStateChange={setLiveBurn} onSessionIdChange={setLiveSessionId} />
          </ErrorBoundary>
        )}
      </main>

      {/* ── Floating widgets (each wrapped in ErrorBoundary) ── */}
      {openWidgets.has("trades") && (
        <ErrorBoundary>
          <FloatingWidget
            title="Trades"
            icon={<HugeiconsIcon icon={Activity01Icon} size={14} className="text-accent" />}
            onClose={() => toggleWidget("trades")}
            defaultWidth={520} defaultHeight={500}
          >
            <TradesView onBack={() => toggleWidget("trades")} />
          </FloatingWidget>
        </ErrorBoundary>
      )}
      {openWidgets.has("portfolio") && (
        <ErrorBoundary>
          <FloatingWidget
            title="Portfolio"
            icon={<HugeiconsIcon icon={Wallet01Icon} size={14} className="text-accent" />}
            onClose={() => toggleWidget("portfolio")}
            defaultWidth={480} defaultHeight={460}
          >
            <PortfolioView onBack={() => toggleWidget("portfolio")} />
          </FloatingWidget>
        </ErrorBoundary>
      )}
      {openWidgets.has("memory") && (
        <ErrorBoundary>
          <FloatingWidget
            title="Memory"
            icon={<HugeiconsIcon icon={BrainIcon} size={14} className="text-accent" />}
            onClose={() => toggleWidget("memory")}
            defaultWidth={500} defaultHeight={480}
          >
            <MemoryView onBack={() => toggleWidget("memory")} />
          </FloatingWidget>
        </ErrorBoundary>
      )}
      {openWidgets.has("ops") && (
        <ErrorBoundary>
          <FloatingWidget
            title="Operations"
            icon={<HugeiconsIcon icon={Settings01Icon} size={14} className="text-accent" />}
            onClose={() => toggleWidget("ops")}
            defaultWidth={420} defaultHeight={500}
          >
            <OpsWidget onBack={() => toggleWidget("ops")} />
          </FloatingWidget>
        </ErrorBoundary>
      )}
    </div>
  );
};

import { Component, type FC, type ReactNode, type ErrorInfo, useEffect, useState, useCallback } from "react";
import { Navbar } from "./components/Navbar";
import { SparklesBackground } from "./components/SparklesBackground";
import { WaveSpinner } from "./components/WaveSpinner";

// ── Error Boundary ───────────────────────────────────────────────────
interface EBProps { children: ReactNode }
interface EBState { hasError: boolean; error: Error | null }

class ErrorBoundary extends Component<EBProps, EBState> {
  constructor(props: EBProps) { super(props); this.state = { hasError: false, error: null }; }
  static getDerivedStateFromError(error: Error): EBState { return { hasError: true, error }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error("[LauncherErrorBoundary]", error, info.componentStack); }
  render() {
    if (this.state.hasError) {
      return (
        <div className="flex items-center justify-center min-h-screen">
          <div className="p-8 text-center max-w-md">
            <h2 className="text-lg font-semibold text-red-400 mb-2">Something went wrong</h2>
            <p className="text-sm text-zinc-400 mb-4">{this.state.error?.message}</p>
            <button onClick={() => this.setState({ hasError: false, error: null })}
              className="px-4 py-2 text-sm rounded-lg border border-white/10 bg-zinc-900 text-zinc-300 hover:bg-zinc-800 transition">
              Try again
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
import { DashboardView } from "./views/DashboardView";
import { ConnectView } from "./views/ConnectView";
import { FundView } from "./views/FundView";
import { WalletView } from "./views/WalletView";
import { ClaudeView } from "./views/ClaudeView";
import { ManageView } from "./views/ManageView";
import { BridgeView } from "./views/BridgeView";
import { OpenClawView } from "./views/OpenClawView";
import { ExploreView } from "./views/ExploreView";
import { WizardView } from "./views/WizardView";
import { getRouting, getSnapshot, type RoutingDecision } from "./api";

export const App: FC = () => {
  const [routing, setRouting] = useState<RoutingDecision | null>(null);
  const [viewMode, setViewMode] = useState<"wizard" | "dashboard" | null>(null);
  const [version, setVersion] = useState("...");
  const [currentPath, setCurrentPath] = useState("/");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function init() {
      try {
        const [routingResult, snap] = await Promise.all([getRouting(), getSnapshot()]);
        setRouting(routingResult);
        setViewMode(routingResult.mode);
        setVersion((snap as { version?: string }).version ?? "?");
      } catch {
        setViewMode("dashboard");
      } finally {
        setLoading(false);
      }
    }
    init();
  }, []);

  const navigate = useCallback((path: string) => {
    setCurrentPath(path);
    window.scrollTo(0, 0);
  }, []);

  if (loading || !viewMode) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <SparklesBackground density={40} speed={0.2} />
        <div className="relative z-10 flex flex-col items-center gap-8 animate-fade-in">
          <img src="/echoclaw-logo.png" alt="EchoClaw" className="h-14 w-auto opacity-70" />
          <WaveSpinner size="lg" />
          <p className="text-xs text-zinc-600 font-medium tracking-widest uppercase">Initializing</p>
        </div>
      </div>
    );
  }

  const overallStatus = routing?.reason === "ready" ? "ok" as const : "warn" as const;
  const statusLabel = routing?.reason === "ready" ? "Ready" : "Setup needed";

  function renderView() {
    if (viewMode === "wizard") {
      return <WizardView onComplete={() => {
        setViewMode("dashboard"); setCurrentPath("/");
        getRouting().then(r => setRouting(r)).catch(() => {});
      }} />;
    }

    switch (currentPath) {
      case "/connect":  return <ConnectView onNavigate={navigate} />;
      case "/fund":     return <FundView onNavigate={navigate} />;
      case "/wallet":   return <WalletView onNavigate={navigate} />;
      case "/claude":   return <ClaudeView onNavigate={navigate} />;
      case "/manage":   return <ManageView onNavigate={navigate} />;
      case "/bridge":   return <BridgeView onNavigate={navigate} />;
      case "/openclaw": return <OpenClawView onNavigate={navigate} />;
      case "/explore":  return <ExploreView onNavigate={navigate} mode="explore" />;
      case "/advanced": return <ExploreView onNavigate={navigate} mode="advanced" />;
      default:          return <DashboardView onNavigate={navigate} />;
    }
  }

  return (
    <ErrorBoundary>
      <div className="min-h-screen relative">
        <SparklesBackground density={50} speed={0.3} />

        <div className="relative z-10">
          <Navbar
            version={version}
            overallStatus={overallStatus}
            statusLabel={statusLabel}
            onNavigate={navigate}
          />

          <main className="pt-6" key={currentPath}>
            <ErrorBoundary>
              <div className="animate-fade-in">
                {renderView()}
              </div>
            </ErrorBoundary>
          </main>
        </div>
      </div>
    </ErrorBoundary>
  );
};

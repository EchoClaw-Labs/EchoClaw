import { type FC, useRef, useEffect, useCallback, useState } from "react";
import { MessageBubble } from "../components/MessageBubble";
import { ToolCallsSection } from "../components/ToolCallsSection";
import { ChatInput } from "../components/ChatInput";
import { EchoLoader } from "../components/EchoLoader";
import { BurnIndicator } from "../components/BurnIndicator";
import { useAgentStream } from "../hooks/useAgentStream";
import { startLoop, stopLoop } from "../api";
import type { AgentStatus, AssistantTurn, ChatFeedItem, ChatMessage } from "../types";
import { cn } from "../utils";

interface ChatViewProps {
  status: AgentStatus | null;
  onRefreshStatus: () => void;
  onBurnStateChange?: (burn: { sessionCostOg: number; ledgerLockedOg: number | null; estimatedRemaining: number; isLowBalance: boolean; model: string | null }) => void;
  onSessionIdChange?: (id: string | undefined) => void;
}

export const ChatView: FC<ChatViewProps> = ({ status, onRefreshStatus, onBurnStateChange, onSessionIdChange }) => {
  const {
    feedItems, pendingAssistantTurn, activity,
    pendingApprovals, burnState, sessionId,
    send, approve, reject,
  } = useAgentStream(onRefreshStatus, status?.sessionId ?? undefined);

  // Propagate burnState and sessionId to parent
  useEffect(() => {
    onBurnStateChange?.({
      sessionCostOg: burnState.sessionCostOg,
      ledgerLockedOg: burnState.ledgerLockedOg,
      estimatedRemaining: burnState.estimatedRemaining,
      isLowBalance: burnState.isLowBalance,
      model: burnState.model,
    });
  }, [burnState, onBurnStateChange]);

  useEffect(() => { onSessionIdChange?.(sessionId); }, [sessionId, onSessionIdChange]);

  // Two independent switches: Txs (manual/auto) + Loop (off/on)
  const [txsAuto, setTxsAuto] = useState(false);
  const [loopOn, setLoopOn] = useState(status?.loop.active ?? false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollToBottom = useCallback(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, []);
  useEffect(() => { scrollToBottom(); }, [feedItems, pendingAssistantTurn, scrollToBottom]);

  // Sync with backend state
  useEffect(() => {
    if (status?.loop) {
      setLoopOn(status.loop.active);
      setTxsAuto(status.loop.mode === "full");
    }
  }, [status?.loop]);

  // Derive backend loopMode from switches
  const effectiveLoopMode = txsAuto ? "full" : "restricted";

  const handleSend = (text: string) => {
    if (activity !== "idle") return;
    send(text, effectiveLoopMode);
  };

  const handleTxsToggle = async () => {
    const newAuto = !txsAuto;
    setTxsAuto(newAuto);
    if (loopOn) {
      try { await startLoop(newAuto ? "full" : "restricted"); } catch (err) { console.warn("[loop] mode switch failed:", err); }
    }
  };

  const handleLoopToggle = async () => {
    const newLoop = !loopOn;
    setLoopOn(newLoop);
    try {
      if (newLoop) await startLoop(effectiveLoopMode);
      else await stopLoop();
    } catch (err) { console.warn("[loop] toggle failed:", err); }
  };

  const renderMessage = (msg: ChatMessage) => {
    if (msg.role === "system") {
      const isError = msg.content.startsWith("Error:");
      return (
        <div key={msg.id} className={cn("text-center text-[11px] my-6 font-mono", isError ? "text-status-error/80" : "text-muted-foreground/60")}>
          — {msg.content} —
        </div>
      );
    }

    return (
      <MessageBubble
        key={msg.id}
        content={msg.content}
        variant={msg.role === "user" ? "sent" : "received"}
        grouped="single"
        timestamp={msg.timestamp.slice(11, 16)}
        seed={status?.model ?? "echo"}
      />
    );
  };

  const renderAssistantTurn = (turn: AssistantTurn, isPending: boolean) => {
    const hasContent = turn.content.trim().length > 0;
    const hasActivities = turn.activities.length > 0;

    return (
      <div key={turn.id} className="w-full">
        {isPending && hasActivities && (
          <ToolCallsSection
            activities={turn.activities}
            className="mb-4 ml-[44px]"
          />
        )}

        {hasContent && (
          <MessageBubble
            content={turn.content}
            variant="received"
            grouped="single"
            timestamp={turn.timestamp.slice(11, 16)}
            seed={status?.model ?? "echo"}
          />
        )}

        {!isPending && hasActivities && (
          <ToolCallsSection
            activities={turn.activities}
            collapseAfterTools={2}
            className="-mt-4 mb-6 ml-[44px]"
          />
        )}
      </div>
    );
  };

  const renderFeedItem = (item: ChatFeedItem) => {
    if (item.kind === "message") return renderMessage(item.message);
    return renderAssistantTurn(item.turn, false);
  };

  return (
    <div className="flex flex-col h-full relative">
      {/* ── Messages ─────────────────────────────────────── */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 md:px-8 pb-4 relative z-10 w-full max-w-4xl mx-auto">
        
        {/* Empty state */}
        {feedItems.length === 0 && !pendingAssistantTurn && (
          <div className="flex flex-col items-center justify-center h-[75vh] gap-6 animate-fade-in select-none">
            <div className="relative">
              <div className="absolute inset-0 bg-accent/20 blur-[60px] rounded-full" />
              <img src="/new_echo_solo.png" alt="Echo" className="w-20 h-20 md:w-24 md:h-24 object-contain opacity-90 drop-shadow-2xl relative z-10" draggable={false} />
            </div>
            <h1 className="text-2xl md:text-3xl font-semibold text-foreground tracking-tight opacity-90">
              EchoClaw
            </h1>
          </div>
        )}

        {/* Message feed */}
        <div className="pt-6">
          {feedItems.map(renderFeedItem)}

          {pendingAssistantTurn && renderAssistantTurn(pendingAssistantTurn, true)}
        </div>

        {/* Pending approvals */}
        {pendingApprovals.map(pa => (
          <div key={pa.id} className="my-4 rounded-xl border border-status-warn/30 bg-status-warn/10 px-5 py-4 shadow-sm backdrop-blur-sm">
            <div className="flex items-center gap-2 mb-3">
              <div className="h-2 w-2 rounded-full bg-status-warn animate-pulse" />
              <span className="text-xs font-semibold text-status-warn uppercase tracking-wider">Approval Required</span>
            </div>
            <code className="text-xs font-mono text-foreground/90 block mb-2 bg-black/40 px-2 py-1 rounded">echoclaw {pa.command}</code>
            {Object.keys(pa.args).length > 0 && (
              <div className="text-[11px] text-muted-foreground mb-3 font-mono break-all">{JSON.stringify(pa.args)}</div>
            )}
            <div className="text-[11px] text-foreground/70 mb-4 leading-relaxed border-l-2 border-status-warn/40 pl-3 italic">{pa.reasoning}</div>
            <div className="flex gap-2">
              <button onClick={() => approve(pa.id)}
                className="rounded-lg bg-status-ok/20 border border-status-ok/30 px-5 py-2 text-xs font-semibold text-status-ok hover:bg-status-ok/30 hover:border-status-ok/50 transition-all shadow-sm">
                Approve
              </button>
              <button onClick={() => reject(pa.id)}
                className="rounded-lg bg-card/80 border border-border px-5 py-2 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-card transition-all shadow-sm">
                Reject
              </button>
            </div>
          </div>
        ))}

        {/* Thinking indicator */}
        {activity === "thinking" && !pendingAssistantTurn && (
          <div className="my-6 ml-10">
            <EchoLoader />
          </div>
        )}
      </div>

      {/* ── Input area ───────────────────────────────────── */}
      <div className="px-4 pb-6 pt-2 w-full max-w-4xl mx-auto relative z-20">
        
        {/* Mode switches: Txs + Loop - Subtle Tags above input */}
        <div className="flex items-center justify-center gap-4 mb-3">
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-semibold">Txs</span>
            <button onClick={handleTxsToggle}
              className={cn("px-3 py-1 text-[11px] rounded-full transition-all font-medium border",
                txsAuto ? "bg-status-warn/10 text-status-warn border-status-warn/20" : "bg-card border-border/50 text-muted-foreground hover:text-foreground",
              )}>
              {txsAuto ? "Auto" : "Manual"}
            </button>
          </div>
          <div className="w-px h-3 bg-border/50" />
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-semibold">Loop</span>
            <button onClick={handleLoopToggle}
              className={cn("px-3 py-1 text-[11px] rounded-full transition-all font-medium border",
                loopOn ? "bg-status-ok/10 text-status-ok border-status-ok/20" : "bg-card border-border/50 text-muted-foreground hover:text-foreground",
              )}>
              {loopOn ? "On" : "Off"}
            </button>
          </div>
        </div>

        <ChatInput
          onSend={handleSend}
          disabled={activity !== "idle"}
          placeholder="Ask anything..."
        />
        
        <div className="mt-3">
          <BurnIndicator
            sessionCostOg={burnState.sessionCostOg || status?.usage.sessionCost || 0}
            ledgerLockedOg={burnState.ledgerLockedOg}
            estimatedRemaining={burnState.estimatedRemaining}
            isLowBalance={burnState.isLowBalance}
            model={burnState.model || status?.model || null}
          />
        </div>
      </div>
    </div>
  );
};

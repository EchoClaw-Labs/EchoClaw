/**
 * Hook encapsulating SSE transport for agent chat.
 * Extracts transport logic from ChatView, keeping it presentation-only.
 */

import { useState, useRef, useCallback, useEffect } from "react";
import { sendMessage, parseSSEStream, approveAction, getApprovalQueue } from "../api";
import type { AssistantTurn, ChatFeedItem, ChatMessage, FileUpdateState, ToolCallState } from "../types";

export type { ToolCallState };

export interface BurnState {
  requestTokens: number;
  requestCostOg: number;
  sessionTokens: number;
  sessionCostOg: number;
  ledgerLockedOg: number | null;
  estimatedRemaining: number;
  isLowBalance: boolean;
  model: string | null;
}

export type Activity = "idle" | "thinking" | "executing" | "error";

export interface PendingApproval {
  id: string;
  toolCallId: string;
  command: string;
  args: Record<string, unknown>;
  reasoning: string;
}

const INITIAL_BURN: BurnState = {
  requestTokens: 0, requestCostOg: 0,
  sessionTokens: 0, sessionCostOg: 0,
  ledgerLockedOg: null, estimatedRemaining: 0,
  isLowBalance: false, model: null,
};

const SESSION_STORAGE_KEY = "echo_agent_session_id";
const ERROR_RESET_MS = 3000;

function createAssistantTurn(timestamp = new Date().toISOString()): AssistantTurn {
  return {
    id: `turn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    content: "",
    timestamp,
    activities: [],
  };
}

export function useAgentStream(onRefreshStatus: () => void, initialSessionId?: string) {
  const [feedItems, setFeedItems] = useState<ChatFeedItem[]>([]);
  const [pendingAssistantTurn, setPendingAssistantTurn] = useState<AssistantTurn | null>(null);
  const pendingAssistantTurnRef = useRef<AssistantTurn | null>(null);
  const [activity, setActivity] = useState<Activity>("idle");
  const streamingRef = useRef("");
  const activityOrderRef = useRef(0);
  const [pendingApprovals, setPendingApprovals] = useState<PendingApproval[]>([]);
  const [burnState, setBurnState] = useState<BurnState>(INITIAL_BURN);
  const [sessionId, setSessionId] = useState<string | undefined>(() => {
    // Hydrate from localStorage or prop
    if (initialSessionId) return initialSessionId;
    try { return localStorage.getItem(SESSION_STORAGE_KEY) ?? undefined; } catch { return undefined; }
  });
  const abortRef = useRef<AbortController | null>(null);

  // Persist sessionId to localStorage
  useEffect(() => {
    if (sessionId) {
      try { localStorage.setItem(SESSION_STORAGE_KEY, sessionId); } catch (err) { console.warn("[session] localStorage write failed:", err); }
    }
  }, [sessionId]);

  // Abort in-flight SSE on unmount
  useEffect(() => {
    return () => { abortRef.current?.abort(); };
  }, []);

  const updatePendingAssistantTurn = useCallback((updater: (current: AssistantTurn | null) => AssistantTurn | null) => {
    setPendingAssistantTurn(prev => {
      const next = updater(prev);
      pendingAssistantTurnRef.current = next;
      return next;
    });
  }, []);

  // Hydrate persisted approvals on mount (P0.2 fix)
  useEffect(() => {
    getApprovalQueue()
      .then(data => {
        if (data?.items?.length) {
          setPendingApprovals(data.items.map((a) => ({
            id: a.id,
            toolCallId: "",
            command: a.toolCall.command,
            args: a.toolCall.args,
            reasoning: a.reasoning,
          })));
        }
      })
      .catch((err) => { console.warn("[approvals] hydration failed:", err); });
  }, []);

  const upsertPendingTool = useCallback((tool: ToolCallState, timestamp: string) => {
    updatePendingAssistantTurn(prev => {
      const base = prev ?? createAssistantTurn(timestamp);
      const existingIndex = base.activities.findIndex(item => item.kind === "tool" && item.tool.id === tool.id);

      if (existingIndex >= 0) {
        return {
          ...base,
          activities: base.activities.map((item, index) => index === existingIndex && item.kind === "tool"
            ? {
              ...item,
              timestamp,
              tool: {
                ...item.tool,
                ...tool,
                args: Object.keys(tool.args).length > 0 ? tool.args : item.tool.args,
              },
            }
            : item),
        };
      }

      return {
        ...base,
        activities: [...base.activities, {
          id: `tool-activity-${tool.id}`,
          kind: "tool",
          order: activityOrderRef.current++,
          timestamp,
          tool,
        }],
      };
    });
  }, [updatePendingAssistantTurn]);

  const appendPendingFile = useCallback((file: FileUpdateState) => {
    updatePendingAssistantTurn(prev => {
      const base = prev ?? createAssistantTurn(file.timestamp);
      return {
        ...base,
        activities: [...base.activities, {
          id: file.id,
          kind: "file",
          order: activityOrderRef.current++,
          timestamp: file.timestamp,
          file,
        }],
      };
    });
  }, [updatePendingAssistantTurn]);

  const handleEvent = useCallback((type: string, data: Record<string, unknown>) => {
    switch (type) {
      case "status":
        if (data.sessionId) setSessionId(data.sessionId as string);
        if (data.type === "session") break;
        setActivity(data.type === "thinking" ? "thinking" : "idle");
        break;
      case "text_delta":
        streamingRef.current += data.text as string;
        updatePendingAssistantTurn(prev => {
          const base = prev ?? createAssistantTurn();
          return { ...base, content: streamingRef.current };
        });
        break;
      case "tool_start": {
        const id = (data.id as string) || `t-${Date.now()}`;
        const timestamp = new Date().toISOString();
        setActivity("executing");
        upsertPendingTool({
          id,
          command: data.command as string,
          args: (data.args as Record<string, unknown>) ?? {},
          status: "running",
        }, timestamp);
        break;
      }
      case "tool_result": {
        const id = (data.id as string) || "";
        const timestamp = new Date().toISOString();
        upsertPendingTool({
          id,
          command: data.command as string,
          args: (data.args as Record<string, unknown>) ?? {},
          status: (data.success ? "success" : "error") as ToolCallState["status"],
          output: data.output as string,
          durationMs: data.durationMs as number,
        }, timestamp);
        setActivity("thinking");
        break;
      }
      case "usage":
        setBurnState(prev => ({
          requestTokens: (data.totalTokens as number) ?? 0,
          requestCostOg: (data.costOg as number) ?? 0,
          sessionTokens: (data.sessionTotalTokens as number) ?? prev.sessionTokens,
          sessionCostOg: (data.sessionTotalCostOg as number) ?? prev.sessionCostOg,
          ledgerLockedOg: (data.ledgerLockedOg as number) ?? prev.ledgerLockedOg,
          estimatedRemaining: (data.estimatedRequestsRemaining as number) ?? prev.estimatedRemaining,
          isLowBalance: prev.isLowBalance,
          model: (data.model as string) ?? prev.model,
        }));
        break;
      case "balance_low":
        setBurnState(prev => ({ ...prev, isLowBalance: true, ledgerLockedOg: (data.ledgerLockedOg as number) ?? prev.ledgerLockedOg }));
        break;
      case "file_update":
        appendPendingFile({
          id: `file-${Date.now()}-${activityOrderRef.current}`,
          path: (data.path as string) ?? "",
          action: (data.action as string) ?? "unknown",
          timestamp: new Date().toISOString(),
        });
        break;
      case "approval_required":
        setPendingApprovals(prev => [...prev, {
          id: data.id as string, toolCallId: (data.toolCallId as string) ?? "",
          command: data.command as string, args: (data.args as Record<string, unknown>) ?? {},
          reasoning: (data.reasoning as string) ?? "",
        }]);
        setActivity("idle");
        break;
      case "error":
        setActivity("error");
        setFeedItems(prev => [...prev, {
          id: `message-e-${Date.now()}`,
          kind: "message",
          message: { id: `e-${Date.now()}`, role: "system", content: `Error: ${data.message}`, timestamp: new Date().toISOString() },
        }]);
        setTimeout(() => setActivity("idle"), ERROR_RESET_MS);
        break;
      case "done": {
        const fc = streamingRef.current.trim();
        const currentTurn = pendingAssistantTurnRef.current;
        if (fc || currentTurn?.activities.length) {
          const turn = {
            ...(currentTurn ?? createAssistantTurn()),
            content: fc,
          };
          setFeedItems(items => [...items, {
            id: turn.id,
            kind: "assistant_turn",
            turn,
          }]);
        }
        updatePendingAssistantTurn(() => null);
        streamingRef.current = "";
        activityOrderRef.current = 0;
        setActivity("idle");
        onRefreshStatus();
        break;
      }
    }
  }, [appendPendingFile, onRefreshStatus, updatePendingAssistantTurn, upsertPendingTool]);

  const send = useCallback((text: string, loopMode: string) => {
    const userMsg: ChatMessage = { id: `u-${Date.now()}`, role: "user", content: text, timestamp: new Date().toISOString() };
    setFeedItems(prev => [...prev, { id: `message-${userMsg.id}`, kind: "message", message: userMsg }]);
    updatePendingAssistantTurn(() => null);
    streamingRef.current = "";
    activityOrderRef.current = 0;
    setActivity("thinking");
    abortRef.current = sendMessage(text, loopMode, handleEvent, sessionId);
  }, [handleEvent, sessionId, updatePendingAssistantTurn]);

  const approve = useCallback(async (approvalId: string) => {
    setPendingApprovals(prev => prev.filter(a => a.id !== approvalId));
    setActivity("executing");
    try {
      const res = await approveAction(approvalId, "approve");
      await parseSSEStream(res, handleEvent);
    } catch (err) { console.warn("[approve] stream error:", err); }
    setActivity("idle");
    onRefreshStatus();
  }, [handleEvent, onRefreshStatus]);

  const reject = useCallback(async (approvalId: string) => {
    setPendingApprovals(prev => prev.filter(a => a.id !== approvalId));
    try {
      await approveAction(approvalId, "reject");
    } catch (err) { console.warn("[reject] failed:", err); }
  }, []);

  return {
    feedItems, pendingAssistantTurn, activity,
    pendingApprovals, burnState, sessionId,
    send, approve, reject,
  };
}

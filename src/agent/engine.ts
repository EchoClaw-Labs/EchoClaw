/**
 * Conversation engine — core message loop (Postgres-backed).
 *
 * All state lives in Postgres via db/repos/.
 * Session isolation via ConversationSession instances.
 * Tool results preserve tool_call_id for proper round-trip.
 */

import type { Message, ToolCall, ToolResult, AgentEvent, RequestUsage, InternalToolCall, ConversationSession, InferenceConfig, TradeEntry } from "./types.js";
import { buildSystemPrompt } from "./tools.js";
import { generateId } from "./id.js";
import { SSE_TOOL_OUTPUT_LIMIT } from "./constants.js";
import { toOpenAITools, isInternal, isMutating } from "./tool-registry.js";
import { inferWithTools, inferNonStreaming, loadInferenceConfig } from "./inference.js";
import { executeTool } from "./executor.js";
import { webSearch, webFetch } from "./search.js";
import { addTask, removeTask } from "./scheduler.js";
import { getLedgerState, isLowBalance, recordBillingSnapshot } from "./billing.js";
import { calculateBudget, calculateHybridBudget, parseCompactionResult } from "./context.js";
import * as soulRepo from "./db/repos/soul.js";
import * as memoryRepo from "./db/repos/memory.js";
import * as sessionsRepo from "./db/repos/sessions.js";
import * as messagesRepo from "./db/repos/messages.js";
import * as knowledgeRepo from "./db/repos/knowledge.js";
import * as skillsRepo from "./db/repos/skills.js";
import * as usageRepo from "./db/repos/usage.js";
import * as tradesRepo from "./db/repos/trades.js";
import * as approvalsRepo from "./db/repos/approvals.js";
import { buildCompactionPrompt, getCompactionSystemPrompt } from "./prompts/compaction.js";
import logger from "../utils/logger.js";

// ── Session factory ──────────────────────────────────────────────────

let sharedInferenceConfig: InferenceConfig | null = null;

export async function initEngine(): Promise<boolean> {
  sharedInferenceConfig = await loadInferenceConfig();
  if (!sharedInferenceConfig) {
    logger.error("agent.engine.init_failed", { reason: "no inference config" });
    return false;
  }
  logger.info("agent.engine.ready", { model: sharedInferenceConfig.model });
  return true;
}

export function createSession(): ConversationSession | null {
  if (!sharedInferenceConfig) return null;
  const id = generateId("session");
  return { id, messages: [], loadedKnowledge: new Map(), inferenceConfig: sharedInferenceConfig };
}

export function getInferenceConfig(): InferenceConfig | null {
  return sharedInferenceConfig;
}

// ── Main conversation turn ───────────────────────────────────────────

export type EventEmitter = (event: AgentEvent) => void;

export async function processMessage(
  session: ConversationSession,
  userMessage: string,
  emit: EventEmitter,
  loopMode: "full" | "restricted" | "off" = "off",
): Promise<void> {
  // Ensure session exists in DB
  await sessionsRepo.createSession(session.id);

  const userMsg: Message = { role: "user", content: userMessage, timestamp: new Date().toISOString() };
  session.messages.push(userMsg);
  await messagesRepo.addMessage(session.id, userMsg);

  await inferenceLoop(session, emit, loopMode);
}

export async function resumeAfterApproval(
  session: ConversationSession,
  approvedToolCall: ToolCall,
  emit: EventEmitter,
  loopMode: "full" | "restricted" | "off",
  toolCallId?: string,
): Promise<void> {
  // Use provided toolCallId (from approval item) or generate one
  const resolvedId = toolCallId ?? generateId("call");
  emit({ type: "tool_start", data: { id: resolvedId, command: approvedToolCall.command, args: approvedToolCall.args } });
  const result = await executeTool(approvedToolCall, true);
  emit({ type: "tool_result", data: {
    id: resolvedId, command: result.command, success: result.success,
    output: result.output.slice(0, SSE_TOOL_OUTPUT_LIMIT), durationMs: result.durationMs,
  }});

  const toolMsg: Message = { role: "tool", content: result.output, toolCallId: resolvedId, timestamp: new Date().toISOString() };
  session.messages.push(toolMsg);
  await messagesRepo.addMessage(session.id, toolMsg);

  await inferenceLoop(session, emit, loopMode);
}

// ── Inference loop ───────────────────────────────────────────────────

async function inferenceLoop(
  session: ConversationSession,
  emit: EventEmitter,
  loopMode: "full" | "restricted" | "off",
  maxIterations = 100,
): Promise<void> {
  const config = session.inferenceConfig;

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    const systemPrompt = await buildSystemPrompt(session.loadedKnowledge, loopMode);

    const newMessagesSinceSnapshot = session.messageCountAtSnapshot !== undefined
      ? session.messages.length - session.messageCountAtSnapshot
      : session.messages.length;
    const budget = calculateHybridBudget(
      session.lastPromptTokens, systemPrompt, session.messages,
      newMessagesSinceSnapshot, config.contextLimit,
    );
    if (budget.shouldCompact) {
      await compactSession(session, emit);
    }

    const fullMessages: Message[] = [
      { role: "system", content: systemPrompt, timestamp: new Date().toISOString() },
      ...session.messages,
    ];

    emit({ type: "status", data: { type: "thinking" } });

    // Native OpenAI function calling — tools sent via API parameter
    const tools = toOpenAITools();
    let response;

    try {
      response = await inferWithTools(config, fullMessages, tools);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error("agent.inference.failed", { sessionId: session.id, error: msg });
      emit({ type: "error", data: { message: `Inference failed: ${msg}` } });
      emit({ type: "done", data: {} });
      return;
    }

    const totalUsage = response.usage;

    // Emit clean text content (null when tool calls returned)
    if (response.content) {
      emit({ type: "text_delta", data: { text: response.content } });
    }

    // Record usage with dynamic pricing from provider
    const costOg = (totalUsage.promptTokens / 1_000_000) * config.inputPricePerM
                  + (totalUsage.completionTokens / 1_000_000) * config.outputPricePerM;
    await usageRepo.logUsage(session.id, totalUsage.promptTokens, totalUsage.completionTokens, costOg);

    // Snapshot real prompt_tokens for hybrid compaction budget
    if (totalUsage.promptTokens > 0) {
      session.lastPromptTokens = totalUsage.promptTokens;
      session.messageCountAtSnapshot = session.messages.length;
      await sessionsRepo.updateSessionTokenCount(session.id, totalUsage.promptTokens);
    }

    // Get session totals + ledger balance for enhanced usage event
    const sessionStats = await usageRepo.getUsageStats(session.id);
    const ledger = await getLedgerState(config.provider);
    const avgCost = sessionStats.requestCount > 0 ? sessionStats.lifetimeCost / sessionStats.requestCount : costOg;
    const estimatedRemaining = avgCost > 0 && ledger ? Math.floor(ledger.providerLockedOg / avgCost) : 0;

    const usage: RequestUsage = { promptTokens: totalUsage.promptTokens, completionTokens: totalUsage.completionTokens, totalTokens: totalUsage.promptTokens + totalUsage.completionTokens, costOg };
    emit({ type: "usage", data: {
      ...usage,
      sessionTotalTokens: sessionStats.sessionTokens,
      sessionTotalCostOg: sessionStats.sessionCost,
      ledgerAvailableOg: ledger?.ledgerAvailableOg ?? null,
      ledgerLockedOg: ledger?.providerLockedOg ?? null,
      estimatedRequestsRemaining: estimatedRemaining,
      model: config.model,
      inputPricePerM: config.inputPricePerM.toFixed(4),
      outputPricePerM: config.outputPricePerM.toFixed(4),
    }});

    // Record billing snapshot + check low balance
    await recordBillingSnapshot(config.provider, sessionStats.sessionCost);
    if (ledger && isLowBalance(ledger, config)) {
      emit({ type: "balance_low", data: {
        message: `Low compute balance: ${ledger.providerLockedOg.toFixed(4)} 0G (threshold: ${config.alertThresholdOg.toFixed(4)} 0G)`,
        ledgerLockedOg: ledger.providerLockedOg,
        threshold: config.alertThresholdOg,
      }});
    }

    // Convert ParsedToolCall[] → ToolCall[] with mutating flag from registry
    const allToolCalls: ToolCall[] | null = response.toolCalls?.map(tc => ({
      command: tc.name,
      args: tc.arguments as Record<string, string | boolean | number>,
      confirm: isMutating(tc.name),
    })) ?? null;

    // Store message with clean content
    const assistantMsg: Message = {
      role: "assistant", content: response.content ?? "",
      toolCalls: allToolCalls?.map(tc => ({ id: generateId("call"), command: tc.command, args: tc.args as Record<string, unknown> })),
      timestamp: new Date().toISOString(),
    };
    session.messages.push(assistantMsg);
    await messagesRepo.addMessage(session.id, assistantMsg);

    if (!allToolCalls || allToolCalls.length === 0) {
      emit({ type: "done", data: { sessionTokens: usage.totalTokens } });
      return;
    }

    // Split by registry: internal (engine-handled) vs CLI (spawned)
    const internalCalls = allToolCalls.filter(tc => isInternal(tc.command));
    const cliCalls = allToolCalls.filter(tc => !isInternal(tc.command));

    // Process internal tools first (web search, file ops, etc.)
    if (internalCalls.length > 0) {
      const internalAsTools: InternalToolCall[] = internalCalls.map(tc => ({
        type: tc.command as InternalToolCall["type"],
        params: tc.args as Record<string, string>,
      }));
      await processInternalTools(internalAsTools, session, emit, loopMode);
    }

    // If no CLI calls, continue inference loop (internal tools may have loaded context)
    if (cliCalls.length === 0 && internalCalls.length > 0) {
      continue;
    }

    if (cliCalls.length === 0) {
      emit({ type: "done", data: { sessionTokens: usage.totalTokens } });
      return;
    }

    // Build a filtered assistantMsg for CLI tool execution (only CLI tool_calls)
    const cliAssistantMsg: Message = {
      ...assistantMsg,
      toolCalls: cliCalls.map(tc => ({ id: generateId("call"), command: tc.command, args: tc.args as Record<string, unknown> })),
    };

    const execResult = await executeToolCalls(cliCalls, cliAssistantMsg, session, emit, loopMode);
    if (execResult === "approval_pending") {
      emit({ type: "done", data: { pendingApprovals: true } });
      return;
    }
  }

  emit({ type: "error", data: { message: "Max tool iterations reached" } });
  emit({ type: "done", data: {} });
}

// ── System prompt built directly from DB via tools.ts buildSystemPrompt() ──

// ── Tool execution ───────────────────────────────────────────────────
//
// Design decision: multi-mutation approval is INTENTIONALLY piecemeal.
// Each mutating tool is a separate approval. After approving tool A, engine
// re-enters inference — model sees result, may adjust or skip remaining tools.
// This is correct for a trading agent where market conditions change between
// each execution. "Sell SOL" approved → model sees SOL sold → may decide
// ETH buy is no longer optimal at new price.

async function executeToolCalls(
  toolCalls: ToolCall[], assistantMsg: Message, session: ConversationSession,
  emit: EventEmitter, loopMode: "full" | "restricted" | "off",
): Promise<"ok" | "approval_pending"> {
  // In restricted mode: execute safe tools first, enqueue ALL mutating tools for approval
  const pendingApprovals: Array<{ id: string; toolCallId: string; call: ToolCall }> = [];

  for (let i = 0; i < toolCalls.length; i++) {
    const call = toolCalls[i];
    if (!call.confirm && isMutating(call.command)) call.confirm = true;

    const toolCallId = assistantMsg.toolCalls?.[i]?.id ?? generateId("call");

    if (call.confirm && loopMode === "restricted") {
      // Queue for approval — don't stop, continue processing safe tools
      const approvalId = generateId("approval");
      await approvalsRepo.enqueue(approvalId, call, "This operation modifies on-chain state or moves funds.", session.id, toolCallId);
      pendingApprovals.push({ id: approvalId, toolCallId, call });
      continue;
    }

    // Execute safe tool (or any tool in full mode)
    emit({ type: "tool_start", data: { id: toolCallId, command: call.command, args: call.args } });

    const confirmed = loopMode === "full" || !call.confirm;
    const result = await executeTool(call, confirmed);

    emit({ type: "tool_result", data: { id: toolCallId, command: result.command, success: result.success, output: result.output.slice(0, SSE_TOOL_OUTPUT_LIMIT), durationMs: result.durationMs } });

    const toolMsg: Message = { role: "tool", content: result.output, toolCallId, timestamp: new Date().toISOString() };
    session.messages.push(toolMsg);
    await messagesRepo.addMessage(session.id, toolMsg);
  }

  // Emit all pending approvals
  if (pendingApprovals.length > 0) {
    for (const pa of pendingApprovals) {
      emit({ type: "approval_required", data: { id: pa.id, toolCallId: pa.toolCallId, command: pa.call.command, args: pa.call.args, reasoning: "This operation modifies on-chain state or moves funds." } });
    }
    return "approval_pending";
  }

  return "ok";
}

// ── Internal tools (DB-backed) ───────────────────────────────────────

async function processInternalTools(tools: InternalToolCall[], session: ConversationSession, emit: EventEmitter, loopMode: "full" | "restricted" | "off" = "off"): Promise<void> {
  for (const tool of tools) {
    const toolCallId = generateId("call");
    const startTime = Date.now();
    emit({ type: "tool_start", data: { id: toolCallId, command: tool.type, args: tool.params } });

    let output = "";
    let success = true;

    /** Safe string accessor for tool params (type is Record<string, unknown>). */
    const str = (key: string): string => {
      const v = tool.params[key];
      return typeof v === "string" ? v : "";
    };

    try {
      switch (tool.type) {
        case "file_write": {
          const path = str("path"), content = str("content");
          if (!path || !content) { output = "Missing path or content"; success = false; break; }
          if (path.includes("..") && path !== "../soul.md") {
            output = `Blocked: path traversal "${path}"`; success = false; break;
          }
          if (path === "../soul.md" || path === "soul.md") {
            await soulRepo.upsertSoul(content);
          } else {
            await knowledgeRepo.upsertFile(path, content);
          }
          emit({ type: "file_update", data: { path, action: "write" } });
          output = `Written: ${path}`;
          break;
        }
        case "file_read": {
          const path = str("path");
          if (!path) { output = "Missing path"; success = false; break; }
          let content = await knowledgeRepo.getFile(path);
          if (!content) content = await skillsRepo.getSkillReference(path);
          if (content) {
            session.loadedKnowledge.set(path, content);
            emit({ type: "file_update", data: { path, action: "loaded" } });
            output = `Loaded: ${path} (${content.length} chars)`;
          } else {
            output = `Not found: ${path}`; success = false;
          }
          break;
        }
        case "file_list": {
          const entries = await knowledgeRepo.listFiles(str("path"));
          const content = JSON.stringify(entries, null, 2);
          const listMsg: Message = { role: "tool", content, timestamp: new Date().toISOString() };
          session.messages.push(listMsg);
          await messagesRepo.addMessage(session.id, listMsg);
          output = `${entries.length} entries`;
          break;
        }
        case "file_delete": {
          const path = str("path");
          if (!path) { output = "Missing path"; success = false; break; }
          if (path.includes("..")) { output = `Blocked: path traversal "${path}"`; success = false; break; }
          await knowledgeRepo.deleteFile(path);
          session.loadedKnowledge.delete(path);
          emit({ type: "file_update", data: { path, action: "deleted" } });
          output = `Deleted: ${path}`;
          break;
        }
        case "memory_update": {
          const append = str("append");
          if (!append) { output = "Missing append text"; success = false; break; }
          await memoryRepo.appendMemory(append, undefined, "agent");
          emit({ type: "file_update", data: { path: "memory.md", action: "updated" } });
          output = "Memory updated";
          break;
        }
        case "web_search": {
          const query = str("query");
          if (!query) { output = "Missing query"; success = false; break; }
          const results = await webSearch(query);
          const content = JSON.stringify(results, null, 2);
          const searchMsg: Message = { role: "tool", content, timestamp: new Date().toISOString() };
          session.messages.push(searchMsg);
          await messagesRepo.addMessage(session.id, searchMsg);
          output = `${Array.isArray(results) ? results.length : 0} results`;
          break;
        }
        case "web_fetch": {
          const url = str("url");
          if (!url || (!url.startsWith("http://") && !url.startsWith("https://"))) {
            output = "Invalid URL"; success = false; break;
          }
          const result = await webFetch(url);
          const content = result
            ? `# ${result.title ?? "Fetched page"}\n\nSource: ${url}\n\n${result.markdown}`
            : `Failed to fetch: ${url}`;
          const fetchMsg: Message = { role: "tool", content, timestamp: new Date().toISOString() };
          session.messages.push(fetchMsg);
          await messagesRepo.addMessage(session.id, fetchMsg);
          output = result ? `Fetched: ${result.title ?? url}` : `Failed: ${url}`;
          success = !!result;
          break;
        }
        case "trade_log": {
          const rawTrade = tool.params.trade;
          let trade: Partial<TradeEntry>;
          if (typeof rawTrade === "object" && rawTrade !== null) {
            trade = rawTrade as Partial<TradeEntry>;
          } else if (typeof rawTrade === "string") {
            try { trade = JSON.parse(rawTrade) as Partial<TradeEntry>; }
            catch { output = "Invalid trade entry — expected JSON object"; success = false; break; }
          } else {
            trade = {};
          }
          if (!trade.type || !trade.chain || !trade.status || !trade.input || !trade.output) {
            output = "Incomplete trade entry"; success = false; break;
          }
          const entry: TradeEntry = {
            id: trade.id ?? generateId("trade"),
            timestamp: trade.timestamp ?? new Date().toISOString(),
            type: trade.type, chain: trade.chain, status: trade.status,
            input: trade.input, output: trade.output,
            pnl: trade.pnl, meta: trade.meta ?? {},
            reasoning: trade.reasoning, signature: trade.signature, explorerUrl: trade.explorerUrl,
          };
          await tradesRepo.addTrade(entry);
          emit({ type: "file_update", data: { path: "trades", action: "logged", tradeId: entry.id } });
          output = `Trade logged: ${entry.id}`;
          break;
        }
        case "schedule_create": {
          const p = tool.params;
          const taskType = str("type") || "inference";
          const validTaskTypes = new Set(["cli_execute", "inference", "alert", "snapshot", "backup"]);
          if (!validTaskTypes.has(taskType)) {
            output = `Invalid task type: ${taskType}`; success = false; break;
          }
          const cronExpr = str("cron") || "0 * * * *";
          const { default: cron } = await import("node-cron");
          if (!cron.validate(cronExpr)) {
            output = `Invalid cron: ${cronExpr}`; success = false; break;
          }
          let payload: Record<string, unknown>;
          if (!p.payload) {
            payload = {};
          } else if (typeof p.payload === "object") {
            payload = p.payload as Record<string, unknown>;
          } else if (typeof p.payload === "string") {
            // Smart resolution: plain string → per-type key (inference→prompt, cli_execute→command, alert→message)
            try { payload = JSON.parse(p.payload) as Record<string, unknown>; }
            catch {
              const keyMap: Record<string, string> = { inference: "prompt", cli_execute: "command", alert: "message" };
              const key = keyMap[taskType] ?? "prompt";
              payload = { [key]: p.payload };
            }
          } else {
            payload = {};
          }
          const effectiveLoopMode = loopMode === "full" ? (str("loopMode") || "full") : "restricted";

          if (taskType === "cli_execute" && payload.command) {
            const cmdSnake = String(payload.command).replace(/\s+/g, "_");
            if (isMutating(cmdSnake) && effectiveLoopMode !== "full") {
              output = `Blocked: mutating command in ${loopMode} mode`; success = false; break;
            }
          }

          const taskId = generateId("task");
          await addTask({ id: taskId, name: str("name") || "Unnamed task", description: str("description"), cronExpression: cronExpr, taskType, payload, loopMode: effectiveLoopMode });
          emit({ type: "file_update", data: { path: "tasks", action: "created", taskId, name: str("name") } });
          output = `Task created: ${taskId}`;
          break;
        }
        case "schedule_remove": {
          const taskId = str("id");
          if (!taskId) { output = "Missing task ID"; success = false; break; }
          const ok = await removeTask(taskId);
          emit({ type: "file_update", data: { path: "tasks", action: ok ? "removed" : "not_found", taskId } });
          output = ok ? `Removed: ${taskId}` : `Not found: ${taskId}`;
          success = ok;
          break;
        }
      }
    } catch (err) {
      output = err instanceof Error ? err.message : String(err);
      success = false;
      logger.warn("agent.internal_tool.failed", { command: tool.type, error: output });
    }

    emit({ type: "tool_result", data: { id: toolCallId, command: tool.type, success, output: output.slice(0, SSE_TOOL_OUTPUT_LIMIT), durationMs: Date.now() - startTime } });
  }
}

// ── Compaction ────────────────────────────────────────────────────────

async function compactSession(session: ConversationSession, emit: EventEmitter): Promise<void> {
  logger.info("agent.session.compacting", { sessionId: session.id, messageCount: session.messages.length });
  emit({ type: "status", data: { type: "compacting" } });

  const compactionMessages: Message[] = [
    { role: "system", content: getCompactionSystemPrompt(), timestamp: new Date().toISOString() },
    { role: "user", content: buildCompactionPrompt(session.messages), timestamp: new Date().toISOString() },
  ];

  try {
    const result = await inferNonStreaming(session.inferenceConfig, compactionMessages);
    const { summary, insights } = parseCompactionResult(result.content);

    if (insights) {
      await memoryRepo.appendMemory(insights, "compaction", "compaction");
      emit({ type: "file_update", data: { path: "memory.md", action: "compaction_insights" } });
    }

    await sessionsRepo.compactSession(session.id, summary);

    // Start fresh session — emit new sessionId so client stays in sync
    session.id = generateId("session");
    await sessionsRepo.createSession(session.id);
    emit({ type: "status", data: { type: "session", sessionId: session.id } });
    const today = new Date().toISOString().slice(0, 10);
    session.messages = [{ role: "system", content: `[Session compacted — ${today}]

Your previous session was summarized. Key insights saved to memory.

To restore full working context:
1. Your memory entries above contain pointers to knowledge files
2. Use file_read on recent thoughts/ and journal/ entries for today (${today})
3. Resume where you left off — your entire knowledge base is intact

Previous session summary:
${summary}`, timestamp: new Date().toISOString() }];

    // Reset hybrid snapshot — new session starts with full heuristic
    session.lastPromptTokens = undefined;
    session.messageCountAtSnapshot = undefined;

    logger.info("[agent] compaction complete — new session started");
  } catch (err) {
    logger.error("agent.session.compaction_failed", {
      sessionId: session.id,
      error: err instanceof Error ? err.message : String(err),
      messageCount: session.messages.length,
    });
    // Do NOT mutate session state on failure — keep existing messages intact
    emit({ type: "error", data: { message: "Context compaction failed — session continues with current context" } });
  }
}

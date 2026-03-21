/**
 * Pure Anthropic <-> OpenAI translation functions.
 * No I/O — separately testable.
 */

// ── Types ────────────────────────────────────────────────────────────

export interface AnthropicRequest {
  model: string;
  messages: AnthropicMessage[];
  system?: string | AnthropicSystemBlock[];
  max_tokens: number;
  temperature?: number;
  top_p?: number;
  stop_sequences?: string[];
  stream?: boolean;
  tools?: AnthropicTool[];
  tool_choice?: unknown;
  metadata?: unknown;
}

export interface AnthropicMessage {
  role: "user" | "assistant";
  content: string | AnthropicContentBlock[];
}

export interface AnthropicImageSource {
  type: string;
  media_type?: string;
  data?: string;
  url?: string;
  file_id?: string;
  path?: string;
  name?: string;
}

export type AnthropicContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; source: AnthropicImageSource }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; content?: string | AnthropicContentBlock[]; is_error?: boolean };

export interface AnthropicSystemBlock {
  type: "text";
  text: string;
}

export interface AnthropicTool {
  name: string;
  description?: string;
  input_schema: Record<string, unknown>;
}

export interface AnthropicResponse {
  id: string;
  type: "message";
  role: "assistant";
  content: AnthropicContentBlock[];
  model: string;
  stop_reason: string | null;
  stop_sequence: string | null;
  usage: { input_tokens: number; output_tokens: number };
}

// OpenAI types (minimal)

interface OpenAIMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
  name?: string;
}

interface OpenAIToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

interface OpenAITool {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
  };
}

export interface TokenCountRequest {
  model?: string;
  messages?: unknown[];
  system?: string | unknown[];
  tools?: unknown[];
  tool_choice?: unknown;
  metadata?: unknown;
  stop_sequences?: unknown[];
  max_tokens?: number;
}

interface OpenAIRequest {
  model: string;
  messages: OpenAIMessage[];
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  stop?: string[];
  stream?: boolean;
  tools?: OpenAITool[];
  tool_choice?: "auto" | "none" | "required" | { type: "function"; function: { name: string } };
}

interface OpenAIResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: string;
      content: string | null;
      tool_calls?: OpenAIToolCall[];
    };
    finish_reason: string | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

// ── Stream state ─────────────────────────────────────────────────────

export interface StreamState {
  messageId: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  started: boolean;
  nextContentBlockIndex: number;
  activeToolCalls: Map<number, { id: string; name: string; arguments: string; blockIndex: number }>;
  currentTextBlockIndex: number | null;
  finishReason: string | null;
}

export function createStreamState(model: string): StreamState {
  return {
    messageId: `msg_${randomId()}`,
    model,
    inputTokens: 0,
    outputTokens: 0,
    started: false,
    nextContentBlockIndex: 0,
    activeToolCalls: new Map(),
    currentTextBlockIndex: null,
    finishReason: null,
  };
}

// ── Request translation: Anthropic → OpenAI ──────────────────────────

export function translateRequest(req: AnthropicRequest): OpenAIRequest {
  const messages: OpenAIMessage[] = [];

  // System message
  if (req.system) {
    const systemText = typeof req.system === "string"
      ? req.system
      : req.system.map((b) => {
        if (b.type !== "text") {
          throw new Error(`Unsupported Claude system block type: ${b.type}`);
        }
        return b.text;
      }).join("\n\n");
    if (systemText) {
      messages.push({ role: "system", content: systemText });
    }
  }

  // Convert messages
  for (const msg of req.messages) {
    if (typeof msg.content === "string") {
      messages.push({ role: msg.role, content: msg.content });
      continue;
    }

    // Content is an array of blocks
    const blocks = msg.content;

    if (msg.role === "user") {
      assertOnlyBlockTypes(blocks, ["text", "tool_result"], "user");

      // Check for tool_result blocks — each becomes a separate "tool" message
      const toolResults = blocks.filter(b => b.type === "tool_result") as Array<
        Extract<AnthropicContentBlock, { type: "tool_result" }>
      >;
      const otherBlocks = blocks.filter(b => b.type !== "tool_result");

      // Emit tool results first
      for (const tr of toolResults) {
        const content = serializeToolResultContent(tr.content);
        messages.push({
          role: "tool",
          tool_call_id: tr.tool_use_id,
          content,
        });
      }

      // Remaining content as user message
      if (otherBlocks.length > 0) {
        const textParts = otherBlocks
          .filter(b => b.type === "text")
          .map(b => (b as { text: string }).text);
        if (textParts.length > 0) {
          messages.push({ role: "user", content: textParts.join("\n") });
        }
      }
    } else if (msg.role === "assistant") {
      assertOnlyBlockTypes(blocks, ["text", "tool_use"], "assistant");

      // Assistant message may contain text + tool_use blocks
      const textBlocks = blocks.filter(b => b.type === "text") as Array<
        Extract<AnthropicContentBlock, { type: "text" }>
      >;
      const toolUseBlocks = blocks.filter(b => b.type === "tool_use") as Array<
        Extract<AnthropicContentBlock, { type: "tool_use" }>
      >;

      const assistantMsg: OpenAIMessage = {
        role: "assistant",
        content: textBlocks.length > 0
          ? textBlocks.map(b => b.text).join("\n")
          : null,
      };

      if (toolUseBlocks.length > 0) {
        assistantMsg.tool_calls = toolUseBlocks.map(tu => ({
          id: tu.id,
          type: "function" as const,
          function: {
            name: tu.name,
            arguments: typeof tu.input === "string" ? tu.input : JSON.stringify(tu.input),
          },
        }));
      }

      messages.push(assistantMsg);
    }
  }

  const result: OpenAIRequest = {
    model: req.model,
    messages,
  };

  if (req.max_tokens != null) result.max_tokens = req.max_tokens;
  if (req.temperature != null) result.temperature = req.temperature;
  if (req.top_p != null) result.top_p = req.top_p;
  if (req.stop_sequences) result.stop = req.stop_sequences;
  if (req.stream != null) result.stream = req.stream;

  // Tools
  if (req.tools && req.tools.length > 0) {
    result.tools = req.tools.map(t => ({
      type: "function" as const,
      function: {
        name: t.name,
        ...(t.description ? { description: t.description } : {}),
        parameters: t.input_schema,
      },
    }));

    // Forward tool_choice: Anthropic → OpenAI format
    if (req.tool_choice) {
      const tc = req.tool_choice as Record<string, unknown>;
      if (tc.type === "auto") result.tool_choice = "auto";
      else if (tc.type === "any") result.tool_choice = "required";
      else if (tc.type === "none") result.tool_choice = "none";
      else if (tc.type === "tool" && typeof tc.name === "string") {
        result.tool_choice = { type: "function", function: { name: tc.name } };
      }
    }
  }

  return result;
}

// ── Response translation: OpenAI → Anthropic (non-streaming) ─────────

export function translateResponse(openAIRes: OpenAIResponse, reqModel: string): AnthropicResponse {
  const choice = openAIRes.choices?.[0];
  const content: AnthropicContentBlock[] = [];

  if (choice?.message?.content) {
    content.push({ type: "text", text: choice.message.content });
  }

  if (choice?.message?.tool_calls) {
    for (const tc of choice.message.tool_calls) {
      let input: unknown;
      try {
        input = JSON.parse(tc.function.arguments);
      } catch {
        input = tc.function.arguments;
      }
      content.push({
        type: "tool_use",
        id: tc.id,
        name: tc.function.name,
        input,
      });
    }
  }

  // If no content at all, add empty text block
  if (content.length === 0) {
    content.push({ type: "text", text: "" });
  }

  return {
    id: openAIRes.id || `msg_${randomId()}`,
    type: "message",
    role: "assistant",
    content,
    model: openAIRes.model || reqModel,
    stop_reason: mapStopReason(choice?.finish_reason ?? null),
    stop_sequence: null,
    usage: {
      input_tokens: openAIRes.usage?.prompt_tokens ?? 0,
      output_tokens: openAIRes.usage?.completion_tokens ?? 0,
    },
  };
}

// ── Stream translation: OpenAI SSE chunks → Anthropic SSE events ─────

export function translateStreamChunk(
  chunk: Record<string, unknown>,
  state: StreamState,
): string[] {
  const events: string[] = [];

  // Extract delta from choices[0]
  const choices = chunk.choices as Array<{
    delta?: {
      role?: string;
      content?: string | null;
      tool_calls?: Array<{
        index: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason?: string | null;
  }> | undefined;

  const delta = choices?.[0]?.delta;
  const finishReason = choices?.[0]?.finish_reason;

  // Usage from chunk (some providers include it)
  const usage = chunk.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined;
  if (usage?.prompt_tokens) state.inputTokens = usage.prompt_tokens;
  if (usage?.completion_tokens) state.outputTokens = usage.completion_tokens;

  // Emit message_start on first chunk
  if (!state.started) {
    state.started = true;
    if (chunk.id) state.messageId = chunk.id as string;
    if (chunk.model) state.model = chunk.model as string;

    events.push(sseEvent("message_start", {
      type: "message_start",
      message: {
        id: state.messageId,
        type: "message",
        role: "assistant",
        content: [],
        model: state.model,
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: state.inputTokens, output_tokens: 0 },
      },
    }));
  }

  if (delta) {
    // Text content
    if (delta.content != null && delta.content !== "") {
      if (state.currentTextBlockIndex == null) {
        state.currentTextBlockIndex = state.nextContentBlockIndex++;
        events.push(sseEvent("content_block_start", {
          type: "content_block_start",
          index: state.currentTextBlockIndex,
          content_block: { type: "text", text: "" },
        }));
      }
      events.push(sseEvent("content_block_delta", {
        type: "content_block_delta",
        index: state.currentTextBlockIndex,
        delta: { type: "text_delta", text: delta.content },
      }));
    }

    // Tool calls
    if (delta.tool_calls) {
      for (const tc of delta.tool_calls) {
        const tcIndex = tc.index;

        if (!state.activeToolCalls.has(tcIndex)) {
          // Close text block if open
          if (state.currentTextBlockIndex != null) {
            events.push(sseEvent("content_block_stop", {
              type: "content_block_stop",
              index: state.currentTextBlockIndex,
            }));
            state.currentTextBlockIndex = null;
          }

          // New tool call
          const id = tc.id || `toolu_${randomId()}`;
          const name = tc.function?.name || "";
          const blockIndex = state.nextContentBlockIndex++;
          state.activeToolCalls.set(tcIndex, { id, name, arguments: "", blockIndex });

          events.push(sseEvent("content_block_start", {
            type: "content_block_start",
            index: blockIndex,
            content_block: { type: "tool_use", id, name, input: {} },
          }));
        }

        // Accumulate arguments
        if (tc.function?.arguments) {
          const existing = state.activeToolCalls.get(tcIndex)!;
          if (tc.id && existing.id !== tc.id) existing.id = tc.id;
          if (tc.function?.name && existing.name !== tc.function.name) {
            existing.name = tc.function.name;
          }
          existing.arguments += tc.function.arguments;

          events.push(sseEvent("content_block_delta", {
            type: "content_block_delta",
            index: existing.blockIndex,
            delta: { type: "input_json_delta", partial_json: tc.function.arguments },
          }));
        }
      }
    }
  }

  // Finish
  if (finishReason) {
    state.finishReason = finishReason;

    // Close any open content block
    if (state.currentTextBlockIndex != null) {
      events.push(sseEvent("content_block_stop", {
        type: "content_block_stop",
        index: state.currentTextBlockIndex,
      }));
      state.currentTextBlockIndex = null;
    }

    for (const toolCall of getSortedToolCalls(state)) {
      events.push(sseEvent("content_block_stop", {
        type: "content_block_stop",
        index: toolCall.blockIndex,
      }));
    }
    state.activeToolCalls.clear();

    events.push(sseEvent("message_delta", {
      type: "message_delta",
      delta: {
        stop_reason: mapStopReason(finishReason),
        stop_sequence: null,
      },
      usage: { output_tokens: state.outputTokens },
    }));

    events.push(sseEvent("message_stop", { type: "message_stop" }));
  }

  return events;
}

/**
 * Generate final events when stream ends without a finish_reason chunk.
 * Called when we receive [DONE] from OpenAI.
 */
export function finalizeStream(state: StreamState): string[] {
  const events: string[] = [];

  // If we never received a finish_reason, emit closing events
  if (state.finishReason === null) {
    const toolCalls = getSortedToolCalls(state);

    if (state.currentTextBlockIndex != null) {
      events.push(sseEvent("content_block_stop", {
        type: "content_block_stop",
        index: state.currentTextBlockIndex,
      }));
      state.currentTextBlockIndex = null;
    }

    for (const toolCall of toolCalls) {
      events.push(sseEvent("content_block_stop", {
        type: "content_block_stop",
        index: toolCall.blockIndex,
      }));
    }
    state.activeToolCalls.clear();

    // If no content was ever started, emit an empty text block
    if (state.currentTextBlockIndex == null && toolCalls.length === 0 && state.nextContentBlockIndex === 0) {
      events.push(sseEvent("content_block_start", {
        type: "content_block_start",
        index: 0,
        content_block: { type: "text", text: "" },
      }));
      events.push(sseEvent("content_block_stop", {
        type: "content_block_stop",
        index: 0,
      }));
    }

    const stopReason = toolCalls.length > 0 ? "tool_use" : "end_turn";
    events.push(sseEvent("message_delta", {
      type: "message_delta",
      delta: { stop_reason: stopReason, stop_sequence: null },
      usage: { output_tokens: state.outputTokens },
    }));

    events.push(sseEvent("message_stop", { type: "message_stop" }));
  }

  return events;
}

// ── Token estimation ─────────────────────────────────────────────────

export function estimateTokenCount(
  payload: TokenCountRequest,
): number {
  const messages = Array.isArray(payload.messages) ? payload.messages : [];
  const tools = Array.isArray(payload.tools) ? payload.tools : [];

  let total = 24;
  total += messages.length * 12;
  total += tools.length * 20;
  total += estimateStructuredValue(payload.model);
  total += estimateStructuredValue(payload.system);
  total += estimateStructuredValue(messages);
  total += estimateStructuredValue(tools);
  total += estimateStructuredValue(payload.tool_choice);
  total += estimateStructuredValue(payload.metadata);
  total += estimateStructuredValue(payload.stop_sequences);

  if (payload.max_tokens != null) {
    total += 4;
  }

  return Math.max(1, Math.ceil(total));
}

// ── Helpers ──────────────────────────────────────────────────────────

function estimateStructuredValue(value: unknown): number {
  if (value == null) return 0;

  if (typeof value === "string") {
    const whitespaceRuns = value.match(/\s+/g)?.length ?? 0;
    const newlineCount = value.match(/\n/g)?.length ?? 0;
    return Math.max(1, Math.ceil(value.length / 3) + whitespaceRuns + newlineCount * 2);
  }

  if (typeof value === "number") return 2;
  if (typeof value === "boolean") return 1;

  if (Array.isArray(value)) {
    return 4 + value.length * 2 + value.reduce((sum, entry) => sum + estimateStructuredValue(entry), 0);
  }

  if (typeof value === "object") {
    return 8 + Object.entries(value).reduce(
      (sum, [key, entryValue]) => sum + Math.max(1, Math.ceil(key.length / 3)) + 2 + estimateStructuredValue(entryValue),
      0,
    );
  }

  return 4;
}

function serializeToolResultContent(content?: string | AnthropicContentBlock[]): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  return content
    .map((block) => serializeToolResultBlock(block))
    .filter((part) => part.length > 0)
    .join("\n");
}

function serializeToolResultBlock(block: AnthropicContentBlock): string {
  switch (block.type) {
    case "text":
      return block.text;
    case "image":
      return formatToolResultImagePlaceholder(block.source);
    default:
      return `[tool_result ${block.type} omitted]`;
  }
}

function formatToolResultImagePlaceholder(source: AnthropicImageSource): string {
  const details: string[] = [];

  if (source.type) details.push(`source=${source.type}`);
  if (source.media_type) details.push(`media_type=${source.media_type}`);

  const name = getBestEffortImageName(source);
  if (name) details.push(`name="${name}"`);
  if (source.path) details.push(`path="${source.path}"`);
  if (source.file_id) details.push(`file_id=${source.file_id}`);
  if (source.url) {
    details.push(`url="${source.url}"`);
  } else if (source.data) {
    details.push(`data_chars=${source.data.length}`);
  }

  if (details.length === 0) {
    return "[tool_result image omitted]";
  }

  return `[tool_result image omitted: ${details.join(", ")}]`;
}

function getBestEffortImageName(source: AnthropicImageSource): string | null {
  if (typeof source.name === "string" && source.name.trim()) {
    return source.name.trim();
  }

  if (typeof source.path === "string" && source.path.trim()) {
    return lastPathSegment(source.path);
  }

  if (typeof source.url === "string" && source.url.trim()) {
    try {
      return lastPathSegment(new URL(source.url).pathname);
    } catch {
      return lastPathSegment(source.url.split(/[?#]/)[0] ?? source.url);
    }
  }

  return null;
}

function lastPathSegment(value: string): string | null {
  const parts = value.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) ?? null;
}

function mapStopReason(reason: string | null): string | null {
  if (!reason) return null;
  switch (reason) {
    case "stop": return "end_turn";
    case "length": return "max_tokens";
    case "tool_calls": return "tool_use";
    default: return reason;
  }
}

function assertOnlyBlockTypes(
  blocks: AnthropicContentBlock[],
  allowedTypes: AnthropicContentBlock["type"][],
  role: string,
): void {
  for (const block of blocks) {
    if (!allowedTypes.includes(block.type)) {
      throw new Error(`Unsupported Claude ${role} block type: ${block.type}`);
    }
  }
}

function getSortedToolCalls(state: StreamState): Array<{ id: string; name: string; arguments: string; blockIndex: number }> {
  return [...state.activeToolCalls.values()].sort((a, b) => a.blockIndex - b.blockIndex);
}

function sseEvent(eventType: string, data: unknown): string {
  return `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
}

function randomId(): string {
  return Math.random().toString(36).slice(2, 14) + Date.now().toString(36);
}

/**
 * Direct 0G Compute inference layer.
 *
 * Uses the existing broker from broker-factory.ts to authenticate,
 * then sends OpenAI-compatible chat/completions requests directly
 * to the provider endpoint. Supports streaming via SSE.
 */

import { getAuthenticatedBroker } from "../0g-compute/broker-factory.js";
import { getServiceMetadata, listChatServices } from "../0g-compute/operations.js";
import { loadComputeState } from "../0g-compute/readiness.js";
import { calculateProviderPricing, formatPricePerMTokens } from "../0g-compute/pricing.js";
import { DEFAULT_CONTEXT_LIMIT } from "./constants.js";
import type { Message, StreamChunk, InferenceConfig, InferenceResponse, ParsedToolCall } from "./types.js";
import type { OpenAITool } from "./tool-registry.js";
import { sanitizeContent } from "./tool-parser.js";
import { retryWithBackoff, isRetryableError } from "./resilience.js";
import type { RetryOptions } from "./resilience.js";

const INFERENCE_RETRY: RetryOptions = {
  maxRetries: 2,
  baseDelayMs: 2000,
  maxDelayMs: 15_000,
  jitter: true,
  shouldRetry: isRetryableError,
};

export type { InferenceConfig, InferenceResponse, ParsedToolCall } from "./types.js";
import logger from "../utils/logger.js";

// ── Config resolution ────────────────────────────────────────────────

/**
 * Load inference config from compute state.
 * Returns provider, model, endpoint, and context limit.
 */
export async function loadInferenceConfig(): Promise<InferenceConfig | null> {
  const state = loadComputeState();
  if (!state) {
    logger.warn("[agent] No compute state found — run echoclaw echo first");
    return null;
  }

  try {
    const broker = await getAuthenticatedBroker();
    const metadata = await getServiceMetadata(broker, state.activeProvider);

    // Dynamic pricing from provider (same approach as BalanceMonitor)
    let inputPricePerM = 1.0;
    let outputPricePerM = 3.2;
    let recommendedMinLockedOg = 1.0;
    let alertThresholdOg = 1.2;

    try {
      const services = await listChatServices(broker);
      const svc = services.find(s => s.provider.toLowerCase() === state.activeProvider.toLowerCase());
      if (svc) {
        inputPricePerM = parseFloat(formatPricePerMTokens(svc.inputPrice));
        outputPricePerM = parseFloat(formatPricePerMTokens(svc.outputPrice));
        const pricing = calculateProviderPricing(svc.inputPrice, svc.outputPrice);
        recommendedMinLockedOg = pricing.recommendedMinLockedOg;
        alertThresholdOg = pricing.recommendedAlertLockedOg;
        logger.info(`[agent] pricing loaded: ${inputPricePerM}/M in, ${outputPricePerM}/M out, min: ${recommendedMinLockedOg.toFixed(2)} 0G`);
      }
    } catch {
      logger.warn("[agent] could not load provider pricing, using defaults");
    }

    return {
      provider: state.activeProvider,
      model: state.model ?? metadata.model,
      endpoint: metadata.endpoint,
      contextLimit: DEFAULT_CONTEXT_LIMIT,
      inputPricePerM,
      outputPricePerM,
      recommendedMinLockedOg,
      alertThresholdOg,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[agent] Failed to load inference config: ${msg}`);
    return null;
  }
}

// ── Request building ─────────────────────────────────────────────────

interface OpenAIMessage {
  role: string;
  content: string | null;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
}

interface ChatCompletionRequest {
  model: string;
  messages: OpenAIMessage[];
  stream: boolean;
  max_tokens?: number;
  temperature?: number;
}

/**
 * Build OpenAI-compatible message array from our Message type.
 * Preserves tool_call_id for tool results and tool_calls for assistant messages.
 */
function buildRequest(
  model: string,
  messages: Message[],
  stream: boolean,
): ChatCompletionRequest {
  const openaiMessages: OpenAIMessage[] = messages.map(m => {
    // Tool result messages: must include tool_call_id
    if (m.role === "tool" && m.toolCallId) {
      return { role: "tool", content: m.content, tool_call_id: m.toolCallId };
    }

    // Assistant messages with tool calls: include tool_calls array
    if (m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0) {
      return {
        role: "assistant",
        content: m.content || null,
        tool_calls: m.toolCalls.map(tc => ({
          id: tc.id,
          type: "function" as const,
          function: { name: tc.command, arguments: JSON.stringify(tc.args) },
        })),
      };
    }

    // Regular messages
    return { role: m.role, content: m.content };
  });

  return {
    model,
    messages: openaiMessages,
    stream,
    max_tokens: 8192,
    temperature: 0.7,
  };
}

// ── Auth headers ─────────────────────────────────────────────────────

async function getAuthHeaders(provider: string, content: string): Promise<Record<string, string>> {
  const broker = await getAuthenticatedBroker();
  const headers = await broker.inference.getRequestHeaders(provider, content);
  return headers as unknown as Record<string, string>;
}

// ── Non-streaming inference ──────────────────────────────────────────

export interface InferenceResult {
  content: string;
  finishReason: string | null;
  usage: { promptTokens: number; completionTokens: number };
}

export async function inferNonStreaming(
  config: InferenceConfig,
  messages: Message[],
): Promise<InferenceResult> {
  const request = buildRequest(config.model, messages, false);
  const contentForAuth = JSON.stringify(request.messages);
  const authHeaders = await getAuthHeaders(config.provider, contentForAuth);

  const url = `${config.endpoint}/chat/completions`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120_000);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify(request),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      throw new Error(`0G compute returned ${response.status}: ${errText.slice(0, 200)}`);
    }

    const json = await response.json() as {
      choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };

    const choice = json.choices?.[0];
    return {
      content: choice?.message?.content ?? "",
      finishReason: choice?.finish_reason ?? null,
      usage: {
        promptTokens: json.usage?.prompt_tokens ?? 0,
        completionTokens: json.usage?.completion_tokens ?? 0,
      },
    };
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
}

// ── Streaming inference ──────────────────────────────────────────────

/**
 * Stream inference results as an async generator of chunks.
 * Each chunk contains either content text, finish reason, or usage data.
 */
export async function* inferStreaming(
  config: InferenceConfig,
  messages: Message[],
): AsyncGenerator<StreamChunk> {
  const request = buildRequest(config.model, messages, true);
  const contentForAuth = JSON.stringify(request.messages);
  const authHeaders = await getAuthHeaders(config.provider, contentForAuth);

  const url = `${config.endpoint}/chat/completions`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 300_000);

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify(request),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }

  if (!response.ok) {
    clearTimeout(timeout);
    const errText = await response.text().catch(() => "");
    throw new Error(`0G compute returned ${response.status}: ${errText.slice(0, 200)}`);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    clearTimeout(timeout);
    throw new Error("No response body reader available");
  }

  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith("data: ")) continue;

        const data = trimmed.slice(6);
        if (data === "[DONE]") {
          clearTimeout(timeout);
          return;
        }

        try {
          const chunk = JSON.parse(data) as {
            choices?: Array<{
              delta?: { content?: string };
              finish_reason?: string | null;
            }>;
            usage?: { prompt_tokens?: number; completion_tokens?: number };
          };

          const delta = chunk.choices?.[0]?.delta;
          const finishReason = chunk.choices?.[0]?.finish_reason ?? null;
          const usage = chunk.usage
            ? { promptTokens: chunk.usage.prompt_tokens ?? 0, completionTokens: chunk.usage.completion_tokens ?? 0 }
            : null;

          yield {
            content: delta?.content ?? null,
            finishReason,
            usage,
          };
        } catch {
          // Skip unparseable chunks
        }
      }
    }
  } finally {
    clearTimeout(timeout);
  }
}

// ── Native OpenAI function calling ──────────────────────────────────

/**
 * Infer with native OpenAI function calling.
 *
 * 0G providers (GLM-5, DeepSeek, Qwen) support the `tools` parameter natively.
 * Response includes `tool_calls` in standard OpenAI format.
 * Non-streaming: tool_calls require full response for structured parsing.
 *
 * Defense-in-depth: if model returns text content with embedded tool call
 * artifacts (known GLM-5 issue), falls back to content parser.
 */
export async function inferWithTools(
  config: InferenceConfig,
  messages: Message[],
  tools: OpenAITool[],
): Promise<InferenceResponse> {
  return retryWithBackoff(
    () => doInferWithTools(config, messages, tools),
    INFERENCE_RETRY,
    "inference",
  );
}

async function doInferWithTools(
  config: InferenceConfig,
  messages: Message[],
  tools: OpenAITool[],
): Promise<InferenceResponse> {
  const request = buildRequest(config.model, messages, false);

  // Add tools to request (native OpenAI function calling)
  const body: Record<string, unknown> = { ...request };
  if (tools.length > 0) {
    body.tools = tools;
    body.tool_choice = "auto";
  }

  const contentForAuth = JSON.stringify(body.messages);
  const authHeaders = await getAuthHeaders(config.provider, contentForAuth);

  const url = `${config.endpoint}/chat/completions`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 300_000);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      throw new Error(`0G compute returned ${response.status}: ${errText.slice(0, 200)}`);
    }

    const json = await response.json() as {
      choices?: Array<{
        message?: {
          content?: string | null;
          tool_calls?: Array<{
            id: string;
            type: "function";
            function: { name: string; arguments: string };
          }>;
        };
        finish_reason?: string;
      }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };

    const choice = json.choices?.[0];
    const msg = choice?.message;
    const usage = {
      promptTokens: json.usage?.prompt_tokens ?? 0,
      completionTokens: json.usage?.completion_tokens ?? 0,
    };

    // Native tool_calls in response — skip malformed, don't degrade to {}
    if (msg?.tool_calls && msg.tool_calls.length > 0) {
      const toolCalls: ParsedToolCall[] = [];
      for (const tc of msg.tool_calls) {
        try {
          const args = JSON.parse(tc.function.arguments);
          toolCalls.push({ name: tc.function.name, arguments: args });
        } catch {
          logger.warn("agent.inference.malformed_tool_args", {
            name: tc.function.name, raw: tc.function.arguments.slice(0, 200),
          });
        }
      }
      if (toolCalls.length > 0) {
        return { content: null, toolCalls, usage };
      }
      // All tool calls malformed → fall through to text response
    }

    // Text response — sanitize any stray artifacts
    const rawContent = msg?.content ?? "";
    return { content: sanitizeContent(rawContent), toolCalls: null, usage };
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
}

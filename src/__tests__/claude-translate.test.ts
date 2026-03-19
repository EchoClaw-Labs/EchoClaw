import { describe, expect, it } from "vitest";
import {
  createStreamState,
  estimateTokenCount,
  finalizeStream,
  translateRequest,
  translateResponse,
  translateStreamChunk,
  type AnthropicRequest,
} from "../claude/translate.js";

function parseSseEvents(payloads: string[]): Array<{ event: string; data: any }> {
  return payloads.map((payload) => {
    const [eventLine, dataLine] = payload.trim().split("\n");
    return {
      event: eventLine!.replace("event: ", ""),
      data: JSON.parse(dataLine!.replace("data: ", "")),
    };
  });
}

describe("claude translateRequest", () => {
  it("maps system, tool_use, tool_result, and tool schemas to OpenAI format", () => {
    const req: AnthropicRequest = {
      model: "sonnet",
      max_tokens: 128,
      system: [{ type: "text", text: "You are concise." }],
      messages: [
        { role: "user", content: [{ type: "text", text: "Hello" }] },
        {
          role: "assistant",
          content: [{ type: "tool_use", id: "toolu_1", name: "lookup_price", input: { symbol: "0G" } }],
        },
        {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "42" }],
        },
      ],
      tools: [{
        name: "lookup_price",
        description: "Return a token price",
        input_schema: { type: "object", properties: { symbol: { type: "string" } } },
      }],
    };

    const translated = translateRequest(req);

    expect(translated).toMatchObject({
      model: "sonnet",
      max_tokens: 128,
      messages: [
        { role: "system", content: "You are concise." },
        { role: "user", content: "Hello" },
        {
          role: "assistant",
          content: null,
          tool_calls: [{
            id: "toolu_1",
            type: "function",
            function: {
              name: "lookup_price",
              arguments: JSON.stringify({ symbol: "0G" }),
            },
          }],
        },
        { role: "tool", tool_call_id: "toolu_1", content: "42" },
      ],
      tools: [{
        type: "function",
        function: {
          name: "lookup_price",
          description: "Return a token price",
          parameters: { type: "object", properties: { symbol: { type: "string" } } },
        },
      }],
    });
  });

  it("serializes tool_result image blocks into best-effort text placeholders", () => {
    const translated = translateRequest({
      model: "sonnet",
      max_tokens: 64,
      messages: [
        {
          role: "assistant",
          content: [{ type: "tool_use", id: "toolu_1", name: "inspect_image", input: { path: "/tmp/frog.png" } }],
        },
        {
          role: "user",
          content: [{
            type: "tool_result",
            tool_use_id: "toolu_1",
            content: [{
              type: "image",
              source: { type: "base64", media_type: "image/png", data: "ZmFrZQ==" },
            }],
          }],
        },
      ],
    });

    expect(translated.messages).toEqual([
      {
        role: "assistant",
        content: null,
        tool_calls: [{
          id: "toolu_1",
          type: "function",
          function: {
            name: "inspect_image",
            arguments: JSON.stringify({ path: "/tmp/frog.png" }),
          },
        }],
      },
      {
        role: "tool",
        tool_call_id: "toolu_1",
        content: "[tool_result image omitted: source=base64, media_type=image/png, data_chars=8]",
      },
    ]);
  });

  it("keeps text and adds best-effort name/path metadata for tool_result images", () => {
    const translated = translateRequest({
      model: "sonnet",
      max_tokens: 64,
      messages: [
        {
          role: "assistant",
          content: [{ type: "tool_use", id: "toolu_1", name: "inspect_image", input: { path: "/tmp/frog.png" } }],
        },
        {
          role: "user",
          content: [{
            type: "tool_result",
            tool_use_id: "toolu_1",
            content: [
              { type: "text", text: "Saved screenshot" },
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: "image/png",
                  data: "ZmFrZQ==",
                  path: "/tmp/frog.png",
                },
              },
              { type: "text", text: "Use it for context" },
            ],
          }],
        },
      ],
    });

    expect(translated.messages[1]).toEqual({
      role: "tool",
      tool_call_id: "toolu_1",
      content: "Saved screenshot\n[tool_result image omitted: source=base64, media_type=image/png, name=\"frog.png\", path=\"/tmp/frog.png\", data_chars=8]\nUse it for context",
    });
  });

  it("fails fast on top-level user image blocks instead of silently dropping them", () => {
    expect(() => translateRequest({
      model: "sonnet",
      max_tokens: 64,
      messages: [{
        role: "user",
        content: [{
          type: "image",
          source: { type: "base64", media_type: "image/png", data: "ZmFrZQ==" },
        }],
      }],
    })).toThrow("Unsupported Claude user block type: image");
  });
});

describe("claude estimateTokenCount", () => {
  it("counts tool-heavy payloads more conservatively than the old string-length heuristic", () => {
    const payload = {
      model: "sonnet",
      system: [{ type: "text", text: "You are a careful coding assistant.\nUse tools when needed." }],
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Inspect the repository and explain the migration plan in detail." },
            { type: "tool_result", tool_use_id: "toolu_1", content: JSON.stringify({ files: ["a.ts", "b.ts"], changed: true }) },
          ],
        },
      ],
      tools: [{
        name: "read_file",
        description: "Read a file from disk",
        input_schema: {
          type: "object",
          properties: {
            path: { type: "string" },
            limit: { type: "number" },
          },
          required: ["path"],
        },
      }],
      tool_choice: { type: "tool", name: "read_file" },
      stop_sequences: ["</final>"],
    };

    const oldHeuristic = Math.max(
      1,
      Math.ceil(
        (JSON.stringify(payload.messages) + JSON.stringify(payload.system)).length / 4,
      ),
    );

    expect(estimateTokenCount(payload)).toBeGreaterThan(oldHeuristic);
  });

  it("grows monotonically as messages and tools are added", () => {
    const base = estimateTokenCount({
      model: "sonnet",
      messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
    });
    const withSystem = estimateTokenCount({
      model: "sonnet",
      system: "You are concise.",
      messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
    });
    const withTools = estimateTokenCount({
      model: "sonnet",
      system: "You are concise.",
      messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
      tools: [{
        name: "lookup",
        input_schema: { type: "object", properties: { id: { type: "string" } } },
      }],
    });

    expect(withSystem).toBeGreaterThan(base);
    expect(withTools).toBeGreaterThan(withSystem);
  });
});

describe("claude translateResponse", () => {
  it("maps OpenAI tool calls back into Anthropic content blocks", () => {
    const translated = translateResponse({
      id: "chatcmpl_123",
      object: "chat.completion",
      created: 1,
      model: "openai/gpt-oss-120b",
      choices: [{
        index: 0,
        message: {
          role: "assistant",
          content: "Looking it up",
          tool_calls: [{
            id: "call_1",
            type: "function",
            function: {
              name: "lookup_price",
              arguments: "{\"symbol\":\"0G\"}",
            },
          }],
        },
        finish_reason: "tool_calls",
      }],
      usage: { prompt_tokens: 10, completion_tokens: 6, total_tokens: 16 },
    }, "sonnet");

    expect(translated).toEqual({
      id: "chatcmpl_123",
      type: "message",
      role: "assistant",
      model: "openai/gpt-oss-120b",
      stop_reason: "tool_use",
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 6 },
      content: [
        { type: "text", text: "Looking it up" },
        { type: "tool_use", id: "call_1", name: "lookup_price", input: { symbol: "0G" } },
      ],
    });
  });
});

describe("claude translateStreamChunk", () => {
  it("assigns stable, unique Anthropic content block indexes for multiple streamed tool calls", () => {
    const state = createStreamState("sonnet");

    const firstEvents = parseSseEvents(translateStreamChunk({
      id: "chatcmpl_stream",
      model: "openai/gpt-oss-120b",
      choices: [{
        delta: {
          tool_calls: [
            { index: 0, id: "call_0", function: { name: "tool_a", arguments: "{\"x\":" } },
            { index: 1, id: "call_1", function: { name: "tool_b", arguments: "{\"y\":" } },
          ],
        },
      }],
    }, state));

    const secondEvents = parseSseEvents(translateStreamChunk({
      choices: [{
        delta: {
          tool_calls: [
            { index: 0, function: { arguments: "1}" } },
            { index: 1, function: { arguments: "2}" } },
          ],
        },
      }],
    }, state));

    const finishEvents = parseSseEvents(translateStreamChunk({
      choices: [{ delta: {}, finish_reason: "tool_calls" }],
    }, state));

    expect(firstEvents.map((event) => [event.event, event.data.index]).filter(([event]) => event === "content_block_start"))
      .toEqual([
        ["content_block_start", 0],
        ["content_block_start", 1],
      ]);

    expect(secondEvents.map((event) => event.data.index).filter((index) => index != null)).toEqual([0, 1]);

    expect(finishEvents.map((event) => [event.event, event.data.index]).filter(([event]) => event === "content_block_stop"))
      .toEqual([
        ["content_block_stop", 0],
        ["content_block_stop", 1],
      ]);

    const messageDelta = finishEvents.find((event) => event.event === "message_delta");
    expect(messageDelta?.data.delta.stop_reason).toBe("tool_use");
  });

  it("finalizes an empty stream with a valid empty Anthropic text block", () => {
    const state = createStreamState("sonnet");
    const events = parseSseEvents(finalizeStream(state));

    expect(events).toEqual([
      {
        event: "content_block_start",
        data: {
          type: "content_block_start",
          index: 0,
          content_block: { type: "text", text: "" },
        },
      },
      {
        event: "content_block_stop",
        data: { type: "content_block_stop", index: 0 },
      },
      {
        event: "message_delta",
        data: {
          type: "message_delta",
          delta: { stop_reason: "end_turn", stop_sequence: null },
          usage: { output_tokens: 0 },
        },
      },
      {
        event: "message_stop",
        data: { type: "message_stop" },
      },
    ]);
  });
});

import { describe, expect, it, vi, beforeEach } from "vitest";

const mockWriteStdout = vi.fn();

vi.mock("../commands/khalani/request.js", () => ({
  prepareQuoteRequest: vi.fn(async () => ({
    chains: [
      { type: "eip155", id: 1, name: "Ethereum" },
      { type: "eip155", id: 8453, name: "Base" },
    ],
    fromChainId: 1,
    toChainId: 8453,
    request: {
      tradeType: "EXACT_INPUT",
      fromChainId: 1,
      fromToken: "0x1111111111111111111111111111111111111111",
      toChainId: 8453,
      toToken: "0x2222222222222222222222222222222222222222",
      amount: "1000",
      fromAddress: "0x3333333333333333333333333333333333333333",
    },
  })),
}));

vi.mock("../khalani/chains.js", () => ({
  getChain: vi.fn((chainId: number) =>
    chainId === 1
      ? { type: "eip155", id: 1, name: "Ethereum" }
      : { type: "eip155", id: 8453, name: "Base" }),
}));

vi.mock("../khalani/client.js", () => ({
  getKhalaniClient: vi.fn(() => ({
    async *streamQuotes() {
      yield {
        quoteId: "quote-stream",
        routeId: "Hyperstream",
        type: "native-filler",
        depositMethods: ["CONTRACT_CALL"],
        quote: {
          amountIn: "1000",
          amountOut: "995",
          expectedDurationSeconds: 30,
          validBefore: 1700000000,
        },
      };
      yield {
        quoteId: "quote-stream",
        routeId: "Across",
        type: "external-intent-router",
        depositMethods: ["CONTRACT_CALL"],
        quote: {
          amountIn: "1000",
          amountOut: "990",
          expectedDurationSeconds: 45,
          validBefore: 1700000000,
        },
      };
    },
  })),
}));

vi.mock("../utils/output.js", () => ({
  isHeadless: vi.fn(() => true),
  writeJsonSuccess: vi.fn(),
  writeStdout: mockWriteStdout,
}));

vi.mock("../utils/ui.js", () => ({
  colors: {
    success: (value: string) => value,
    info: (value: string) => value,
  },
  infoBox: vi.fn(),
  printTable: vi.fn(),
  spinner: vi.fn(() => ({
    start: vi.fn(),
    stop: vi.fn(),
  })),
}));

const { createQuoteSubcommand } = await import("../commands/khalani/quote.js");

describe("khalani quote streaming", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("emits NDJSON route lines followed by a complete line in headless mode", async () => {
    const cmd = createQuoteSubcommand();
    cmd.exitOverride();

    await cmd.parseAsync([
      "node",
      "quote",
      "--from-chain", "1",
      "--from-token", "0x1111111111111111111111111111111111111111",
      "--to-chain", "8453",
      "--to-token", "0x2222222222222222222222222222222222222222",
      "--amount", "1000",
      "--stream",
    ], { from: "user" });

    expect(mockWriteStdout).toHaveBeenCalledTimes(3);

    const firstLine = JSON.parse(mockWriteStdout.mock.calls[0][0]);
    const secondLine = JSON.parse(mockWriteStdout.mock.calls[1][0]);
    const completeLine = JSON.parse(mockWriteStdout.mock.calls[2][0]);

    expect(firstLine.type).toBe("route");
    expect(secondLine.type).toBe("route");
    expect(completeLine).toMatchObject({
      success: true,
      type: "complete",
      quoteId: "quote-stream",
      routeCount: 2,
      bestRouteIndex: 0,
    });
  });
});

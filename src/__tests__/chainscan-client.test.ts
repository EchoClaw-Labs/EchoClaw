import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock config/store before importing client
vi.mock("../config/store.js", () => ({
  loadConfig: () => ({
    services: {
      chainScanBaseUrl: "https://chainscan.0g.ai/open",
    },
    wallet: { address: null },
  }),
}));

// Mock logger to suppress output in tests
vi.mock("../utils/logger.js", () => ({
  default: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Import client once (after mocks are set up)
import { chainscanClient } from "../chainscan/client.js";

// Save original fetch
const originalFetch = globalThis.fetch;

describe("chainscan client", () => {
  beforeEach(() => {
    vi.stubEnv("CHAINSCAN_API_KEY", "");
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.unstubAllEnvs();
  });

  describe("chainscanClient.getBalance", () => {
    it("should parse successful balance response", async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: "1",
          message: "OK",
          result: "1000000000000000000",
        }),
      });

      const balance = await chainscanClient.getBalance("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045");
      expect(balance).toBe("1000000000000000000");
    });

    it("should forward API key when set", async () => {
      vi.stubEnv("CHAINSCAN_API_KEY", "test-key-123");

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: "1",
          message: "OK",
          result: "0",
        }),
      });

      await chainscanClient.getBalance("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045");

      const calledUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(calledUrl).toContain("apikey=test-key-123");
    });
  });

  describe("chainscanClient.getTransactions", () => {
    it("should return empty array for 'No transactions found'", async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: "0",
          message: "No transactions found",
          result: null,
        }),
      });

      const txs = await chainscanClient.getTransactions("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045");
      expect(txs).toEqual([]);
    });

    it("should forward pagination params", async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: "1",
          message: "OK",
          result: [],
        }),
      });

      await chainscanClient.getTransactions("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045", {
        page: 2,
        offset: 50,
        sort: "asc",
      });

      const calledUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(calledUrl).toContain("page=2");
      expect(calledUrl).toContain("offset=50");
      expect(calledUrl).toContain("sort=asc");
    });
  });

  describe("chainscanClient.getContractAbi", () => {
    it("should return ABI string on success", async () => {
      const mockAbi = '[{"inputs":[],"name":"name","type":"function"}]';

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: "1",
          message: "OK",
          result: mockAbi,
        }),
      });

      const abi = await chainscanClient.getContractAbi("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045");
      expect(abi).toBe(mockAbi);
    });
  });

  describe("chainscanClient.getTokenSupply", () => {
    it("should return supply string", async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: "1",
          message: "OK",
          result: "1000000000000000000000000",
        }),
      });

      const supply = await chainscanClient.getTokenSupply("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045");
      expect(supply).toBe("1000000000000000000000000");
    });
  });

  describe("error handling", () => {
    it("should throw on API error response", async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: "0",
          message: "Invalid address format",
          result: "Error! Invalid address format",
        }),
      });

      await expect(
        chainscanClient.getContractAbi("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045")
      ).rejects.toThrow(/Invalid address format/);
    });

    it("should throw on HTTP error", async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: false,
        status: 500,
      });

      await expect(
        chainscanClient.getBalance("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045")
      ).rejects.toThrow(/500/);
    });
  });

  describe("chainscanClient.getTokenHolderStats", () => {
    it("should call custom API endpoint and extract .list", async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: 0,
          message: "success",
          result: {
            total: 1,
            list: [{ statTime: "1700000000", holderCount: "42" }],
          },
        }),
      });

      const stats = await chainscanClient.getTokenHolderStats("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045");
      expect(stats).toEqual([{ statTime: "1700000000", holderCount: "42" }]);

      const calledUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(calledUrl).toContain("/statistics/token/holder");
      expect(calledUrl).toContain("contract=");
      expect(calledUrl).not.toContain("contractAddress=");
    });

    it("should send sort as uppercase", async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: 0,
          message: "success",
          result: { total: 0, list: [] },
        }),
      });

      await chainscanClient.getTokenHolderStats("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045", { sort: "asc" });

      const calledUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(calledUrl).toContain("sort=ASC");
    });
  });

  describe("chainscanClient.getTopTokenSenders", () => {
    it("should use correct path /statistics/top/token/sender", async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: 0,
          message: "success",
          result: {
            total: 1,
            list: [{ address: "0xabc", value: "100" }],
          },
        }),
      });

      const data = await chainscanClient.getTopTokenSenders("24h");
      expect(data).toEqual([{ address: "0xabc", value: "100" }]);

      const calledUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(calledUrl).toContain("/statistics/top/token/sender");
    });
  });

  describe("input validation (sync throws)", () => {
    it("should throw on invalid address", () => {
      expect(() => chainscanClient.getBalance("0xinvalid")).toThrow(/Invalid address/);
    });

    it("should throw on invalid tx hash", () => {
      expect(() => chainscanClient.getTxStatus("not-a-hash")).toThrow(/Transaction hash is required|Invalid transaction hash/);
    });

    it("should throw on too many addresses in batch", () => {
      const addresses = Array(21).fill("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045");
      expect(() => chainscanClient.getBalanceMulti(addresses)).toThrow(/Too many addresses/);
    });

    it("should throw on decode with mismatched arrays", () => {
      expect(() =>
        chainscanClient.decodeRaw(
          ["0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"],
          ["0x1234", "0x5678"]
        )
      ).toThrow(/same length/);
    });
  });

  describe("fetchCustomApi {code, message, data} envelope", () => {
    it("should extract data from {code: 0, data: T} response", async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          code: 0,
          message: "success",
          data: [{ hash: "0xabc", abi: "transfer(address,uint256)", decodedData: "", error: "" }],
        }),
      });

      const results = await chainscanClient.decodeByHashes([
        "0x" + "a".repeat(64),
      ]);
      expect(results).toEqual([{ hash: "0xabc", abi: "transfer(address,uint256)", decodedData: "", error: "" }]);
    });
  });
});

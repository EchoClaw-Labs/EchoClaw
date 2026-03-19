import { describe, expect, it, vi } from "vitest";

const mockFetchJson = vi.fn();
vi.mock("../utils/http.js", () => ({
  fetchJson: (...args: unknown[]) => mockFetchJson(...args),
  fetchWithTimeout: vi.fn(),
}));
vi.mock("../config/store.js", () => ({
  loadConfig: () => ({ solana: { jupiterApiKey: "" } }),
}));

const { getPendingInvites } = await import("../chains/solana/send-service.js");

describe("send service", () => {
  it("getPendingInvites unwraps { invites: [...], hasMoreData }", async () => {
    mockFetchJson.mockResolvedValueOnce({
      invites: [
        { invitePDA: "pda1", amount: "1000000000", mint: "So11111111111111111111111111111111111111112", createdAt: "2026-03-14" },
      ],
      hasMoreData: false,
    });

    const invites = await getPendingInvites("walletAddr");
    expect(invites).toHaveLength(1);
    expect(invites[0].invitePDA).toBe("pda1");
  });

  it("getPendingInvites returns empty on error", async () => {
    mockFetchJson.mockRejectedValueOnce(new Error("network"));
    const invites = await getPendingInvites("walletAddr");
    expect(invites).toEqual([]);
  });

  it("getPendingInvites returns empty when invites is null", async () => {
    mockFetchJson.mockResolvedValueOnce({ invites: null, hasMoreData: false });
    const invites = await getPendingInvites("walletAddr");
    expect(invites).toEqual([]);
  });
});

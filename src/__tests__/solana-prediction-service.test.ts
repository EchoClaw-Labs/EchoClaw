import { describe, expect, it, vi } from "vitest";

const mockFetchJson = vi.fn();
vi.mock("../utils/http.js", () => ({
  fetchJson: (...args: unknown[]) => mockFetchJson(...args),
}));
vi.mock("../config/store.js", () => ({
  loadConfig: () => ({ solana: { jupiterApiKey: "" } }),
}));

const { listEvents, getPositions } = await import("../chains/solana/prediction-service.js");

describe("prediction service", () => {
  it("listEvents unwraps { data: [...] } and normalizes fields", async () => {
    mockFetchJson.mockResolvedValueOnce({
      data: [
        {
          eventId: "EVT-1",
          metadata: { title: "Will SOL hit $200?" },
          category: "crypto",
          isLive: true,
          markets: [
            {
              marketId: "MKT-1",
              metadata: { title: "SOL > $200" },
              pricing: { buyYesPriceUsd: 0.65, buyNoPriceUsd: 0.35, volume: 50000 },
            },
          ],
        },
      ],
    });

    const events = await listEvents("crypto");

    expect(events).toHaveLength(1);
    expect(events[0].id).toBe("EVT-1");
    expect(events[0].title).toBe("Will SOL hit $200?");
    expect(events[0].status).toBe("live");
    expect(events[0].markets![0].marketId).toBe("MKT-1");
    expect(events[0].markets![0].buyYesPriceUsd).toBe(0.65);
  });

  it("getPositions unwraps { data: [...] }", async () => {
    mockFetchJson.mockResolvedValueOnce({
      data: [
        { pubkey: "pos1", marketId: "MKT-1", isYes: true, contracts: 10, totalCostUsd: 6.5, valueUsd: 7.0, pnlUsd: 0.5, pnlUsdPercent: 7.7, claimable: false },
      ],
      pagination: { total: 1 },
    });

    const positions = await getPositions("walletAddr");
    expect(positions).toHaveLength(1);
    expect(positions[0].pubkey).toBe("pos1");
  });

  it("listEvents returns empty array when data is missing", async () => {
    mockFetchJson.mockResolvedValueOnce({ data: null });
    const events = await listEvents();
    expect(events).toEqual([]);
  });
});

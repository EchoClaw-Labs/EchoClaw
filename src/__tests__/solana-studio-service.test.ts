import { describe, expect, it, vi } from "vitest";

const mockLoadConfig = vi.fn();
vi.mock("../utils/http.js", () => ({
  fetchJson: vi.fn(),
  fetchWithTimeout: vi.fn(),
}));
vi.mock("../config/store.js", () => ({
  loadConfig: () => mockLoadConfig(),
}));

const { ErrorCodes } = await import("../errors.js");

describe("studio service", () => {
  it("studioGetFees throws when no API key is set", async () => {
    mockLoadConfig.mockReturnValue({ solana: { jupiterApiKey: "" } });

    const { studioGetFees } = await import("../chains/solana/studio-service.js");

    await expect(studioGetFees("some-mint")).rejects.toMatchObject({
      code: ErrorCodes.SOLANA_STUDIO_CLAIM_FAILED,
    });
  });

  it("studioCreateToken throws when no API key is set", async () => {
    mockLoadConfig.mockReturnValue({ solana: { jupiterApiKey: "" } });

    const { studioCreateToken } = await import("../chains/solana/studio-service.js");

    await expect(
      studioCreateToken(new Uint8Array(64), {
        tokenName: "Test",
        tokenSymbol: "TST",
        imagePath: "/nonexistent.png",
        initialMarketCap: 16000,
        migrationMarketCap: 69000,
      }),
    ).rejects.toMatchObject({
      code: ErrorCodes.SOLANA_STUDIO_CREATE_FAILED,
    });
  });
});

import { describe, it, expect, beforeEach, vi } from "vitest";

const mockIsHeadless = vi.fn(() => false);
const mockWriteStderr = vi.fn((_: string) => {});

vi.mock("../utils/output.js", () => ({
  isHeadless: () => mockIsHeadless(),
  writeStderr: (text: string) => mockWriteStderr(text),
}));

const { renderBatBanner, BAT_ASCII_LINES } = await import("../utils/banner.js");

describe("renderBatBanner", () => {
  beforeEach(() => {
    mockIsHeadless.mockReset();
    mockWriteStderr.mockReset();
    vi.useRealTimers();
  });

  it("returns false and prints nothing in headless mode", async () => {
    mockIsHeadless.mockReturnValue(true);

    const rendered = await renderBatBanner();

    expect(rendered).toBe(false);
    expect(mockWriteStderr).not.toHaveBeenCalled();
  });

  it("prints bat lines plus branding and separator", async () => {
    mockIsHeadless.mockReturnValue(false);

    const rendered = await renderBatBanner({ animated: false });

    expect(rendered).toBe(true);
    // bat lines + empty + branding + separator + trailing empty
    expect(mockWriteStderr).toHaveBeenCalledTimes(BAT_ASCII_LINES.length + 4);

    const outputs = mockWriteStderr.mock.calls.map((call) => call[0]);
    expect(outputs[BAT_ASCII_LINES.length]).toBe("");
    expect(outputs[BAT_ASCII_LINES.length + 1]).toContain("EchoClaw");
    expect(outputs[BAT_ASCII_LINES.length + 1]).toContain("0G Network");
    expect(outputs.at(-1)).toBe("");
  });

  it("renders subtitle and description when provided", async () => {
    mockIsHeadless.mockReturnValue(false);

    await renderBatBanner({ animated: false, subtitle: "Test Wizard", description: "A description." });

    // bat lines + empty + branding + separator + subtitle + description + trailing empty
    expect(mockWriteStderr).toHaveBeenCalledTimes(BAT_ASCII_LINES.length + 6);

    const outputs = mockWriteStderr.mock.calls.map((call) => call[0]);
    expect(outputs[BAT_ASCII_LINES.length + 3]).toContain("Test Wizard");
    expect(outputs[BAT_ASCII_LINES.length + 4]).toContain("A description.");
  });

  it("completes animated rendering with timers", async () => {
    mockIsHeadless.mockReturnValue(false);
    vi.useFakeTimers();

    let done = false;
    const promise = renderBatBanner({ animated: true, delayMs: 1 }).then(() => {
      done = true;
    });

    await Promise.resolve();
    expect(done).toBe(false);

    await vi.runAllTimersAsync();
    await promise;

    expect(done).toBe(true);
    // bat lines + branding block via writeStderr (ANSI frames go through process.stderr.write)
    expect(mockWriteStderr).toHaveBeenCalledTimes(BAT_ASCII_LINES.length + 4);
  });

});

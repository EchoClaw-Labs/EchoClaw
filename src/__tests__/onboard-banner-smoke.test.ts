import { describe, it, expect, beforeEach, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const prompt = vi.fn();
  const renderBatBanner = vi.fn(async () => true);
  const writeStderr = vi.fn();
  const successBox = vi.fn();

  const makeStep = () => ({
    name: "Mock Step",
    description: "mock",
    detect: () => ({ configured: false, summary: "Not configured" }),
    run: async () => ({ action: "configured" as const, message: "ok" }),
  });

  return {
    prompt,
    renderBatBanner,
    writeStderr,
    successBox,
    makeStep,
  };
});

vi.mock("inquirer", () => ({
  default: {
    prompt: (...args: unknown[]) => mocks.prompt(...args),
  },
}));

vi.mock("../utils/output.js", () => ({
  isHeadless: () => false,
  writeStderr: (text: string) => mocks.writeStderr(text),
}));

vi.mock("../utils/banner.js", () => ({
  renderBatBanner: () => mocks.renderBatBanner(),
}));

vi.mock("../utils/ui.js", () => ({
  colors: {
    muted: (s: string) => s,
    success: (s: string) => s,
    warn: (s: string) => s,
    info: (s: string) => s,
    bold: (s: string) => s,
    error: (s: string) => s,
  },
  successBox: (title: string, content: string) => mocks.successBox(title, content),
}));

vi.mock("../commands/onboard/steps/config.js", () => ({ configStep: mocks.makeStep() }));
vi.mock("../commands/onboard/steps/openclaw.js", () => ({ openclawStep: mocks.makeStep() }));
vi.mock("../commands/onboard/steps/password.js", () => ({ passwordStep: mocks.makeStep() }));
vi.mock("../commands/onboard/steps/webhooks.js", () => ({ webhooksStep: mocks.makeStep() }));
vi.mock("../commands/onboard/steps/wallet.js", () => ({ walletStep: mocks.makeStep() }));
vi.mock("../commands/onboard/steps/compute.js", () => ({ computeStep: mocks.makeStep() }));
vi.mock("../commands/onboard/steps/monitor.js", () => ({ monitorStep: mocks.makeStep() }));
vi.mock("../commands/onboard/steps/gateway.js", () => ({ gatewayStep: mocks.makeStep() }));

const { createOnboardCommand } = await import("../commands/onboard/index.js");

describe("onboard banner smoke", () => {
  beforeEach(() => {
    mocks.prompt.mockReset();
    mocks.renderBatBanner.mockClear();
    mocks.writeStderr.mockClear();
    mocks.successBox.mockClear();

    // Select OpenClaw in meta-selector, then skip every step quickly.
    mocks.prompt.mockResolvedValue({ target: "openclaw", proceed: false, action: "skip", cont: true });
  });

  it("renders bat banner in interactive onboard flow", async () => {
    const command = createOnboardCommand();
    command.exitOverride();

    await command.parseAsync([], { from: "user" });

    expect(mocks.renderBatBanner).toHaveBeenCalledTimes(2);
  });
});

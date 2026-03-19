import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const prompt = vi.fn();
  const renderBatBanner = vi.fn(async () => true);
  const writeStderr = vi.fn();
  const runClaudeSetup = vi.fn(async () => {});

  return {
    prompt,
    renderBatBanner,
    writeStderr,
    runClaudeSetup,
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
  successBox: vi.fn(),
}));

vi.mock("../commands/claude/setup-cmd.js", () => ({
  runClaudeSetup: () => mocks.runClaudeSetup(),
}));

vi.mock("../commands/onboard/steps/config.js", () => ({ configStep: {} }));
vi.mock("../commands/onboard/steps/openclaw.js", () => ({ openclawStep: {} }));
vi.mock("../commands/onboard/steps/password.js", () => ({ passwordStep: {} }));
vi.mock("../commands/onboard/steps/webhooks.js", () => ({ webhooksStep: {} }));
vi.mock("../commands/onboard/steps/wallet.js", () => ({ walletStep: {} }));
vi.mock("../commands/onboard/steps/compute.js", () => ({ computeStep: {} }));
vi.mock("../commands/onboard/steps/monitor.js", () => ({ monitorStep: {} }));
vi.mock("../commands/onboard/steps/gateway.js", () => ({ gatewayStep: {} }));

const { createOnboardCommand } = await import("../commands/onboard/index.js");

describe("onboard meta-selector", () => {
  beforeEach(() => {
    mocks.prompt.mockReset();
    mocks.renderBatBanner.mockClear();
    mocks.writeStderr.mockClear();
    mocks.runClaudeSetup.mockClear();
  });

  it("delegates Claude selection to the dedicated Claude wizard", async () => {
    mocks.prompt.mockResolvedValue({ target: "claude" });

    const command = createOnboardCommand();
    command.exitOverride();

    await command.parseAsync([], { from: "user" });

    expect(mocks.runClaudeSetup).toHaveBeenCalledTimes(1);
  });
});

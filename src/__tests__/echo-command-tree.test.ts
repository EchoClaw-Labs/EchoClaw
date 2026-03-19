import { Command } from "commander";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  runEchoMenu: vi.fn(async () => {}),
  runHeadlessConnect: vi.fn(async () => {}),
  runHeadlessFund: vi.fn(async () => {}),
  printVerify: vi.fn(async () => {}),
  printStatus: vi.fn(async () => {}),
  printDoctor: vi.fn(async () => {}),
  writeSupportReportToFile: vi.fn(async () => {}),
}));

vi.mock("../utils/output.js", () => ({
  isHeadless: () => false,
}));

vi.mock("../commands/echo/menu.js", () => ({
  runEchoMenu: () => mocks.runEchoMenu(),
}));

vi.mock("../commands/echo/connect.js", () => ({
  runHeadlessConnect: (options: unknown) => mocks.runHeadlessConnect(options),
}));

vi.mock("../commands/echo/fund.js", () => ({
  runHeadlessFund: (options: unknown) => mocks.runHeadlessFund(options),
}));

vi.mock("../commands/echo/status.js", () => ({
  printVerify: (json: boolean, runtime?: string, fresh?: boolean) => mocks.printVerify(json, runtime, fresh),
  printStatus: (json: boolean, fresh?: boolean) => mocks.printStatus(json, fresh),
  printDoctor: (json: boolean, fresh?: boolean) => mocks.printDoctor(json, fresh),
  writeSupportReportToFile: (json?: boolean) => mocks.writeSupportReportToFile(json),
}));

vi.mock("../commands/echo/wallet.js", () => ({
  createWalletHubSubcommand: () => new Command("wallet").description("wallet"),
}));

vi.mock("../commands/claude/index.js", () => ({
  createClaudeCommand: () => new Command("claude").description("claude"),
}));

const { createEchoCommand } = await import("../commands/echo/index.js");

describe("echo command tree", () => {
  beforeEach(() => {
    mocks.runEchoMenu.mockClear();
    mocks.runHeadlessConnect.mockClear();
    mocks.runHeadlessFund.mockClear();
    mocks.printVerify.mockClear();
    mocks.printStatus.mockClear();
    mocks.printDoctor.mockClear();
    mocks.writeSupportReportToFile.mockClear();
  });

  it("registers the task-first subcommands", () => {
    const root = createEchoCommand();
    const commandNames = root.commands.map((command) => command.name());

    expect(commandNames).toEqual(expect.arrayContaining([
      "connect",
      "fund",
      "verify",
      "status",
      "doctor",
      "support-report",
      "explore",
      "advanced",
      "wallet",
      "claude",
    ]));
  });

  it("runs the interactive launcher from the root command", async () => {
    const command = createEchoCommand();
    command.exitOverride();

    await command.parseAsync([], { from: "user" });

    expect(mocks.runEchoMenu).toHaveBeenCalledTimes(1);
    expect(mocks.runHeadlessConnect).not.toHaveBeenCalled();
    expect(mocks.runHeadlessFund).not.toHaveBeenCalled();
  });

  it("dispatches connect plans to the headless orchestrator", async () => {
    const command = createEchoCommand();
    command.exitOverride();

    await command.parseAsync(["connect", "--plan", "--runtime", "claude-code", "--json"], { from: "user" });

    expect(mocks.runHeadlessConnect).toHaveBeenCalledTimes(1);
    expect(mocks.runHeadlessConnect).toHaveBeenCalledWith(expect.objectContaining({
      runtime: "claude-code",
      plan: true,
      json: true,
    }));
    expect(mocks.runEchoMenu).not.toHaveBeenCalled();
  });

  it("dispatches fund apply calls to the headless orchestrator", async () => {
    const command = createEchoCommand();
    command.exitOverride();

    await command.parseAsync(["fund", "--apply", "--provider", "0xabc", "--amount", "1", "--json"], { from: "user" });

    expect(mocks.runHeadlessFund).toHaveBeenCalledTimes(1);
    expect(mocks.runHeadlessFund).toHaveBeenCalledWith(expect.objectContaining({
      provider: "0xabc",
      amount: "1",
      apply: true,
      json: true,
    }));
  });

  it("routes verification and diagnostics commands through status helpers", async () => {
    const command = createEchoCommand();
    command.exitOverride();

    await command.parseAsync(["verify", "--runtime", "openclaw", "--json"], { from: "user" });
    await command.parseAsync(["status", "--fresh", "--json"], { from: "user" });
    await command.parseAsync(["doctor", "--fresh", "--json"], { from: "user" });
    await command.parseAsync(["support-report", "--json"], { from: "user" });

    expect(mocks.printVerify).toHaveBeenCalledWith(true, "openclaw", true);
    expect(mocks.printStatus).toHaveBeenCalledWith(true, true);
    expect(mocks.printDoctor).toHaveBeenCalledWith(true, true);
    expect(mocks.writeSupportReportToFile).toHaveBeenCalledWith(true);
  });
});

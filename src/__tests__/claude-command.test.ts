import { Command } from "commander";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const runClaudeSetup = vi.fn(async () => {});
  const proxyAction = vi.fn(async () => {});
  const configAction = vi.fn(async () => {});

  return {
    runClaudeSetup,
    proxyAction,
    configAction,
  };
});

vi.mock("../commands/claude/setup-cmd.js", () => ({
  runClaudeSetup: () => mocks.runClaudeSetup(),
}));

vi.mock("../commands/claude/proxy-cmd.js", () => ({
  createProxySubcommand: () =>
    new Command("proxy")
      .description("proxy")
      .action(() => mocks.proxyAction()),
}));

vi.mock("../commands/claude/config-cmd.js", () => ({
  createConfigSubcommand: () =>
    new Command("config")
      .description("config")
      .action(() => mocks.configAction()),
}));

const { createClaudeCommand } = await import("../commands/claude/index.js");

describe("claude command", () => {
  beforeEach(() => {
    mocks.runClaudeSetup.mockClear();
    mocks.proxyAction.mockClear();
    mocks.configAction.mockClear();
  });

  it("runs the Claude wizard from the root command", async () => {
    const command = createClaudeCommand();
    command.exitOverride();

    await command.parseAsync([], { from: "user" });

    expect(mocks.runClaudeSetup).toHaveBeenCalledTimes(1);
    expect(mocks.proxyAction).not.toHaveBeenCalled();
    expect(mocks.configAction).not.toHaveBeenCalled();
  });

  it("dispatches the proxy subcommand without running the wizard", async () => {
    const command = createClaudeCommand();
    command.exitOverride();

    await command.parseAsync(["proxy"], { from: "user" });

    expect(mocks.proxyAction).toHaveBeenCalledTimes(1);
    expect(mocks.runClaudeSetup).not.toHaveBeenCalled();
  });

  it("dispatches the config subcommand without running the wizard", async () => {
    const command = createClaudeCommand();
    command.exitOverride();

    await command.parseAsync(["config"], { from: "user" });

    expect(mocks.configAction).toHaveBeenCalledTimes(1);
    expect(mocks.runClaudeSetup).not.toHaveBeenCalled();
  });

  it("does not expose the removed setup subcommand", async () => {
    const command = createClaudeCommand();
    command.exitOverride();

    await expect(command.parseAsync(["setup"], { from: "user" })).rejects.toMatchObject({
      code: "commander.excessArguments",
    });

    expect(mocks.runClaudeSetup).not.toHaveBeenCalled();
    expect(mocks.proxyAction).not.toHaveBeenCalled();
    expect(mocks.configAction).not.toHaveBeenCalled();
  });
});

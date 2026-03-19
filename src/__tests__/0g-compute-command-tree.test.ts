import { Command } from "commander";
import { describe, expect, it, vi } from "vitest";

vi.mock("../commands/0g-compute/providers.js", () => ({
  createProvidersSubcommand: () => new Command("providers"),
}));

vi.mock("../commands/0g-compute/ledger.js", () => ({
  createLedgerSubcommand: () => new Command("ledger"),
}));

vi.mock("../commands/0g-compute/provider.js", () => ({
  createProviderSubcommand: () => new Command("provider"),
}));

vi.mock("../commands/0g-compute/api-key.js", () => ({
  createApiKeySubcommand: () => new Command("api-key"),
}));

vi.mock("../commands/0g-compute/monitor-cmd.js", () => ({
  createMonitorSubcommand: () => new Command("monitor"),
}));

const { create0gComputeCommand } = await import("../commands/0g-compute/index.js");

describe("0g-compute command tree", () => {
  it("registers only the shared compute primitives", () => {
    const root = create0gComputeCommand();
    const commandNames = root.commands.map((command) => command.name());

    expect(commandNames).toEqual(expect.arrayContaining([
      "providers",
      "ledger",
      "provider",
      "api-key",
      "monitor",
      "setup",
    ]));
    expect(commandNames).not.toContain("openclaw");
    expect(commandNames).not.toContain("wizard");
  });
});

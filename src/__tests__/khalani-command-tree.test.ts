import { describe, expect, it } from "vitest";
import { createKhalaniCommand } from "../commands/khalani/index.js";

describe("khalani command tree", () => {
  it("registers the expected first-slice subcommands", () => {
    const root = createKhalaniCommand();
    const commandNames = root.commands.map((command) => command.name());

    expect(commandNames).toEqual(expect.arrayContaining([
      "chains",
      "tokens",
      "quote",
      "bridge",
      "orders",
      "order",
    ]));
  });
});

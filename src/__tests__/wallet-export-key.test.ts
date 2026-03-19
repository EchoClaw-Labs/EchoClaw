import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { Command } from "commander";
import { createWalletCommand } from "../commands/wallet/index.js";
import { ErrorCodes } from "../errors.js";
import { setJsonMode } from "../utils/output.js";

function setTTY(stream: NodeJS.WriteStream, isTTY: boolean | undefined): void {
  Object.defineProperty(stream, "isTTY", {
    value: isTTY,
    configurable: true,
  });
}

describe("wallet export-key stdout guard", () => {
  let originalStdoutTTY: boolean | undefined;
  let originalStderrTTY: boolean | undefined;

  beforeEach(() => {
    originalStdoutTTY = process.stdout.isTTY;
    originalStderrTTY = process.stderr.isTTY;
    setJsonMode(false);
  });

  afterEach(() => {
    setTTY(process.stdout, originalStdoutTTY);
    setTTY(process.stderr, originalStderrTTY);
    setJsonMode(false);
  });

  it("blocks --stdout when stdout is piped, even if stderr is TTY", async () => {
    setTTY(process.stderr, true);
    setTTY(process.stdout, false);

    const wallet = createWalletCommand();
    wallet.exitOverride();
    const exportKeyCmd = wallet.commands.find((cmd: Command) => cmd.name() === "export-key");
    expect(exportKeyCmd).toBeDefined();
    exportKeyCmd!.exitOverride();

    await expect(
      exportKeyCmd!.parseAsync(["--stdout", "--i-understand"], { from: "user" })
    ).rejects.toMatchObject({ code: ErrorCodes.EXPORT_BLOCKED_HEADLESS });
  });
});

import { Command } from "commander";
import { describe, it, expect, vi } from "vitest";
import {
  runAutoUpdateBootstrap,
  shouldSkipAutoUpdateBootstrap,
} from "../update/cli-bootstrap.js";

interface TestCommand {
  name(): string;
  parent?: TestCommand | null;
}

function makeCommandPath(...names: string[]): TestCommand {
  let parent: TestCommand | null = null;

  for (const name of names) {
    const current: TestCommand = {
      name: () => name,
      parent,
    };
    parent = current;
  }

  if (parent == null) {
    throw new Error("expected at least one command name");
  }

  return parent;
}

async function parseCommanderPaths(argv: string[]): Promise<{
  thisCommand: Command;
  actionCommand: Command;
}> {
  const program = new Command("echoclaw");
  const update = new Command("update");
  const updateStatus = new Command("status").action(() => {});
  update.addCommand(updateStatus);

  const wallet = new Command("wallet");
  const walletBalance = new Command("balance").action(() => {});
  wallet.addCommand(walletBalance);

  program.addCommand(update);
  program.addCommand(wallet);

  let seen: { thisCommand: Command; actionCommand: Command } | null = null;
  program.hook("preAction", (thisCommand, actionCommand) => {
    seen = { thisCommand, actionCommand };
  });

  await program.parseAsync(["node", "echoclaw", ...argv]);

  if (seen == null) {
    throw new Error("expected preAction hook to run");
  }

  return seen;
}

describe("shouldSkipAutoUpdateBootstrap", () => {
  it("does not skip echo commands", () => {
    const actionCommand = makeCommandPath("echo");
    expect(shouldSkipAutoUpdateBootstrap(actionCommand, actionCommand)).toBe(false);
  });

  it("does not skip echo subtree commands", () => {
    const actionCommand = makeCommandPath("echo", "agent", "start");
    expect(shouldSkipAutoUpdateBootstrap(actionCommand, actionCommand)).toBe(false);
  });

  it("skips the entire update subtree", () => {
    const actionCommand = makeCommandPath("update", "stop");
    expect(shouldSkipAutoUpdateBootstrap(actionCommand, actionCommand)).toBe(true);
  });

  it("does not skip unrelated nested commands that happen to share a leaf name", () => {
    const actionCommand = makeCommandPath("0g-compute", "provider");
    expect(shouldSkipAutoUpdateBootstrap(actionCommand, actionCommand)).toBe(false);
  });

  it("does not skip ordinary commands", () => {
    const actionCommand = makeCommandPath("wallet", "balance");
    expect(shouldSkipAutoUpdateBootstrap(actionCommand, actionCommand)).toBe(false);
  });

  it("skips update subtree for real Commander root + leaf commands", async () => {
    const { thisCommand, actionCommand } = await parseCommanderPaths(["update", "status"]);
    expect(shouldSkipAutoUpdateBootstrap(thisCommand, actionCommand)).toBe(true);
  });

  it("does not skip ordinary Commander root + leaf commands", async () => {
    const { thisCommand, actionCommand } = await parseCommanderPaths(["wallet", "balance"]);
    expect(shouldSkipAutoUpdateBootstrap(thisCommand, actionCommand)).toBe(false);
  });
});

describe("runAutoUpdateBootstrap", () => {
  it("runs retirement, default seeding, and update check for ordinary commands in order", async () => {
    const callOrder: string[] = [];
    const thisCommand = makeCommandPath("echoclaw");
    const actionCommand = makeCommandPath("wallet", "balance");

    const ran = await runAutoUpdateBootstrap({
      thisCommand,
      actionCommand,
      retireLegacyUpdateDaemon: async () => {
        callOrder.push("retire");
      },
      ensureAutoUpdateDefault: () => {
        callOrder.push("seed");
      },
      startUpdateCheck: () => {
        callOrder.push("check");
      },
    });

    expect(ran).toBe(true);
    expect(callOrder).toEqual(["retire", "seed", "check"]);
  });

  it("skips bootstrap side effects for update root", async () => {
    const thisCommand = makeCommandPath("echoclaw");
    const retireLegacyUpdateDaemon = vi.fn(async () => undefined);
    const ensureAutoUpdateDefault = vi.fn();
    const startUpdateCheck = vi.fn();

    const ran = await runAutoUpdateBootstrap({
      thisCommand,
      actionCommand: makeCommandPath("update", "status"),
      retireLegacyUpdateDaemon,
      ensureAutoUpdateDefault,
      startUpdateCheck,
    });

    expect(ran).toBe(false);
    expect(retireLegacyUpdateDaemon).not.toHaveBeenCalled();
    expect(ensureAutoUpdateDefault).not.toHaveBeenCalled();
    expect(startUpdateCheck).not.toHaveBeenCalled();
  });

  it("runs bootstrap for echo commands", async () => {
    const callOrder: string[] = [];
    const thisCommand = makeCommandPath("echoclaw");

    const ran = await runAutoUpdateBootstrap({
      thisCommand,
      actionCommand: makeCommandPath("echo", "status"),
      retireLegacyUpdateDaemon: async () => { callOrder.push("retire"); },
      ensureAutoUpdateDefault: () => { callOrder.push("seed"); },
      startUpdateCheck: () => { callOrder.push("check"); },
    });

    expect(ran).toBe(true);
    expect(callOrder).toEqual(["retire", "seed", "check"]);
  });

  it("skips bootstrap side effects for real Commander update status", async () => {
    const { thisCommand, actionCommand } = await parseCommanderPaths(["update", "status"]);
    const retireLegacyUpdateDaemon = vi.fn(async () => undefined);
    const ensureAutoUpdateDefault = vi.fn();
    const startUpdateCheck = vi.fn();

    const ran = await runAutoUpdateBootstrap({
      thisCommand,
      actionCommand,
      retireLegacyUpdateDaemon,
      ensureAutoUpdateDefault,
      startUpdateCheck,
    });

    expect(ran).toBe(false);
    expect(retireLegacyUpdateDaemon).not.toHaveBeenCalled();
    expect(ensureAutoUpdateDefault).not.toHaveBeenCalled();
    expect(startUpdateCheck).not.toHaveBeenCalled();
  });
});

interface CommandLike {
  name(): string;
  parent?: CommandLike | null;
}

const SKIP_AUTO_UPDATE_BOOTSTRAP_ROOT_COMMANDS = new Set(["update"]);

interface RetireLegacyUpdateDaemonLike {
  (): Promise<unknown> | unknown;
}

interface RunAutoUpdateBootstrapOptions {
  thisCommand: CommandLike;
  actionCommand: CommandLike;
  retireLegacyUpdateDaemon: RetireLegacyUpdateDaemonLike;
  ensureAutoUpdateDefault: () => void;
  startUpdateCheck: () => void;
}

function getCommandPathNames(command: CommandLike): string[] {
  const names: string[] = [];
  let current: CommandLike | null | undefined = command;

  while (current) {
    names.push(current.name());
    current = current.parent;
  }

  return names.reverse();
}

function getSharedPrefixLength(a: string[], b: string[]): number {
  let idx = 0;
  while (idx < Math.min(a.length, b.length) && a[idx] === b[idx]) {
    idx += 1;
  }
  return idx;
}

function getActionablePathNames(
  thisCommand: CommandLike,
  actionCommand: CommandLike,
): string[] {
  const thisPathNames = getCommandPathNames(thisCommand);
  const actionPathNames = getCommandPathNames(actionCommand);
  const sharedPrefixLength = getSharedPrefixLength(thisPathNames, actionPathNames);
  const actionablePathNames = actionPathNames.slice(sharedPrefixLength);

  return actionablePathNames.length > 0 ? actionablePathNames : actionPathNames;
}

export function shouldSkipAutoUpdateBootstrap(
  thisCommand: CommandLike,
  actionCommand: CommandLike,
): boolean {
  const pathNames = getActionablePathNames(thisCommand, actionCommand);
  const rootCommandName = pathNames[0];
  return rootCommandName != null && SKIP_AUTO_UPDATE_BOOTSTRAP_ROOT_COMMANDS.has(rootCommandName);
}

export async function runAutoUpdateBootstrap({
  thisCommand,
  actionCommand,
  retireLegacyUpdateDaemon,
  ensureAutoUpdateDefault,
  startUpdateCheck,
}: RunAutoUpdateBootstrapOptions): Promise<boolean> {
  if (shouldSkipAutoUpdateBootstrap(thisCommand, actionCommand)) {
    return false;
  }

  await retireLegacyUpdateDaemon();
  ensureAutoUpdateDefault();
  startUpdateCheck();
  return true;
}

import inquirer from "inquirer";
import { renderBatBanner } from "../../utils/banner.js";
import { isHeadless, writeStderr } from "../../utils/output.js";
import { EchoError, ErrorCodes } from "../../errors.js";
import type { EchoTask, LauncherItem } from "./types.js";
import { ADVANCED_ITEMS, EXPLORE_ITEMS } from "./catalog.js";
import { describeLauncherItem } from "./assessment.js";
import { buildEchoSnapshot } from "./state.js";
import { printHomeSummary } from "./status.js";
import { runInteractiveConnect } from "./connect.js";
import { runInteractiveFund } from "./fund.js";
import { runInteractiveBridge } from "./bridge.js";
import { runInteractiveWallet } from "./wallet.js";
import { runInteractiveManage } from "./manage.js";
import { runInteractiveEchoClaw } from "./echoclaw.js";
import { colors, infoBox, successBox } from "../../utils/ui.js";
import { isDaemonAlive } from "../../utils/daemon-spawn.js";
import { LAUNCHER_PID_FILE, LAUNCHER_DEFAULT_PORT } from "../../config/paths.js";

async function runLauncherList(title: string, items: LauncherItem[]): Promise<void> {
  while (true) {
    const { itemId } = await inquirer.prompt([{
      type: "list",
      name: "itemId",
      message: title,
      choices: [
        ...items.map((item) => ({
          name: `${item.title} [${item.badge}]`,
          value: item.id,
        })),
        { name: "Back", value: "back" },
      ],
    }]);

    if (itemId === "back") return;
    const item = items.find((entry) => entry.id === itemId);
    if (!item) continue;
    infoBox(item.title, describeLauncherItem(item));
  }
}

export async function runEchoMenu(): Promise<void> {
  if (isHeadless()) {
    throw new EchoError(
      ErrorCodes.ONBOARD_REQUIRES_TTY,
      "The `echoclaw echo` launcher requires an interactive terminal.",
      "Use `echoclaw echo status --json`, `echoclaw echo doctor --json`, or the task subcommands for automation.",
    );
  }

  writeStderr("");
  await renderBatBanner({
    subtitle: "Echo Launcher",
    description: "Connect your AI, fund it with 0G, explore safely, and fix setup from one menu.",
  });

  while (true) {
    const snapshot = await buildEchoSnapshot({ includeReadiness: false });
    printHomeSummary(snapshot);

    const { action } = await inquirer.prompt([{
      type: "list",
      name: "action",
      message: "What do you want to do?",
      choices: [
        { name: "Open Launcher (browser)", value: "launcher" },
        { name: "Run EchoClaw Agent locally", value: "echoclaw" },
        { name: "Connect my AI", value: "connect" },
        { name: "Fund my AI in 0G", value: "fund" },
        { name: "Bridge / Cross-Chain", value: "bridge" },
        { name: "Explore Echo", value: "explore" },
        { name: "Wallet & Keys", value: "wallet" },
        { name: "Manage / Fix", value: "manage" },
        { name: "Advanced", value: "advanced" },
        { name: "Exit", value: "exit" },
      ],
    }]);

    const task = action as EchoTask | "launcher" | "echoclaw";
    if (task === "exit") return;

    if (task === "launcher") {
      const alreadyRunning = isDaemonAlive(LAUNCHER_PID_FILE);
      if (!alreadyRunning) {
        const { spawnLauncher } = await import("../../utils/daemon-spawn.js");
        const result = spawnLauncher();
        if (result.status === "spawn_failed") {
          infoBox("Launcher", `Failed to start: ${result.error}`);
          continue;
        }
      }
      const url = `http://127.0.0.1:${LAUNCHER_DEFAULT_PORT}`;
      const { openLauncherInBrowser } = await import("./launcher-cmd.js");
      await openLauncherInBrowser(LAUNCHER_DEFAULT_PORT);
      successBox("Launcher", `${alreadyRunning ? "Already running" : "Started"}\nURL: ${url}`);
      continue;
    }
    if (task === "echoclaw") {
      await runInteractiveEchoClaw();
    } else if (task === "connect") {
      await runInteractiveConnect();
    } else if (task === "fund") {
      await runInteractiveFund();
    } else if (task === "bridge") {
      await runInteractiveBridge();
    } else if (task === "explore") {
      await runLauncherList("Explore Echo", EXPLORE_ITEMS);
    } else if (task === "wallet") {
      await runInteractiveWallet();
    } else if (task === "manage") {
      await runInteractiveManage();
    } else if (task === "advanced") {
      await runLauncherList("Advanced", ADVANCED_ITEMS);
    } else {
      infoBox("Unknown", colors.warn("Unsupported action."));
    }
  }
}

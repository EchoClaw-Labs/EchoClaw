import inquirer from "inquirer";
import { runOpenclawOnboard } from "../onboard/index.js";
import { runClaudeManageMenu } from "./claude-manage.js";
import { runInteractiveConnect } from "./connect.js";
import { runInteractiveFund } from "./fund.js";
import { printDoctor, printStatus, printVerify, writeSupportReportToFile } from "./status.js";

export async function runInteractiveManage(): Promise<void> {
  while (true) {
    const { action } = await inquirer.prompt([{
      type: "list",
      name: "action",
      message: "Manage / Fix",
      choices: [
        { name: "Resume setup", value: "resume" },
        { name: "Verify it works now", value: "verify" },
        { name: "Doctor", value: "doctor" },
        { name: "Status", value: "status" },
        { name: "Generate support report", value: "support" },
        { name: "Refresh from network", value: "refresh" },
        { name: "Fix Claude", value: "claude" },
        { name: "Fix OpenClaw", value: "openclaw" },
        { name: "Fix skill linking", value: "skills" },
        { name: "Fix compute funding", value: "fund" },
        { name: "Back", value: "back" },
      ],
    }]);

    if (action === "back") return;
    if (action === "resume") {
      await runInteractiveConnect();
    } else if (action === "verify") {
      await printVerify(false);
    } else if (action === "doctor") {
      await printDoctor(false);
    } else if (action === "status") {
      await printStatus(false);
    } else if (action === "support") {
      await writeSupportReportToFile(false);
    } else if (action === "refresh") {
      await printStatus(false, true);
    } else if (action === "claude") {
      await runClaudeManageMenu();
    } else if (action === "openclaw") {
      await runOpenclawOnboard();
    } else if (action === "skills") {
      await runInteractiveConnect();
    } else if (action === "fund") {
      await runInteractiveFund();
    }
  }
}

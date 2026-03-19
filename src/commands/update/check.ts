import { Command } from "commander";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { respond } from "../../utils/respond.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export function createCheckSubcommand(): Command {
  return new Command("check")
    .description("Check for updates (one-shot, no daemon)")
    .option("--json", "JSON output")
    .action(async () => {
      const pkg = JSON.parse(
        readFileSync(join(__dirname, "../../../package.json"), "utf-8"),
      );

      const { checkForUpdates } = await import("../../update/updater.js");
      const result = await checkForUpdates(pkg.version, { forceCheck: true, readOnly: true });

      respond({
        data: {
          currentVersion: result.currentVersion,
          latestVersion: result.latestVersion,
          isNewer: result.isNewer,
          action: result.action,
        },
        ui: {
          type: result.isNewer ? "warn" : "success",
          title: "Update Check",
          body: result.isNewer
            ? `New version available: ${result.latestVersion} (current: ${result.currentVersion})\nRun: npm i -g @echoclaw/echo@latest`
            : `Up to date (${result.currentVersion})`,
        },
      });
    });
}

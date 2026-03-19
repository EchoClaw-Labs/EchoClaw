import { Command } from "commander";
import { getAutoUpdatePreference, setAutoUpdatePreference } from "../../update/auto-update-preference.js";
import { detectLegacyUpdateArtifacts, retireLegacyUpdateDaemon } from "../../update/legacy-runtime.js";
import { UPDATE_CHECK_FILE, loadUpdateCheckState } from "../../update/updater.js";
import { respond } from "../../utils/respond.js";

function formatIsoTime(timestampMs: number | undefined): string | null {
  if (typeof timestampMs !== "number") return null;
  return new Date(timestampMs).toISOString();
}

export function createEnableSubcommand(): Command {
  return new Command("enable")
    .alias("start")
    .description("Enable auto-update on CLI use, including headless")
    .option("--daemon", "Legacy compatibility option (ignored)")
    .option("--interval <sec>", "Legacy compatibility option (ignored)")
    .option("--json", "JSON output")
    .action(async (options: { daemon?: boolean; interval?: string }) => {
      const write = setAutoUpdatePreference(true);
      const cleanup = await retireLegacyUpdateDaemon({ waitMs: 1000 });
      const preference = getAutoUpdatePreference();
      const legacyOptionsIgnored = Boolean(options.daemon || options.interval);
      const warningLines: string[] = [];

      if (cleanup.final.daemonRunning) {
        warningLines.push("legacy update daemon is still running");
      }
      if (cleanup.warnings.length > 0) {
        warningLines.push(...cleanup.warnings);
      }
      if (preference.source === "disable-flag") {
        warningLines.push("ECHO_DISABLE_UPDATE_CHECK=1 still disables checks until unset");
      }
      if (legacyOptionsIgnored) {
        warningLines.push("legacy --daemon/--interval flags were ignored");
      }

      const lines = [
        preference.source === "disable-flag"
          ? "Auto-update preference was saved, but checks remain disabled by ECHO_DISABLE_UPDATE_CHECK=1."
          : "Auto-update will run on CLI use, including headless.",
        `Saved to: ${write}`,
        "Update daemon is no longer used.",
      ];
      if (cleanup.final.daemonRunning) {
        lines.push("Legacy update daemon cleanup is incomplete. Review status output.");
      }
      if (legacyOptionsIgnored) {
        lines.push("Legacy flags --daemon/--interval are accepted but ignored.");
      }

      respond({
        data: {
          enabled: preference.enabled,
          effectiveEnabled: preference.enabled,
          source: preference.source,
          explicit: preference.explicit,
          value: preference.value,
          envPath: write,
          legacyOptionsIgnored,
          daemonUsed: false,
          legacyCleanup: {
            detected: cleanup.initial.detected,
            daemonRunning: cleanup.final.daemonRunning,
            cleanedFiles: cleanup.cleanedFiles,
            warnings: cleanup.warnings,
          },
        },
        ui: {
          type: warningLines.length > 0 ? "warn" : "success",
          title: preference.source === "disable-flag"
            ? "Auto-Update Preference Saved"
            : "Auto-Update Enabled",
          body: lines.join("\n"),
        },
      });
    });
}

export function createDisableSubcommand(): Command {
  return new Command("disable")
    .alias("stop")
    .description("Disable automatic package installation on CLI use")
    .option("--json", "JSON output")
    .action(async () => {
      const write = setAutoUpdatePreference(false);
      const cleanup = await retireLegacyUpdateDaemon({ waitMs: 1000 });
      const preference = getAutoUpdatePreference();
      const warningLines: string[] = [];

      if (cleanup.final.daemonRunning) {
        warningLines.push("legacy update daemon is still running");
      }
      if (cleanup.warnings.length > 0) {
        warningLines.push(...cleanup.warnings);
      }

      const lines = [
        "Automatic package installation is disabled.",
        `Saved to: ${write}`,
        "Update daemon is no longer used.",
      ];
      if (cleanup.final.daemonRunning) {
        lines.push("Legacy update daemon cleanup is incomplete. Review status output.");
      }

      respond({
        data: {
          enabled: preference.enabled,
          effectiveEnabled: preference.enabled,
          source: preference.source,
          explicit: preference.explicit,
          value: preference.value,
          envPath: write,
          daemonUsed: false,
          legacyCleanup: {
            detected: cleanup.initial.detected,
            daemonRunning: cleanup.final.daemonRunning,
            cleanedFiles: cleanup.cleanedFiles,
            warnings: cleanup.warnings,
          },
        },
        ui: {
          type: warningLines.length > 0 ? "warn" : "success",
          title: "Auto-Update Disabled",
          body: lines.join("\n"),
        },
      });
    });
}

export function createStatusSubcommand(): Command {
  return new Command("status")
    .description("Show one-shot auto-update status and any legacy artifacts")
    .option("--json", "JSON output")
    .action(async () => {
      const preference = getAutoUpdatePreference();
      const state = loadUpdateCheckState();
      const legacy = detectLegacyUpdateArtifacts();

      const lines = [
        `Auto-update: ${preference.enabled ? "enabled" : "disabled"}`,
        `Preference source: ${preference.source}`,
        `Update daemon used: no`,
      ];

      const lastCheckedAt = formatIsoTime(state?.lastCheckedAtMs);
      const lastAutoUpdateAttemptAt = formatIsoTime(state?.lastAutoUpdateAttemptAtMs);
      if (lastCheckedAt) {
        lines.push(`Last check: ${lastCheckedAt}`);
      }
      if (state?.lastNotifiedVersion) {
        lines.push(`Last notified version: ${state.lastNotifiedVersion}`);
      }
      if (lastAutoUpdateAttemptAt) {
        lines.push(`Last auto-update attempt: ${lastAutoUpdateAttemptAt}`);
      }
      if (legacy.detected) {
        lines.push(
          `Legacy artifacts: ${legacy.daemonRunning ? "daemon still running" : "files detected"}`,
        );
      }

      respond({
        data: {
          enabled: preference.enabled,
          explicit: preference.explicit,
          source: preference.source,
          value: preference.value,
          daemonUsed: false,
          updateCheckFile: UPDATE_CHECK_FILE,
          lastCheck: state
            ? {
                lastCheckedAtMs: state.lastCheckedAtMs,
                lastCheckedAtIso: lastCheckedAt,
                lastNotifiedVersion: state.lastNotifiedVersion ?? null,
                lastAutoUpdateAttemptAtMs: state.lastAutoUpdateAttemptAtMs ?? null,
                lastAutoUpdateAttemptAtIso: lastAutoUpdateAttemptAt,
              }
            : null,
          legacyArtifacts: legacy,
        },
        ui: {
          type: legacy.detected ? "warn" : "info",
          title: "Auto-Update Status",
          body: lines.join("\n"),
        },
      });
    });
}

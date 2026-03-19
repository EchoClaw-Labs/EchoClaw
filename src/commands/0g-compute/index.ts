import { Command } from "commander";
import { EchoError, ErrorCodes } from "../../errors.js";
import { respond } from "../../utils/respond.js";
import { createProvidersSubcommand } from "./providers.js";
import { createLedgerSubcommand } from "./ledger.js";
import { createProviderSubcommand } from "./provider.js";
import { createApiKeySubcommand } from "./api-key.js";
import { createMonitorSubcommand } from "./monitor-cmd.js";

export function create0gComputeCommand(): Command {
  const root = new Command("0g-compute")
    .alias("0g")
    .description("0G Compute Network: inference, funding, and provider management");

  // ── setup (inline — too small for its own file) ─────────────────
  root
    .command("setup")
    .description("Readiness check (read-only, no transactions)")
    .option("--json", "JSON output")
    .action(async () => {
      const { checkComputeReadiness } = await import("../../0g-compute/readiness.js");

      const result = await checkComputeReadiness();
      const { checks } = result;

      // Build human-readable summary of failing checks
      const failingChecks: string[] = [];
      for (const [name, check] of Object.entries(checks)) {
        if (!check.ok) {
          failingChecks.push(`${name}: ${check.detail ?? "failed"}${check.hint ? ` (${check.hint})` : ""}`);
        }
      }

      respond({
        data: { ready: result.ready, provider: result.provider, checks },
        ui: {
          type: result.ready ? "success" : "warn",
          title: "0G Compute Setup",
          body: result.ready
            ? `All checks passed. Provider: ${result.provider ?? "unknown"}`
            : `Issues found:\n${failingChecks.map(l => `  - ${l}`).join("\n")}`,
        },
      });
    });

  // ── subcommands ─────────────────────────────────────────────────
  root.addCommand(createProvidersSubcommand());
  root.addCommand(createLedgerSubcommand());
  root.addCommand(createProviderSubcommand());
  root.addCommand(createApiKeySubcommand());
  root.addCommand(createMonitorSubcommand());

  return root;
}

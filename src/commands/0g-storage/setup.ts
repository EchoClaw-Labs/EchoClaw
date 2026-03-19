import { Command } from "commander";
import { respond } from "../../utils/respond.js";
import { getStorageEndpoints } from "../../0g-storage/client.js";
import { storageCheckConnectivity } from "../../0g-storage/sdk-bridge.cjs";
import { withSuppressedConsole } from "../../0g-compute/bridge.js";
import { loadConfig } from "../../config/store.js";

export function createStorageSetupCommand(): Command {
  return new Command("setup")
    .description("Readiness check for 0G Storage (read-only)")
    .option("--indexer <url>", "Override indexer URL")
    .option("--rpc <url>", "Override EVM RPC URL")
    .option("--json", "JSON output")
    .action(async (opts: { indexer?: string; rpc?: string }) => {
      const cfg = loadConfig();
      const walletConfigured = !!cfg.wallet.address;
      const endpoints = getStorageEndpoints({
        indexerRpcUrl: opts.indexer,
        evmRpcUrl: opts.rpc,
      });

      const connectivity = await withSuppressedConsole(() =>
        storageCheckConnectivity(endpoints.evmRpcUrl, endpoints.indexerRpcUrl)
      );

      const ready = walletConfigured && connectivity.rpc && connectivity.indexer;

      const checks = {
        wallet: {
          ok: walletConfigured,
          detail: walletConfigured ? cfg.wallet.address : undefined,
          hint: walletConfigured ? undefined : "Run: echoclaw wallet create --json",
        },
        rpc: {
          ok: connectivity.rpc,
          detail: connectivity.rpc ? endpoints.evmRpcUrl : connectivity.rpcDetail,
          hint: connectivity.rpc ? undefined : "Check RPC endpoint or network connectivity.",
        },
        indexer: {
          ok: connectivity.indexer,
          detail: connectivity.indexer ? endpoints.indexerRpcUrl : connectivity.indexerDetail,
          hint: connectivity.indexer ? undefined : "Check indexer endpoint or try later.",
        },
      };

      const failingChecks: string[] = [];
      for (const [name, check] of Object.entries(checks)) {
        if (!check.ok) {
          failingChecks.push(`${name}: ${check.detail ?? "failed"}${check.hint ? ` (${check.hint})` : ""}`);
        }
      }

      respond({
        data: { ready, checks, endpoints },
        ui: {
          type: ready ? "success" : "warn",
          title: "0G Storage Setup",
          body: ready
            ? `All checks passed.\nIndexer: ${endpoints.indexerRpcUrl}\nRPC: ${endpoints.evmRpcUrl}`
            : `Issues found:\n${failingChecks.map((l) => `  - ${l}`).join("\n")}`,
        },
      });
    });
}

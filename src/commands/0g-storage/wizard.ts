import { Command } from "commander";
import { EchoError, ErrorCodes } from "../../errors.js";
import { isHeadless, writeJsonSuccess } from "../../utils/output.js";
import { spinner, successBox, infoBox, colors } from "../../utils/ui.js";
import { getStorageClientConfig, getStorageEndpoints } from "../../0g-storage/client.js";
import { storageCheckConnectivity } from "../../0g-storage/sdk-bridge.cjs";
import { withSuppressedConsole } from "../../0g-compute/bridge.js";
import { uploadFile, downloadFile } from "../../0g-storage/files.js";
import { loadConfig } from "../../config/store.js";
import { formatCostDisplay } from "../../0g-storage/cost.js";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";

export function createStorageWizardCommand(): Command {
  return new Command("wizard")
    .description("Interactive setup: test connectivity and optional test upload")
    .option("--test-upload", "Perform a test upload/download round-trip")
    .option("--indexer <url>", "Override indexer URL")
    .option("--rpc <url>", "Override EVM RPC URL")
    .option("--json", "JSON output")
    .action(async (opts: { testUpload?: boolean; indexer?: string; rpc?: string }) => {
      if (isHeadless() && !opts.testUpload) {
        throw new EchoError(
          ErrorCodes.INTERACTIVE_COMMAND_NOT_SUPPORTED,
          "Wizard requires a TTY or --test-upload flag.",
          "Use '0g-storage setup --json' for headless readiness checks."
        );
      }

      const cfg = loadConfig();
      const walletConfigured = !!cfg.wallet.address;
      const endpoints = getStorageEndpoints({
        indexerRpcUrl: opts.indexer,
        evmRpcUrl: opts.rpc,
      });

      // Step 1: Connectivity
      const s = spinner("Checking 0G Storage connectivity...");
      s.start();

      const connectivity = await withSuppressedConsole(() =>
        storageCheckConnectivity(endpoints.evmRpcUrl, endpoints.indexerRpcUrl)
      );

      if (!connectivity.rpc) {
        s.fail("RPC check failed");
        throw new EchoError(
          ErrorCodes.ZG_STORAGE_SETUP_FAILED,
          `RPC unreachable: ${connectivity.rpcDetail ?? "unknown error"}`,
          "Check your network connection and RPC URL."
        );
      }

      if (!connectivity.indexer) {
        s.fail("Indexer check failed");
        throw new EchoError(
          ErrorCodes.ZG_STORAGE_SETUP_FAILED,
          `Indexer unreachable: ${connectivity.indexerDetail ?? "unknown error"}`,
          "Check indexer URL or try again later."
        );
      }

      s.succeed("Connectivity OK");

      if (!walletConfigured) {
        infoBox("Wallet Required", "No wallet configured. Run: echoclaw wallet create --json");
        if (isHeadless()) {
          writeJsonSuccess({ ready: false, reason: "wallet_not_configured" });
        }
        return;
      }

      // Step 2: Optional test upload
      if (opts.testUpload) {
        const s2 = spinner("Performing test upload...");
        s2.start();

        const tmpDir = mkdtempSync(join(tmpdir(), "echo-storage-wizard-"));
        const testFile = join(tmpDir, "wizard-test.txt");
        writeFileSync(testFile, `Echo 0G Storage Wizard Test — ${new Date().toISOString()}\n${randomBytes(32).toString("hex")}`);

        try {
          const config = getStorageClientConfig();
          const result = await uploadFile(config, testFile);
          s2.succeed(`Upload OK — root: ${result.root.slice(0, 20)}...`);

          const s3 = spinner("Downloading test file...");
          s3.start();
          const downloadPath = join(tmpDir, "wizard-downloaded.txt");
          await downloadFile(config, result.root, downloadPath);
          s3.succeed("Download OK — round-trip verified");

          if (isHeadless()) {
            writeJsonSuccess({
              ready: true,
              testUpload: {
                root: result.root,
                txHash: result.txHash,
                sizeBytes: result.sizeBytes,
                cost: formatCostDisplay(result.cost),
              },
            });
          } else {
            successBox(
              "0G Storage Ready",
              `Wallet: ${colors.address(cfg.wallet.address!)}\n` +
                `Root: ${colors.info(result.root)}\n` +
                `Cost: ${formatCostDisplay(result.cost)}`
            );
          }
        } finally {
          rmSync(tmpDir, { recursive: true, force: true });
        }
      } else {
        if (isHeadless()) {
          writeJsonSuccess({ ready: true });
        } else {
          successBox("0G Storage Ready", `Wallet: ${colors.address(cfg.wallet.address!)}\nAll connectivity checks passed.`);
        }
      }
    });
}

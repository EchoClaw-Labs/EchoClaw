import { Command } from "commander";
import { EchoError, ErrorCodes } from "../../errors.js";
import { isHeadless, writeJsonSuccess } from "../../utils/output.js";
import { respond } from "../../utils/respond.js";
import { getAuthenticatedBroker, resetAuthenticatedBroker } from "../../0g-compute/broker-factory.js";
import { withSuppressedConsole } from "../../0g-compute/bridge.js";
import { normalizeSubAccount, serializeSubAccount } from "../../0g-compute/account.js";
import { requireAddress, serializeBigInts } from "../../0g-compute/helpers.js";
import { requireYes } from "./helpers.js";

export function createProviderSubcommand(): Command {
  const providerCmd = new Command("provider").argument("<address>").description("Provider-specific operations");

  providerCmd
    .command("info")
    .description("Show provider metadata, ack status, and sub-account balance")
    .option("--fresh", "Refresh broker state before reading provider info")
    .option("--json", "JSON output")
    .action(async (options: { fresh?: boolean; json?: boolean }, cmd: Command) => {
      const providerAddress = requireAddress(cmd.parent!.args[0]!, "provider");
      if (options.fresh) {
        resetAuthenticatedBroker();
      }
      const broker = await getAuthenticatedBroker();

      const [metadata, userAcked] = await withSuppressedConsole(() => Promise.all([
        broker.inference.getServiceMetadata(providerAddress),
        broker.inference.acknowledged(providerAddress),
      ]));

      let normalizedAccount: ReturnType<typeof normalizeSubAccount> | null = null;
      try {
        const rawAccount = await withSuppressedConsole(() => broker.inference.getAccount(providerAddress));
        normalizedAccount = normalizeSubAccount(rawAccount);
      } catch {
        // No sub-account yet
      }

      const result: Record<string, unknown> = {
        provider: providerAddress,
        ...metadata,
        userAcknowledged: userAcked,
        subAccount: normalizedAccount ? serializeSubAccount(normalizedAccount) : null,
      };

      const balanceLine = normalizedAccount
        ? `Balance: Total=${normalizedAccount.totalOg.toFixed(4)} | Pending=${normalizedAccount.pendingRefundOg.toFixed(4)} | Locked=${normalizedAccount.lockedOg.toFixed(4)} 0G`
        : "Sub-account: none";

      respond({
        data: result,
        ui: {
          type: "info",
          title: `Provider ${providerAddress.slice(0, 10)}...`,
          body: [
            `Model:    ${metadata.model}`,
            `Endpoint: ${metadata.endpoint}`,
            `User ACK: ${userAcked}`,
            balanceLine,
          ].join("\n"),
        },
      });
    });

  providerCmd
    .command("ack")
    .description("Acknowledge provider signer (user-level, on-chain)")
    .option("--yes", "Confirm on-chain transaction")
    .option("--json", "JSON output")
    .action(async (options: { yes?: boolean; json?: boolean }, cmd: Command) => {
      requireYes(options.yes, "acknowledge provider signer");
      const providerAddress = requireAddress(cmd.parent!.args[0]!, "provider");
      const broker = await getAuthenticatedBroker();

      try {
        await withSuppressedConsole(() => broker.inference.acknowledgeProviderSigner(providerAddress));
      } catch (err) {
        throw new EchoError(
          ErrorCodes.ZG_ACKNOWLEDGE_FAILED,
          `Acknowledge failed: ${err instanceof Error ? err.message : String(err)}`
        );
      }

      respond({
        data: { acknowledged: true, provider: providerAddress },
        ui: {
          type: "success",
          title: "Provider Acknowledged",
          body: `Provider ${providerAddress.slice(0, 10)}... signer acknowledged.`,
        },
      });
    });

  providerCmd
    .command("verify")
    .description("Verify provider TEE attestation")
    .option("--json", "JSON output")
    .action(async (_options: { json?: boolean }, cmd: Command) => {
      const providerAddress = requireAddress(cmd.parent!.args[0]!, "provider");
      const broker = await getAuthenticatedBroker();

      const result = await withSuppressedConsole(() => broker.inference.verifyService(providerAddress));

      if (isHeadless()) {
        writeJsonSuccess({ verification: serializeBigInts(result) as Record<string, unknown> });
      } else {
        process.stderr.write(`TEE Verification for ${providerAddress.slice(0, 10)}...:\n`);
        process.stderr.write(JSON.stringify(serializeBigInts(result), null, 2) + "\n");
      }
    });

  return providerCmd;
}

import { Command } from "commander";
import { parseUnits } from "viem";
import { EchoError, ErrorCodes } from "../../errors.js";
import { isHeadless, writeJsonSuccess } from "../../utils/output.js";
import { respond } from "../../utils/respond.js";
import { getAuthenticatedBroker } from "../../0g-compute/broker-factory.js";
import { withSuppressedConsole } from "../../0g-compute/bridge.js";
import { normalizeSubAccount, normalizeInferTuple, normalizeLedger, normalizeLedgerDetail, serializeSubAccount } from "../../0g-compute/account.js";
import { requireAddress, requirePositiveNumber, serializeBigInts } from "../../0g-compute/helpers.js";
import { requireYes } from "./helpers.js";
import logger from "../../utils/logger.js";

export function createLedgerSubcommand(): Command {
  const ledger = new Command("ledger").description("Manage 0G Compute ledger");

  ledger
    .command("status")
    .description("Show ledger status and sub-account balances")
    .option("--json", "JSON output")
    .action(async () => {
      const broker = await getAuthenticatedBroker();

      // Try getLedgerWithDetail (returns sub-accounts without extra RPC)
      let normalized: import("../../0g-compute/account.js").NormalizedLedger;
      let subAccounts: ReturnType<typeof normalizeInferTuple>[] = [];

      try {
        const detail = await withSuppressedConsole(() =>
          (broker.ledger as unknown as { getLedgerWithDetail(): Promise<{ ledgerInfo: unknown; infers: [string, bigint, bigint][] }> })
            .getLedgerWithDetail()
        );
        // ledgerInfo = [totalBalance, reserved, availableBalance] — different from LedgerStructOutput
        normalized = normalizeLedgerDetail(detail.ledgerInfo);
        if (Array.isArray(detail.infers)) {
          subAccounts = detail.infers.map((t) => normalizeInferTuple(t as [string, bigint, bigint]));
        }
      } catch {
        // Fallback to plain getLedger (returns LedgerStructOutput with named props)
        try {
          const ledgerRaw = await withSuppressedConsole(() => broker.ledger.getLedger());
          normalized = normalizeLedger(ledgerRaw);
        } catch {
          throw new EchoError(
            ErrorCodes.ZG_LEDGER_NOT_FOUND,
            "No ledger found for this wallet.",
            "Create one with: echoclaw 0g-compute ledger deposit <amount> --yes"
          );
        }
      }

      if (isHeadless()) {
        writeJsonSuccess({
          ledger: {
            availableOg: normalized.availableOg,
            totalOg: normalized.totalOg,
            reservedOg: normalized.reservedOg,
          },
          subAccounts: subAccounts.map((sa) => ({
            provider: sa.provider,
            ...serializeSubAccount(sa),
          })),
        });
      } else {
        process.stderr.write("Ledger:\n");
        process.stderr.write(`  Available: ${normalized.availableOg.toFixed(4)} 0G\n`);
        process.stderr.write(`  Reserved:  ${normalized.reservedOg.toFixed(4)} 0G  (locked in sub-accounts)\n`);
        process.stderr.write(`  Total:     ${normalized.totalOg.toFixed(4)} 0G\n`);

        if (subAccounts.length > 0) {
          process.stderr.write("\nSub-accounts:\n");
          process.stderr.write(
            "  Provider                                     | Total       | Pending     | Locked\n"
          );
          process.stderr.write("  " + "-".repeat(95) + "\n");
          for (const sa of subAccounts) {
            const addr = sa.provider.slice(0, 42).padEnd(42);
            const total = sa.totalOg.toFixed(4).padStart(10);
            const pending = sa.pendingRefundOg.toFixed(4).padStart(10);
            const locked = sa.lockedOg.toFixed(4).padStart(10);
            process.stderr.write(`  ${addr} | ${total} 0G | ${pending} 0G | ${locked} 0G\n`);
          }
        }
      }
    });

  ledger
    .command("deposit <amount>")
    .description("Deposit 0G to the compute ledger (creates if needed)")
    .option("--yes", "Confirm on-chain transaction")
    .option("--json", "JSON output")
    .action(async (amountStr: string, options: { yes?: boolean; json?: boolean }) => {
      requireYes(options.yes, "ledger deposit");
      const amount = requirePositiveNumber(amountStr, "deposit amount");

      const broker = await getAuthenticatedBroker();

      // Try depositFund first; if no ledger exists, use addLedger
      try {
        await withSuppressedConsole(() => broker.ledger.getLedger());
        logger.info(`[0G Compute] Depositing ${amount} 0G to existing ledger...`);
        await withSuppressedConsole(() => broker.ledger.depositFund(amount));
      } catch {
        logger.info(`[0G Compute] No ledger found, creating with ${amount} 0G...`);
        await withSuppressedConsole(() => broker.ledger.addLedger(amount));
      }

      respond({
        data: { deposited: amount, unit: "0G" },
        ui: { type: "success", title: "Ledger Deposit", body: `Deposited ${amount} 0G to compute ledger.` },
      });
    });

  ledger
    .command("fund")
    .description("Transfer 0G from ledger to a provider sub-account")
    .requiredOption("--provider <addr>", "Provider address")
    .requiredOption("--amount <0G>", "Amount in 0G")
    .option("--yes", "Confirm on-chain transaction")
    .option("--json", "JSON output")
    .action(async (options: { provider: string; amount: string; yes?: boolean; json?: boolean }) => {
      requireYes(options.yes, "ledger fund transfer");
      const provider = requireAddress(options.provider, "provider");
      const amount = requirePositiveNumber(options.amount, "fund amount");
      const amountWei = parseUnits(options.amount, 18);

      const broker = await getAuthenticatedBroker();

      // Pre-check: verify ledger available balance before on-chain call
      try {
        const ledgerRaw = await withSuppressedConsole(() => broker.ledger.getLedger());
        const ledgerNorm = normalizeLedger(ledgerRaw);
        if (amount > ledgerNorm.availableOg + 0.001) {
          throw new EchoError(
            ErrorCodes.ZG_TRANSFER_FAILED,
            `Ledger available balance is ${ledgerNorm.availableOg.toFixed(4)} 0G, but you need ${amount} 0G.`,
            "Deposit more first: echoclaw 0g-compute ledger deposit <amount> --yes --json"
          );
        }
      } catch (err) {
        if (err instanceof EchoError) throw err;
        throw new EchoError(
          ErrorCodes.ZG_LEDGER_NOT_FOUND,
          "No ledger found for this wallet.",
          "Create one with: echoclaw 0g-compute ledger deposit <amount> --yes"
        );
      }

      try {
        await withSuppressedConsole(() => broker.ledger.transferFund(provider, "inference", amountWei));
      } catch (err) {
        throw new EchoError(
          ErrorCodes.ZG_TRANSFER_FAILED,
          `Transfer failed: ${err instanceof Error ? err.message : String(err)}`,
          "Check ledger balance with: echoclaw 0g-compute ledger status"
        );
      }

      respond({
        data: { transferred: amount, unit: "0G", provider },
        ui: {
          type: "success",
          title: "Ledger Fund",
          body: `Transferred ${amount} 0G to provider sub-account ${provider.slice(0, 10)}...`,
        },
      });
    });

  return ledger;
}

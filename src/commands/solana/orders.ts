/**
 * DCA and Limit order commands — Jupiter Recurring/Trigger API.
 */

import { Command } from "commander";
import { requireSolanaWallet } from "../../wallet/multi-auth.js";
import {
  createDcaOrder,
  listDcaOrders,
  cancelDcaOrder,
  createLimitOrder,
  listLimitOrders,
  cancelLimitOrder,
  type TriggerOrder,
} from "../../chains/solana/order-service.js";
import { isHeadless, writeJsonSuccess } from "../../utils/output.js";
import { successBox, infoBox, spinner, printTable, colors } from "../../utils/ui.js";
import { EchoError, ErrorCodes } from "../../errors.js";
import { shortenSolanaAddress } from "../../chains/solana/validation.js";

export function createOrdersSubcommand(): Command {
  const orders = new Command("dca")
    .description("Dollar-cost averaging orders (Jupiter Recurring API)")
    .exitOverride();

  // echoclaw solana dca create <amount> <from> <to> --every <interval> --count <n>
  orders
    .command("create <amount> <from> <to>")
    .description("Create a DCA order")
    .requiredOption("--every <interval>", "Interval: minute | hour | day | week | month")
    .option("--count <n>", "Number of orders", "10")
    .option("--yes", "Skip confirmation")
    .action(async (amount: string, from: string, to: string, options) => {
      const wallet = requireSolanaWallet();
      const totalAmount = Number(amount);
      const count = Number(options.count);

      if (!options.yes && !isHeadless()) {
        process.stderr.write(
          `\n  DCA: ${colors.info(`${totalAmount} ${from}`)} → ${colors.info(to)}\n` +
          `  ${count} orders, every ${options.every}\n` +
          `  Use ${colors.muted("--yes")} to execute.\n\n`,
        );
        throw new EchoError(ErrorCodes.CONFIRMATION_REQUIRED, "Add --yes to proceed.");
      }

      const spin = spinner("Creating DCA order...");
      spin.start();

      try {
        const result = await createDcaOrder(wallet.secretKey, from, to, totalAmount, options.every, count);
        spin.succeed("DCA order created");

        if (isHeadless()) {
          writeJsonSuccess({ action: "dca-create", ...result, from, to, totalAmount, interval: options.every, count });
        } else {
          successBox("DCA Created", `Order: ${colors.muted(result.orderKey)}\nSignature: ${colors.muted(result.signature)}`);
        }
      } catch (err) { spin.fail("DCA creation failed"); throw err; }
    });

  // echoclaw solana dca list
  orders
    .command("list")
    .description("List active DCA orders")
    .action(async () => {
      const wallet = requireSolanaWallet();
      const spin = spinner("Loading DCA orders...");
      spin.start();

      const dcaOrders = await listDcaOrders(wallet.address);
      spin.succeed(`Found ${dcaOrders.length} order(s)`);

      if (isHeadless()) {
        writeJsonSuccess({ orders: dcaOrders });
        return;
      }

      if (dcaOrders.length === 0) {
        infoBox("DCA Orders", "No active DCA orders.");
        return;
      }

      printTable(
        [
          { header: "Order", width: 14 },
          { header: "Input", width: 14 },
          { header: "Output", width: 14 },
          { header: "Per Cycle", width: 14 },
        ],
        dcaOrders.map((o) => [
          shortenSolanaAddress(o.orderKey),
          shortenSolanaAddress(o.inputMint),
          shortenSolanaAddress(o.outputMint),
          o.inAmountPerCycle ?? "-",
        ]),
      );
    });

  // echoclaw solana dca cancel <orderKey>
  orders
    .command("cancel <orderKey>")
    .description("Cancel a DCA order")
    .option("--yes", "Skip confirmation")
    .action(async (orderKey: string, options: { yes?: boolean }) => {
      const wallet = requireSolanaWallet();

      if (!options.yes && !isHeadless()) {
        process.stderr.write(`\n  Cancel DCA order ${colors.muted(shortenSolanaAddress(orderKey))}\n  Use ${colors.muted("--yes")} to execute.\n\n`);
        throw new EchoError(ErrorCodes.CONFIRMATION_REQUIRED, "Add --yes to proceed.");
      }

      const spin = spinner("Cancelling DCA order...");
      spin.start();

      try {
        const signature = await cancelDcaOrder(wallet.secretKey, orderKey);
        spin.succeed("DCA order cancelled");

        if (isHeadless()) {
          writeJsonSuccess({ action: "dca-cancel", orderKey, signature });
        } else {
          successBox("DCA Cancelled", `Order: ${colors.muted(shortenSolanaAddress(orderKey))}\nSignature: ${colors.muted(signature)}`);
        }
      } catch (err) { spin.fail("Cancel failed"); throw err; }
    });

  return orders;
}

export function createLimitSubcommand(): Command {
  const limit = new Command("limit")
    .description("Limit orders (Jupiter Trigger API)")
    .exitOverride();

  // echoclaw solana limit create <amount> <from> <to> --at <price>
  limit
    .command("create <amount> <from> <to>")
    .description("Create a limit order")
    .requiredOption("--at <price>", "Target USD price for output token")
    .option("--yes", "Skip confirmation")
    .action(async (amount: string, from: string, to: string, options) => {
      const wallet = requireSolanaWallet();
      const inputAmount = Number(amount);
      const targetPrice = Number(options.at);

      if (!options.yes && !isHeadless()) {
        process.stderr.write(
          `\n  Limit: ${colors.info(`${inputAmount} ${from}`)} → ${colors.info(to)} at $${targetPrice}\n` +
          `  Use ${colors.muted("--yes")} to execute.\n\n`,
        );
        throw new EchoError(ErrorCodes.CONFIRMATION_REQUIRED, "Add --yes to proceed.");
      }

      const spin = spinner("Creating limit order...");
      spin.start();

      try {
        const result = await createLimitOrder(wallet.secretKey, from, to, inputAmount, targetPrice);
        spin.succeed("Limit order created");

        if (isHeadless()) {
          writeJsonSuccess({ action: "limit-create", ...result, from, to, inputAmount, targetPrice });
        } else {
          successBox("Limit Order Created", `Order: ${colors.muted(result.orderKey)}\nTarget: $${targetPrice}\nSignature: ${colors.muted(result.signature)}`);
        }
      } catch (err) { spin.fail("Limit order failed"); throw err; }
    });

  // echoclaw solana limit list
  limit
    .command("list")
    .description("List active limit orders")
    .action(async () => {
      const wallet = requireSolanaWallet();
      const spin = spinner("Loading limit orders...");
      spin.start();

      const limitOrders = await listLimitOrders(wallet.address);
      spin.succeed(`Found ${limitOrders.length} order(s)`);

      if (isHeadless()) {
        writeJsonSuccess({ orders: limitOrders });
        return;
      }

      if (limitOrders.length === 0) {
        infoBox("Limit Orders", "No active limit orders.");
        return;
      }

      printTable(
        [
          { header: "Order", width: 14 },
          { header: "Input", width: 14 },
          { header: "Output", width: 14 },
          { header: "Making", width: 14 },
          { header: "Status", width: 10 },
        ],
        limitOrders.map((o: TriggerOrder) => [
          shortenSolanaAddress(o.orderKey),
          shortenSolanaAddress(o.inputMint),
          shortenSolanaAddress(o.outputMint),
          o.remainingMakingAmount,
          o.status,
        ]),
      );
    });

  // echoclaw solana limit cancel <orderKey>
  limit
    .command("cancel <orderKey>")
    .description("Cancel a limit order")
    .option("--yes", "Skip confirmation")
    .action(async (orderKey: string, options: { yes?: boolean }) => {
      const wallet = requireSolanaWallet();

      if (!options.yes && !isHeadless()) {
        process.stderr.write(`\n  Cancel limit order ${colors.muted(shortenSolanaAddress(orderKey))}\n  Use ${colors.muted("--yes")} to execute.\n\n`);
        throw new EchoError(ErrorCodes.CONFIRMATION_REQUIRED, "Add --yes to proceed.");
      }

      const spin = spinner("Cancelling limit order...");
      spin.start();

      try {
        const signature = await cancelLimitOrder(wallet.secretKey, orderKey);
        spin.succeed("Limit order cancelled");

        if (isHeadless()) {
          writeJsonSuccess({ action: "limit-cancel", orderKey, signature });
        } else {
          successBox("Limit Order Cancelled", `Order: ${colors.muted(shortenSolanaAddress(orderKey))}\nSignature: ${colors.muted(signature)}`);
        }
      } catch (err) { spin.fail("Cancel failed"); throw err; }
    });

  return limit;
}

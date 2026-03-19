import { Command } from "commander";
import { isAddress, getAddress, type Address } from "viem";
import { EchoError, ErrorCodes } from "../../errors.js";
import { isHeadless, writeJsonSuccess } from "../../utils/output.js";
import { loadConfig } from "../../config/store.js";
import {
  addOrder,
  removeOrder,
  updateOrder,
  armOrder,
  disarmOrder,
  getOrderById,
  listOrders,
} from "../../bot/orders.js";
import type {
  Trigger,
  TriggerType,
  SizeSpec,
  BotOrder,
  OrderState,
} from "../../bot/types.js";
import { DEFAULT_GUARDRAILS } from "../../bot/types.js";
import { VALID_TRIGGERS, parseIntSafe, formatOrder } from "./helpers.js";

export function createOrderSubcommand(): Command {
  const order = new Command("order").description("Manage orders");

  // order add
  order
    .command("add")
    .description("Add a new order")
    .requiredOption("--token <addr>", "Token contract address")
    .requiredOption("--side <side>", "buy or sell")
    .requiredOption("--trigger <type>", `Trigger type: ${VALID_TRIGGERS.join(", ")}`)
    .option("--threshold <number>", "Threshold for price/bonding triggers")
    .option("--amount-og <amount>", "0G amount for buy (absolute)")
    .option("--amount-tokens <amount>", 'Token amount for sell (absolute, or "all")')
    .option("--percent <number>", "Percentage of balance")
    .option("--slippage-bps <bps>", "Slippage tolerance in bps", "100")
    .option("--cooldown-ms <ms>", "Cooldown between triggers in ms", "5000")
    .option("--ignore-wallet <addr>", "Ignore trades from this wallet (for onNewBuy/Sell)")
    .option("--min-buy-og <amount>", "Min trade amount filter for onNewBuy/Sell")
    .option("--json", "JSON output")
    .action(
      async (
        options: {
          token: string;
          side: string;
          trigger: string;
          threshold?: string;
          amountOg?: string;
          amountTokens?: string;
          percent?: string;
          slippageBps: string;
          cooldownMs: string;
          ignoreWallet?: string;
          minBuyOg?: string;
          json?: boolean;
        }
      ) => {
        // Validate token
        if (!isAddress(options.token)) {
          throw new EchoError(ErrorCodes.INVALID_ADDRESS, `Invalid token address: ${options.token}`);
        }
        const token = getAddress(options.token) as Address;

        // Validate side
        if (options.side !== "buy" && options.side !== "sell") {
          throw new EchoError(ErrorCodes.BOT_INVALID_ORDER, 'Side must be "buy" or "sell"');
        }

        // Validate trigger type
        if (!VALID_TRIGGERS.includes(options.trigger as TriggerType)) {
          throw new EchoError(
            ErrorCodes.BOT_INVALID_TRIGGER,
            `Invalid trigger: ${options.trigger}. Valid: ${VALID_TRIGGERS.join(", ")}`
          );
        }
        const triggerType = options.trigger as TriggerType;

        // Build trigger
        let trigger: Trigger;
        switch (triggerType) {
          case "priceAbove":
          case "priceBelow": {
            if (!options.threshold) {
              throw new EchoError(ErrorCodes.BOT_INVALID_TRIGGER, `--threshold required for ${triggerType}`);
            }
            const threshold = parseFloat(options.threshold);
            if (!Number.isFinite(threshold) || threshold <= 0) {
              throw new EchoError(ErrorCodes.BOT_INVALID_TRIGGER, `Invalid threshold: ${options.threshold}`);
            }
            trigger = { type: triggerType, threshold };
            break;
          }
          case "bondingProgressAbove": {
            if (!options.threshold) {
              throw new EchoError(ErrorCodes.BOT_INVALID_TRIGGER, "--threshold required for bondingProgressAbove");
            }
            const threshold = parseFloat(options.threshold);
            if (!Number.isFinite(threshold) || threshold < 0 || threshold > 100) {
              throw new EchoError(
                ErrorCodes.BOT_INVALID_TRIGGER,
                `Threshold must be 0-100 (e.g., 75 for 75%): got ${options.threshold}`
              );
            }
            trigger = { type: "bondingProgressAbove", threshold };
            break;
          }
          case "onNewBuy":
          case "onNewSell": {
            const cfg = loadConfig();
            const ignoreWallet = options.ignoreWallet
              ? (getAddress(options.ignoreWallet) as Address)
              : cfg.wallet.address ?? undefined;
            const minAmountOg = options.minBuyOg ? parseFloat(options.minBuyOg) : undefined;
            trigger = { type: triggerType, ignoreWallet, minAmountOg };
            break;
          }
          default:
            throw new EchoError(ErrorCodes.BOT_INVALID_TRIGGER, `Unhandled trigger type: ${triggerType}`);
        }

        // Build size
        let size: SizeSpec;
        if (options.amountOg) {
          size = { mode: "absolute", amountOg: options.amountOg };
        } else if (options.amountTokens) {
          if (options.amountTokens.toLowerCase() === "all") {
            size = { mode: "all" };
          } else {
            size = { mode: "absoluteTokens", amountTokens: options.amountTokens };
          }
        } else if (options.percent) {
          const percent = parseFloat(options.percent);
          if (!Number.isFinite(percent) || percent <= 0 || percent > 100) {
            throw new EchoError(ErrorCodes.BOT_INVALID_ORDER, `Percent must be 1-100: got ${options.percent}`);
          }
          size = { mode: "percent", percent };
        } else {
          throw new EchoError(
            ErrorCodes.BOT_INVALID_ORDER,
            "Specify one of: --amount-og, --amount-tokens, --percent"
          );
        }

        // Validate size vs side
        if (options.side === "buy" && (size.mode === "absoluteTokens" || size.mode === "all")) {
          throw new EchoError(
            ErrorCodes.BOT_INVALID_ORDER,
            "Buy orders use --amount-og or --percent, not --amount-tokens/all"
          );
        }
        if (options.side === "sell" && size.mode === "absolute") {
          throw new EchoError(
            ErrorCodes.BOT_INVALID_ORDER,
            "Sell orders use --amount-tokens, --percent, or all, not --amount-og"
          );
        }

        const slippageBps = parseIntSafe(options.slippageBps, "slippage-bps");
        if (slippageBps > DEFAULT_GUARDRAILS.maxSlippageBps) {
          throw new EchoError(
            ErrorCodes.BOT_GUARDRAIL_EXCEEDED,
            `Slippage ${slippageBps}bps exceeds max ${DEFAULT_GUARDRAILS.maxSlippageBps}bps`
          );
        }

        const cooldownMs = parseIntSafe(options.cooldownMs, "cooldown-ms");

        const newOrder = addOrder({
          token,
          side: options.side,
          trigger,
          size,
          slippageBps,
          cooldownMs,
        });

        if (isHeadless()) {
          writeJsonSuccess({ order: newOrder });
        } else {
          process.stderr.write(`Order created: ${newOrder.id}\n`);
          process.stderr.write(`  ${formatOrder(newOrder)}\n`);
        }
      }
    );

  // order list
  order
    .command("list")
    .description("List orders")
    .option("--token <addr>", "Filter by token address")
    .option("--state <state>", "Filter by state: armed, filled, failed, cancelled, disarmed, all", "armed")
    .option("--json", "JSON output")
    .action(
      (options: { token?: string; state?: string; json?: boolean }) => {
        const tokenFilter = options.token && isAddress(options.token) ? getAddress(options.token) : undefined;
        const stateFilter = (options.state ?? "armed") as OrderState | "all";
        const orders = listOrders({ token: tokenFilter, state: stateFilter });

        if (isHeadless()) {
          writeJsonSuccess({ orders });
        } else {
          if (orders.length === 0) {
            process.stderr.write("No orders found.\n");
            return;
          }
          process.stderr.write(
            `ID       | State      | Side | Trigger                      | Size           | Token      | Slippage\n`
          );
          process.stderr.write("-".repeat(110) + "\n");
          for (const o of orders) {
            process.stderr.write(formatOrder(o) + "\n");
          }
          process.stderr.write(`\nTotal: ${orders.length}\n`);
        }
      }
    );

  // order show
  order
    .command("show <id>")
    .description("Show order details")
    .option("--json", "JSON output")
    .action((id: string, options: { json?: boolean }) => {
      const o = getOrderById(id);
      if (!o) {
        throw new EchoError(ErrorCodes.BOT_ORDER_NOT_FOUND, `Order not found: ${id}`);
      }

      if (isHeadless()) {
        writeJsonSuccess({ order: o });
      } else {
        process.stderr.write(JSON.stringify(o, null, 2) + "\n");
      }
    });

  // order update
  order
    .command("update <id>")
    .description("Update order parameters")
    .option("--slippage-bps <bps>", "New slippage in bps")
    .option("--cooldown-ms <ms>", "New cooldown in ms")
    .option("--json", "JSON output")
    .action(
      (id: string, options: { slippageBps?: string; cooldownMs?: string; json?: boolean }) => {
        const patch: Partial<Pick<BotOrder, "slippageBps" | "cooldownMs">> = {};
        if (options.slippageBps) {
          const bps = parseIntSafe(options.slippageBps, "slippage-bps");
          if (bps > DEFAULT_GUARDRAILS.maxSlippageBps) {
            throw new EchoError(
              ErrorCodes.BOT_GUARDRAIL_EXCEEDED,
              `Slippage ${bps}bps exceeds max ${DEFAULT_GUARDRAILS.maxSlippageBps}bps`
            );
          }
          patch.slippageBps = bps;
        }
        if (options.cooldownMs) {
          patch.cooldownMs = parseIntSafe(options.cooldownMs, "cooldown-ms");
        }

        const updated = updateOrder(id, patch);

        if (isHeadless()) {
          writeJsonSuccess({ order: updated });
        } else {
          process.stderr.write(`Order updated: ${id}\n`);
          process.stderr.write(`  ${formatOrder(updated)}\n`);
        }
      }
    );

  // order remove
  order
    .command("remove <id>")
    .description("Cancel/remove an order")
    .option("--yes", "Skip confirmation")
    .action((id: string, options: { yes?: boolean }) => {
      if (!options.yes && !isHeadless()) {
        throw new EchoError(ErrorCodes.CONFIRMATION_REQUIRED, "Add --yes to confirm removal");
      }

      const removed = removeOrder(id);
      if (!removed) {
        throw new EchoError(ErrorCodes.BOT_ORDER_NOT_FOUND, `Order not found: ${id}`);
      }

      if (isHeadless()) {
        writeJsonSuccess({ removed: true, orderId: id });
      } else {
        process.stderr.write(`Order cancelled: ${id}\n`);
      }
    });

  // order arm
  order
    .command("arm <id>")
    .description("Arm (activate) an order")
    .action((id: string) => {
      const o = armOrder(id);
      if (isHeadless()) {
        writeJsonSuccess({ order: o });
      } else {
        process.stderr.write(`Order armed: ${id}\n`);
      }
    });

  // order disarm
  order
    .command("disarm <id>")
    .description("Disarm (deactivate) an order")
    .action((id: string) => {
      const o = disarmOrder(id);
      if (isHeadless()) {
        writeJsonSuccess({ order: o });
      } else {
        process.stderr.write(`Order disarmed: ${id}\n`);
      }
    });

  return order;
}

import { Command } from "commander";
import { EchoError, ErrorCodes } from "../../errors.js";
import { getCachedKhalaniChains, resolveChainId } from "../../khalani/chains.js";
import { getKhalaniClient } from "../../khalani/client.js";
import type { KhalaniOrder } from "../../khalani/types.js";
import { infoBox, printTable, colors, spinner } from "../../utils/ui.js";
import { isHeadless, writeJsonSuccess } from "../../utils/output.js";
import { normalizeAddressForFamily, resolveConfiguredAddress } from "./helpers.js";

function getStatusColor(status: string): (value: string) => string {
  if (status === "filled") return colors.success;
  if (status === "failed" || status === "refunded") return colors.error;
  if (status === "refund_pending") return colors.warn;
  return colors.info;
}

function resolveOrdersAddress(rawAddress: string | undefined, wallet: "eip155" | "solana"): string {
  const resolved = rawAddress ?? resolveConfiguredAddress(wallet);
  if (!resolved) {
    throw new EchoError(
      ErrorCodes.WALLET_NOT_CONFIGURED,
      `No ${wallet === "solana" ? "Solana" : "EVM"} address configured.`,
      "Pass the address explicitly or configure the matching wallet first."
    );
  }
  return normalizeAddressForFamily(resolved, wallet, "address");
}

function renderOrdersTable(orders: KhalaniOrder[]): void {
  const rows = orders.map((order) => [
    order.id,
    getStatusColor(order.status)(order.status),
    `${order.fromChainId} -> ${order.toChainId}`,
    order.srcAmount,
    order.destAmount,
    order.updatedAt,
  ]);

  printTable(
    [
      { header: "Order ID", width: 28 },
      { header: "Status", width: 18 },
      { header: "Route", width: 16 },
      { header: "Src Amount", width: 22 },
      { header: "Dest Amount", width: 22 },
      { header: "Updated", width: 26 },
    ],
    rows,
  );
}

export async function handleOrderById(orderId: string): Promise<void> {
  const order = await getKhalaniClient().getOrderById(orderId);

  if (isHeadless()) {
    writeJsonSuccess({ order });
    return;
  }

  infoBox(
    "Khalani Order",
    [
      `Order ID: ${order.id}`,
      `Status: ${order.status}`,
      `Route: ${order.routeId}`,
      `Author: ${order.author}`,
      `Chains: ${order.fromChainId} -> ${order.toChainId}`,
      `Source Amount: ${order.srcAmount}`,
      `Destination Amount: ${order.destAmount}`,
      `Deposit Tx: ${order.depositTxHash}`,
      `Created: ${order.createdAt}`,
      `Updated: ${order.updatedAt}`,
    ].join("\n"),
  );

  const rows = Object.entries(order.transactions).map(([kind, txInfo]) => {
    const info: KhalaniOrder["transactions"][string] = txInfo;
    return [
      kind,
      info.chainId.toString(),
      info.txHash,
      info.amount ?? "-",
      info.timestamp,
    ];
  });

  if (rows.length > 0) {
    printTable(
      [
        { header: "Kind", width: 14 },
        { header: "Chain", width: 10 },
        { header: "Tx Hash", width: 30 },
        { header: "Amount", width: 20 },
        { header: "Timestamp", width: 26 },
      ],
      rows,
    );
  }
}

export function createOrdersSubcommand(): Command {
  const orders = new Command("orders")
    .description("List Khalani orders for an address")
    .argument("[address]", "Wallet address (EVM or Solana depending on --wallet)")
    .option("--wallet <family>", "Configured wallet family fallback: eip155 | solana", "eip155")
    .option("--limit <n>", "Result limit")
    .option("--cursor <n>", "Pagination cursor")
    .option("--from-chain <chain>", "Filter by source chain")
    .option("--to-chain <chain>", "Filter by destination chain")
    .option("--order-ids <ids>", "Comma-separated order IDs")
    .option("--tx-hash <hash>", "Search orders by transaction hash")
    .action(async (address: string | undefined, options: {
      wallet?: string;
      limit?: string;
      cursor?: string;
      fromChain?: string;
      toChain?: string;
      orderIds?: string;
      txHash?: string;
    }) => {
      const chains = await getCachedKhalaniChains();
      const wallet = options.wallet === "solana" ? "solana" : "eip155";
      const resolvedAddress = resolveOrdersAddress(address, wallet);
      const fromChainId = options.fromChain ? resolveChainId(options.fromChain, chains) : undefined;
      const toChainId = options.toChain ? resolveChainId(options.toChain, chains) : undefined;
      const limit = options.limit ? Number(options.limit) : undefined;
      const cursor = options.cursor ? Number(options.cursor) : undefined;

      const spin = isHeadless() ? null : spinner("Fetching Khalani orders...");
      const response = await getKhalaniClient().getOrders(resolvedAddress, {
        limit,
        cursor,
        fromChainId,
        toChainId,
        orderIds: options.orderIds,
        txHashSearch: options.txHash,
      });

      spin?.stop();

      if (isHeadless()) {
        writeJsonSuccess({
          address: resolvedAddress,
          wallet,
          data: response.data,
          cursor: response.cursor,
        });
        return;
      }

      renderOrdersTable(response.data);
      if (response.cursor != null) {
        infoBox("Pagination", `Next cursor: ${response.cursor}`);
      }
    });

  orders
    .command("by-id <orderId>")
    .description("Get a single Khalani order by ID")
    .action(async (orderId: string) => {
      await handleOrderById(orderId);
    });

  return orders;
}

export function createOrderSubcommand(): Command {
  return new Command("order")
    .description("Get a single Khalani order by ID (alias for: orders by-id)")
    .argument("<orderId>", "Order ID")
    .action(async (orderId: string) => {
      await handleOrderById(orderId);
    });
}

/**
 * Bot order persistence — atomic file read/write for order CRUD.
 * Pattern matches config/store.ts atomic write (tmp + rename).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import type { Address } from "viem";
import { BOT_DIR, BOT_ORDERS_FILE } from "../config/paths.js";
import { EchoError, ErrorCodes } from "../errors.js";
import logger from "../utils/logger.js";
import type { BotOrder, BotOrdersFile, Trigger, SizeSpec, OrderState } from "./types.js";

function ensureBotDir(): void {
  if (!existsSync(BOT_DIR)) {
    mkdirSync(BOT_DIR, { recursive: true });
    logger.debug(`Created bot directory: ${BOT_DIR}`);
  }
}

export function loadOrders(): BotOrdersFile {
  ensureBotDir();

  if (!existsSync(BOT_ORDERS_FILE)) {
    return { version: 1, orders: [] };
  }

  try {
    const raw = readFileSync(BOT_ORDERS_FILE, "utf-8");
    const parsed = JSON.parse(raw) as BotOrdersFile;
    if (parsed.version !== 1) {
      logger.warn(`Unknown orders version ${parsed.version}, returning empty`);
      return { version: 1, orders: [] };
    }
    return parsed;
  } catch (err) {
    logger.error(`Failed to parse orders file: ${err}`);
    return { version: 1, orders: [] };
  }
}

export function saveOrders(file: BotOrdersFile): void {
  ensureBotDir();
  const dir = dirname(BOT_ORDERS_FILE);
  const tmpFile = join(dir, `.orders.tmp.${Date.now()}.json`);

  try {
    writeFileSync(tmpFile, JSON.stringify(file, null, 2), "utf-8");
    renameSync(tmpFile, BOT_ORDERS_FILE);
  } catch (err) {
    try {
      if (existsSync(tmpFile)) unlinkSync(tmpFile);
    } catch {
      // ignore cleanup
    }
    throw err;
  }
}

export function addOrder(spec: {
  token: Address;
  side: "buy" | "sell";
  trigger: Trigger;
  size: SizeSpec;
  slippageBps: number;
  cooldownMs: number;
}): BotOrder {
  const file = loadOrders();

  const order: BotOrder = {
    id: randomUUID(),
    token: spec.token,
    side: spec.side,
    trigger: spec.trigger,
    size: spec.size,
    slippageBps: spec.slippageBps,
    cooldownMs: spec.cooldownMs,
    state: "armed",
    createdAt: Date.now(),
  };

  file.orders.push(order);
  saveOrders(file);
  logger.debug(`Order added: ${order.id}`);
  return order;
}

export function removeOrder(id: string): boolean {
  const file = loadOrders();
  const order = file.orders.find((o) => o.id === id);
  if (!order) return false;

  order.state = "cancelled";
  saveOrders(file);
  logger.debug(`Order cancelled: ${id}`);
  return true;
}

export function updateOrder(
  id: string,
  patch: Partial<Pick<BotOrder, "trigger" | "size" | "slippageBps" | "cooldownMs">>
): BotOrder {
  const file = loadOrders();
  const order = file.orders.find((o) => o.id === id);
  if (!order) {
    throw new EchoError(ErrorCodes.BOT_ORDER_NOT_FOUND, `Order not found: ${id}`);
  }

  if (patch.trigger !== undefined) order.trigger = patch.trigger;
  if (patch.size !== undefined) order.size = patch.size;
  if (patch.slippageBps !== undefined) order.slippageBps = patch.slippageBps;
  if (patch.cooldownMs !== undefined) order.cooldownMs = patch.cooldownMs;

  saveOrders(file);
  logger.debug(`Order updated: ${id}`);
  return order;
}

export function armOrder(id: string): BotOrder {
  const file = loadOrders();
  const order = file.orders.find((o) => o.id === id);
  if (!order) {
    throw new EchoError(ErrorCodes.BOT_ORDER_NOT_FOUND, `Order not found: ${id}`);
  }
  if (order.state !== "cancelled" && order.state !== "disarmed") {
    throw new EchoError(
      ErrorCodes.BOT_INVALID_ORDER,
      `Cannot arm order in state "${order.state}". Only cancelled/disarmed orders can be armed.`
    );
  }
  order.state = "armed";
  saveOrders(file);
  return order;
}

export function disarmOrder(id: string): BotOrder {
  const file = loadOrders();
  const order = file.orders.find((o) => o.id === id);
  if (!order) {
    throw new EchoError(ErrorCodes.BOT_ORDER_NOT_FOUND, `Order not found: ${id}`);
  }
  order.state = "disarmed";
  saveOrders(file);
  return order;
}

export function getArmedOrdersForToken(token: string): BotOrder[] {
  const file = loadOrders();
  const addr = token.toLowerCase();
  return file.orders.filter(
    (o) => o.token.toLowerCase() === addr && o.state === "armed"
  );
}

export function markFilled(id: string, txHash: string): void {
  const file = loadOrders();
  const order = file.orders.find((o) => o.id === id);
  if (!order) return;
  order.state = "filled";
  order.filledAt = Date.now();
  order.filledTxHash = txHash;
  saveOrders(file);
}

export function markFailed(id: string, reason: string): void {
  const file = loadOrders();
  const order = file.orders.find((o) => o.id === id);
  if (!order) return;
  order.state = "failed";
  order.failReason = reason;
  saveOrders(file);
}

export function setLastProcessedTxHash(id: string, txHash: string): void {
  const file = loadOrders();
  const order = file.orders.find((o) => o.id === id);
  if (!order) return;
  order.lastProcessedTxHash = txHash;
  saveOrders(file);
}

export function getOrderById(id: string): BotOrder | undefined {
  const file = loadOrders();
  return file.orders.find((o) => o.id === id);
}

export function listOrders(filter?: {
  token?: string;
  state?: OrderState | "all";
}): BotOrder[] {
  const file = loadOrders();
  let orders = file.orders;

  if (filter?.token) {
    const addr = filter.token.toLowerCase();
    orders = orders.filter((o) => o.token.toLowerCase() === addr);
  }

  if (filter?.state && filter.state !== "all") {
    orders = orders.filter((o) => o.state === filter.state);
  }

  return orders;
}

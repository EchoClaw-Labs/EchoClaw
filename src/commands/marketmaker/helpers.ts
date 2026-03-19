import { EchoError, ErrorCodes } from "../../errors.js";
import type { TriggerType, BotOrder } from "../../bot/types.js";

export const VALID_TRIGGERS: TriggerType[] = [
  "onNewBuy",
  "onNewSell",
  "priceAbove",
  "priceBelow",
  "bondingProgressAbove",
];

export function parseIntSafe(value: string, name: string): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) {
    throw new EchoError(ErrorCodes.INVALID_AMOUNT, `Invalid ${name}: ${value}`);
  }
  return n;
}

export function formatOrder(o: BotOrder): string {
  const trigger =
    o.trigger.type === "priceAbove" || o.trigger.type === "priceBelow" || o.trigger.type === "bondingProgressAbove"
      ? `${o.trigger.type}(${(o.trigger as { threshold: number }).threshold})`
      : o.trigger.type;

  let size: string;
  switch (o.size.mode) {
    case "absolute":
      size = `${o.size.amountOg} 0G`;
      break;
    case "absoluteTokens":
      size = `${o.size.amountTokens} tokens`;
      break;
    case "percent":
      size = `${o.size.percent}%`;
      break;
    case "all":
      size = "all";
      break;
  }

  return (
    `${o.id.slice(0, 8)} | ${o.state.padEnd(10)} | ${o.side.padEnd(4)} | ` +
    `${trigger.padEnd(28)} | ${size.padEnd(14)} | ` +
    `${o.token.slice(0, 10)}.. | slip=${o.slippageBps}bps`
  );
}

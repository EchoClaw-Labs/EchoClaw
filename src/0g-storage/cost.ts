/**
 * Cost calculation and formatting for 0G Storage operations.
 * Uses balance diff (pre/post) since SDK doesn't return cost directly.
 */

import type { CostInfo } from "./types.js";

const WEI_PER_OG = 10n ** 18n;
const DECIMALS = 6;
const SCALE = 10n ** BigInt(DECIMALS);

export function formatCost(weiDiff: bigint): CostInfo {
  const totalWei = weiDiff < 0n ? 0n : weiDiff;
  const wholePart = totalWei / WEI_PER_OG;
  const fracPart = (totalWei % WEI_PER_OG) * SCALE / WEI_PER_OG;
  const total0G = `${wholePart}.${fracPart.toString().padStart(DECIMALS, "0")}`;

  return {
    totalWei: totalWei.toString(),
    total0G,
  };
}

export function formatCostDisplay(cost: CostInfo): string {
  return `${cost.total0G} 0G`;
}

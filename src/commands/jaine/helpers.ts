import type { Address } from "viem";
import { getPublicClient } from "../../wallet/client.js";
import { EchoError, ErrorCodes } from "../../errors.js";
import { ERC20_EXTENDED_ABI } from "../../jaine/abi/erc20.js";
import { FEE_TIERS, type FeeTier } from "../../jaine/abi/factory.js";
import { getTokenSymbol } from "../../jaine/coreTokens.js";

export function validateFeeTier(fee: number): FeeTier {
  if (!FEE_TIERS.includes(fee as FeeTier)) {
    throw new EchoError(
      ErrorCodes.INVALID_FEE_TIER,
      `Invalid fee tier: ${fee}`,
      `Valid fee tiers: ${FEE_TIERS.join(", ")}`
    );
  }
  return fee as FeeTier;
}

export async function getTokenDecimals(token: Address): Promise<number> {
  const client = getPublicClient();
  const decimals = await client.readContract({
    address: token,
    abi: ERC20_EXTENDED_ABI,
    functionName: "decimals",
  });
  const n = Number(decimals);
  // Guard: NaN or out of range → fallback 18
  if (!Number.isFinite(n) || n < 0 || n > 255) {
    return 18;
  }
  return n;
}

export async function getTokenSymbolOnChain(token: Address): Promise<string> {
  const client = getPublicClient();
  try {
    return await client.readContract({
      address: token,
      abi: ERC20_EXTENDED_ABI,
      functionName: "symbol",
    });
  } catch {
    return getTokenSymbol(token);
  }
}

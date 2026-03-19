import type { Address, Hex } from "viem";
import { concat, pad, toHex } from "viem";

/**
 * Encode path for Uniswap V3 exactInput
 * Format: token0 + fee0 + token1 + fee1 + token2 + ...
 *
 * @param tokens - Array of token addresses in swap order
 * @param fees - Array of fee tiers (length = tokens.length - 1)
 * @returns Encoded path bytes
 */
export function encodePath(tokens: Address[], fees: number[]): Hex {
  if (tokens.length < 2) {
    throw new Error("Path must have at least 2 tokens");
  }
  if (fees.length !== tokens.length - 1) {
    throw new Error("Fees length must be tokens.length - 1");
  }

  // Each address is 20 bytes, each fee is 3 bytes
  const parts: Hex[] = [];

  for (let i = 0; i < tokens.length; i++) {
    // Add token address (20 bytes)
    parts.push(tokens[i].toLowerCase() as Hex);

    // Add fee if not last token (3 bytes)
    if (i < fees.length) {
      // Fee is uint24, encode as 3 bytes
      const feeHex = pad(toHex(fees[i]), { size: 3 });
      parts.push(feeHex);
    }
  }

  return concat(parts);
}

/**
 * Encode path for Uniswap V3 exactOutput
 * Note: exactOutput requires REVERSED path (tokenOut first)
 *
 * @param tokens - Array of token addresses in swap order (tokenIn → tokenOut)
 * @param fees - Array of fee tiers
 * @returns Encoded path bytes (reversed for exactOutput)
 */
export function encodePathForExactOutput(tokens: Address[], fees: number[]): Hex {
  // Reverse both arrays for exactOutput
  const reversedTokens = [...tokens].reverse();
  const reversedFees = [...fees].reverse();
  return encodePath(reversedTokens, reversedFees);
}

/**
 * Decode path bytes into tokens and fees
 *
 * @param path - Encoded path bytes
 * @returns Object with tokens array and fees array
 */
export function decodePath(path: Hex): { tokens: Address[]; fees: number[] } {
  // Remove 0x prefix
  const data = path.slice(2);

  // Each token is 20 bytes (40 hex chars), each fee is 3 bytes (6 hex chars)
  const tokens: Address[] = [];
  const fees: number[] = [];

  let offset = 0;
  let isToken = true;

  while (offset < data.length) {
    if (isToken) {
      // Read 20 bytes for token
      const tokenHex = data.slice(offset, offset + 40);
      tokens.push(`0x${tokenHex}` as Address);
      offset += 40;
      isToken = false;
    } else {
      // Read 3 bytes for fee
      const feeHex = data.slice(offset, offset + 6);
      fees.push(parseInt(feeHex, 16));
      offset += 6;
      isToken = true;
    }
  }

  return { tokens, fees };
}

/**
 * Calculate the number of hops in a path
 */
export function getPathHops(tokens: Address[]): number {
  return tokens.length - 1;
}

/**
 * Format path as human-readable string
 * e.g., "USDC → [0.3%] → w0G → [0.05%] → WETH"
 */
export function formatPath(
  tokens: Address[],
  fees: number[],
  getSymbol: (addr: Address) => string
): string {
  const parts: string[] = [];

  for (let i = 0; i < tokens.length; i++) {
    parts.push(getSymbol(tokens[i]));

    if (i < fees.length) {
      const feePercent = (fees[i] / 10000).toFixed(2);
      parts.push(`→ [${feePercent}%] →`);
    }
  }

  return parts.join(" ");
}

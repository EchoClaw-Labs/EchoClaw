import type { Address } from "viem";
import { isAddress, getAddress } from "viem";
import { EchoError, ErrorCodes } from "../errors.js";

/**
 * Core tokens on 0G mainnet supported by Jaine DEX
 * Addresses from MOLTBOT/jaine.md
 */
export const CORE_TOKENS: Record<string, Address> = {
  USDC: "0x1f3aa82227281ca364bfb3d253b0f1af1da6473e",
  WETH: "0x564770837ef8bbf077cfe54e5f6106538c815b22",
  stgUSDT: "0x9FBBAFC2Ad79af2b57eD23C60DfF79eF5c2b0FB5",
  stgUSDC: "0x8a2B28364102Bea189D99A475C494330Ef2bDD0B",
  w0G: "0x1Cd0690fF9a693f5EF2dD976660a8dAFc81A109c",
  st0G: "0x7bBC63D01CA42491c3E084C941c3E86e55951404",
  wstETH: "0x161a128567BF0C005b58211757F7e46eed983F02",
  PAI: "0x59ef6F3943bBdFE2fB19565037Ac85071223E94C",
  oUSDT: "0x1217BfE6c773EEC6cc4A38b5Dc45B92292B6E189",
  LINK: "0x76159c2b43ff6F630193e37EC68452169914C1Bb",
  coinbaseBTC: "0xa5613ac7f1E83a68719b1398c8F6aAA25581db82",
  HAIO: "0xbCB868d3d0A823ced82B77DD72E4f7A3C720A40E",
} as const;

/** List of core token symbols */
export const CORE_TOKEN_SYMBOLS = Object.keys(CORE_TOKENS) as (keyof typeof CORE_TOKENS)[];

/**
 * Resolve token symbol or address to checksummed address
 * @param tokenOrSymbol - Token symbol (e.g., "USDC") or address (0x...)
 * @param userAliases - Optional user-defined token aliases
 * @returns Checksummed address
 * @throws EchoError if token not found
 */
export function resolveToken(
  tokenOrSymbol: string,
  userAliases?: Record<string, Address>
): Address {
  // If it's already a valid address, return checksummed
  if (isAddress(tokenOrSymbol)) {
    return getAddress(tokenOrSymbol);
  }

  // Normalize symbol to match case-insensitive
  const upperSymbol = tokenOrSymbol.toUpperCase();

  // Check user aliases first (they have priority)
  if (userAliases) {
    for (const [symbol, addr] of Object.entries(userAliases)) {
      if (symbol.toUpperCase() === upperSymbol) {
        return getAddress(addr);
      }
    }
  }

  // Check core tokens (case-insensitive)
  for (const [symbol, addr] of Object.entries(CORE_TOKENS)) {
    if (symbol.toUpperCase() === upperSymbol) {
      return getAddress(addr);
    }
  }

  throw new EchoError(
    ErrorCodes.TOKEN_NOT_FOUND,
    `Token not found: ${tokenOrSymbol}`,
    `Use a valid address or one of: ${CORE_TOKEN_SYMBOLS.join(", ")}`
  );
}

/**
 * Get symbol for a token address (reverse lookup)
 * @param address - Token address
 * @param userAliases - Optional user-defined token aliases
 * @returns Symbol if found, shortened address otherwise
 */
export function getTokenSymbol(
  address: Address,
  userAliases?: Record<string, Address>
): string {
  const checksummed = getAddress(address);

  // Check user aliases first
  if (userAliases) {
    for (const [symbol, addr] of Object.entries(userAliases)) {
      if (getAddress(addr) === checksummed) {
        return symbol;
      }
    }
  }

  // Check core tokens
  for (const [symbol, addr] of Object.entries(CORE_TOKENS)) {
    if (getAddress(addr) === checksummed) {
      return symbol;
    }
  }

  // Return shortened address if not found
  return `${checksummed.slice(0, 6)}...${checksummed.slice(-4)}`;
}

/**
 * Check if a token is a core token
 */
export function isCoreToken(address: Address): boolean {
  const checksummed = getAddress(address);
  return Object.values(CORE_TOKENS).some((addr) => getAddress(addr) === checksummed);
}

/**
 * Get all core token addresses
 */
export function getCoreTokenAddresses(): Address[] {
  return Object.values(CORE_TOKENS).map((addr) => getAddress(addr));
}

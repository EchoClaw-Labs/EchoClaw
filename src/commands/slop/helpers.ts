import { parseUnits, type Address, type Hex } from "viem";
import { getPublicClient } from "../../wallet/client.js";
import { loadConfig } from "../../config/store.js";
import { EchoError, ErrorCodes } from "../../errors.js";
import { SLOP_TOKEN_ABI } from "../../slop/abi/token.js";
import { SLOP_REGISTRY_ABI } from "../../slop/abi/registry.js";

export function parseUnitsSafe(value: string, decimals: number, name: string): bigint {
  try {
    const result = parseUnits(value, decimals);
    if (result < 0n) {
      throw new EchoError(ErrorCodes.INVALID_AMOUNT, `${name} must be >= 0`);
    }
    return result;
  } catch (err) {
    if (err instanceof EchoError) throw err;
    throw new EchoError(
      ErrorCodes.INVALID_AMOUNT,
      `Invalid ${name}: ${value}`,
      "Must be a valid decimal number (e.g., 0.01, 100)"
    );
  }
}

export function validateUserSalt(salt: string): Hex {
  // Check format: 0x + 64 hex chars
  if (!/^0x[0-9a-fA-F]{64}$/.test(salt)) {
    throw new EchoError(
      ErrorCodes.INVALID_AMOUNT,
      "Invalid userSalt format",
      "Must be 32 bytes hex (0x + 64 hex characters)"
    );
  }
  // Check non-zero (contract requires non-zero salt)
  if (BigInt(salt) === 0n) {
    throw new EchoError(
      ErrorCodes.INVALID_AMOUNT,
      "userSalt cannot be zero",
      "Provide a non-zero 32-byte hex value"
    );
  }
  return salt as Hex;
}

export async function validateOfficialToken(tokenAddr: Address): Promise<void> {
  const cfg = loadConfig();
  const client = getPublicClient();

  const isValid = await client.readContract({
    address: cfg.slop.tokenRegistry,
    abi: SLOP_REGISTRY_ABI,
    functionName: "isValidToken",
    args: [tokenAddr],
  });

  if (!isValid) {
    throw new EchoError(
      ErrorCodes.SLOP_TOKEN_NOT_OFFICIAL,
      "Not an official slop.money token",
      `Token ${tokenAddr} is not registered in TokenRegistry`
    );
  }
}

export async function checkNotGraduated(tokenAddr: Address): Promise<void> {
  const client = getPublicClient();

  const isGraduated = await client.readContract({
    address: tokenAddr,
    abi: SLOP_TOKEN_ABI,
    functionName: "isGraduated",
  });

  if (isGraduated) {
    throw new EchoError(
      ErrorCodes.SLOP_TOKEN_GRADUATED,
      "Token has graduated - bonding curve trading disabled",
      "Use: echoclaw jaine swap to trade on the DEX"
    );
  }
}

export async function checkTradingEnabled(tokenAddr: Address): Promise<void> {
  const client = getPublicClient();

  const isTradingEnabled = await client.readContract({
    address: tokenAddr,
    abi: SLOP_TOKEN_ABI,
    functionName: "isTradingEnabled",
  });

  if (!isTradingEnabled) {
    throw new EchoError(
      ErrorCodes.SLOP_TRADE_DISABLED,
      "Trading is disabled for this token"
    );
  }
}

export interface TokenState {
  ogReserves: bigint;
  tokenReserves: bigint;
  virtualOgReserves: bigint;
  virtualTokenReserves: bigint;
  k: bigint;
  curveSupply: bigint;
  buyFeeBps: bigint;
  sellFeeBps: bigint;
  isGraduated: boolean;
}

export async function getTokenState(tokenAddr: Address): Promise<TokenState> {
  const client = getPublicClient();

  const [
    ogReserves,
    tokenReserves,
    virtualOgReserves,
    virtualTokenReserves,
    k,
    curveSupply,
    buyFeeBps,
    sellFeeBps,
    isGraduated,
  ] = await Promise.all([
    client.readContract({ address: tokenAddr, abi: SLOP_TOKEN_ABI, functionName: "ogReserves" }),
    client.readContract({ address: tokenAddr, abi: SLOP_TOKEN_ABI, functionName: "tokenReserves" }),
    client.readContract({ address: tokenAddr, abi: SLOP_TOKEN_ABI, functionName: "virtualOgReserves" }),
    client.readContract({ address: tokenAddr, abi: SLOP_TOKEN_ABI, functionName: "virtualTokenReserves" }),
    client.readContract({ address: tokenAddr, abi: SLOP_TOKEN_ABI, functionName: "k" }),
    client.readContract({ address: tokenAddr, abi: SLOP_TOKEN_ABI, functionName: "CURVE_SUPPLY" }),
    client.readContract({ address: tokenAddr, abi: SLOP_TOKEN_ABI, functionName: "buyFeeBps" }),
    client.readContract({ address: tokenAddr, abi: SLOP_TOKEN_ABI, functionName: "sellFeeBps" }),
    client.readContract({ address: tokenAddr, abi: SLOP_TOKEN_ABI, functionName: "isGraduated" }),
  ]);

  return {
    ogReserves,
    tokenReserves,
    virtualOgReserves,
    virtualTokenReserves,
    k,
    curveSupply,
    buyFeeBps: BigInt(buyFeeBps),
    sellFeeBps: BigInt(sellFeeBps),
    isGraduated,
  };
}

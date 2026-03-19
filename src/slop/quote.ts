/**
 * Slop.money bonding curve quote math.
 * Pure bigint functions matching BondingCurveLib.sol 1:1.
 */

/** Precision constant (1e18) for price calculations */
export const PRECISION = 10n ** 18n;

/** Graduation threshold: 80% of CURVE_SUPPLY sold triggers graduation */
export const GRADUATION_THRESHOLD_BPS = 8000n;

/**
 * Ceiling division - rounds up instead of down (protocol-favoring).
 * Formula: a == 0 ? 0 : (a - 1) / b + 1
 */
export function ceilDiv(a: bigint, b: bigint): bigint {
  if (b === 0n) throw new Error("Division by zero");
  return a === 0n ? 0n : (a - 1n) / b + 1n;
}

/**
 * Calculate tokens received for a given 0G input.
 * Mirrors BondingCurveLib.calculateTokensOut()
 *
 * Formula: tokensOut = tokenReserves - ceil(k / (ogReserves + ogIn))
 *
 * @param k Constant product invariant
 * @param ogReserves Current 0G reserves
 * @param tokenReserves Current token reserves
 * @param ogIn Amount of 0G to swap (AFTER fee deduction)
 * @returns tokensOut Amount of tokens to receive
 */
export function calculateTokensOut(
  k: bigint,
  ogReserves: bigint,
  tokenReserves: bigint,
  ogIn: bigint
): bigint {
  if (ogIn <= 0n) throw new Error("0G amount must be > 0");
  if (k <= 0n) throw new Error("K must be > 0");
  if (ogReserves <= 0n || tokenReserves <= 0n) throw new Error("Reserves must be > 0");

  const newOgReserves = ogReserves + ogIn;
  // SLO-12: ceilDiv rounds UP newTokenReserves, which rounds DOWN tokensOut
  const newTokenReserves = ceilDiv(k, newOgReserves);

  if (tokenReserves <= newTokenReserves) {
    throw new Error("Insufficient liquidity");
  }

  return tokenReserves - newTokenReserves;
}

/**
 * Calculate 0G received for a given token input.
 * Mirrors BondingCurveLib.calculateOgOut()
 *
 * Formula: ogOut = ogReserves - ceil(k / (tokenReserves + tokensIn))
 *
 * @param k Constant product invariant
 * @param ogReserves Current 0G reserves
 * @param tokenReserves Current token reserves
 * @param tokensIn Amount of tokens to swap
 * @returns ogOut Amount of 0G to receive (BEFORE fee deduction)
 */
export function calculateOgOut(
  k: bigint,
  ogReserves: bigint,
  tokenReserves: bigint,
  tokensIn: bigint
): bigint {
  if (tokensIn <= 0n) throw new Error("Token amount must be > 0");
  if (k <= 0n) throw new Error("K must be > 0");
  if (ogReserves <= 0n || tokenReserves <= 0n) throw new Error("Reserves must be > 0");

  const newTokenReserves = tokenReserves + tokensIn;
  // SLO-12: ceilDiv rounds UP newOgReserves, which rounds DOWN ogOut
  const newOgReserves = ceilDiv(k, newTokenReserves);

  if (ogReserves <= newOgReserves) {
    throw new Error("Insufficient liquidity");
  }

  return ogReserves - newOgReserves;
}

/**
 * Calculate spot price (price per token in 0G with 18 decimals).
 * Mirrors BondingCurveLib.calculateSpotPrice()
 */
export function calculateSpotPrice(ogReserves: bigint, tokenReserves: bigint): bigint {
  if (tokenReserves <= 0n) throw new Error("Token reserves must be > 0");
  return (ogReserves * PRECISION) / tokenReserves;
}

/**
 * Calculate partial fill for buy orders hitting the 80% graduation cap.
 *
 * @param ogReserves Current 0G reserves
 * @param tokenReserves Current token reserves
 * @param virtualTokenReserves Virtual token reserves (from token contract)
 * @param curveSupply CURVE_SUPPLY (from token contract)
 * @param ogAmountGross Gross 0G amount (BEFORE fee)
 * @param buyFeeBps Buy fee in basis points
 * @returns Object with tokensOut, ogUsed, feeUsed, refund
 */
export function calculatePartialFill(
  ogReserves: bigint,
  tokenReserves: bigint,
  virtualTokenReserves: bigint,
  curveSupply: bigint,
  ogAmountGross: bigint,
  buyFeeBps: bigint
): {
  tokensOut: bigint;
  ogUsed: bigint;
  feeUsed: bigint;
  refund: bigint;
  hitCap: boolean;
} {
  const k = ogReserves * tokenReserves;

  // Calculate fee and amount after fee
  const fee = (ogAmountGross * buyFeeBps) / 10000n;
  const amountAfterFee = ogAmountGross - fee;

  // Calculate tokens out
  let tokensOut = calculateTokensOut(k, ogReserves, tokenReserves, amountAfterFee);

  // Check graduation threshold
  const tokensSoldBefore = virtualTokenReserves - tokenReserves;
  const graduationThreshold = (curveSupply * GRADUATION_THRESHOLD_BPS) / 10000n;
  const remainingTo80 =
    tokensSoldBefore >= graduationThreshold ? 0n : graduationThreshold - tokensSoldBefore;

  if (remainingTo80 === 0n) {
    throw new Error("Graduation threshold reached - bonding curve trading disabled");
  }

  // Check if partial fill needed
  if (tokensOut > remainingTo80) {
    // Cap at remaining tokens
    tokensOut = remainingTo80;

    // Exact-out math: ogInUsed = ogReserves * tokensOut / (tokenReserves - tokensOut)
    const newTokenReserves = tokenReserves - tokensOut;
    if (newTokenReserves <= 0n) throw new Error("Would drain pool");

    // SLO-21: Use ceiling division (protocol-favoring rounding)
    const ogInUsed = ceilDiv(ogReserves * tokensOut, newTokenReserves);

    // Recalculate fee proportionally
    // ogAmountUsed = ogInUsed * 10000 / (10000 - buyFeeBps)
    const ogAmountUsed = ceilDiv(ogInUsed * 10000n, 10000n - buyFeeBps);
    const feeUsed = ogAmountUsed - ogInUsed;

    const refund = ogAmountGross - ogAmountUsed;

    return {
      tokensOut,
      ogUsed: ogInUsed,
      feeUsed,
      refund,
      hitCap: true,
    };
  }

  // No cap hit - full fill
  return {
    tokensOut,
    ogUsed: amountAfterFee,
    feeUsed: fee,
    refund: 0n,
    hitCap: false,
  };
}

/**
 * Apply slippage tolerance to calculate minimum output.
 *
 * @param amount Expected output amount
 * @param slippageBps Slippage tolerance in basis points (e.g., 50 = 0.5%)
 * @returns Minimum acceptable output
 */
export function applySlippage(amount: bigint, slippageBps: bigint): bigint {
  if (slippageBps < 0n || slippageBps > 10000n) {
    throw new Error("Invalid slippage (0-10000 bps)");
  }
  return (amount * (10000n - slippageBps)) / 10000n;
}

/**
 * Calculate graduation progress (percentage of CURVE_SUPPLY sold).
 *
 * @param tokenReserves Current token reserves
 * @param virtualTokenReserves Virtual token reserves
 * @param curveSupply CURVE_SUPPLY
 * @returns Progress in basis points (0-10000, where 8000 = graduation), clamped for safety
 */
export function calculateGraduationProgress(
  tokenReserves: bigint,
  virtualTokenReserves: bigint,
  curveSupply: bigint
): bigint {
  if (curveSupply === 0n) return 0n;

  // Clamp tokensSold to >= 0 for defensive safety
  const tokensSold = virtualTokenReserves > tokenReserves
    ? virtualTokenReserves - tokenReserves
    : 0n;

  const progress = (tokensSold * 10000n) / curveSupply;

  // Clamp to 0..10000 range
  if (progress < 0n) return 0n;
  if (progress > 10000n) return 10000n;
  return progress;
}

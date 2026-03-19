/**
 * Jaine (Uniswap V3) Factory ABI - minimal subset for pool discovery
 */
export const FACTORY_ABI = [
  {
    type: "function",
    name: "getPool",
    stateMutability: "view",
    inputs: [
      { name: "tokenA", type: "address" },
      { name: "tokenB", type: "address" },
      { name: "fee", type: "uint24" },
    ],
    outputs: [{ name: "pool", type: "address" }],
  },
  {
    type: "function",
    name: "feeAmountTickSpacing",
    stateMutability: "view",
    inputs: [{ name: "fee", type: "uint24" }],
    outputs: [{ name: "", type: "int24" }],
  },
] as const;

/** Standard Uniswap V3 fee tiers in basis points (100 = 0.01%) */
export const FEE_TIERS = [100, 500, 3000, 10000] as const;
export type FeeTier = (typeof FEE_TIERS)[number];

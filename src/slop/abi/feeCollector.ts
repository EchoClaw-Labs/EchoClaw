/**
 * FeeCollector ABI - minimal subset for fee queries and withdrawals
 */
export const SLOP_FEE_COLLECTOR_ABI = [
  // Fee stats per token
  {
    type: "function",
    name: "getTokenFeeStats",
    stateMutability: "view",
    inputs: [{ name: "token", type: "address" }],
    outputs: [
      { name: "totalCreator", type: "uint256" },
      { name: "totalPlatform", type: "uint256" },
      { name: "pendingCreator", type: "uint256" },
      { name: "pendingPlatform", type: "uint256" },
      { name: "volume", type: "uint256" },
    ],
  },
  // Fee config per token
  {
    type: "function",
    name: "tokenFeeConfigs",
    stateMutability: "view",
    inputs: [{ name: "token", type: "address" }],
    outputs: [
      { name: "creatorShare", type: "uint16" },
      { name: "platformShare", type: "uint16" },
      { name: "creator", type: "address" },
      { name: "isActive", type: "bool" },
    ],
  },
  // Creator withdrawal
  {
    type: "function",
    name: "withdrawCreatorFees",
    stateMutability: "nonpayable",
    inputs: [{ name: "token", type: "address" }],
    outputs: [],
  },
  // Global stats
  {
    type: "function",
    name: "totalFeesCollected",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "totalCreatorPayouts",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "totalPlatformRevenue",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  // Thresholds
  {
    type: "function",
    name: "minDistributionAmount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

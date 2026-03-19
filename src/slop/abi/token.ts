/**
 * SlopMoneyToken ABI - minimal subset for trading and queries
 */
export const SLOP_TOKEN_ABI = [
  // Trading
  {
    type: "function",
    name: "buyWithSlippage",
    stateMutability: "payable",
    inputs: [{ name: "minTokensOut", type: "uint256" }],
    outputs: [{ name: "tokensOut", type: "uint256" }],
  },
  {
    type: "function",
    name: "sellWithSlippage",
    stateMutability: "nonpayable",
    inputs: [
      { name: "tokenAmount", type: "uint256" },
      { name: "minOgOut", type: "uint256" },
    ],
    outputs: [{ name: "ogOut", type: "uint256" }],
  },
  // View - bonding curve state
  {
    type: "function",
    name: "ogReserves",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "tokenReserves",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "virtualOgReserves",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "virtualTokenReserves",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "k",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "CURVE_SUPPLY",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "TOTAL_SUPPLY",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  // View - token state
  {
    type: "function",
    name: "isGraduated",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "isTradingEnabled",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "creator",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "creationTime",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "liquidityPool",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "liquidityNFTId",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  // View - fees
  {
    type: "function",
    name: "buyFeeBps",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint16" }],
  },
  {
    type: "function",
    name: "sellFeeBps",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint16" }],
  },
  // View - price
  {
    type: "function",
    name: "getCurrentPrice",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "price", type: "uint256" },
      { name: "source", type: "uint8" },
    ],
  },
  // View - creator reward
  {
    type: "function",
    name: "pendingCreatorReward",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "CREATOR_GRADUATION_REWARD",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  // View - LP fees (post-graduation)
  {
    type: "function",
    name: "getPendingLPFees",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "pendingW0G", type: "uint256" },
      { name: "pendingToken", type: "uint256" },
    ],
  },
  // Creator actions
  {
    type: "function",
    name: "claimCreatorReward",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
  {
    type: "function",
    name: "collectLPFees",
    stateMutability: "nonpayable",
    inputs: [{ name: "recipient", type: "address" }],
    outputs: [
      { name: "w0gFees", type: "uint256" },
      { name: "tokenFees", type: "uint256" },
    ],
  },
  // Metadata
  {
    type: "function",
    name: "metadata",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "description", type: "string" },
      { name: "imageUrl", type: "string" },
      { name: "twitter", type: "string" },
      { name: "telegram", type: "string" },
      { name: "website", type: "string" },
    ],
  },
  // ERC20 standard
  {
    type: "function",
    name: "name",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
  {
    type: "function",
    name: "symbol",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
  {
    type: "function",
    name: "totalSupply",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  // Trade info
  {
    type: "function",
    name: "tradeInfo",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "totalVolume", type: "uint256" },
      { name: "totalTransactions", type: "uint256" },
      { name: "buyCount", type: "uint256" },
      { name: "sellCount", type: "uint256" },
      { name: "uniqueTraders", type: "uint256" },
    ],
  },
] as const;

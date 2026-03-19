/**
 * TokenRegistry ABI - minimal subset for token queries
 */
export const SLOP_REGISTRY_ABI = [
  {
    type: "function",
    name: "isValidToken",
    stateMutability: "view",
    inputs: [{ name: "tokenAddress", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "tokenInfo",
    stateMutability: "view",
    inputs: [{ name: "tokenAddress", type: "address" }],
    outputs: [
      { name: "name", type: "string" },
      { name: "symbol", type: "string" },
      { name: "creator", type: "address" },
      { name: "createdAt", type: "uint256" },
      { name: "isGraduated", type: "bool" },
    ],
  },
  {
    type: "function",
    name: "getCreatorTokens",
    stateMutability: "view",
    inputs: [{ name: "creator", type: "address" }],
    outputs: [{ name: "", type: "address[]" }],
  },
  {
    type: "function",
    name: "getTokensInfo",
    stateMutability: "view",
    inputs: [{ name: "tokenAddresses", type: "address[]" }],
    outputs: [
      {
        name: "infos",
        type: "tuple[]",
        components: [
          { name: "name", type: "string" },
          { name: "symbol", type: "string" },
          { name: "creator", type: "address" },
          { name: "createdAt", type: "uint256" },
          { name: "isGraduated", type: "bool" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "getTokensPaginated",
    stateMutability: "view",
    inputs: [
      { name: "offset", type: "uint256" },
      { name: "limit", type: "uint256" },
    ],
    outputs: [
      { name: "tokens", type: "address[]" },
      { name: "total", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "getStatistics",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "total", type: "uint256" },
      { name: "graduated", type: "uint256" },
      { name: "active", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "totalTokensCreated",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "creatorTokenCount",
    stateMutability: "view",
    inputs: [{ name: "creator", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

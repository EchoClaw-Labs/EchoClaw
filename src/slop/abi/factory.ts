/**
 * SlopMoneyFactory ABI - minimal subset for token creation and queries
 */
export const SLOP_FACTORY_ABI = [
  // Token creation
  {
    type: "function",
    name: "createToken",
    stateMutability: "nonpayable",
    inputs: [
      { name: "name", type: "string" },
      { name: "symbol", type: "string" },
      { name: "description", type: "string" },
      { name: "imageUrl", type: "string" },
      { name: "twitter", type: "string" },
      { name: "telegram", type: "string" },
      { name: "website", type: "string" },
      { name: "userSalt", type: "bytes32" },
    ],
    outputs: [{ name: "tokenAddress", type: "address" }],
  },
  // View functions
  {
    type: "function",
    name: "isOfficialToken",
    stateMutability: "view",
    inputs: [{ name: "token", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "tokenCreator",
    stateMutability: "view",
    inputs: [{ name: "token", type: "address" }],
    outputs: [{ name: "", type: "address" }],
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
    name: "totalTokensGraduated",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  // Events
  {
    type: "event",
    name: "TokenCreated",
    inputs: [
      { name: "tokenAddress", type: "address", indexed: true },
      { name: "creator", type: "address", indexed: true },
      { name: "name", type: "string", indexed: false },
      { name: "symbol", type: "string", indexed: false },
      { name: "imageUrl", type: "string", indexed: false },
      { name: "description", type: "string", indexed: false },
      { name: "twitter", type: "string", indexed: false },
      { name: "telegram", type: "string", indexed: false },
      { name: "website", type: "string", indexed: false },
      { name: "tokenId", type: "uint256", indexed: false },
      { name: "timestamp", type: "uint256", indexed: false },
    ],
  },
] as const;

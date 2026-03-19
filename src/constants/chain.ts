import type { Address } from "viem";

export const CHAIN = {
  chainId: 16661,
  name: "0G Mainnet",
  rpc: "https://evmrpc.0g.ai",
  explorer: "https://chainscan.0g.ai",
} as const;

// Jaine DEX (Uniswap V3 fork) + W0G
export const PROTOCOL = {
  w0g: "0x1cd0690ff9a693f5ef2dd976660a8dafc81a109c" as Address,
  jaineFactory: "0x9bdcA5798E52e592A08e3b34d3F18EeF76Af7ef4" as Address,
  jaineRouter: "0x8B598A7C136215A95ba0282b4d832B9f9801f2e2" as Address,
  nftPositionManager: "0x8F67A30Ed186e3E1f6504c6dE3239Ef43A2e0d72" as Address,
  quoter: "0xd00883722cECAD3A1c60bCA611f09e1851a0bE02" as Address,
  w0gUsdcPool: "0xa9e824Eddb9677fB2189AB9c439238A83695C091" as Address,
} as const;

// Slop.money (bonding curve token launcher)
export const SLOP = {
  factory: "0x9f33ccdecbdff42c7daa22b8ad0ea7e7f3e534ec" as Address,
  tokenRegistry: "0x8aa0ae1b35a41d12747c048269571f3722487e34" as Address,
  feeCollector: "0x3d9611112a9186c6006cafec27c50620f036d63c" as Address,
  graduationModule: "0xcc2f0a59f308cf4e35146136b32ec2bc09f4623c" as Address,
  securityModule: "0x15b73cbd4f2463932a87fbd3b4fb1787affee102" as Address,
  configVault: "0x42e95c5377843cf9fa8ab8303d4ed6f131503ef6" as Address,
  lpFeesHelper: "0xb4dc1d4064d329b832acf344ccd0f47ce7fc7154" as Address,
  revenueDistributor: "0x25981703435a5bc5fa3fe82bcd3cc48fdb373f49" as Address,
} as const;

// Minimal ERC20 ABI for balance/symbol/decimals
export const ERC20_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
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
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

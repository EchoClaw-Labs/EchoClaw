import type { LauncherItem } from "./types.js";

export { PROVIDER_LABELS } from "../../shared/runtime-catalog.js";

export const EXPLORE_ITEMS: LauncherItem[] = [
  {
    id: "ai-providers",
    title: "See AI providers on 0G",
    badge: "needs wallet",
    description: "Inspect live chat providers, models, and pricing on 0G.",
    command: "echoclaw 0g-compute providers --detailed --json",
  },
  {
    id: "chain-data",
    title: "Read chain data",
    badge: "read-only",
    description: "Use ChainScan surfaces to inspect balances, holders, and transactions.",
    command: "echoclaw chainscan --help",
  },
  {
    id: "swap-preview",
    title: "Preview swaps",
    badge: "read-only",
    description: "Quote and inspect Jaine routes without moving funds.",
    command: "echoclaw jaine pools scan-core --json",
  },
  {
    id: "storage",
    title: "See storage actions",
    badge: "needs wallet",
    description: "Learn which 0G Storage commands are available before uploading files.",
    command: "echoclaw 0g-storage --help",
  },
  {
    id: "social",
    title: "See social actions",
    badge: "read-only",
    description: "Browse EchoBook modules and read-only paths before authenticating.",
    command: "echoclaw echobook --help",
  },
  {
    id: "cross-chain",
    title: "Cross-chain bridge (Khalani)",
    badge: "moves funds",
    description: "Quote and execute cross-chain bridges via the Khalani / HyperStream aggregator.",
    command: "echoclaw khalani bridge --help",
  },
  {
    id: "token-discovery",
    title: "Discover tokens and balances",
    badge: "read-only",
    description: "Search tokens across chains with Khalani and check multi-chain wallet balances.",
    command: "echoclaw khalani tokens top --json  |  echoclaw wallet balances --json",
  },
  {
    id: "solana",
    title: "Solana DeFi (Jupiter)",
    badge: "full DeFi",
    description: "Swap, stake, lend, trade predictions, browse trending tokens, DCA, limit orders — all on Solana via Jupiter.",
    command: "echoclaw solana --help",
  },
];

export const ADVANCED_ITEMS: LauncherItem[] = [
  {
    id: "compute",
    title: "Low-level 0G Compute commands",
    badge: "advanced",
    description: "Use shared provider, ledger, API key, and monitor primitives directly.",
    command: "echoclaw 0g-compute --help",
  },
  {
    id: "skills",
    title: "Skill installation surface",
    badge: "advanced",
    description: "Install or inspect skill paths directly for OpenClaw, Claude Code, Codex, or Other.",
    command: "echoclaw skill --help",
  },
  {
    id: "wallet",
    title: "Wallet and transfer primitives",
    badge: "moves funds",
    description: "Create/import EVM and Solana wallets, back up keystore data, check multi-chain balances, and use send prepare/confirm flows.",
    command: "echoclaw wallet --help",
  },
  {
    id: "storage",
    title: "0G Storage primitives",
    badge: "needs wallet",
    description: "Work with storage setup, files, virtual drive, notes, and backups directly.",
    command: "echoclaw 0g-storage --help",
  },
  {
    id: "defi",
    title: "DeFi and chain modules",
    badge: "mixed",
    description: "Jump straight to Jaine, ChainScan, Slop, EchoBook, or MarketMaker command surfaces.",
    command: "echoclaw jaine --help",
  },
];

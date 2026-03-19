import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Address } from "viem";
import { CHAIN, PROTOCOL, SLOP } from "../constants/chain.js";
import { CONFIG_DIR, CONFIG_FILE } from "./paths.js";
import logger from "../utils/logger.js";

export interface EchoConfig {
  version: 1;
  chain: {
    chainId: number;
    rpcUrl: string;
    explorerUrl: string;
  };
  protocol: {
    w0g: Address;
    jaineFactory: Address;
    jaineRouter: Address;
    nftPositionManager: Address;
    quoter: Address;
    w0gUsdcPool: Address;
  };
  slop: {
    factory: Address;
    tokenRegistry: Address;
    feeCollector: Address;
    graduationModule: Address;
    securityModule: Address;
    configVault: Address;
    lpFeesHelper: Address;
    revenueDistributor: Address;
  };
  wallet: {
    address: Address | null;
    solanaAddress: string | null;
  };
  services: {
    backendApiUrl: string;
    proxyApiUrl: string;
    chatWsUrl: string;
    echoApiUrl: string;
    chainScanBaseUrl: string;
    khalaniApiUrl: string;
    jaineSubgraphUrl: string;
    slopWsUrl: string;
    storageIndexerRpcUrl: string;
    storageEvmRpcUrl: string;
    storageFlowContract: string;
  };
  solana: {
    cluster: "mainnet-beta" | "devnet" | "testnet" | "custom";
    rpcUrl: string;
    explorerUrl: string;
    commitment: string;
    jupiterApiKey: string;
  };
  claude?: {
    provider: string;
    model: string;
    providerEndpoint: string;
    proxyPort: number;
  };
}

export function getDefaultConfig(): EchoConfig {
  return {
    version: 1,
    chain: {
      chainId: CHAIN.chainId,
      rpcUrl: CHAIN.rpc,
      explorerUrl: CHAIN.explorer,
    },
    protocol: {
      w0g: PROTOCOL.w0g,
      jaineFactory: PROTOCOL.jaineFactory,
      jaineRouter: PROTOCOL.jaineRouter,
      nftPositionManager: PROTOCOL.nftPositionManager,
      quoter: PROTOCOL.quoter,
      w0gUsdcPool: PROTOCOL.w0gUsdcPool,
    },
    slop: {
      factory: SLOP.factory,
      tokenRegistry: SLOP.tokenRegistry,
      feeCollector: SLOP.feeCollector,
      graduationModule: SLOP.graduationModule,
      securityModule: SLOP.securityModule,
      configVault: SLOP.configVault,
      lpFeesHelper: SLOP.lpFeesHelper,
      revenueDistributor: SLOP.revenueDistributor,
    },
    wallet: {
      address: null,
      solanaAddress: null,
    },
    solana: {
      cluster: "mainnet-beta" as const,
      rpcUrl: "https://api.mainnet-beta.solana.com",
      explorerUrl: "https://explorer.solana.com",
      commitment: "confirmed",
      jupiterApiKey: "",
    },
    services: {
      backendApiUrl: "https://be.slop.money/api",
      proxyApiUrl: "https://ai.slop.money/api",
      chatWsUrl: "https://ai.slop.money",
      echoApiUrl: "https://backend.echoclaw.ai/api",
      chainScanBaseUrl: "https://chainscan.0g.ai/open",
      khalaniApiUrl: "https://api.hyperstream.dev",
      jaineSubgraphUrl: "https://api.goldsky.com/api/public/project_cmgl0cagfjymu01wc2mojevm6/subgraphs/jaine-v3-goldsky/0.0.2/gn",
      slopWsUrl: "https://be.slop.money",
      storageIndexerRpcUrl: "https://indexer-storage-turbo.0g.ai",
      storageEvmRpcUrl: "https://evmrpc.0g.ai",
      storageFlowContract: "0x62d4144db0f0a6fbbaeb6296c785c71b3d57c526",
    },
  };
}

export function ensureConfigDir(): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
    logger.debug(`Created config directory: ${CONFIG_DIR}`);
  }
}

function parseClaudeConfig(raw: unknown): EchoConfig["claude"] | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return undefined;
  }

  const candidate = raw as Record<string, unknown>;
  if (
    typeof candidate.provider !== "string"
    || typeof candidate.model !== "string"
    || typeof candidate.providerEndpoint !== "string"
    || typeof candidate.proxyPort !== "number"
  ) {
    return undefined;
  }

  return {
    provider: candidate.provider,
    model: candidate.model,
    providerEndpoint: candidate.providerEndpoint,
    proxyPort: candidate.proxyPort,
  };
}

export function loadConfig(): EchoConfig {
  ensureConfigDir();
  const defaults = getDefaultConfig();

  if (!existsSync(CONFIG_FILE)) {
    logger.debug("Config file not found, using defaults");
    return defaults;
  }

  try {
    const raw = readFileSync(CONFIG_FILE, "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;

    // Validate version
    if (parsed.version !== 1) {
      logger.warn(`Unknown config version ${parsed.version}, using defaults`);
      return defaults;
    }

    const {
      watchlist: _legacyWatchlist,
      ...parsedWithoutWatchlist
    } = parsed;

    // Deep merge with defaults to handle missing fields
    return {
      ...defaults,
      ...parsedWithoutWatchlist,
      chain: {
        ...defaults.chain,
        ...((parsed.chain as Record<string, unknown> | undefined) ?? {}),
      },
      protocol: {
        ...defaults.protocol,
        ...((parsed.protocol as Record<string, unknown> | undefined) ?? {}),
      },
      slop: {
        ...defaults.slop,
        ...((parsed.slop as Record<string, unknown> | undefined) ?? {}),
      },
      wallet: {
        ...defaults.wallet,
        ...((parsed.wallet as Record<string, unknown> | undefined) ?? {}),
      },
      solana: {
        ...defaults.solana,
        ...((parsed.solana as Record<string, unknown> | undefined) ?? {}),
      },
      services: {
        ...defaults.services,
        ...((parsed.services as Record<string, unknown> | undefined) ?? {}),
      },
      ...(parseClaudeConfig(parsed.claude) ? { claude: parseClaudeConfig(parsed.claude) } : {}),
    };
  } catch (err) {
    logger.error(`Failed to parse config: ${err}`);
    return defaults;
  }
}

export function saveConfig(config: EchoConfig): void {
  ensureConfigDir();

  const dir = dirname(CONFIG_FILE);
  const tmpFile = join(dir, `.config.tmp.${Date.now()}.json`);

  try {
    // Atomic write: write to temp, then rename
    writeFileSync(tmpFile, JSON.stringify(config, null, 2), "utf-8");
    renameSync(tmpFile, CONFIG_FILE);
    logger.debug(`Config saved to ${CONFIG_FILE}`);
  } catch (err) {
    // Cleanup temp file if rename failed
    try {
      if (existsSync(tmpFile)) {
        unlinkSync(tmpFile);
      }
    } catch {
      // Ignore cleanup errors
    }
    throw err;
  }
}

export function configExists(): boolean {
  return existsSync(CONFIG_FILE);
}

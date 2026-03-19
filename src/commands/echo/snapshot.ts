import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadComputeState, type ReadinessResult, checkComputeReadiness } from "../../0g-compute/readiness.js";
import { getMonitorPid } from "../../0g-compute/monitor-lifecycle.js";
import { loadConfig, configExists } from "../../config/store.js";
import { autoDetectProvider, detectProviders, resolveProvider } from "../../providers/registry.js";
import { getSkillSourcePath } from "../../providers/link-utils.js";
import type { DetectionResult, ProviderName } from "../../providers/types.js";
import { keystoreExists } from "../../wallet/keystore.js";
import { solanaKeystoreExists } from "../../wallet/solana-keystore.js";
import { resetAuthenticatedBroker } from "../../0g-compute/broker-factory.js";
import { getClaudeProxyHealth, type ClaudeProxyHealth } from "./claude-health.js";
import { getPasswordHealth, type PasswordHealth } from "./password-health.js";

export interface WalletHealth {
  configuredAddress: string | null;
  keystorePresent: boolean;
  evmAddress: string | null;
  evmKeystorePresent: boolean;
  solanaAddress: string | null;
  solanaKeystorePresent: boolean;
  password: PasswordHealth;
  decryptable: boolean;
}

export interface SkillLinkStatus {
  provider: ProviderName;
  sourcePath: string;
  userTarget: string;
  userLinked: boolean;
  projectTarget: string | null;
  projectLinked: boolean;
  manualOnly: boolean;
}

export interface EchoSnapshot {
  generatedAt: string;
  version: string;
  configExists: boolean;
  wallet: WalletHealth;
  runtimes: {
    recommended: ProviderName;
    detected: Record<ProviderName, DetectionResult>;
    skills: SkillLinkStatus[];
  };
  compute: {
    state: ReturnType<typeof loadComputeState>;
    readiness: ReadinessResult | null;
  };
  claude: ClaudeProxyHealth;
  monitor: {
    running: boolean;
    pid: number | null;
  };
  solanaCluster: string;
  solanaRpcUrl: string;
  jupiterApiKeySet: boolean;
}

function getVersion(): string {
  try {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const pkgPath = join(__dirname, "..", "..", "..", "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { version?: string };
    return pkg.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

function getSkillLinkStatuses(): SkillLinkStatus[] {
  const providers: ProviderName[] = ["openclaw", "claude-code", "codex", "other"];

  return providers.map((providerName) => {
    const adapter = resolveProvider(providerName);
    const userTargets = adapter.getSkillTargets("user");
    const projectTargets = adapter.getSkillTargets("project");

    return {
      provider: providerName,
      sourcePath: getSkillSourcePath("echoclaw"),
      userTarget: userTargets.userDir,
      userLinked: existsSync(userTargets.userDir),
      projectTarget: projectTargets.projectDir ?? null,
      projectLinked: projectTargets.projectDir ? existsSync(projectTargets.projectDir) : false,
      manualOnly: providerName === "other",
    };
  });
}

export async function buildEchoSnapshot(opts?: {
  includeReadiness?: boolean;
  fresh?: boolean;
}): Promise<EchoSnapshot> {
  if (opts?.fresh) {
    resetAuthenticatedBroker();
  }

  const cfg = loadConfig();
  const password = getPasswordHealth();
  const evmKeystorePresent = keystoreExists();
  const solanaKeystorePresent = solanaKeystoreExists();
  const wallet: WalletHealth = {
    configuredAddress: cfg.wallet.address,
    keystorePresent: evmKeystorePresent,
    evmAddress: cfg.wallet.address,
    evmKeystorePresent,
    solanaAddress: cfg.wallet.solanaAddress,
    solanaKeystorePresent,
    password,
    decryptable: (password.status === "ready" || password.status === "drift") && (evmKeystorePresent || solanaKeystorePresent),
  };

  let readiness: ReadinessResult | null = null;
  if (opts?.includeReadiness) {
    try {
      readiness = await checkComputeReadiness();
    } catch {
      readiness = null;
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    version: getVersion(),
    configExists: configExists(),
    wallet,
    runtimes: {
      recommended: autoDetectProvider().name,
      detected: detectProviders(),
      skills: getSkillLinkStatuses(),
    },
    compute: {
      state: loadComputeState(),
      readiness,
    },
    claude: await getClaudeProxyHealth(),
    monitor: {
      running: getMonitorPid() != null,
      pid: getMonitorPid(),
    },
    solanaCluster: cfg.solana?.cluster ?? "mainnet-beta",
    solanaRpcUrl: cfg.solana?.rpcUrl ?? "https://api.mainnet-beta.solana.com",
    jupiterApiKeySet: Boolean(cfg.solana?.jupiterApiKey),
  };
}

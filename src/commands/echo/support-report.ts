import type { EchoSnapshot } from "./snapshot.js";

function truncateValue(value: string | null): string | null {
  if (!value) return null;
  if (!value.startsWith("0x") || value.length < 14) return value;
  return `${value.slice(0, 8)}...${value.slice(-4)}`;
}

export function buildSupportReport(snapshot: EchoSnapshot): Record<string, unknown> {
  return {
    generatedAt: snapshot.generatedAt,
    version: snapshot.version,
    configExists: snapshot.configExists,
    wallet: {
      configuredAddress: truncateValue(snapshot.wallet.configuredAddress),
      keystorePresent: snapshot.wallet.keystorePresent,
      evmAddress: truncateValue(snapshot.wallet.evmAddress),
      evmKeystorePresent: snapshot.wallet.evmKeystorePresent,
      solanaAddress: truncateValue(snapshot.wallet.solanaAddress),
      solanaKeystorePresent: snapshot.wallet.solanaKeystorePresent,
      passwordStatus: snapshot.wallet.password.status,
      passwordSource: snapshot.wallet.password.source,
      passwordDriftSources: snapshot.wallet.password.driftSources,
    },
    runtimes: {
      recommended: snapshot.runtimes.recommended,
      detected: Object.fromEntries(
        Object.entries(snapshot.runtimes.detected).map(([key, value]) => [key, {
          detected: value.detected,
          detail: value.detail ?? null,
          version: value.version ?? null,
        }]),
      ),
      skills: snapshot.runtimes.skills.map((entry) => ({
        provider: entry.provider,
        userTarget: entry.userTarget,
        userLinked: entry.userLinked,
        projectTarget: entry.projectTarget,
        projectLinked: entry.projectLinked,
        manualOnly: entry.manualOnly,
      })),
    },
    compute: {
      activeProvider: truncateValue(snapshot.compute.state?.activeProvider ?? null),
      model: snapshot.compute.state?.model ?? null,
      readiness: snapshot.compute.readiness
        ? {
            ready: snapshot.compute.readiness.ready,
            provider: truncateValue(snapshot.compute.readiness.provider),
            checks: snapshot.compute.readiness.checks,
          }
        : null,
    },
    claude: {
      configured: snapshot.claude.configured,
      running: snapshot.claude.running,
      healthy: snapshot.claude.healthy,
      port: snapshot.claude.port,
      provider: truncateValue(snapshot.claude.provider),
      model: snapshot.claude.model,
      providerEndpoint: snapshot.claude.providerEndpoint,
      authConfigured: snapshot.claude.authConfigured,
      settings: snapshot.claude.settings,
    },
    monitor: snapshot.monitor,
  };
}

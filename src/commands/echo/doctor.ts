import { getCachedKhalaniChains } from "../../khalani/chains.js";
import { colors } from "../../utils/ui.js";
import type { EchoSnapshot } from "./snapshot.js";

export interface DoctorCheck {
  id: string;
  ok: boolean;
  title: string;
  detail: string;
  hint?: string;
}

export async function buildDoctorChecks(snapshot: EchoSnapshot): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [
    {
      id: "config",
      ok: snapshot.configExists,
      title: "Config file",
      detail: snapshot.configExists ? "Config directory and config.json available" : "Config file missing",
      hint: snapshot.configExists ? undefined : "Run: echoclaw config init --json",
    },
    {
      id: "wallet-address",
      ok: snapshot.wallet.configuredAddress != null,
      title: "Wallet address",
      detail: snapshot.wallet.configuredAddress ?? "No wallet address configured",
      hint: snapshot.wallet.configuredAddress ? undefined : "Use `echoclaw echo` -> Wallet & Keys",
    },
    {
      id: "keystore",
      ok: snapshot.wallet.keystorePresent,
      title: "Keystore",
      detail: snapshot.wallet.keystorePresent ? "Encrypted keystore present" : "No keystore found",
      hint: snapshot.wallet.keystorePresent ? undefined : "Use `echoclaw echo` -> Wallet & Keys",
    },
    {
      id: "password",
      ok: snapshot.wallet.password.status === "ready",
      title: "Keystore password",
      detail:
        snapshot.wallet.password.status === "ready"
          ? `Resolved from ${snapshot.wallet.password.source}`
          : snapshot.wallet.password.status === "drift"
            ? `Password drift detected across: ${snapshot.wallet.password.driftSources.join(", ")}`
            : snapshot.wallet.password.status === "invalid"
              ? "Password does not decrypt current keystore"
              : "Keystore password not configured",
      hint:
        snapshot.wallet.password.status === "ready"
          ? undefined
          : "Use `echoclaw echo` -> Manage / Fix or Wallet & Keys",
    },
    {
      id: "runtime-detection",
      ok: Object.values(snapshot.runtimes.detected).some((entry) => entry.detected),
      title: "AI runtime detection",
      detail: `Recommended runtime: ${colors.info(snapshot.runtimes.recommended)}`,
      hint: "Use `echoclaw echo` -> Connect my AI",
    },
  ];

  if (snapshot.compute.readiness) {
    for (const [key, value] of Object.entries(snapshot.compute.readiness.checks)) {
      checks.push({
        id: `compute-${key}`,
        ok: value.ok,
        title: `0G Compute: ${key}`,
        detail: value.detail ?? (value.ok ? "OK" : "Failed"),
        hint: value.hint,
      });
    }
  }

  if (snapshot.wallet.solanaAddress || snapshot.wallet.solanaKeystorePresent) {
    checks.push({
      id: "solana-wallet-address",
      ok: snapshot.wallet.solanaAddress != null,
      title: "Solana wallet address",
      detail: snapshot.wallet.solanaAddress ?? "No Solana wallet address configured",
      hint: snapshot.wallet.solanaAddress ? undefined : "Use `echoclaw wallet create --chain solana`",
    });
    checks.push({
      id: "solana-keystore",
      ok: snapshot.wallet.solanaKeystorePresent,
      title: "Solana keystore",
      detail: snapshot.wallet.solanaKeystorePresent ? "Encrypted Solana keystore present" : "No Solana keystore found",
      hint: snapshot.wallet.solanaKeystorePresent ? undefined : "Use `echoclaw wallet create --chain solana`",
    });
  }

  if (snapshot.claude.configured) {
    checks.push({
      id: "claude-proxy",
      ok: snapshot.claude.running && snapshot.claude.healthy,
      title: "Claude proxy",
      detail: snapshot.claude.running
        ? snapshot.claude.healthy
          ? `Running on port ${snapshot.claude.port}`
          : `Running but health endpoint is unreachable on port ${snapshot.claude.port}`
        : "Proxy not running",
      hint: "Use `echoclaw echo` -> Manage / Fix -> Fix Claude",
    });
  }

  if (snapshot.monitor.running) {
    checks.push({
      id: "monitor",
      ok: true,
      title: "Balance monitor",
      detail: `Running (PID ${snapshot.monitor.pid})`,
    });
  }

  if (snapshot.wallet.solanaAddress || snapshot.wallet.solanaKeystorePresent) {
    let khalaniOk = false;
    let khalaniDetail = "Khalani API unreachable";
    try {
      const chains = await getCachedKhalaniChains();
      khalaniOk = chains.length > 0;
      khalaniDetail = khalaniOk
        ? `Khalani API reachable (${chains.length} chains)`
        : "Khalani API returned no chains";
    } catch (err) {
      khalaniDetail = `Khalani API error: ${err instanceof Error ? err.message : String(err)}`;
    }
    checks.push({
      id: "khalani-api",
      ok: khalaniOk,
      title: "Khalani cross-chain API",
      detail: khalaniDetail,
      hint: khalaniOk ? undefined : "Check network connectivity or Khalani service status.",
    });
  }

  return checks;
}

/**
 * Strict readiness check for 0G Compute.
 *
 * Single source of truth used by both `onboard/steps/compute.detect()`
 * and `0g-compute setup`.  Performs on-chain + config checks to verify
 * that the compute stack is fully operational.
 */

import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { withSuppressedConsole } from "./bridge.js";
import { getAuthenticatedBroker } from "./broker-factory.js";
import { normalizeSubAccount, normalizeInferTuple } from "./account.js";
import { calculateProviderPricing } from "./pricing.js";
import { ZG_COMPUTE_DIR, ZG_COMPUTE_STATE_FILE } from "./constants.js";
import { requireWalletAndKeystore } from "../bot/executor.js";
import { loadOpenclawConfig } from "../openclaw/config.js";
import logger from "../utils/logger.js";

// ── Compute state persistence ────────────────────────────────────────

export interface ComputeState {
  activeProvider: string;
  model: string;
  configuredAt: number;
}

export function loadComputeState(): ComputeState | null {
  if (!existsSync(ZG_COMPUTE_STATE_FILE)) return null;
  try {
    const raw = readFileSync(ZG_COMPUTE_STATE_FILE, "utf-8");
    const parsed = JSON.parse(raw) as Partial<ComputeState>;
    if (typeof parsed.activeProvider !== "string" || !parsed.activeProvider) return null;
    return parsed as ComputeState;
  } catch {
    return null;
  }
}

export function saveComputeState(state: ComputeState): void {
  if (!existsSync(ZG_COMPUTE_DIR)) {
    mkdirSync(ZG_COMPUTE_DIR, { recursive: true });
  }
  const tmpFile = join(dirname(ZG_COMPUTE_STATE_FILE), `.compute-state.${Date.now()}.tmp`);
  writeFileSync(tmpFile, JSON.stringify(state, null, 2), "utf-8");
  renameSync(tmpFile, ZG_COMPUTE_STATE_FILE);
  logger.debug(`[0G Compute] State saved to ${ZG_COMPUTE_STATE_FILE}`);
}

// ── Readiness check ──────────────────────────────────────────────────

export interface ReadinessCheck {
  ok: boolean;
  detail?: string;
  hint?: string;
}

export interface ReadinessResult {
  ready: boolean;
  provider: string | null;
  checks: {
    wallet: ReadinessCheck;
    broker: ReadinessCheck;
    ledger: ReadinessCheck;
    subAccount: ReadinessCheck;
    ack: ReadinessCheck;
    openclawConfig: ReadinessCheck;
  };
}

function fail(detail: string, hint?: string): ReadinessCheck {
  return { ok: false, detail, hint };
}

function pass(detail?: string): ReadinessCheck {
  return { ok: true, detail };
}

/** Strip trailing slashes and normalise scheme+host for URL comparison. */
function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, "")}`;
  } catch {
    return url.toLowerCase().replace(/\/+$/, "");
  }
}

/**
 * Run a full readiness check for 0G Compute.
 *
 * Checks in order:
 *   1. Wallet configured (keystore + password)
 *   2. Broker initialises (SDK + RPC)
 *   3. Ledger exists on-chain
 *   4. Provider sub-account has sufficient locked balance
 *   5. Provider signer is acknowledged
 *   6. OpenClaw config has `models.providers.zg` with baseUrl + apiKey
 *      (+ cross-check that baseUrl matches detected provider endpoint)
 *
 * Provider recovery chain:
 *   a. `compute-state.json` → activeProvider
 *   b. Ledger detail → first sub-account with lockedOg > 0
 *   c. OpenClaw config baseUrl → match against service endpoints
 */
export async function checkComputeReadiness(): Promise<ReadinessResult> {
  const result: ReadinessResult = {
    ready: false,
    provider: null,
    checks: {
      wallet: fail("Not checked"),
      broker: fail("Not checked"),
      ledger: fail("Not checked"),
      subAccount: fail("Not checked"),
      ack: fail("Not checked"),
      openclawConfig: fail("Not checked"),
    },
  };

  // 1. Wallet
  let walletAddress: string;
  try {
    const { address } = requireWalletAndKeystore();
    walletAddress = address;
    result.checks.wallet = pass(address);
  } catch (err) {
    result.checks.wallet = fail(
      err instanceof Error ? err.message : "Wallet not configured",
      "Run: echoclaw wallet create",
    );
    return result;
  }

  // 2. Broker
  let broker;
  try {
    broker = await getAuthenticatedBroker();
    result.checks.broker = pass();
  } catch (err) {
    result.checks.broker = fail(
      err instanceof Error ? err.message : "Broker init failed",
      "Check network connection and wallet configuration.",
    );
    return result;
  }

  // 3. Ledger
  try {
    await withSuppressedConsole(() => broker.ledger.getLedger());
    result.checks.ledger = pass();
  } catch {
    result.checks.ledger = fail(
      "No ledger found on-chain",
      "Run: echoclaw 0g-compute ledger deposit <amount>",
    );
    return result;
  }

  // 4. Provider recovery + sub-account check
  let provider: string | null = null;

  // Try compute-state.json first
  const computeState = loadComputeState();
  if (computeState) {
    provider = computeState.activeProvider;
  }

  // Fallback: scan sub-accounts from ledger detail
  if (!provider) {
    try {
      const detail = await withSuppressedConsole(() =>
        (broker.ledger as unknown as { getLedgerWithDetail(): Promise<{ infers: [string, bigint, bigint][] }> })
          .getLedgerWithDetail(),
      );
      const infers = detail?.infers;
      if (Array.isArray(infers)) {
        for (const tuple of infers) {
          if (Array.isArray(tuple) && tuple.length >= 3) {
            const { lockedOg, provider: addr } = normalizeInferTuple(tuple as [string, bigint, bigint]);
            if (lockedOg > 0) {
              provider = addr;
              break;
            }
          }
        }
      }
    } catch {
      // No detail available — provider stays null
    }
  }

  // Fallback 3: recover provider from OpenClaw config baseUrl → match service endpoint
  if (!provider) {
    try {
      const config = loadOpenclawConfig();
      const zgBaseUrl = (config as any)?.models?.providers?.zg?.baseUrl;
      if (zgBaseUrl) {
        const services = await withSuppressedConsole(() =>
          broker.inference.listServiceWithDetail(),
        ) as unknown as Array<{ provider: string; [k: string]: unknown }>;

        for (const svc of services) {
          try {
            const meta = await withSuppressedConsole(() =>
              broker.inference.getServiceMetadata(svc.provider),
            ) as { endpoint?: string };
            if (meta.endpoint && normalizeUrl(meta.endpoint) === normalizeUrl(zgBaseUrl)) {
              provider = svc.provider;
              break;
            }
          } catch {
            // Skip — try next service
          }
        }
      }
    } catch {
      // Fallback failed — provider stays null
    }
  }

  if (!provider) {
    result.checks.subAccount = fail(
      "No active provider found",
      "Run: echoclaw echo",
    );
    return result;
  }

  result.provider = provider;

  // Check sub-account balance
  try {
    const account = await withSuppressedConsole(() =>
      broker.inference.getAccount(provider!),
    );
    const normalized = normalizeSubAccount(account);

    // Get pricing to determine minimum threshold
    let recommendedMin = 1.0;
    try {
      const services = await withSuppressedConsole(() =>
        broker.inference.listServiceWithDetail(),
      ) as Array<{ provider: string; inputPrice: bigint; outputPrice: bigint }>;

      const svc = services.find(
        (s: any) => s.provider?.toLowerCase() === provider!.toLowerCase(),
      );
      if (svc) {
        const pricing = calculateProviderPricing(svc.inputPrice, svc.outputPrice);
        recommendedMin = pricing.recommendedMinLockedOg;
      }
    } catch {
      // Use default min if pricing unavailable
    }

    if (normalized.lockedOg < recommendedMin) {
      result.checks.subAccount = fail(
        `Locked: ${normalized.lockedOg.toFixed(4)} 0G (need ≥ ${recommendedMin.toFixed(1)} 0G)`,
        "Run: echoclaw echo",
      );
      return result;
    }

    result.checks.subAccount = pass(`Locked: ${normalized.lockedOg.toFixed(4)} 0G`);
  } catch {
    result.checks.subAccount = fail(
      "Could not read sub-account balance",
      "Run: echoclaw echo",
    );
    return result;
  }

  // 5. ACK
  try {
    const acked = await withSuppressedConsole(() =>
      broker.inference.acknowledged(provider!),
    );
    if (acked) {
      result.checks.ack = pass();
    } else {
      result.checks.ack = fail(
        "Provider signer not acknowledged",
        "Run: echoclaw 0g-compute provider <addr> ack",
      );
      return result;
    }
  } catch {
    result.checks.ack = fail(
      "Could not verify ACK status",
      "Run: echoclaw 0g-compute provider <addr> ack",
    );
    return result;
  }

  // 6. OpenClaw config
  try {
    const config = loadOpenclawConfig();
    const zgProvider = (config as any)?.models?.providers?.zg;
    if (zgProvider && zgProvider.baseUrl && zgProvider.apiKey) {
      // Cross-check: verify OpenClaw baseUrl matches detected provider's endpoint
      if (result.provider) {
        try {
          const meta = await withSuppressedConsole(() =>
            broker.inference.getServiceMetadata(result.provider!),
          ) as { endpoint?: string };
          if (meta.endpoint && normalizeUrl(meta.endpoint) !== normalizeUrl(zgProvider.baseUrl)) {
            result.checks.openclawConfig = fail(
              `OpenClaw baseUrl does not match provider endpoint (expected ${meta.endpoint})`,
              "Run: echoclaw echo",
            );
            return result;
          }
        } catch {
          // Can't verify — pass anyway (best-effort cross-check)
        }
      }
      result.checks.openclawConfig = pass();
    } else {
      result.checks.openclawConfig = fail(
        "OpenClaw config missing models.providers.zg (or missing baseUrl/apiKey)",
        "Run: echoclaw echo",
      );
      return result;
    }
  } catch {
    result.checks.openclawConfig = fail(
      "Could not read OpenClaw config",
      "Check ~/.openclaw/openclaw.json",
    );
    return result;
  }

  // All checks passed
  result.ready = true;
  return result;
}

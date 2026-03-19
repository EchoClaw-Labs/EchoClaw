import { ENV_FILE } from "../config/paths.js";
import { readEnvValue } from "../providers/env-resolution.js";
import { getKeystorePassword } from "../utils/env.js";
import { decryptPrivateKey, keystoreExists, loadKeystore } from "../wallet/keystore.js";

export type PasswordHealthStatus = "ready" | "missing" | "drift" | "invalid";
export type PasswordHealthSource = "env" | "app-env" | "none";

export interface PasswordHealth {
  status: PasswordHealthStatus;
  source: PasswordHealthSource;
  appEnvPresent: boolean;
  driftSources: string[];
}

function sanitizeEnvValue(value: string | undefined): string | null {
  if (value == null || value === "" || value === "undefined") return null;
  return value;
}

function detectPasswordSource(resolved: string | null, values: {
  envValue: string | null;
  appEnvValue: string | null;
}): PasswordHealthSource {
  if (!resolved) return "none";
  if (resolved === values.appEnvValue) return "app-env";
  if (resolved === values.envValue) return "env";
  return "none";
}

export function getPasswordHealth(): PasswordHealth {
  const envValue = sanitizeEnvValue(process.env.ECHO_KEYSTORE_PASSWORD);
  const appEnvValue = readEnvValue("ECHO_KEYSTORE_PASSWORD", ENV_FILE);
  const resolved = getKeystorePassword();

  const presentValues = new Map<string, string[]>();
  for (const [label, value] of [
    ["env", envValue],
    ["app-env", appEnvValue],
  ] as const) {
    if (!value) continue;
    const seen = presentValues.get(value) ?? [];
    seen.push(label);
    presentValues.set(value, seen);
  }

  const distinctValues = [...presentValues.keys()];
  const driftSources = distinctValues.length > 1
    ? [...presentValues.values()].flat()
    : [];

  let status: PasswordHealthStatus;
  if (!resolved) {
    status = "missing";
  } else if (driftSources.length > 0) {
    status = "drift";
  } else {
    status = "ready";
  }

  if (keystoreExists() && resolved) {
    const keystore = loadKeystore();
    if (keystore) {
      try {
        decryptPrivateKey(keystore, resolved);
      } catch {
        status = "invalid";
      }
    }
  }

  const source = detectPasswordSource(resolved, { envValue, appEnvValue });

  return {
    status,
    source,
    appEnvPresent: appEnvValue != null,
    driftSources,
  };
}

import { EchoError, ErrorCodes } from "../errors.js";
import { getKeystorePassword } from "../utils/env.js";
import { getPasswordHealth, type PasswordHealth } from "./health.js";

export interface AgentPasswordCompatibilityResult {
  health: PasswordHealth;
  migrated: boolean;
  appPath: string | null;
}

function getDriftHint(driftSources: string[]): string {
  const sources = driftSources.length > 0 ? ` Conflicting sources: ${driftSources.join(", ")}.` : "";
  return `Save the correct password again in EchoClaw to synchronize the config.${sources}`;
}

export function ensureAgentPasswordReadyForContainer(): AgentPasswordCompatibilityResult {
  const health = getPasswordHealth();

  if (health.status === "drift") {
    throw new EchoError(
      ErrorCodes.AGENT_START_FAILED,
      "Agent start blocked: conflicting password sources were detected.",
      getDriftHint(health.driftSources),
    );
  }

  if (health.status === "invalid") {
    throw new EchoError(
      ErrorCodes.AGENT_START_FAILED,
      "Agent start blocked: stored password does not decrypt the wallet keystore.",
      "Save the correct keystore password in EchoClaw and retry.",
    );
  }

  const resolvedPassword = getKeystorePassword();
  if (!resolvedPassword) {
    return { health, migrated: false, appPath: null };
  }

  process.env.ECHO_KEYSTORE_PASSWORD = resolvedPassword;

  return { health, migrated: false, appPath: null };
}

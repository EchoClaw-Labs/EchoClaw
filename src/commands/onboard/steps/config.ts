import { configExists, getDefaultConfig, loadConfig, saveConfig } from "../../../config/store.js";
import { CONFIG_FILE } from "../../../config/paths.js";
import type { OnboardState, OnboardStep, StepStatus, StepResult } from "../types.js";

function detect(state: OnboardState): StepStatus {
  const exists = configExists();
  if (exists) {
    const cfg = loadConfig();
    state.configInitialized = true;
    return {
      configured: true,
      summary: `Config at ${CONFIG_FILE} (chain: ${cfg.chain.chainId})`,
    };
  }
  return { configured: false, summary: "No config file found" };
}

async function run(state: OnboardState): Promise<StepResult> {
  const cfg = getDefaultConfig();
  saveConfig(cfg);
  state.configInitialized = true;
  return {
    action: "configured",
    message: `Config initialized (0G Mainnet, chain ${cfg.chain.chainId})`,
  };
}

export const configStep: OnboardStep = {
  name: "Configuration",
  description: "Creates your local settings file — stores your preferred RPC endpoint and network config. Like .env for your crypto wallet.",
  detect,
  run,
};

import { homedir, platform } from "node:os";
import { join } from "node:path";

const APP_NAME = "echoclaw";

function getConfigDir(): string {
  const plat = platform();

  if (plat === "win32") {
    // Windows: %APPDATA%/echoclaw
    const appData = process.env.APPDATA ?? join(homedir(), "AppData", "Roaming");
    return join(appData, APP_NAME);
  }

  if (plat === "darwin") {
    // macOS: ~/Library/Application Support/echoclaw
    return join(homedir(), "Library", "Application Support", APP_NAME);
  }

  // Linux/Unix: ~/.config/echoclaw
  const xdgConfig = process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
  return join(xdgConfig, APP_NAME);
}

export const CONFIG_DIR = getConfigDir();
export const CONFIG_FILE = join(CONFIG_DIR, "config.json");
export const KEYSTORE_FILE = join(CONFIG_DIR, "keystore.json");
export const SOLANA_KEYSTORE_FILE = join(CONFIG_DIR, "solana-keystore.json");
export const INTENTS_DIR = join(CONFIG_DIR, "intents");
export const JWT_FILE = join(CONFIG_DIR, "jwt.json");
export const SLOP_JWT_FILE = join(CONFIG_DIR, "slop-jwt.json");

// 0G Storage paths
export const STORAGE_DRIVE_FILE = join(CONFIG_DIR, "storage-drive.json");

// Backup paths
// App-specific .env (provider-neutral)
export const ENV_FILE = join(CONFIG_DIR, ".env");

// Backup paths
export const BACKUPS_DIR = join(CONFIG_DIR, "backups");

// Bot paths
export const BOT_DIR = join(CONFIG_DIR, "bot");
export const BOT_ORDERS_FILE = join(BOT_DIR, "orders.json");
export const BOT_STATE_FILE = join(BOT_DIR, "state.json");
export const BOT_PID_FILE = join(BOT_DIR, "bot.pid");
export const BOT_SHUTDOWN_FILE = join(BOT_DIR, "bot.shutdown");
export const BOT_LOG_FILE = join(BOT_DIR, "bot.log");
export const BOT_STOPPED_FILE = join(BOT_DIR, "bot.stopped");

// Launcher paths
export const LAUNCHER_DIR = join(CONFIG_DIR, "launcher");
export const LAUNCHER_PID_FILE = join(LAUNCHER_DIR, "launcher.pid");
export const LAUNCHER_LOG_FILE = join(LAUNCHER_DIR, "launcher.log");
export const LAUNCHER_STOPPED_FILE = join(LAUNCHER_DIR, "launcher.stopped");
export const LAUNCHER_DEFAULT_PORT = 4200;

// Solana paths
export const SOLANA_TOKEN_CACHE_FILE = join(CONFIG_DIR, "solana-token-cache.json");

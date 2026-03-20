/**
 * Wallet API handlers.
 *
 * Password, create, import, backup, restore, export.
 * Reuses existing wallet functions — zero logic duplication.
 */

import { writeFileSync, cpSync, existsSync } from "node:fs";
import { join } from "node:path";
import { platform } from "node:os";
import type { RouteHandler } from "../types.js";
import { jsonResponse, errorResponse, registerRoute } from "../routes.js";
import { createWallet } from "../../wallet/create.js";
import { createSolanaWallet } from "../../wallet/solana-create.js";
import { importWallet } from "../../wallet/import.js";
import { importSolanaWallet } from "../../wallet/solana-import.js";
import { loadKeystore, decryptPrivateKey, keystoreExists } from "../../wallet/keystore.js";
import { loadSolanaKeystore, decryptSolanaSecretKey, encodeSolanaSecretKey, solanaKeystoreExists } from "../../wallet/solana-keystore.js";
import { writeAppEnvValue } from "../../providers/env-resolution.js";
import { requireKeystorePassword } from "../../utils/env.js";
import { autoBackup, listBackups } from "../../commands/wallet/backup.js";
import { CONFIG_DIR, KEYSTORE_FILE, SOLANA_KEYSTORE_FILE } from "../../config/paths.js";
import { EchoError } from "../../errors.js";
import logger from "../../utils/logger.js";
import { buildWalletView } from "../../commands/echo/wallet-view.js";

// ── GET /api/wallet/summary ──────────────────────────────────────

const handleSummary: RouteHandler = async (_req, res, params) => {
  const fresh = params.query.fresh === "1" || params.query.fresh === "true";

  try {
    const view = await buildWalletView({ fresh });
    jsonResponse(res, 200, view);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errorResponse(res, 500, "WALLET_SUMMARY_FAILED", `Failed to build wallet summary: ${msg}`,
      "Ensure wallet is configured and RPC endpoints are reachable.");
  }
};

// ── POST /api/wallet/password ────────────────────────────────────

const handleSetPassword: RouteHandler = async (_req, res, params) => {
  const password = params.body?.password as string | undefined;
  if (!password || typeof password !== "string" || password.length < 8) {
    errorResponse(res, 400, "INVALID_PASSWORD", "Password must be at least 8 characters.");
    return;
  }

  const appPath = writeAppEnvValue("ECHO_KEYSTORE_PASSWORD", password);
  process.env.ECHO_KEYSTORE_PASSWORD = password;

  logger.info("[launcher] password set via API");
  jsonResponse(res, 200, {
    phase: "wallet", status: "applied", summary: "Keystore password saved.",
    appPath,
  });
};

// ── POST /api/wallet/create ──────────────────────────────────────

const handleCreate: RouteHandler = async (_req, res, params) => {
  const chain = (params.body?.chain as string) ?? "evm";
  const force = params.body?.force === true;

  // Safety guard: if keystore exists and force was not explicitly requested,
  // ask the frontend for confirmation instead of overwriting silently.
  if (!force) {
    const exists = chain === "solana" ? solanaKeystoreExists() : keystoreExists();
    if (exists) {
      jsonResponse(res, 200, {
        phase: "wallet", status: "confirm_required", reason: "keystore_exists",
        message: `A ${chain.toUpperCase()} keystore already exists. Creating a new wallet will overwrite it. A backup will be created automatically.`,
      });
      return;
    }
  }

  if (chain === "solana") {
    const result = await createSolanaWallet({ force });
    jsonResponse(res, 200, {
      phase: "wallet", status: "applied",
      summary: `Solana wallet created: ${result.address}`,
      address: result.address, chain: "solana", overwritten: result.overwritten,
    });
  } else {
    const result = await createWallet({ force });
    jsonResponse(res, 200, {
      phase: "wallet", status: "applied",
      summary: `EVM wallet created: ${result.address}`,
      address: result.address, chain: "evm", chainId: result.chainId, overwritten: result.overwritten,
    });
  }
};

// ── POST /api/wallet/import ──────────────────────────────────────

const handleImport: RouteHandler = async (_req, res, params) => {
  const chain = (params.body?.chain as string) ?? "evm";
  const privateKey = params.body?.privateKey as string | undefined;
  const force = params.body?.force === true;

  if (!privateKey || typeof privateKey !== "string") {
    errorResponse(res, 400, "MISSING_KEY", "privateKey is required.");
    return;
  }

  // Safety guard: if keystore exists and force was not explicitly requested,
  // ask the frontend for confirmation instead of overwriting silently.
  if (!force) {
    const exists = chain === "solana" ? solanaKeystoreExists() : keystoreExists();
    if (exists) {
      jsonResponse(res, 200, {
        phase: "wallet", status: "confirm_required", reason: "keystore_exists",
        message: `A ${chain.toUpperCase()} keystore already exists. Importing will overwrite it. A backup will be created automatically.`,
      });
      return;
    }
  }

  if (chain === "solana") {
    const result = await importSolanaWallet(privateKey, { force });
    jsonResponse(res, 200, {
      phase: "wallet", status: "applied",
      summary: `Solana wallet imported: ${result.address}`,
      address: result.address, chain: "solana", overwritten: result.overwritten,
    });
  } else {
    const result = await importWallet(privateKey, { force });
    jsonResponse(res, 200, {
      phase: "wallet", status: "applied",
      summary: `EVM wallet imported: ${result.address}`,
      address: result.address, chain: "evm", chainId: result.chainId, overwritten: result.overwritten,
    });
  }
};

// ── GET /api/wallet/backups ──────────────────────────────────────

const handleListBackups: RouteHandler = async (_req, res) => {
  const backups = listBackups();
  jsonResponse(res, 200, { backups });
};

// ── POST /api/wallet/backup ──────────────────────────────────────

const handleBackup: RouteHandler = async (_req, res) => {
  const dir = await autoBackup();
  jsonResponse(res, 200, {
    phase: "wallet", status: "applied",
    summary: dir ? `Backup created: ${dir}` : "Nothing to back up.",
    backupDir: dir,
  });
};

// ── POST /api/wallet/restore ─────────────────────────────────────

const handleRestore: RouteHandler = async (_req, res, params) => {
  const backupDir = params.body?.backupDir as string | undefined;
  if (!backupDir || typeof backupDir !== "string") {
    errorResponse(res, 400, "MISSING_BACKUP_DIR", "backupDir is required.");
    return;
  }

  if (!existsSync(backupDir)) {
    errorResponse(res, 404, "BACKUP_NOT_FOUND", `Backup directory not found: ${backupDir}`);
    return;
  }

  // Backup current state first
  await autoBackup();

  // Restore files
  const files = ["keystore.json", "solana-keystore.json", "config.json"];
  const restored: string[] = [];
  for (const file of files) {
    const src = join(backupDir, file);
    const dst = join(CONFIG_DIR, file);
    if (existsSync(src)) {
      cpSync(src, dst);
      restored.push(file);
    }
  }

  logger.info(`[launcher] wallet restored from ${backupDir}: ${restored.join(", ")}`);
  jsonResponse(res, 200, {
    phase: "wallet", status: "applied",
    summary: `Restored ${restored.length} file(s) from backup.`,
    restoredFiles: restored,
  });
};

// ── POST /api/wallet/export ──────────────────────────────────────
// Writes key to LOCAL FILE only. NEVER returns raw key in response body.

const handleExport: RouteHandler = async (_req, res, params) => {
  const chain = (params.body?.chain as string) ?? "evm";
  const password = requireKeystorePassword();

  let exportedKey: string;
  if (chain === "solana") {
    if (!solanaKeystoreExists()) {
      errorResponse(res, 404, "KEYSTORE_NOT_FOUND", "Solana keystore not found.");
      return;
    }
    const keystore = loadSolanaKeystore();
    if (!keystore) {
      errorResponse(res, 404, "KEYSTORE_NOT_FOUND", "Solana keystore not found.");
      return;
    }
    exportedKey = encodeSolanaSecretKey(decryptSolanaSecretKey(keystore, password));
  } else {
    if (!keystoreExists()) {
      errorResponse(res, 404, "KEYSTORE_NOT_FOUND", "EVM keystore not found.");
      return;
    }
    const keystore = loadKeystore();
    if (!keystore) {
      errorResponse(res, 404, "KEYSTORE_NOT_FOUND", "EVM keystore not found.");
      return;
    }
    exportedKey = decryptPrivateKey(keystore, password);
  }

  const fileName = `echoclaw-${chain}-key-${Date.now()}.txt`;
  const filePath = join(CONFIG_DIR, fileName);
  writeFileSync(filePath, exportedKey, {
    encoding: "utf-8",
    mode: platform() !== "win32" ? 0o600 : undefined,
  });

  logger.info(`[launcher] key exported to ${filePath}`);
  jsonResponse(res, 200, {
    phase: "wallet", status: "applied",
    summary: `Key exported to local file. Copy it manually.`,
    filePath,
  });
};

// ── Registration ─────────────────────────────────────────────────

export function registerWalletRoutes(): void {
  registerRoute("GET", "/api/wallet/summary", handleSummary);
  registerRoute("POST", "/api/wallet/password", handleSetPassword);
  registerRoute("POST", "/api/wallet/create", handleCreate);
  registerRoute("POST", "/api/wallet/import", handleImport);
  registerRoute("GET", "/api/wallet/backups", handleListBackups);
  registerRoute("POST", "/api/wallet/backup", handleBackup);
  registerRoute("POST", "/api/wallet/restore", handleRestore);
  registerRoute("POST", "/api/wallet/export", handleExport);
}

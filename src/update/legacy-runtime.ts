import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import {
  UPDATE_LOG_FILE,
  UPDATE_PID_FILE,
  UPDATE_SHUTDOWN_FILE,
  UPDATE_STATE_FILE,
  UPDATE_STOPPED_FILE,
} from "./constants.js";
import logger from "../utils/logger.js";

export interface LegacyUpdateArtifacts {
  detected: boolean;
  pidFileExists: boolean;
  shutdownFileExists: boolean;
  stoppedFileExists: boolean;
  stateFileExists: boolean;
  logFileExists: boolean;
  pid: number | null;
  daemonRunning: boolean;
}

export interface RetireLegacyUpdateDaemonOptions {
  forceShutdown?: boolean;
  waitMs?: number;
}

export interface LegacyUpdateCleanupResult {
  initial: LegacyUpdateArtifacts;
  final: LegacyUpdateArtifacts;
  stopSignalSent: boolean;
  shutdownRequested: boolean;
  forceKilled: boolean;
  cleanedFiles: string[];
  warnings: string[];
}

function readLegacyUpdatePid(): number | null {
  if (!existsSync(UPDATE_PID_FILE)) return null;

  try {
    const raw = readFileSync(UPDATE_PID_FILE, "utf-8").trim();
    const pid = Number.parseInt(raw, 10);
    return Number.isFinite(pid) ? pid : null;
  } catch {
    return null;
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pushWarning(warnings: string[], message: string): void {
  warnings.push(message);
  logger.warn(message);
}

function removeArtifact(path: string, cleanedFiles: string[], warnings: string[]): void {
  try {
    if (!existsSync(path)) return;
    unlinkSync(path);
    cleanedFiles.push(path);
  } catch (err) {
    pushWarning(
      warnings,
      `Failed to remove legacy update artifact ${path}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

async function waitForProcessExit(pid: number, timeoutMs: number): Promise<boolean> {
  if (timeoutMs <= 0) return !isProcessAlive(pid);

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) return true;
    await sleep(100);
  }

  return !isProcessAlive(pid);
}

async function stopLegacyDaemon(
  pid: number,
  opts: Required<RetireLegacyUpdateDaemonOptions>,
  result: LegacyUpdateCleanupResult,
): Promise<boolean> {
  try {
    process.kill(pid, "SIGTERM");
    result.stopSignalSent = true;
  } catch (err) {
    pushWarning(
      result.warnings,
      `Failed to signal legacy update daemon ${pid}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return !isProcessAlive(pid);
  }

  if (await waitForProcessExit(pid, opts.waitMs)) {
    return true;
  }

  try {
    writeFileSync(UPDATE_SHUTDOWN_FILE, String(Date.now()), "utf-8");
    result.shutdownRequested = true;
  } catch (err) {
    pushWarning(
      result.warnings,
      `Failed to write legacy update shutdown file: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (await waitForProcessExit(pid, opts.waitMs)) {
    return true;
  }

  if (!opts.forceShutdown) {
    return false;
  }

  try {
    process.kill(pid, "SIGKILL");
    result.forceKilled = true;
  } catch (err) {
    pushWarning(
      result.warnings,
      `Failed to force-kill legacy update daemon ${pid}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return !isProcessAlive(pid);
  }

  return waitForProcessExit(pid, opts.waitMs);
}

export function detectLegacyUpdateArtifacts(): LegacyUpdateArtifacts {
  const pid = readLegacyUpdatePid();
  const daemonRunning = pid != null ? isProcessAlive(pid) : false;
  const pidFileExists = existsSync(UPDATE_PID_FILE);
  const shutdownFileExists = existsSync(UPDATE_SHUTDOWN_FILE);
  const stoppedFileExists = existsSync(UPDATE_STOPPED_FILE);
  const stateFileExists = existsSync(UPDATE_STATE_FILE);
  const logFileExists = existsSync(UPDATE_LOG_FILE);

  return {
    detected: pidFileExists || shutdownFileExists || stoppedFileExists || stateFileExists || logFileExists,
    pidFileExists,
    shutdownFileExists,
    stoppedFileExists,
    stateFileExists,
    logFileExists,
    pid,
    daemonRunning,
  };
}

export async function retireLegacyUpdateDaemon(
  opts: RetireLegacyUpdateDaemonOptions = {},
): Promise<LegacyUpdateCleanupResult> {
  const options: Required<RetireLegacyUpdateDaemonOptions> = {
    forceShutdown: opts.forceShutdown ?? false,
    waitMs: opts.waitMs ?? 0,
  };

  const result: LegacyUpdateCleanupResult = {
    initial: detectLegacyUpdateArtifacts(),
    final: detectLegacyUpdateArtifacts(),
    stopSignalSent: false,
    shutdownRequested: false,
    forceKilled: false,
    cleanedFiles: [],
    warnings: [],
  };

  if (result.initial.stoppedFileExists) {
    removeArtifact(UPDATE_STOPPED_FILE, result.cleanedFiles, result.warnings);
  }

  if (result.initial.daemonRunning && result.initial.pid != null) {
    await stopLegacyDaemon(result.initial.pid, options, result);
  }

  const afterStop = detectLegacyUpdateArtifacts();
  if (!afterStop.daemonRunning) {
    removeArtifact(UPDATE_PID_FILE, result.cleanedFiles, result.warnings);
    removeArtifact(UPDATE_SHUTDOWN_FILE, result.cleanedFiles, result.warnings);
    removeArtifact(UPDATE_STATE_FILE, result.cleanedFiles, result.warnings);
  }

  result.final = detectLegacyUpdateArtifacts();
  return result;
}

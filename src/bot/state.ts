/**
 * Bot runtime state persistence — execution log, daily spend, hourly tx count.
 * Atomic file write pattern matching config/store.ts.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { BOT_DIR, BOT_STATE_FILE } from "../config/paths.js";
import logger from "../utils/logger.js";
import type { BotStateFile, ExecutionEvent } from "./types.js";

const MAX_EXECUTION_LOG = 1000;

function ensureBotDir(): void {
  if (!existsSync(BOT_DIR)) {
    mkdirSync(BOT_DIR, { recursive: true });
  }
}

function getDefaultState(): BotStateFile {
  return {
    version: 1,
    executionLog: [],
    dailySpend: { date: todayStr(), ogSpent: 0 },
    hourlyTxCount: { hour: currentHour(), count: 0 },
  };
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function currentHour(): number {
  return Math.floor(Date.now() / (60 * 60 * 1000));
}

export function loadState(): BotStateFile {
  ensureBotDir();

  if (!existsSync(BOT_STATE_FILE)) {
    return getDefaultState();
  }

  try {
    const raw = readFileSync(BOT_STATE_FILE, "utf-8");
    const parsed = JSON.parse(raw) as BotStateFile;
    if (parsed.version !== 1) return getDefaultState();
    return parsed;
  } catch (err) {
    logger.error(`Failed to parse state file: ${err}`);
    return getDefaultState();
  }
}

export function saveState(state: BotStateFile): void {
  ensureBotDir();
  const dir = dirname(BOT_STATE_FILE);
  const tmpFile = join(dir, `.state.tmp.${Date.now()}.json`);

  try {
    writeFileSync(tmpFile, JSON.stringify(state, null, 2), "utf-8");
    renameSync(tmpFile, BOT_STATE_FILE);
  } catch (err) {
    try {
      if (existsSync(tmpFile)) unlinkSync(tmpFile);
    } catch {
      // ignore
    }
    throw err;
  }
}

export function logExecution(event: ExecutionEvent): void {
  const state = loadState();

  // Append event
  state.executionLog.push(event);

  // Ring buffer: prune old events
  if (state.executionLog.length > MAX_EXECUTION_LOG) {
    state.executionLog = state.executionLog.slice(-MAX_EXECUTION_LOG);
  }

  saveState(state);
}

export function recordSpend(ogAmount: number): void {
  const state = loadState();
  const today = todayStr();

  if (state.dailySpend.date !== today) {
    state.dailySpend = { date: today, ogSpent: 0 };
  }
  state.dailySpend.ogSpent += ogAmount;

  saveState(state);
}

export function recordTx(): void {
  const state = loadState();
  const hour = currentHour();

  if (state.hourlyTxCount.hour !== hour) {
    state.hourlyTxCount = { hour, count: 0 };
  }
  state.hourlyTxCount.count++;

  saveState(state);
}

export function getRecentExecutions(limit = 20): ExecutionEvent[] {
  const state = loadState();
  return state.executionLog.slice(-limit);
}

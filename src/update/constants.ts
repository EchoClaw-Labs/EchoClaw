/**
 * Legacy updater artifact paths.
 * New versions use one-shot auto-update, but older releases may leave these
 * files behind and they still need best-effort cleanup/migration.
 */

import { join } from "node:path";
import { CONFIG_DIR } from "../config/paths.js";

export const UPDATE_DIR = join(CONFIG_DIR, "update");
export const UPDATE_PID_FILE = join(UPDATE_DIR, "update.pid");
export const UPDATE_SHUTDOWN_FILE = join(UPDATE_DIR, "update.shutdown");
export const UPDATE_STOPPED_FILE = join(UPDATE_DIR, "update.stopped");
export const UPDATE_STATE_FILE = join(UPDATE_DIR, "update-state.json");
export const UPDATE_LOG_FILE = join(UPDATE_DIR, "update.log");

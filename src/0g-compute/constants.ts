/**
 * Path constants for the 0G Compute module.
 * Follows the same pattern as BOT_DIR in config/paths.ts.
 */

import { join } from "node:path";
import { CONFIG_DIR } from "../config/paths.js";

export const ZG_COMPUTE_DIR = join(CONFIG_DIR, "0g-compute");
export const ZG_MONITOR_PID_FILE = join(ZG_COMPUTE_DIR, "monitor.pid");
export const ZG_MONITOR_SHUTDOWN_FILE = join(ZG_COMPUTE_DIR, "monitor.shutdown");
export const ZG_MONITOR_STATE_FILE = join(ZG_COMPUTE_DIR, "monitor-state.json");
export const ZG_MONITOR_LOG_FILE = join(ZG_COMPUTE_DIR, "monitor.log");
export const ZG_MONITOR_STOPPED_FILE = join(ZG_COMPUTE_DIR, "monitor.stopped");
export const ZG_COMPUTE_STATE_FILE = join(ZG_COMPUTE_DIR, "compute-state.json");

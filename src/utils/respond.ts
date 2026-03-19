/**
 * Centralized command response handler.
 * Routes output to JSON (headless) or UI boxes (TTY) based on mode.
 */

import { isHeadless, writeJsonSuccess } from "./output.js";
import { successBox, infoBox, warnBox } from "./ui.js";

export interface CommandResult<T extends Record<string, unknown>> {
  data: T;
  ui?: {
    type: "success" | "info" | "warn";
    title: string;
    body: string;
  };
}

/**
 * Unified response function for commands.
 * - Headless mode: outputs JSON to stdout
 * - TTY mode: displays appropriate UI box
 */
export function respond<T extends Record<string, unknown>>(result: CommandResult<T>): void {
  if (isHeadless()) {
    writeJsonSuccess(result.data);
  } else if (result.ui) {
    const boxFn =
      result.ui.type === "success"
        ? successBox
        : result.ui.type === "warn"
          ? warnBox
          : infoBox;
    boxFn(result.ui.title, result.ui.body);
  }
}

/**
 * Centralized output layer for stdout/stderr separation.
 *
 * Convention:
 * - stdout: machine-readable data (addresses, JSON) for piping/scripting
 * - stderr: human UI (spinners, boxes, tables, logs)
 */

let jsonModeEnabled = false;

export function setJsonMode(enabled: boolean): void {
  jsonModeEnabled = enabled;
}

/**
 * Returns true if running in headless mode (JSON output or non-TTY).
 * Used by UI helpers to suppress interactive output.
 */
export function isHeadless(): boolean {
  return jsonModeEnabled || !isStderrTTY();
}

/**
 * True when stdout is an interactive terminal.
 * Use this guard before printing sensitive data to stdout.
 */
export function isStdoutTTY(): boolean {
  return process.stdout.isTTY === true;
}

/**
 * True when stderr is an interactive terminal.
 * Used for human-facing UI/log output.
 */
export function isStderrTTY(): boolean {
  return process.stderr.isTTY === true;
}

export function writeStdout(text: string): void {
  process.stdout.write(text + "\n");
}

export function writeStderr(text: string): void {
  process.stderr.write(text + "\n");
}

export function writeJson(data: unknown): void {
  writeStdout(JSON.stringify(data));
}

export interface JsonErrorFields {
  code: string;
  message: string;
  hint?: string;
  retryable?: boolean;
  externalName?: string;
}

export function writeJsonError(
  code: string,
  message: string,
  hint?: string,
  extra?: { retryable?: boolean; externalName?: string },
): void {
  const error: JsonErrorFields = { code, message };
  if (hint) error.hint = hint;
  if (extra?.retryable !== undefined) error.retryable = extra.retryable;
  if (extra?.externalName) error.externalName = extra.externalName;
  writeJson({ success: false, error });
}

export function writeJsonSuccess<T extends Record<string, unknown>>(data: T): void {
  writeJson({ success: true, ...data });
}

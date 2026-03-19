/**
 * Drive index: virtual filesystem over 0G Storage.
 * Local JSON index with flat paths, atomic writes, implicit mkdir.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
  unlinkSync,
} from "node:fs";
import { dirname } from "node:path";
import { CONFIG_DIR, STORAGE_DRIVE_FILE } from "../config/paths.js";
import { EchoError, ErrorCodes } from "../errors.js";
import type { DriveIndex, DriveEntry, DriveFileEntry, DriveDirEntry } from "./types.js";
import { minimatch } from "../utils/minimatch.js";

// ── Path Normalization & Validation ─────────────────────────────────

const MAX_PATH_LENGTH = 512;
const MAX_SEGMENT_LENGTH = 255;
const VALID_CHARS = /^[a-zA-Z0-9\-_./]+$/;
const DOT_SEGMENT = /(?:^|\/)\.\.(\/|$)|(?:^|\/)\.(\/|$)/;

export function normalizePath(input: string): string {
  let p = input.trim();
  if (!p.startsWith("/")) p = "/" + p;
  // Collapse double slashes
  p = p.replace(/\/\/+/g, "/");
  return p;
}

export function validatePath(input: string): void {
  if (input.length > MAX_PATH_LENGTH) {
    throw new EchoError(
      ErrorCodes.ZG_STORAGE_INVALID_PATH,
      `Path too long (${input.length} > ${MAX_PATH_LENGTH}).`,
      "Shorten the path to 512 characters or less."
    );
  }

  if (DOT_SEGMENT.test(input)) {
    throw new EchoError(
      ErrorCodes.ZG_STORAGE_INVALID_PATH,
      `Path contains '.' or '..' segments: ${input}`,
      "Use absolute virtual paths without relative segments."
    );
  }

  if (!VALID_CHARS.test(input)) {
    throw new EchoError(
      ErrorCodes.ZG_STORAGE_INVALID_PATH,
      `Path contains invalid characters: ${input}`,
      "Allowed: a-z A-Z 0-9 - _ . /"
    );
  }

  const segments = input.split("/").filter(Boolean);
  for (const seg of segments) {
    if (seg.length > MAX_SEGMENT_LENGTH) {
      throw new EchoError(
        ErrorCodes.ZG_STORAGE_INVALID_PATH,
        `Segment too long: '${seg.slice(0, 50)}...' (${seg.length} > ${MAX_SEGMENT_LENGTH}).`,
        "Each path segment must be 255 characters or less."
      );
    }
  }
}

function ensurePath(input: string): string {
  const p = normalizePath(input);
  validatePath(p);
  return p;
}

// ── Index I/O ───────────────────────────────────────────────────────

function emptyIndex(wallet: string): DriveIndex {
  return { version: 1, wallet, entries: {}, snapshots: [] };
}

export function loadDriveIndex(wallet: string): DriveIndex {
  if (!existsSync(STORAGE_DRIVE_FILE)) {
    return emptyIndex(wallet);
  }

  try {
    const raw = readFileSync(STORAGE_DRIVE_FILE, "utf-8");
    const parsed = JSON.parse(raw) as DriveIndex;
    if (parsed.version !== 1) return emptyIndex(wallet);
    return parsed;
  } catch {
    return emptyIndex(wallet);
  }
}

export function saveDriveIndex(index: DriveIndex): void {
  mkdirSync(dirname(STORAGE_DRIVE_FILE) || CONFIG_DIR, { recursive: true });

  const tmpFile = `${STORAGE_DRIVE_FILE}.tmp.${Date.now()}`;
  try {
    writeFileSync(tmpFile, JSON.stringify(index, null, 2), "utf-8");
    renameSync(tmpFile, STORAGE_DRIVE_FILE);
  } catch (err) {
    try {
      if (existsSync(tmpFile)) unlinkSync(tmpFile);
    } catch {
      // ignore cleanup
    }
    throw err;
  }
}

export function exportDriveIndex(wallet: string): DriveIndex {
  return loadDriveIndex(wallet);
}

// ── Implicit Directory Creation ─────────────────────────────────────

function implicitMkdirs(index: DriveIndex, filePath: string): void {
  const parts = filePath.split("/").filter(Boolean);
  // Remove filename — only create parent dirs
  parts.pop();

  let dir = "/";
  for (const part of parts) {
    dir += part + "/";
    if (!index.entries[dir]) {
      index.entries[dir] = { type: "dir", createdAt: new Date().toISOString() };
    }
  }
}

// ── CRUD Operations ─────────────────────────────────────────────────

export function drivePut(
  index: DriveIndex,
  vpath: string,
  entry: DriveFileEntry
): void {
  const p = ensurePath(vpath);
  if (p.endsWith("/")) {
    throw new EchoError(
      ErrorCodes.ZG_STORAGE_INVALID_PATH,
      "File path must not end with /.",
      "Use 'drive mkdir' to create directories."
    );
  }
  implicitMkdirs(index, p);
  index.entries[p] = entry;
}

export function driveGet(index: DriveIndex, vpath: string): DriveEntry {
  const p = ensurePath(vpath);
  const entry = index.entries[p];
  if (!entry) {
    throw new EchoError(
      ErrorCodes.ZG_STORAGE_INDEX_NOT_FOUND,
      `Path not found in drive: ${p}`,
      "Use 'drive ls' to list available files."
    );
  }
  return entry;
}

export function driveMkdir(index: DriveIndex, vpath: string): void {
  let p = ensurePath(vpath);
  if (!p.endsWith("/")) p += "/";
  if (index.entries[p]) return; // already exists
  implicitMkdirs(index, p + "_"); // creates parent dirs
  index.entries[p] = { type: "dir", createdAt: new Date().toISOString() };
}

export function driveRm(index: DriveIndex, vpath: string): string {
  const p = ensurePath(vpath);
  const entry = index.entries[p];
  if (!entry) {
    throw new EchoError(
      ErrorCodes.ZG_STORAGE_INDEX_NOT_FOUND,
      `Path not found in drive: ${p}`,
    );
  }
  const root = entry.type === "file" ? entry.root : undefined;

  // If it's a directory, also remove children
  if (entry.type === "dir" || p.endsWith("/")) {
    const prefix = p.endsWith("/") ? p : p + "/";
    for (const key of Object.keys(index.entries)) {
      if (key.startsWith(prefix)) {
        delete index.entries[key];
      }
    }
  }
  delete index.entries[p];
  return root ?? "";
}

export function driveMv(index: DriveIndex, from: string, to: string): void {
  const fromP = ensurePath(from);
  const toP = ensurePath(to);

  const entry = index.entries[fromP];
  if (!entry) {
    throw new EchoError(
      ErrorCodes.ZG_STORAGE_INDEX_NOT_FOUND,
      `Source path not found: ${fromP}`,
    );
  }

  if (index.entries[toP]) {
    throw new EchoError(
      ErrorCodes.ZG_STORAGE_INDEX_CONFLICT,
      `Destination already exists: ${toP}`,
      "Remove the destination first or choose a different path."
    );
  }

  // Move the entry
  implicitMkdirs(index, toP);
  index.entries[toP] = entry;
  delete index.entries[fromP];

  // If directory, move children too
  if (entry.type === "dir") {
    const fromPrefix = fromP.endsWith("/") ? fromP : fromP + "/";
    const toPrefix = toP.endsWith("/") ? toP : toP + "/";
    for (const key of Object.keys(index.entries)) {
      if (key.startsWith(fromPrefix)) {
        const newKey = toPrefix + key.slice(fromPrefix.length);
        index.entries[newKey] = index.entries[key];
        delete index.entries[key];
      }
    }
  }
}

// ── Query Operations ────────────────────────────────────────────────

export interface DriveLsEntry {
  name: string;
  type: "file" | "dir";
  size?: number;
  root?: string;
}

export function driveLs(
  index: DriveIndex,
  dir: string,
  recursive = false
): DriveLsEntry[] {
  let prefix = ensurePath(dir);
  if (!prefix.endsWith("/")) prefix += "/";
  if (prefix === "//") prefix = "/";

  const results: DriveLsEntry[] = [];
  const seen = new Set<string>();

  for (const [path, entry] of Object.entries(index.entries)) {
    if (!path.startsWith(prefix)) continue;
    const relative = path.slice(prefix.length);
    if (!relative) continue;

    if (recursive) {
      const name = relative.endsWith("/") ? relative.slice(0, -1) : relative;
      results.push({
        name,
        type: entry.type,
        size: entry.type === "file" ? entry.sizeBytes : undefined,
        root: entry.type === "file" ? entry.root : undefined,
      });
    } else {
      // Only direct children
      const firstSlash = relative.indexOf("/");
      if (firstSlash === -1) {
        // Direct file child
        results.push({
          name: relative,
          type: entry.type,
          size: entry.type === "file" ? entry.sizeBytes : undefined,
          root: entry.type === "file" ? entry.root : undefined,
        });
      } else if (firstSlash === relative.length - 1) {
        // Direct dir child (trailing /)
        const name = relative.slice(0, -1);
        if (!seen.has(name)) {
          seen.add(name);
          results.push({ name, type: "dir" });
        }
      } else {
        // Implicit intermediate dir
        const name = relative.slice(0, firstSlash);
        if (!seen.has(name)) {
          seen.add(name);
          results.push({ name, type: "dir" });
        }
      }
    }
  }

  return results.sort((a, b) => {
    if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

export function driveTree(index: DriveIndex, dir: string): string {
  const entries = driveLs(index, dir, true);
  if (entries.length === 0) return "(empty)";

  const lines: string[] = [];
  const sorted = entries.sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of sorted) {
    const depth = entry.name.split("/").length - 1;
    const indent = "  ".repeat(depth);
    const name = entry.name.split("/").pop() ?? entry.name;
    const suffix = entry.type === "dir" ? "/" : "";
    const size = entry.size != null ? ` (${formatBytes(entry.size)})` : "";
    lines.push(`${indent}${name}${suffix}${size}`);
  }

  return lines.join("\n");
}

export function driveFind(
  index: DriveIndex,
  pattern: string
): Array<{ path: string; type: "file" | "dir"; size?: number; root?: string }> {
  const results: Array<{ path: string; type: "file" | "dir"; size?: number; root?: string }> = [];

  for (const [path, entry] of Object.entries(index.entries)) {
    const filename = path.split("/").filter(Boolean).pop() ?? "";
    if (minimatch(filename, pattern) || minimatch(path, pattern)) {
      results.push({
        path,
        type: entry.type,
        size: entry.type === "file" ? entry.sizeBytes : undefined,
        root: entry.type === "file" ? entry.root : undefined,
      });
    }
  }

  return results.sort((a, b) => a.path.localeCompare(b.path));
}

export interface DriveDuResult {
  path: string;
  totalBytes: number;
  fileCount: number;
}

export function driveDu(index: DriveIndex, dir: string): DriveDuResult {
  let prefix = ensurePath(dir);
  if (!prefix.endsWith("/")) prefix += "/";
  if (prefix === "//") prefix = "/";

  let totalBytes = 0;
  let fileCount = 0;

  for (const [path, entry] of Object.entries(index.entries)) {
    if (prefix === "/" || path.startsWith(prefix) || path === prefix.slice(0, -1)) {
      if (entry.type === "file") {
        totalBytes += entry.sizeBytes;
        fileCount++;
      }
    }
  }

  return { path: prefix, totalBytes, fileCount };
}

// ── Snapshot Operations ─────────────────────────────────────────────

export function addSnapshot(
  index: DriveIndex,
  root: string
): void {
  const entryCount = Object.keys(index.entries).length;
  index.snapshots.push({
    root,
    createdAt: new Date().toISOString(),
    entryCount,
  });
}

export function serializeIndex(index: DriveIndex): string {
  return JSON.stringify(index, null, 2);
}

export function deserializeIndex(raw: string): DriveIndex {
  const parsed = JSON.parse(raw) as DriveIndex;
  if (parsed.version !== 1) {
    throw new EchoError(
      ErrorCodes.ZG_STORAGE_INDEX_NOT_FOUND,
      "Invalid drive index version.",
    );
  }
  return parsed;
}

// ── Helpers ─────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}GB`;
}

import { randomBytes, scryptSync, createCipheriv, createDecipheriv } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, renameSync, unlinkSync, chmodSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { Hex } from "viem";
import { KEYSTORE_FILE } from "../config/paths.js";
import { ensureConfigDir } from "../config/store.js";
import { EchoError, ErrorCodes } from "../errors.js";
import logger from "../utils/logger.js";

export interface KeystoreV1 {
  version: 1;
  ciphertext: string; // base64
  iv: string; // base64, 12 bytes
  salt: string; // base64, 32 bytes
  tag: string; // base64, 16 bytes (GCM auth tag)
  kdf: {
    name: "scrypt";
    N: number;
    r: number;
    p: number;
    dkLen: number;
  };
}

const KDF_PARAMS = {
  name: "scrypt" as const,
  N: 2 ** 14, // 16384
  r: 8,
  p: 1,
  dkLen: 32,
};

function deriveKey(password: string, salt: Uint8Array, dkLen: number, params = KDF_PARAMS): Buffer {
  return scryptSync(password, salt, dkLen, {
    N: params.N,
    r: params.r,
    p: params.p,
  });
}

export function normalizePrivateKey(pk: string): Hex {
  // Remove 0x prefix if present
  const cleaned = pk.startsWith("0x") ? pk.slice(2) : pk;

  // Validate hex format and length (32 bytes = 64 hex chars)
  if (!/^[0-9a-fA-F]{64}$/.test(cleaned)) {
    throw new Error("Invalid private key: must be 32 bytes hex");
  }

  return `0x${cleaned.toLowerCase()}` as Hex;
}

export function encryptPrivateKey(plainPk: string, password: string): KeystoreV1 {
  const normalizedPk = normalizePrivateKey(plainPk);
  return encryptSecretBytes(Buffer.from(normalizedPk.slice(2), "hex"), password);
}

export function encryptSecretBytes(secret: Uint8Array, password: string): KeystoreV1 {
  const secretBuffer = Buffer.from(secret);

  // Generate random salt and IV
  const salt = randomBytes(32);
  const iv = randomBytes(12); // 96 bits for GCM

  // Derive key using scrypt
  const key = deriveKey(password, salt, KDF_PARAMS.dkLen);

  // Encrypt with AES-256-GCM
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(secretBuffer), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    version: 1,
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    salt: salt.toString("base64"),
    tag: tag.toString("base64"),
    kdf: KDF_PARAMS,
  };
}

export function decryptPrivateKey(keystore: KeystoreV1, password: string): Hex {
  const decrypted = decryptSecretBytes(keystore, password);
  return `0x${Buffer.from(decrypted).toString("hex")}` as Hex;
}

export function decryptSecretBytes(keystore: KeystoreV1, password: string): Uint8Array {
  if (keystore.version !== 1) {
    throw new Error(`Unsupported keystore version: ${keystore.version}`);
  }

  const salt = Buffer.from(keystore.salt, "base64");
  const iv = Buffer.from(keystore.iv, "base64");
  const ciphertext = Buffer.from(keystore.ciphertext, "base64");
  const tag = Buffer.from(keystore.tag, "base64");

  // Derive key using scrypt
  const key = deriveKey(password, salt, keystore.kdf.dkLen, keystore.kdf);

  // Decrypt with AES-256-GCM
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);

  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch (err) {
    throw new EchoError(ErrorCodes.KEYSTORE_DECRYPT_FAILED, "Decryption failed: wrong password or corrupted keystore");
  }
}

export function saveKeystore(keystore: KeystoreV1): void {
  saveKeystoreFile(KEYSTORE_FILE, keystore);
}

export function loadKeystore(): KeystoreV1 | null {
  return loadKeystoreFile(KEYSTORE_FILE);
}

export function keystoreExists(): boolean {
  return keystoreFileExists(KEYSTORE_FILE);
}

export function saveKeystoreFile(path: string, keystore: KeystoreV1): void {
  ensureConfigDir();

  const dir = dirname(path);
  const baseName = basename(path).replace(/\.json$/, "");
  const tmpFile = join(dir, `.${baseName}.tmp.${Date.now()}.json`);

  try {
    writeFileSync(tmpFile, JSON.stringify(keystore, null, 2), "utf-8");
    if (process.platform !== "win32") {
      try { chmodSync(tmpFile, 0o600); } catch { /* non-fatal on platforms without POSIX perms */ }
    }
    renameSync(tmpFile, path);
    logger.debug(`Keystore saved to ${path}`);
  } catch (err) {
    try {
      if (existsSync(tmpFile)) {
        unlinkSync(tmpFile);
      }
    } catch {
      // Ignore cleanup errors
    }
    throw err;
  }
}

function validateKeystoreShape(parsed: unknown, path: string): KeystoreV1 {
  if (parsed === null || typeof parsed !== "object") {
    throw new EchoError(ErrorCodes.KEYSTORE_CORRUPT, `Keystore at ${path} is not a valid JSON object.`);
  }

  const obj = parsed as Record<string, unknown>;
  const requiredFields: Array<[string, string]> = [
    ["version", "number"],
    ["salt", "string"],
    ["iv", "string"],
    ["tag", "string"],
    ["ciphertext", "string"],
  ];

  for (const [field, expectedType] of requiredFields) {
    if (!(field in obj) || typeof obj[field] !== expectedType) {
      throw new EchoError(
        ErrorCodes.KEYSTORE_CORRUPT,
        `Keystore at ${path} is missing or has invalid field "${field}".`,
        "Re-import your private key or restore from backup.",
      );
    }
  }

  return parsed as KeystoreV1;
}

export function loadKeystoreFile(path: string): KeystoreV1 | null {
  if (!existsSync(path)) {
    return null;
  }

  let parsed: unknown;
  try {
    const raw = readFileSync(path, "utf-8");
    parsed = JSON.parse(raw);
  } catch (err) {
    logger.error(`Failed to parse keystore ${path}: ${err}`);
    throw new EchoError(
      ErrorCodes.KEYSTORE_CORRUPT,
      `Keystore at ${path} contains invalid JSON.`,
      "Re-import your private key or restore from backup.",
    );
  }

  return validateKeystoreShape(parsed, path);
}

export function keystoreFileExists(path: string): boolean {
  return existsSync(path);
}

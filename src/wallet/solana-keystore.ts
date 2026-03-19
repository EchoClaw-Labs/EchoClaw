import bs58 from "bs58";
import { Keypair } from "@solana/web3.js";
import { SOLANA_KEYSTORE_FILE } from "../config/paths.js";
import { EchoError, ErrorCodes } from "../errors.js";
import {
  type KeystoreV1,
  decryptSecretBytes,
  encryptSecretBytes,
  keystoreFileExists,
  loadKeystoreFile,
  saveKeystoreFile,
} from "./keystore.js";

const SOLANA_SECRET_KEY_LENGTH = 64;

function parseJsonSecretKey(input: string): Uint8Array | null {
  if (!input.trim().startsWith("[")) {
    return null;
  }

  const parsed = JSON.parse(input) as unknown;
  if (!Array.isArray(parsed) || parsed.length !== SOLANA_SECRET_KEY_LENGTH) {
    throw new EchoError(ErrorCodes.INVALID_PRIVATE_KEY, `Solana secret key JSON must contain ${SOLANA_SECRET_KEY_LENGTH} bytes`);
  }

  const bytes = parsed.map((value) => {
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 255) {
      throw new EchoError(ErrorCodes.INVALID_PRIVATE_KEY, "Solana secret key JSON must contain integers in range 0-255");
    }
    return value;
  });

  return Uint8Array.from(bytes);
}

export function normalizeSolanaSecretKey(input: string): Uint8Array {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new EchoError(ErrorCodes.INVALID_PRIVATE_KEY, "Solana secret key cannot be empty");
  }

  const jsonBytes = parseJsonSecretKey(trimmed);
  if (jsonBytes) {
    return jsonBytes;
  }

  let decoded: Uint8Array;
  try {
    decoded = bs58.decode(trimmed);
  } catch {
    throw new EchoError(ErrorCodes.INVALID_PRIVATE_KEY, "Solana secret key must be base58 or JSON byte array");
  }

  if (decoded.length !== SOLANA_SECRET_KEY_LENGTH) {
    throw new EchoError(ErrorCodes.INVALID_PRIVATE_KEY, `Solana base58 secret key must decode to ${SOLANA_SECRET_KEY_LENGTH} bytes`);
  }
  return decoded;
}

export function encryptSolanaSecretKey(secretKey: Uint8Array, password: string): KeystoreV1 {
  if (secretKey.length !== SOLANA_SECRET_KEY_LENGTH) {
    throw new EchoError(ErrorCodes.INVALID_PRIVATE_KEY, `Solana secret key must be ${SOLANA_SECRET_KEY_LENGTH} bytes`);
  }
  return encryptSecretBytes(secretKey, password);
}

export function decryptSolanaSecretKey(keystore: KeystoreV1, password: string): Uint8Array {
  const secretKey = decryptSecretBytes(keystore, password);
  if (secretKey.length !== SOLANA_SECRET_KEY_LENGTH) {
    throw new EchoError(ErrorCodes.KEYSTORE_DECRYPT_FAILED, `Solana secret key must be ${SOLANA_SECRET_KEY_LENGTH} bytes after decrypt`);
  }
  return secretKey;
}

export function deriveSolanaAddress(secretKey: Uint8Array): string {
  return Keypair.fromSecretKey(secretKey).publicKey.toBase58();
}

export function encodeSolanaSecretKey(secretKey: Uint8Array): string {
  if (secretKey.length !== SOLANA_SECRET_KEY_LENGTH) {
    throw new EchoError(ErrorCodes.INVALID_PRIVATE_KEY, `Solana secret key must be ${SOLANA_SECRET_KEY_LENGTH} bytes`);
  }
  return bs58.encode(secretKey);
}

export function saveSolanaKeystore(keystore: KeystoreV1): void {
  saveKeystoreFile(SOLANA_KEYSTORE_FILE, keystore);
}

export function loadSolanaKeystore(): KeystoreV1 | null {
  return loadKeystoreFile(SOLANA_KEYSTORE_FILE);
}

export function solanaKeystoreExists(): boolean {
  return keystoreFileExists(SOLANA_KEYSTORE_FILE);
}

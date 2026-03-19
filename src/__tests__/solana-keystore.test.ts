import { describe, expect, it } from "vitest";
import { Keypair } from "@solana/web3.js";
import { ErrorCodes } from "../errors.js";
import {
  decryptSolanaSecretKey,
  deriveSolanaAddress,
  encodeSolanaSecretKey,
  encryptSolanaSecretKey,
  normalizeSolanaSecretKey,
} from "../wallet/solana-keystore.js";

describe("solana keystore helpers", () => {
  it("normalizes base58 and JSON byte-array secret keys", () => {
    const keypair = Keypair.generate();
    const base58Secret = encodeSolanaSecretKey(keypair.secretKey);
    const jsonSecret = JSON.stringify(Array.from(keypair.secretKey));

    expect(Array.from(normalizeSolanaSecretKey(base58Secret))).toEqual(Array.from(keypair.secretKey));
    expect(Array.from(normalizeSolanaSecretKey(jsonSecret))).toEqual(Array.from(keypair.secretKey));
  });

  it("encrypts and decrypts Solana secret keys without changing the derived address", () => {
    const keypair = Keypair.generate();
    const keystore = encryptSolanaSecretKey(keypair.secretKey, "test-password");
    const decrypted = decryptSolanaSecretKey(keystore, "test-password");

    expect(Array.from(decrypted)).toEqual(Array.from(keypair.secretKey));
    expect(deriveSolanaAddress(decrypted)).toBe(keypair.publicKey.toBase58());
  });

  describe("normalizeSolanaSecretKey edge cases", () => {
    it("throws INVALID_PRIVATE_KEY for empty input", () => {
      expect(() => normalizeSolanaSecretKey("")).toThrow();
      try {
        normalizeSolanaSecretKey("");
      } catch (err: unknown) {
        expect((err as { code: string }).code).toBe(ErrorCodes.INVALID_PRIVATE_KEY);
      }
    });

    it("throws INVALID_PRIVATE_KEY for whitespace-only input", () => {
      expect(() => normalizeSolanaSecretKey("   ")).toThrow();
      try {
        normalizeSolanaSecretKey("   ");
      } catch (err: unknown) {
        expect((err as { code: string }).code).toBe(ErrorCodes.INVALID_PRIVATE_KEY);
      }
    });

    it("throws INVALID_PRIVATE_KEY for invalid base58 characters", () => {
      expect(() => normalizeSolanaSecretKey("0OIl")).toThrow();
    });

    it("throws INVALID_PRIVATE_KEY for wrong-length base58 key", () => {
      // Valid base58 but too short to be 64 bytes
      expect(() => normalizeSolanaSecretKey("abc123")).toThrow();
      try {
        normalizeSolanaSecretKey("abc123");
      } catch (err: unknown) {
        expect((err as { code: string }).code).toBe(ErrorCodes.INVALID_PRIVATE_KEY);
      }
    });

    it("throws INVALID_PRIVATE_KEY for JSON array with wrong length", () => {
      const shortArray = JSON.stringify(Array.from({ length: 32 }, () => 0));
      expect(() => normalizeSolanaSecretKey(shortArray)).toThrow();
      try {
        normalizeSolanaSecretKey(shortArray);
      } catch (err: unknown) {
        expect((err as { code: string }).code).toBe(ErrorCodes.INVALID_PRIVATE_KEY);
      }
    });

    it("throws INVALID_PRIVATE_KEY for JSON array with out-of-range values", () => {
      const badArray = JSON.stringify(Array.from({ length: 64 }, () => 256));
      expect(() => normalizeSolanaSecretKey(badArray)).toThrow();
      try {
        normalizeSolanaSecretKey(badArray);
      } catch (err: unknown) {
        expect((err as { code: string }).code).toBe(ErrorCodes.INVALID_PRIVATE_KEY);
      }
    });
  });

  describe("decrypt with wrong password", () => {
    it("throws KEYSTORE_DECRYPT_FAILED for wrong password", () => {
      const keypair = Keypair.generate();
      const keystore = encryptSolanaSecretKey(keypair.secretKey, "correct-password");

      expect(() => decryptSolanaSecretKey(keystore, "wrong-password")).toThrow();
      try {
        decryptSolanaSecretKey(keystore, "wrong-password");
      } catch (err: unknown) {
        expect((err as { code: string }).code).toBe(ErrorCodes.KEYSTORE_DECRYPT_FAILED);
      }
    });
  });

  describe("encodeSolanaSecretKey", () => {
    it("throws for wrong-length key", () => {
      expect(() => encodeSolanaSecretKey(new Uint8Array(32))).toThrow();
    });
  });

  describe("encryptSolanaSecretKey", () => {
    it("throws for wrong-length key", () => {
      expect(() => encryptSolanaSecretKey(new Uint8Array(32), "password")).toThrow();
    });
  });
});

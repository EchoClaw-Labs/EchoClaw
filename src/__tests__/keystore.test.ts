import { describe, it, expect } from "vitest";
import { encryptPrivateKey, decryptPrivateKey, type KeystoreV1 } from "../wallet/keystore.js";

describe("keystore", () => {
  const testPrivateKey = "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  const testPassword = "testpassword123";

  describe("encryptPrivateKey", () => {
    it("should encrypt a private key with 0x prefix", () => {
      const keystore = encryptPrivateKey(testPrivateKey, testPassword);

      expect(keystore.version).toBe(1);
      expect(keystore.ciphertext).toBeTruthy();
      expect(keystore.iv).toBeTruthy();
      expect(keystore.salt).toBeTruthy();
      expect(keystore.tag).toBeTruthy();
      expect(keystore.kdf.name).toBe("scrypt");
    });

    it("should encrypt a private key without 0x prefix", () => {
      const pkWithoutPrefix = testPrivateKey.slice(2);
      const keystore = encryptPrivateKey(pkWithoutPrefix, testPassword);

      expect(keystore.version).toBe(1);
      expect(keystore.ciphertext).toBeTruthy();
    });

    it("should throw on invalid private key format", () => {
      expect(() => encryptPrivateKey("not-a-valid-key", testPassword)).toThrow(
        "Invalid private key"
      );
    });

    it("should throw on too short private key", () => {
      expect(() => encryptPrivateKey("0x1234", testPassword)).toThrow("Invalid private key");
    });

    it("should throw on too long private key", () => {
      const longKey = "0x" + "a".repeat(128);
      expect(() => encryptPrivateKey(longKey, testPassword)).toThrow("Invalid private key");
    });
  });

  describe("decryptPrivateKey", () => {
    it("should decrypt an encrypted private key correctly", () => {
      const keystore = encryptPrivateKey(testPrivateKey, testPassword);
      const decrypted = decryptPrivateKey(keystore, testPassword);

      expect(decrypted).toBe(testPrivateKey.toLowerCase());
    });

    it("should fail with wrong password", () => {
      const keystore = encryptPrivateKey(testPrivateKey, testPassword);

      expect(() => decryptPrivateKey(keystore, "wrongpassword")).toThrow(
        "Decryption failed"
      );
    });

    it("should handle uppercase hex in private key", () => {
      const uppercasePk = "0x0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF";
      const keystore = encryptPrivateKey(uppercasePk, testPassword);
      const decrypted = decryptPrivateKey(keystore, testPassword);

      expect(decrypted).toBe(uppercasePk.toLowerCase());
    });

    it("should throw on unsupported keystore version", () => {
      const keystore = encryptPrivateKey(testPrivateKey, testPassword);
      const invalidKeystore = { ...keystore, version: 99 } as unknown as KeystoreV1;

      expect(() => decryptPrivateKey(invalidKeystore, testPassword)).toThrow(
        "Unsupported keystore version"
      );
    });
  });

  describe("roundtrip", () => {
    it("should survive multiple encrypt/decrypt cycles", () => {
      let currentPk = testPrivateKey;

      for (let i = 0; i < 3; i++) {
        const keystore = encryptPrivateKey(currentPk, testPassword);
        const decrypted = decryptPrivateKey(keystore, testPassword);
        expect(decrypted).toBe(testPrivateKey.toLowerCase());
        currentPk = decrypted;
      }
    });

    it("should produce different ciphertexts for same input (random salt/iv)", () => {
      const keystore1 = encryptPrivateKey(testPrivateKey, testPassword);
      const keystore2 = encryptPrivateKey(testPrivateKey, testPassword);

      expect(keystore1.ciphertext).not.toBe(keystore2.ciphertext);
      expect(keystore1.salt).not.toBe(keystore2.salt);
      expect(keystore1.iv).not.toBe(keystore2.iv);
    });
  });
});

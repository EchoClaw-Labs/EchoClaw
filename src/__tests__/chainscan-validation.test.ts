import { describe, it, expect } from "vitest";
import {
  validateAddress,
  validateTxHash,
  validateAddressBatch,
  validateHashBatch,
  validatePagination,
  validateStatsPagination,
  validateTag,
} from "../chainscan/validation.js";
import { EchoError } from "../errors.js";

describe("chainscan validation", () => {
  describe("validateAddress", () => {
    it("should accept valid checksummed address", () => {
      const result = validateAddress("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045");
      expect(result).toBe("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045");
    });

    it("should checksum a lowercase address", () => {
      const result = validateAddress("0xd8da6bf26964af9d7eed9e03e53415d37aa96045");
      expect(result).toBe("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045");
    });

    it("should throw on invalid address", () => {
      expect(() => validateAddress("0xinvalid")).toThrow(EchoError);
      expect(() => validateAddress("0xinvalid")).toThrow(/Invalid address/);
    });

    it("should throw on empty string", () => {
      expect(() => validateAddress("")).toThrow(EchoError);
      expect(() => validateAddress("")).toThrow(/required/);
    });

    it("should use custom label in error message", () => {
      expect(() => validateAddress("bad", "contractAddress")).toThrow(/Invalid contractAddress/);
    });
  });

  describe("validateTxHash", () => {
    it("should accept valid tx hash", () => {
      const hash = "0x" + "a".repeat(64);
      expect(validateTxHash(hash)).toBe(hash);
    });

    it("should lowercase the hash", () => {
      const hash = "0x" + "A".repeat(64);
      expect(validateTxHash(hash)).toBe("0x" + "a".repeat(64));
    });

    it("should throw on missing 0x prefix", () => {
      expect(() => validateTxHash("a".repeat(64))).toThrow(EchoError);
    });

    it("should throw on wrong length", () => {
      expect(() => validateTxHash("0x" + "a".repeat(63))).toThrow(EchoError);
      expect(() => validateTxHash("0x" + "a".repeat(65))).toThrow(EchoError);
    });

    it("should throw on invalid hex chars", () => {
      expect(() => validateTxHash("0x" + "g".repeat(64))).toThrow(EchoError);
    });

    it("should throw on empty string", () => {
      expect(() => validateTxHash("")).toThrow(EchoError);
      expect(() => validateTxHash("")).toThrow(/required/);
    });
  });

  describe("validateAddressBatch", () => {
    const valid = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";

    it("should accept single address", () => {
      const result = validateAddressBatch([valid], 5);
      expect(result).toHaveLength(1);
    });

    it("should accept multiple addresses up to max", () => {
      const result = validateAddressBatch([valid, valid], 5);
      expect(result).toHaveLength(2);
    });

    it("should throw when exceeding max size", () => {
      const addresses = Array(6).fill(valid);
      expect(() => validateAddressBatch(addresses, 5)).toThrow(/Too many addresses.*6.*max 5/);
    });

    it("should throw on empty array", () => {
      expect(() => validateAddressBatch([], 5)).toThrow(/At least one/);
    });

    it("should throw on invalid address in batch", () => {
      expect(() => validateAddressBatch([valid, "0xinvalid"], 5)).toThrow(EchoError);
    });
  });

  describe("validateHashBatch", () => {
    const validHash = "0x" + "a".repeat(64);

    it("should accept valid hashes", () => {
      const result = validateHashBatch([validHash], 10);
      expect(result).toHaveLength(1);
    });

    it("should throw when exceeding max", () => {
      const hashes = Array(11).fill(validHash);
      expect(() => validateHashBatch(hashes, 10)).toThrow(/Too many hashes/);
    });

    it("should throw on empty array", () => {
      expect(() => validateHashBatch([], 10)).toThrow(/At least one/);
    });
  });

  describe("validatePagination", () => {
    it("should return defaults when no options", () => {
      const result = validatePagination();
      expect(result).toEqual({ page: 1, offset: 25, sort: "desc" });
    });

    it("should accept custom values", () => {
      const result = validatePagination({ page: 3, offset: 50, sort: "asc" });
      expect(result).toEqual({ page: 3, offset: 50, sort: "asc" });
    });

    it("should include startblock and endblock when provided", () => {
      const result = validatePagination({ startblock: 100, endblock: 200 });
      expect(result.startblock).toBe("100");
      expect(result.endblock).toBe("200");
    });

    it("should throw on page < 1", () => {
      expect(() => validatePagination({ page: 0 })).toThrow(/Invalid page/);
    });

    it("should throw on offset > 100", () => {
      expect(() => validatePagination({ offset: 101 })).toThrow(/Invalid offset/);
    });

    it("should throw on offset < 1", () => {
      expect(() => validatePagination({ offset: 0 })).toThrow(/Invalid offset/);
    });

    it("should throw on invalid sort", () => {
      expect(() => validatePagination({ sort: "random" })).toThrow(/Invalid sort/);
    });
  });

  describe("validateStatsPagination", () => {
    it("should return defaults when no options", () => {
      const result = validateStatsPagination();
      expect(result).toEqual({ skip: 0, limit: 30, sort: "desc" });
    });

    it("should accept custom values", () => {
      const result = validateStatsPagination({ skip: 10, limit: 100, sort: "asc" });
      expect(result).toEqual({ skip: 10, limit: 100, sort: "asc" });
    });

    it("should include timestamps when provided", () => {
      const result = validateStatsPagination({ minTimestamp: 1000, maxTimestamp: 2000 });
      expect(result.minTimestamp).toBe("1000");
      expect(result.maxTimestamp).toBe("2000");
    });

    it("should throw on limit > 2000", () => {
      expect(() => validateStatsPagination({ limit: 2001 })).toThrow(/Invalid limit/);
    });

    it("should throw on limit < 1", () => {
      expect(() => validateStatsPagination({ limit: 0 })).toThrow(/Invalid limit/);
    });

    it("should throw on skip > 10000", () => {
      expect(() => validateStatsPagination({ skip: 10001 })).toThrow(/Invalid skip/);
    });

    it("should throw on skip < 0", () => {
      expect(() => validateStatsPagination({ skip: -1 })).toThrow(/Invalid skip/);
    });

    it("should throw on invalid sort", () => {
      expect(() => validateStatsPagination({ sort: "invalid" })).toThrow(/Invalid sort/);
    });
  });

  describe("validateTag", () => {
    it("should return latest_state as default", () => {
      expect(validateTag()).toBe("latest_state");
      expect(validateTag(undefined)).toBe("latest_state");
    });

    it("should accept valid tags", () => {
      expect(validateTag("latest_state")).toBe("latest_state");
      expect(validateTag("latest_mined")).toBe("latest_mined");
      expect(validateTag("latest_finalized")).toBe("latest_finalized");
      expect(validateTag("latest_confirmed")).toBe("latest_confirmed");
      expect(validateTag("latest_checkpoint")).toBe("latest_checkpoint");
      expect(validateTag("earliest")).toBe("earliest");
    });

    it("should throw on invalid tag", () => {
      expect(() => validateTag("latest")).toThrow(/Invalid tag/);
      expect(() => validateTag("pending")).toThrow(/Invalid tag/);
    });
  });
});

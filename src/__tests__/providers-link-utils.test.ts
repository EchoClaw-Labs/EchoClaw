import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { linkToTarget } from "../providers/link-utils.js";

describe("linkToTarget", () => {
  it("throws clear error when source path does not exist", () => {
    const root = mkdtempSync(join(tmpdir(), "echoclaw-link-utils-"));
    const source = join(root, "missing-source");
    const target = join(root, "target", "echoclaw");

    try {
      expect(() => linkToTarget(source, target, { force: false })).toThrow("Skill source not found");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

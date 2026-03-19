import { describe, it, expect } from "vitest";
import { formatCost } from "../0g-storage/cost.js";
import { formatCostDisplay } from "../0g-storage/cost.js";

describe("formatCost", () => {
  it("formats a positive bigint", () => {
    const cost = formatCost(1_000_000_000_000_000n); // 0.001 0G
    expect(cost.totalWei).toBe("1000000000000000");
    expect(cost.total0G).toBe("0.001000");
  });

  it("formats zero", () => {
    const cost = formatCost(0n);
    expect(cost.totalWei).toBe("0");
    expect(cost.total0G).toBe("0.000000");
  });

  it("clamps negative to zero", () => {
    const cost = formatCost(-500n);
    expect(cost.totalWei).toBe("0");
    expect(cost.total0G).toBe("0.000000");
  });

  it("handles 1 full 0G token", () => {
    const oneOG = 10n ** 18n;
    const cost = formatCost(oneOG);
    expect(cost.totalWei).toBe("1000000000000000000");
    expect(cost.total0G).toBe("1.000000");
  });

  it("handles large values", () => {
    const hundredOG = 100n * 10n ** 18n;
    const cost = formatCost(hundredOG);
    expect(cost.total0G).toBe("100.000000");
  });
});

describe("formatCostDisplay", () => {
  it("formats display string", () => {
    const display = formatCostDisplay({
      totalWei: "1000000000000000",
      total0G: "0.001000",
    });
    expect(display).toBe("0.001000 0G");
  });

  it("formats zero cost", () => {
    const display = formatCostDisplay({
      totalWei: "0",
      total0G: "0.000000",
    });
    expect(display).toBe("0.000000 0G");
  });
});

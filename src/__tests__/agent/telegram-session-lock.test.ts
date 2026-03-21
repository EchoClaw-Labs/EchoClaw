import { describe, it, expect } from "vitest";
import { withSessionLock } from "../../agent/telegram/session-lock.js";

function deferred(): {
  promise: Promise<void>;
  resolve: () => void;
} {
  let resolve = () => {};
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("telegram session lock", () => {
  it("serializes work for the same session", async () => {
    const order: string[] = [];
    const gate = deferred();

    const first = withSessionLock("session-1", async () => {
      order.push("first:start");
      await gate.promise;
      order.push("first:end");
    });

    const second = withSessionLock("session-1", async () => {
      order.push("second:start");
      order.push("second:end");
    });

    await Promise.resolve();
    expect(order).toEqual(["first:start"]);

    gate.resolve();
    await Promise.all([first, second]);

    expect(order).toEqual([
      "first:start",
      "first:end",
      "second:start",
      "second:end",
    ]);
  });

  it("allows different sessions to proceed independently", async () => {
    const firstGate = deferred();
    let secondRan = false;

    const first = withSessionLock("session-a", async () => {
      await firstGate.promise;
    });

    const second = withSessionLock("session-b", async () => {
      secondRan = true;
    });

    await second;
    expect(secondRan).toBe(true);

    firstGate.resolve();
    await first;
  });
});

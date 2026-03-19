import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../utils/logger.js", () => ({
  default: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

const { NonceQueue } = await import("../bot/nonce-queue.js");
const logger = (await import("../utils/logger.js")).default;

describe("NonceQueue", () => {
  it("sequential: tasks execute in FIFO order", async () => {
    const queue = new NonceQueue();
    const order: number[] = [];

    await Promise.all([
      queue.enqueue(async () => { order.push(1); }),
      queue.enqueue(async () => { order.push(2); }),
      queue.enqueue(async () => { order.push(3); }),
    ]);

    expect(order).toEqual([1, 2, 3]);
  });

  it("error isolation: failing task does not block next", async () => {
    const queue = new NonceQueue();
    const results: string[] = [];

    const p1 = queue.enqueue(async () => {
      results.push("first-start");
      throw new Error("fail");
    }).catch(() => { results.push("first-caught"); });

    const p2 = queue.enqueue(async () => {
      results.push("second-ok");
    });

    await Promise.all([p1, p2]);

    expect(results).toContain("first-start");
    expect(results).toContain("first-caught");
    expect(results).toContain("second-ok");
  });

  it("pending: count increments on enqueue, decrements on completion", async () => {
    const queue = new NonceQueue();
    expect(queue.pending).toBe(0);

    let resolve1!: () => void;
    const p1 = new Promise<void>((r) => { resolve1 = r; });

    const task = queue.enqueue(async () => { await p1; });
    expect(queue.pending).toBe(1);

    resolve1();
    await task;
    // Allow microtask to process the .then chain
    await new Promise((r) => setTimeout(r, 10));
    expect(queue.pending).toBe(0);
  });

  it("drain: resolves when all tasks finish", async () => {
    const queue = new NonceQueue();
    const completed: number[] = [];

    // Use deterministic manual promises instead of timers
    let resolve1!: () => void;
    let resolve2!: () => void;
    const p1 = new Promise<void>((r) => { resolve1 = r; });
    const p2 = new Promise<void>((r) => { resolve2 = r; });

    queue.enqueue(async () => { await p1; completed.push(1); });
    queue.enqueue(async () => { await p2; completed.push(2); });

    // Resolve both tasks
    resolve1();
    resolve2();

    await queue.drain(5000);

    expect(completed).toEqual([1, 2]);
  });

  it("drain timeout: resolves via timeout and logs warning", async () => {
    vi.useFakeTimers();

    const queue = new NonceQueue();

    // Task that never resolves
    queue.enqueue(() => new Promise<void>(() => {}));

    const drainPromise = queue.drain(100);

    // Advance past timeout
    await vi.advanceTimersByTimeAsync(150);

    await drainPromise;

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("Drain timed out")
    );

    vi.useRealTimers();
  });

  it("concurrent enqueue: maintains order", async () => {
    const queue = new NonceQueue();
    const results: number[] = [];

    // Deterministic: no random delays, just sync pushes
    const promises = Array.from({ length: 10 }, (_, i) =>
      queue.enqueue(async () => {
        results.push(i);
      })
    );

    await Promise.all(promises);

    expect(results).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });
});

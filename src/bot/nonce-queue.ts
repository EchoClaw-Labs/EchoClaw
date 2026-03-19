/**
 * NonceQueue — Serializes blockchain transactions per wallet.
 * FIFO, sequential execution. Error in one tx does not block the next.
 */

import logger from "../utils/logger.js";

export class NonceQueue {
  private chain: Promise<void> = Promise.resolve();
  private _pending = 0;

  /**
   * Enqueue an async function for sequential execution.
   * Returns when the function completes (or throws).
   */
  enqueue<T>(fn: () => Promise<T>): Promise<T> {
    this._pending++;
    const result = this.chain.then(
      () => fn(),
      () => fn() // Previous error doesn't block next
    );

    // Update chain but swallow errors to not block future enqueues
    this.chain = result.then(
      () => { this._pending--; },
      () => { this._pending--; }
    );

    return result;
  }

  get pending(): number {
    return this._pending;
  }

  /**
   * Wait for all pending tasks to complete.
   * @param timeoutMs Max wait time (default 30s)
   */
  async drain(timeoutMs = 30000): Promise<void> {
    if (this._pending === 0) return;

    logger.info(`[NonceQueue] Draining ${this._pending} pending tx...`);

    await Promise.race([
      this.chain,
      new Promise<void>((resolve) => setTimeout(() => {
        logger.warn(`[NonceQueue] Drain timed out after ${timeoutMs}ms`);
        resolve();
      }, timeoutMs)),
    ]);
  }
}

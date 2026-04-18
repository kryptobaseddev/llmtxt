/**
 * Graceful shutdown coordinator for Railway deploy safety (T092).
 *
 * Design
 * ------
 * A single ShutdownCoordinator singleton is created at module load time.
 * Callers register "drain hooks" — ordered cleanup callbacks that are
 * awaited in sequence during the SIGTERM grace window.
 *
 * Hooks are called in registration order; each hook must resolve within
 * its own timeout or the overall drain() deadline will abort everything.
 *
 * In-flight request tracking
 * --------------------------
 * The coordinator also tracks in-flight HTTP request count. Fastify hooks
 * in index.ts increment/decrement this counter. During drain we wait up to
 * DRAIN_TIMEOUT_MS for the counter to reach zero before forcing close.
 *
 * Acceptance criteria (T092):
 *   AC1: isDraining flag flips on drain() call — routes can short-circuit.
 *   AC2: registerDrainHook() accumulates ordered callbacks.
 *   AC3: drain() awaits all hooks in sequence within 30 s total deadline.
 */

/** A cleanup callback registered by a subsystem. */
export type DrainHook = () => Promise<void> | void;

/** Overall drain deadline in ms (must exceed Railway's default 10 s + buffer). */
const DRAIN_TIMEOUT_MS = 30_000;

class ShutdownCoordinator {
  /** True once SIGTERM has been received and drain is in progress. */
  isDraining = false;

  /** Number of currently-active HTTP requests. */
  private _inflight = 0;

  /** Ordered list of registered drain hooks. */
  private _hooks: Array<{ name: string; fn: DrainHook }> = [];

  /**
   * Increment the in-flight HTTP request counter.
   * Called from Fastify's onRequest hook in index.ts.
   */
  requestStarted(): void {
    this._inflight++;
  }

  /**
   * Decrement the in-flight HTTP request counter.
   * Called from Fastify's onResponse hook in index.ts.
   */
  requestFinished(): void {
    if (this._inflight > 0) this._inflight--;
  }

  /** Current in-flight request count. */
  get inflightCount(): number {
    return this._inflight;
  }

  /**
   * Register a drain hook. Hooks are called in registration order.
   *
   * @param name   Human-readable label for logging.
   * @param fn     Async cleanup function. Must not throw — wrap internally.
   */
  registerDrainHook(name: string, fn: DrainHook): void {
    this._hooks.push({ name, fn });
  }

  /**
   * Execute all registered drain hooks in sequence.
   *
   * The overall deadline is DRAIN_TIMEOUT_MS. If hooks don't complete within
   * that window, drain() resolves anyway so the process can exit cleanly.
   *
   * Sets isDraining = true before any hook runs so subsystems can check it.
   */
  async drain(): Promise<void> {
    if (this.isDraining) return; // idempotent
    this.isDraining = true;

    console.log('[shutdown] SIGTERM received — starting drain');

    const deadline = new Promise<void>((resolve) => {
      setTimeout(() => {
        console.warn('[shutdown] drain deadline exceeded — forcing close');
        resolve();
      }, DRAIN_TIMEOUT_MS).unref();
    });

    const runHooks = async () => {
      for (const hook of this._hooks) {
        try {
          console.log(`[shutdown] running drain hook: ${hook.name}`);
          await Promise.resolve(hook.fn());
          console.log(`[shutdown] drain hook done: ${hook.name}`);
        } catch (err) {
          console.error(`[shutdown] drain hook failed (${hook.name}):`, err);
          // Non-fatal — continue with remaining hooks
        }
      }

      // Wait for in-flight requests to drain (up to remaining deadline)
      await this._waitForInflight();
    };

    await Promise.race([runHooks(), deadline]);
    console.log('[shutdown] drain complete');
  }

  /**
   * Spin-wait until in-flight count reaches zero or timeout.
   * Checks every 100 ms.
   */
  private _waitForInflight(): Promise<void> {
    if (this._inflight === 0) return Promise.resolve();

    return new Promise<void>((resolve) => {
      const MAX_POLLS = 280; // 28 s ceiling (100 ms interval)
      let polls = 0;
      const interval = setInterval(() => {
        polls++;
        if (this._inflight === 0 || polls >= MAX_POLLS) {
          clearInterval(interval);
          if (this._inflight > 0) {
            console.warn(`[shutdown] ${this._inflight} requests still in-flight — forcing close`);
          } else {
            console.log('[shutdown] all in-flight requests completed');
          }
          resolve();
        }
      }, 100);
      interval.unref();
    });
  }
}

/** Singleton coordinator — import this everywhere. */
export const shutdownCoordinator = new ShutdownCoordinator();

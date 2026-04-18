/**
 * Test-only export of a ShutdownCoordinator that can be instantiated
 * independently (not the singleton) and has a `startDraining()` helper
 * for simulating mid-drain state in tests.
 */

type DrainHook = () => Promise<void> | void;

const DRAIN_TIMEOUT_MS = 5_000; // shorter for tests

/**
 * A copy of ShutdownCoordinator that is instantiable (not a singleton)
 * for isolation in test cases.
 */
export class ShutdownCoordinatorForTest {
  isDraining = false;
  private _inflight = 0;
  private _hooks: Array<{ name: string; fn: DrainHook }> = [];

  requestStarted(): void { this._inflight++; }

  requestFinished(): void { if (this._inflight > 0) this._inflight--; }

  get inflightCount(): number { return this._inflight; }

  registerDrainHook(name: string, fn: DrainHook): void {
    this._hooks.push({ name, fn });
  }

  /** Test helper: immediately flip isDraining without running hooks. */
  startDraining(): void {
    this.isDraining = true;
  }

  async drain(): Promise<void> {
    if (this.isDraining) return;
    this.isDraining = true;

    const deadline = new Promise<void>((resolve) => {
      setTimeout(resolve, DRAIN_TIMEOUT_MS).unref();
    });

    const runHooks = async () => {
      for (const hook of this._hooks) {
        try {
          await Promise.resolve(hook.fn());
        } catch {
          // Non-fatal
        }
      }
    };

    await Promise.race([runHooks(), deadline]);
  }
}

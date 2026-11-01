/** A resource-key wait expired before the associated effect began. */
export class ResourceAdmissionTimeoutError extends Error {
  constructor() { super("resource key admission timed out"); this.name = "ResourceAdmissionTimeoutError"; }
}

type Waiter = { admit: () => void; timer?: NodeJS.Timeout };
type GateState = { waiting: Waiter[] };

export class ResourceKeyGate {
  private readonly states = new Map<string, GateState>();

  async run<T>(key: string, work: () => Promise<T>, waitTimeoutMs?: number): Promise<T> {
    await this.acquire(key, waitTimeoutMs);
    try {
      return await work();
    } finally {
      this.release(key);
    }
  }

  private acquire(key: string, waitTimeoutMs?: number): Promise<void> {
    if (waitTimeoutMs !== undefined && waitTimeoutMs <= 0) return Promise.reject(new ResourceAdmissionTimeoutError());
    const state = this.states.get(key);
    if (!state) {
      this.states.set(key, { waiting: [] });
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      let settled = false;
      const waiter: Waiter = {
        admit: () => {
          if (settled) return;
          settled = true;
          if (waiter.timer) clearTimeout(waiter.timer);
          resolve();
        }
      };
      state.waiting.push(waiter);
      if (waitTimeoutMs !== undefined) {
        waiter.timer = setTimeout(() => {
          if (settled) return;
          settled = true;
          const index = state.waiting.indexOf(waiter);
          if (index >= 0) state.waiting.splice(index, 1);
          reject(new ResourceAdmissionTimeoutError());
        }, Math.max(0, waitTimeoutMs));
      }
    });
  }

  private release(key: string): void {
    const state = this.states.get(key);
    if (!state) return;
    const next = state.waiting.shift();
    if (next) next.admit();
    else this.states.delete(key);
  }
}

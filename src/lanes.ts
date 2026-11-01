/** Admission expired before the work function was called. No effect was dispatched. */
export class LaneQueueTimeoutError extends Error {
  constructor() { super("execution lane admission timed out"); this.name = "LaneQueueTimeoutError"; }
}

export class LanePool {
  private active = 0;
  private readonly queue: Array<() => void> = [];

  constructor(readonly limit: number) {
    if (!Number.isInteger(limit) || limit < 1) throw new Error("lane limit must be a positive integer");
  }

  get activeCount() { return this.active; }
  get queuedCount() { return this.queue.length; }

  async run<T>(fn: () => Promise<T>, queueWaitTimeoutMs?: number): Promise<T> {
    await this.acquire(queueWaitTimeoutMs);
    try { return await fn(); }
    finally { this.release(); }
  }

  private acquire(queueWaitTimeoutMs?: number): Promise<void> {
    if (queueWaitTimeoutMs !== undefined && queueWaitTimeoutMs <= 0) return Promise.reject(new LaneQueueTimeoutError());
    if (this.active < this.limit) {
      this.active++;
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      let settled = false;
      let timer: NodeJS.Timeout | undefined;
      const admit = () => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        this.active++;
        resolve();
      };
      this.queue.push(admit);
      if (queueWaitTimeoutMs !== undefined) {
        timer = setTimeout(() => {
          if (settled) return;
          settled = true;
          const index = this.queue.indexOf(admit);
          if (index >= 0) this.queue.splice(index, 1);
          reject(new LaneQueueTimeoutError());
        }, Math.max(0, queueWaitTimeoutMs));
      }
    });
  }

  private release() {
    this.active--;
    const next = this.queue.shift();
    if (next) next();
  }
}

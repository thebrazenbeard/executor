export class LanePool {
  private active = 0;
  private readonly queue: Array<() => void> = [];

  constructor(readonly limit: number) {
    if (!Number.isInteger(limit) || limit < 1) throw new Error("lane limit must be a positive integer");
  }

  get activeCount() { return this.active; }
  get queuedCount() { return this.queue.length; }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try { return await fn(); }
    finally { this.release(); }
  }

  private acquire(): Promise<void> {
    if (this.active < this.limit) {
      this.active++;
      return Promise.resolve();
    }
    return new Promise(resolve => {
      this.queue.push(() => {
        this.active++;
        resolve();
      });
    });
  }

  private release() {
    this.active--;
    const next = this.queue.shift();
    if (next) next();
  }
}

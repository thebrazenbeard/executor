export class ResourceKeyGate {
  private readonly tails = new Map<string, Promise<void>>();

  async run<T>(key: string, work: () => Promise<T>): Promise<T> {
    const prior = this.tails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const mine = new Promise<void>(r => { release = r; });
    const tail = prior.catch(() => {}).then(() => mine);
    this.tails.set(key, tail);

    await prior.catch(() => {});
    try {
      return await work();
    } finally {
      release();
      if (this.tails.get(key) === tail) this.tails.delete(key);
    }
  }
}

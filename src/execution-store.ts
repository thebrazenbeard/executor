import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { ExecutionEvent } from "./execution-events.js";

export interface ExecutionEventStore {
  append(event: ExecutionEvent): Promise<void>;
  load(executionId?: string): Promise<ExecutionEvent[]>;
}

export class JsonlExecutionEventStore implements ExecutionEventStore {
  constructor(readonly file: string) {}

  async append(event: ExecutionEvent): Promise<void> {
    await mkdir(path.dirname(this.file), { recursive: true });
    await appendFile(this.file, JSON.stringify(event) + "\n", "utf8");
  }

  async load(executionId?: string): Promise<ExecutionEvent[]> {
    let text: string;
    try { text = await readFile(this.file, "utf8"); } catch (e: any) {
      if (e?.code === "ENOENT") return [];
      throw e;
    }
    const events: ExecutionEvent[] = [];
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      const event = JSON.parse(line) as ExecutionEvent;
      if (!executionId || event.executionId === executionId) events.push(event);
    }
    return events;
  }
}

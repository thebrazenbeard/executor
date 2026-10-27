import { JsonlExecutionEventStore } from "./execution-store.js";
import { projectExecutionEventForTemporal } from "./temporal-projection.js";

function argumentsForPreview(args: string[]): { file: string; executionId?: string } {
  let file: string | undefined;
  let executionId: string | undefined;
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new Error("usage: export-temporal --events-file PATH [--execution-id ID]");
    if (flag === "--events-file" && file === undefined) file = value;
    else if (flag === "--execution-id" && executionId === undefined) executionId = value;
    else throw new Error("usage: export-temporal --events-file PATH [--execution-id ID]");
  }
  if (!file) throw new Error("usage: export-temporal --events-file PATH [--execution-id ID]");
  return { file, ...(executionId === undefined ? {} : { executionId }) };
}

async function main(): Promise<void> {
  const { file, executionId } = argumentsForPreview(process.argv.slice(2));
  const events = await new JsonlExecutionEventStore(file).load(executionId);
  // Validate every projection before emitting any output to avoid a misleading
  // partial preview when one event cannot be represented in Temporal V1.
  const records = events.map(projectExecutionEventForTemporal);
  const seenIds = new Set<string>();
  for (const record of records) {
    if (seenIds.has(record.id)) throw new Error("duplicate Temporal event ID");
    seenIds.add(record.id);
  }
  // Temporal orders by UTC instant and stable ID, not source journal order.
  // These timestamps originate from millisecond-precision Date values.
  records.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp)
    || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const record of records) process.stdout.write(JSON.stringify(record) + "\n");
}

main().catch(() => {
  // Arbitrary source event data may contain credentials. Do not print raw parser
  // failures or source excerpts to stderr.
  console.error("Executor Temporal preview failed; input or mapping is invalid");
  process.exitCode = 2;
});

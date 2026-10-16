import { readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";

const dir = path.resolve("dist", "test");
const files = (await readdir(dir))
  .filter(name => name.endsWith(".test.js"))
  .sort()
  .map(name => path.join(dir, name));

if (!files.length) {
  console.error("no compiled tests found");
  process.exit(1);
}
const result = spawnSync(process.execPath, ["--test", ...files], { stdio: "inherit" });
process.exit(result.status ?? 1);

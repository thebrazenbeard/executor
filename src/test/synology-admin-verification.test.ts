import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("Executor skill requires explicit user approval between DSM prepare and apply", async () => {
  const text = await readFile("skills/executor/SKILL.md","utf8");
  assert.match(text,/admin\.prepare_change/);
  assert.match(text,/explicit user approval/i);
  assert.match(text,/admin\.apply_change/);
  assert.match(text,/never call[\s\S]{0,200}admin\.apply_change[\s\S]{0,200}approval/i);
});

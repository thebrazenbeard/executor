import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function text(path: string) {
  return readFile(path, "utf8");
}

test("Synology package documentation preserves device-specific authority and lane semantics", async () => {
  const [readme, architecture, setup, security, skill] = await Promise.all([
    text("README.md"),
    text("docs/ARCHITECTURE.md"),
    text("docs/SETUP.md"),
    text("SECURITY.md"),
    text("skills/executor/SKILL.md")
  ]);

  for (const body of [readme, architecture, setup]) {
    assert.match(body, /synology-storage/i);
    assert.match(body, /DS216/i);
    assert.match(body, /2 (?:parallel )?execution lanes/i);
    assert.match(body, /64 (?:parallel )?logic lanes/i);
  }

  assert.match(readme, /Windows.{0,80}8 (?:parallel )?execution lanes/is);
  assert.match(setup, /system internal user/i);
  assert.match(setup, /Read\/Write/i);
  assert.match(setup, /Manual Install/i);

  assert.match(security, /prepare.{0,80}explicit user approval.{0,80}apply/is);
  assert.match(skill, /Never call `admin\.apply_change` without explicit user approval/i);
  assert.match(security, /physical DS216|physical NAS/i);
});

test("Synology acceptance requirements and CI artifact are explicit", async () => {
  const [rawContract, workflow] = await Promise.all([
    text("test/acceptance-contract.json"),
    text(".github/workflows/ci.yml")
  ]);
  const contract = JSON.parse(rawContract);
  const ids = new Set(contract.requirements.map((r: { id: string }) => r.id));
  for (const id of ["EXE-22","EXE-23","EXE-24","EXE-25","EXE-26","EXE-27","EXE-28"]) {
    assert.equal(ids.has(id), true, `missing ${id}`);
  }

  assert.match(workflow, /ExecutorNode-armada38x-0\.1\.0-0001\.spk/);
  assert.match(workflow, /actions\/upload-artifact@/);
  assert.match(workflow, /bash nodes\/synology\/validate-spk\.sh/);
  assert.match(workflow, /go test \.\/\.\.\./);
});

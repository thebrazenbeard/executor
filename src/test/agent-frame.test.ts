import test from "node:test";
import assert from "node:assert/strict";
import { parseDeviceServerFrame } from "../registration-proof.js";

test("malformed server frames fail closed instead of dereferencing null", () => {
  for (const raw of ["null", "[]", "42", "false", "true", "\"x\"", "{", "not json"]) {
    assert.equal(parseDeviceServerFrame(raw), undefined, raw);
  }
});

test("object frames remain available for downstream source guards", () => {
  assert.deepEqual(parseDeviceServerFrame('{"type":"ready","deviceId":"VERA-NODE-1"}'),
    { type:"ready", deviceId:"VERA-NODE-1" });
  assert.deepEqual(parseDeviceServerFrame('{"type":"registration-receipt","registered":false}'),
    { type:"registration-receipt", registered:false });
});

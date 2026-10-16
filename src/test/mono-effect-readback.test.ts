import test from "node:test";
import assert from "node:assert/strict";
import {assessMonoEffectSource,REVIEWED_MONO_HEAD} from "../mono-effect-readback.js";

const sha=(x:string)=>x.repeat(64);
const expected={deviceId:"VERA-NODE-1",generation:6,connectedAt:1792164975049,
  effectId:"vn1:effect:one",requestDigest:sha("a")};
const observation={
  sourceHead:REVIEWED_MONO_HEAD,deviceId:expected.deviceId,
  generation:expected.generation,connectedAt:expected.connectedAt,
  effectId:expected.effectId,requestDigest:expected.requestDigest,
  state:"ATTEMPTED_UNKNOWN",resultDigest:null,reconciliationEvidenceDigest:null,
  transportSignal:"HTTP_202"
};
const verifyNoAuthority=(r:ReturnType<typeof assessMonoEffectSource>)=>{
  assert.equal(r.dispatchAuthorized,false);
  assert.equal(r.retryAuthorized,false);
  assert.equal(r.reconciliationAuthorized,false);
  assert.equal(r.applicationCompletionVerified,false);
  assert.equal(r.externalEffectVerified,false);
};
test("Mono unknown effect survives as HOLD regardless of HTTP 202 or send callback",()=>{
  for(const transportSignal of ["NONE","WEBSOCKET_SEND","HTTP_202"]){
    const r=assessMonoEffectSource({...observation,transportSignal},expected);
    assert.equal(r.status,"HOLD");
    assert.equal(r.reason,"AMBIGUOUS_DISPATCH_REQUIRES_MONO_QUALIFIED_RECOVERY");
    verifyNoAuthority(r);
  }
});
test("replaced connection/generation and changed task digest hold without dispatch",()=>{
  for(const bad of [{generation:7},{connectedAt:expected.connectedAt+1},
    {deviceId:"Lappy"},{effectId:"vn1:effect:other"},{requestDigest:sha("b")},
    {sourceHead:"0".repeat(40)}]){
    const r=assessMonoEffectSource({...observation,...bad},expected);
    assert.equal(r.status,"HOLD");verifyNoAuthority(r);
  }
});
test("claimed terminal completion or reconciliation never verifies application effect",()=>{
  const examples=[
    {state:"COMMITTED",resultDigest:sha("b")},
    {state:"RECONCILED_COMMITTED",resultDigest:sha("c"),
      reconciliationEvidenceDigest:sha("d")},
    {state:"RECONCILED_NO_EFFECT",resultDigest:null,reconciliationEvidenceDigest:sha("e")},
    {state:"CANCELLED_PRE_DISPATCH",resultDigest:null},
  ];
  for(const entry of examples){
    const r=assessMonoEffectSource({...observation,...entry},expected);
    assert.equal(r.status,"SOURCE_OBSERVATION_ONLY");
    verifyNoAuthority(r);
  }
});
test("fake completed receipts and missing reconciliation evidence are HELD",()=>{
  for(const entry of [
    {state:"COMMITTED",resultDigest:null},
    {state:"RECONCILED_COMMITTED",resultDigest:sha("c")},
    {state:"RECONCILED_NO_EFFECT",reconciliationEvidenceDigest:null},
    {state:"CANCELLED_PRE_DISPATCH",resultDigest:sha("b")},
    {state:"SOME_MADE_UP_COMPLETED"},
    {transportSignal:"APPLICATION_RECEIVED"},
  ]){
    const r=assessMonoEffectSource({...observation,...entry},expected);
    assert.equal(r.status,"HOLD");verifyNoAuthority(r);
  }
});
test("missing Mono readback and fabricated expected identity fail closed",()=>{
  for(const input of [null,undefined,{},[],"COMMITTED"]){
    const r=assessMonoEffectSource(input,expected);
    assert.equal(r.status,"HOLD");verifyNoAuthority(r);
  }
  const invalid=assessMonoEffectSource(observation,{...expected,generation:NaN});
  assert.equal(invalid.status,"HOLD");verifyNoAuthority(invalid);
});

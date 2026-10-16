import test from "node:test";
import assert from "node:assert/strict";
import { DeviceConnection, DeviceRegistry } from "../device-registry.js";
import { classifyRegistrationReceipt, gatewayRegistrationReceipt, parseRegistrationProbe } from "../registration-proof.js";

const nonce = "0123456789abcdef0123456789abcdef";
class FakeSocket {
  OPEN = 1; readyState = 1; closeCalls: unknown[][] = [];
  close(...args: unknown[]) { this.closeCalls.push(args); }
  send(_data: string, callback?: (error?: Error) => void) { callback?.(); }
}
function attached() {
  const registry = new DeviceRegistry();
  const socket = new FakeSocket();
  const device = new DeviceConnection("VERA-NODE-1", socket as any, 8);
  registry.attach(device);
  return {registry,device,socket};
}
const probe = {type:"registration-probe",nonce};
test("current mapped authenticated connection receives registry-derived generation and session", () => {
  const {registry,device} = attached();
  const receipt = gatewayRegistrationReceipt(registry, device, probe);
  assert.equal(receipt?.registered,true);
  assert.equal(receipt?.generation,1);
  assert.equal(receipt?.connectedAt,registry.describe("VERA-NODE-1")?.connectedAt);
  assert.deepEqual(classifyRegistrationReceipt(receipt,nonce,"VERA-NODE-1"),{
    status:"REGISTRY_SESSION_OBSERVED_UNATTESTED",generation:1,connectedAt:receipt?.connectedAt
  });
});
test("TCP still established but registry detached never receives positive registration", () => {
  const {registry,device,socket}=attached();
  registry.detach(device);
  assert.equal(socket.readyState,1,"socket intentionally still OPEN");
  const result=gatewayRegistrationReceipt(registry,device,probe);
  assert.equal(result?.registered,false);
  assert.equal(classifyRegistrationReceipt(result,nonce,"VERA-NODE-1").status,"HELD");
});
test("new session invalidates old peer without trusting still-open TCP", () => {
  const {registry,device,socket}=attached();
  const newer=new DeviceConnection("VERA-NODE-1",new FakeSocket() as any,8);
  registry.attach(newer);
  assert.equal(socket.readyState,1);
  assert.equal(gatewayRegistrationReceipt(registry,device,probe)?.registered,false);
  const newReceipt=gatewayRegistrationReceipt(registry,newer,probe);
  assert.equal(newReceipt?.registered,true);
  assert.equal(newReceipt?.generation,2);
});
test("wrong identity cannot spoof a mapped device", () => {
  const {registry}=attached();
  const notRegistered=new DeviceConnection("VERA-NODE-1",new FakeSocket() as any,8);
  assert.equal(gatewayRegistrationReceipt(registry,notRegistered,probe)?.registered,false);
});
test("closed socket cannot claim a live registry attachment", () => {
  const {registry,device,socket}=attached();
  (socket as any).readyState=3;
  assert.equal(gatewayRegistrationReceipt(registry,device,probe)?.registered,false);
});
test("malformed nonce and unexpected request fields rejected", () => {
  for (const v of [null, {}, {type:"registration-probe",nonce:"hello"},
    {type:"registration-probe",nonce,token:"SHOULD-NOT-BE-HERE"},
    {type:"request",nonce}]) {
    assert.equal(parseRegistrationProbe(v),undefined);
  }
});
test("client refuses nonce replay, wrong target and forged extra fields", () => {
  const {registry,device}=attached();
  const result=gatewayRegistrationReceipt(registry,device,probe)!;
  assert.equal(classifyRegistrationReceipt(result,"abcdefabcdefabcdefabcdefabcdefab","VERA-NODE-1").status,"HELD");
  assert.equal(classifyRegistrationReceipt(result,nonce,"Lappy").status,"HELD");
  assert.equal(classifyRegistrationReceipt({...result,privilege:"OWNER"},nonce,"VERA-NODE-1").status,"HELD");
});
test("positive-looking invalid receipt never qualifies", () => {
  const base={type:"registration-receipt",nonce,deviceId:"VERA-NODE-1",registered:true};
  for(const bad of [{...base,generation:true,connectedAt:1},
      {...base,generation:0,connectedAt:1},
      {...base,generation:1,connectedAt:-1},
      {...base,generation:1,connectedAt:"now"}]) {
    assert.equal(classifyRegistrationReceipt(bad,nonce,"VERA-NODE-1").status,"HELD");
  }
});

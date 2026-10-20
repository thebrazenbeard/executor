import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const supported = Number(process.versions.node.split(".")[0]) >= 22;
const DIGEST="e".repeat(64);
test("SQLite effect ID+generation unknown survives independent process reopen",{
  skip: supported ? false : "source-only sqlite journal requires Node >=22"
}, async () => {
  const root=mkdtempSync(join(tmpdir(),"vn1-effect-hold-"));
  const db=join(root,"effects.sqlite3");
  const moduleUrl=pathToFileURL(resolve("dist/durable-effect-hold.js")).href;
  const child=`import {DurableEffectHoldJournal} from ${JSON.stringify(moduleUrl)};
const j=new DurableEffectHoldJournal(process.argv[1],process.argv[2]==="first"?{initializeNew:true}:{});
const id="vn1:effect:deterministic",digest="${DIGEST}";
if(process.argv[2]==="first"){
 const x=j.create(id,"VERA-NODE-1",6,1792164975049,digest);
 const dispatch=j.markDispatchIntent(x);
 j.holdAmbiguous(dispatch);
 console.log("FIRST_UNKNOWN="+j.get(id)?.state);
}else if(process.argv[2]==="second"){
 if(j.get(id)?.state!=="OUTCOME_UNKNOWN") throw Error("lost unknown");
 let duplicate=false;
 try{j.create(id,"VERA-NODE-1",7,1792164975999,digest);}
 catch{duplicate=true;}
 if(!duplicate) throw Error("duplicate effect admitted after restart");
 let replay=false;
 try{j.markDispatchIntent(j.get(id));}catch{replay=true;}
 if(!replay) throw Error("unknown effect became dispatchable");
 console.log("SECOND_UNKNOWN_HELD=true");
}else if(process.argv[2]==="stale"){
 const current=j.get(id);
 let held=false;
 try{j.holdAmbiguous({...current,generation:7});}catch{held=true;}
 if(!held) throw Error("stale generation admitted");
 console.log("STALE_CAS_HELD=true");
}else throw Error("bad mode");
j.close();`;
  const run=(stage:string) => {
    const proc=spawnSync(process.execPath,["--input-type=module","-e",child,db,stage],
      {encoding:"utf8",timeout:10000});
    assert.equal(proc.status,0,proc.stderr);
    return proc.stdout;
  };
  try {
    assert.match(run("first"),/FIRST_UNKNOWN=OUTCOME_UNKNOWN/);
    assert.match(run("second"),/SECOND_UNKNOWN_HELD=true/);
    assert.match(run("stale"),/STALE_CAS_HELD=true/);
    const {DurableEffectHoldJournal}=await import("../durable-effect-hold.js");
    const j=new DurableEffectHoldJournal(db);
    try {
      assert.equal(j.get("vn1:effect:deterministic")?.state,"OUTCOME_UNKNOWN");
      assert.throws(()=>j.failBeforeDispatch(j.get("vn1:effect:deterministic")!),
        /effect CAS failed/);
      assert.throws(()=>j.create("vn1:effect:deterministic","VERA-NODE-1",
        6,1792164975049,DIGEST));
    } finally { j.close(); }
  } finally { rmSync(root,{recursive:true,force:true}); }
});
test("invalid task digest/generation is rejected without creating a record",{
  skip: supported ? false : "requires Node >=22"
}, async()=>{
  const root=mkdtempSync(join(tmpdir(),"vn1-effect-invalid-"));
  const {DurableEffectHoldJournal}=await import("../durable-effect-hold.js");
  const journal=new DurableEffectHoldJournal(join(root,"db.sqlite3"),{initializeNew:true});
  try{
    assert.throws(()=>journal.create("x","VERA-NODE-1",true as any,1,DIGEST));
    assert.throws(()=>journal.create("x","VERA-NODE-1",1,1,"not a digest"));
    assert.equal(journal.get("x"),undefined);
  }finally{journal.close();rmSync(root,{recursive:true,force:true});}
});
test("unknown bytes cannot masquerade as a valid journal",{
  skip: supported ? false : "requires Node >=22"
},async()=>{
  const root=mkdtempSync(join(tmpdir(),"vn1-effect-corrupt-"));
  const file=join(root,"corrupt.sqlite3");
  writeFileSync(file,"this is not sqlite");
  const {DurableEffectHoldJournal}=await import("../durable-effect-hold.js");
  try{ assert.throws(()=>new DurableEffectHoldJournal(file)); }
  finally{rmSync(root,{recursive:true,force:true});}
});
test("dispatched state survives process exit but cannot silently resume dispatch",{
  skip: supported ? false : "requires Node >=22"
},async()=>{
  const root=mkdtempSync(join(tmpdir(),"vn1-effect-dispatched-"));
  const db=join(root,"effects.sqlite3");
  const {DurableEffectHoldJournal}=await import("../durable-effect-hold.js");
  let prior=new DurableEffectHoldJournal(db,{initializeNew:true});
  try{
    const created=prior.create("effect:pending","VERA-NODE-1",6,1792164975049,DIGEST);
    prior.markDispatchIntent(created);
  }finally{prior.close();}
  const next=new DurableEffectHoldJournal(db);
  try{
    const found=next.get("effect:pending")!;
    assert.equal(found.state,"DISPATCHED");
    assert.throws(()=>next.markDispatchIntent(found),/CAS failed/);
    const held=next.holdAmbiguous(found);
    assert.equal(held.state,"OUTCOME_UNKNOWN");
    assert.throws(()=>next.create("effect:pending","VERA-NODE-1",7,1792164975999,DIGEST));
    assert.throws(()=>next.failBeforeDispatch(held),/CAS failed/);
  }finally{next.close();rmSync(root,{recursive:true,force:true});}
});

test("missing recovered journal must not be silently recreated under same path",{
  skip: supported ? false : "requires Node >=22"
},async()=>{
  const root=mkdtempSync(join(tmpdir(),"vn1-effect-missing-"));
  const db=join(root,"lost.sqlite3");
  const {DurableEffectHoldJournal}=await import("../durable-effect-hold.js");
  try{
    assert.throws(()=>new DurableEffectHoldJournal(db),/missing|recovery|initialize/i);
    assert.equal(existsSync(db),false,"restart must not initialize an empty ledger");
  }finally{rmSync(root,{recursive:true,force:true});}
});

test("existing journal rejects reinitialization and unrelated SQLite schema",{
  skip: supported ? false : "requires Node >=22"
}, async()=>{
  const root=mkdtempSync(join(tmpdir(),"vn1-effect-schema-"));
  const db=join(root,"existing.sqlite3");
  const wrong=join(root,"foreign.sqlite3");
  const {DurableEffectHoldJournal}=await import("../durable-effect-hold.js");
  const {DatabaseSync}=await import("node:sqlite");
  const journal=new DurableEffectHoldJournal(db,{initializeNew:true});
  try{
    const record=journal.create("effect:hold","VERA-NODE-1",6,1792164975049,DIGEST);
    journal.holdAmbiguous(journal.markDispatchIntent(record));
    assert.throws(()=>new DurableEffectHoldJournal(db,{initializeNew:true}),/EEXIST|exist/i);
  }finally{journal.close();}
  const foreign=new DatabaseSync(wrong);
  foreign.exec("CREATE TABLE unrelated (x INTEGER)");foreign.close();
  try{
    assert.throws(()=>new DurableEffectHoldJournal(wrong),/unrecognized effect journal schema/);
    const recovered=new DurableEffectHoldJournal(db);
    try{assert.equal(recovered.get("effect:hold")?.state,"OUTCOME_UNKNOWN");}
    finally{recovered.close();}
  }finally{rmSync(root,{recursive:true,force:true});}
});

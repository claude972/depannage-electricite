import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, stat, rm, chmod, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
// Node24 can require this synchronous ESM module; the runtime import does not execute a runner.
const {parseArgs,preflight,definiteMissingRow,planningOwnershipRefused,uncertainResponse,exactCount,Registry,emptyManifest,validateManifest,Gate,mutate,cleanup,cleanupPlan,assertRace,finalCode}=createRequire(import.meta.url)('../scripts/qa-advanced/core.mjs');
const REF='abcdefghijklmnopqrst',SHA='a'.repeat(40),U='10000000-0000-4000-8000-000000000001',T='10000000-0000-4000-8000-000000000002';
const base=['--base-url','http://localhost:3017','--sha',SHA,'--app-dir','/unused','--project',REF,'--credentials','/unused/private.json','--out','/unused/evidence'];
const exec=promisify(execFile);
async function temporary(fn:(dir:string)=>Promise<void>){const dir=await mkdtemp(path.join(os.tmpdir(),'qa-advanced-unit-'));try{await fn(dir);}finally{await rm(dir,{recursive:true,force:true});}}

test('strict CLI distinguishes cleanup, API/browser and invalid/duplicate flags',()=>{
  assert.equal(parseArgs(base).suite,'all');assert.equal(parseArgs([...base,'--suite','api']).suite,'api');
  assert.throws(()=>parseArgs([...base,'--project',REF]));assert.throws(()=>parseArgs([...base,'--timeout-ms','0']));assert.throws(()=>parseArgs([...base,'--suite','imaginary']));
  assert.throws(()=>parseArgs(base.filter((x:string)=>x!=='--sha'&&x!==SHA)));
  const cleanupArgs=['--cleanup-manifest','/m.json','--project',REF,'--credentials','/c.json','--out','/out'];assert.ok(parseArgs(cleanupArgs).cleanupManifest);assert.throws(()=>parseArgs([...cleanupArgs,'--dry-run']));
});
test('preflight rejects wrong project, public credentials, remote origins, SHA and Git output; dry preflight has no network',async()=>temporary(async dir=>{
  const app=path.join(dir,'app');await mkdir(app);await exec('git',['init','-q',app]);await exec('git',['-C',app,'-c','user.name=QA','-c','user.email=qa@qa.invalid','commit','--allow-empty','-qm','fixture']);
  const {stdout}=await exec('git',['-C',app,'rev-parse','HEAD']);const file=path.join(dir,'credentials.json');
  const c={supabase:{project_ref:REF,url:`https://${REF}.supabase.co`,publishable_key:'public-placeholder-'.repeat(3),service_role_key:'server-placeholder-'.repeat(3)},allowed_base_urls:[]};await writeFile(file,JSON.stringify(c),{mode:0o600});
  const options=()=>parseArgs(['--base-url','http://localhost:3017','--sha',stdout.trim(),'--app-dir',app,'--project',REF,'--credentials',file,'--out',path.join(dir,'evidence')]);
  assert.equal((await preflight(options())).supabase.project_ref,REF);
  await assert.rejects(()=>preflight({...options(),project:'z'.repeat(20)}));await assert.rejects(()=>preflight({...options(),sha:SHA}));
  await assert.rejects(()=>preflight({...options(),baseUrl:'https://not-allowed.invalid'}));await assert.rejects(()=>preflight({...options(),out:path.join(app,'nested','evidence')}));
  await chmod(file,0o644);await assert.rejects(()=>preflight(options()));
}));
test('atomic manifest and concurrent registry writes preserve exact IDs and private permissions',async()=>temporary(async dir=>{
  const file=path.join(dir,'manifest.json'),r=new Registry(file,emptyManifest(REF,SHA,'012345abcdef'));
  await Promise.all([r.track('users',U),r.track('users',T),r.track('users',U)]);const m=validateManifest(JSON.parse(await readFile(file,'utf8')),REF);
  assert.deepEqual(m.created.users,[U,T]);assert.equal((await stat(file)).mode&0o077,0);
  assert.throws(()=>validateManifest(m,'z'.repeat(20)));assert.throws(()=>validateManifest({...m,created:{...m.created,users:['x)'] }},REF));
  await assert.rejects(()=>r.track('finance_audit',U));await assert.rejects(()=>r.track('users','not-a-uuid'));
}));
test('stop gate drains admitted writes including manifest completion and refuses any later write',async()=>temporary(async dir=>{
  const gate=new Gate(),r=new Registry(path.join(dir,'m.json'),emptyManifest(REF,SHA,'012345abcdef'));let release!:()=>void;
  const ready=new Promise<void>(resolve=>{release=resolve;});let started!:()=>void;const began=new Promise<void>(resolve=>{started=resolve;});
  const pending=mutate(gate,r,'create user',async()=>{started();await ready;await r.track('users',U);return U;});await began;
  gate.stop();assert.throws(()=>gate.run(()=>Promise.resolve()));assert.equal(await gate.drain(5),false);release();assert.equal(await pending,U);assert.equal(await gate.drain(1000),true);
  assert.equal(r.m.intents[0].done,true);assert.deepEqual(r.m.created.users,[U]);
}));
test('uncertain mutation forbids cleanup while a definite refusal is safe to retry',async()=>temporary(async dir=>{
  const gate=new Gate(),r=new Registry(path.join(dir,'m.json'),emptyManifest(REF,SHA,'012345abcdef'));let deletes=0;
  await assert.rejects(()=>mutate(gate,r,'unknown',async()=>{const e:Error&{remoteUnknown?:boolean}=Error('timeout');e.remoteUnknown=true;throw e;}));
  const blocked=await cleanup({delete:async()=>{deletes++;}},r);assert.equal(blocked.ok,false);assert.equal(deletes,0);assert.equal(r.m.uncertain.length,1);
  const r2=new Registry(path.join(dir,'m2.json'),emptyManifest(REF,SHA,'012345abcdef'));
  await assert.rejects(()=>mutate(gate,r2,'denied',async()=>{throw Error('definite refusal');}));assert.equal(r2.m.intents[0].done,true);assert.equal(r2.m.uncertain.length,0);
}));
test('cleanup discovers indirect tickets, orders children before parents, checks every absence and is repeatable',async()=>temporary(async dir=>{
  const r=new Registry(path.join(dir,'m.json'),emptyManifest(REF,SHA,'012345abcdef'));await r.track('users',U);let exists=true;const calls:string[]=[];
  const db={select:async(table:string)=>table==='support_tickets'?[{id:T}]:[],delete:async(t:string)=>{calls.push(t);},count:async()=>0,deleteAuthUser:async()=>{calls.push('Auth');exists=false;},authUserExists:async()=>exists};
  const out=await cleanup(db,r);assert.equal(out.ok,true);assert.deepEqual(r.m.created.tickets,[T]);assert.ok(calls.indexOf('support_events')<calls.indexOf('support_tickets'));assert.ok(calls.indexOf('support_messages')<calls.indexOf('support_tickets'));assert.equal(calls.at(-1),'Auth');
  assert.equal((await cleanup(db,r)).ok,true);assert.ok(!calls.some(s=>s.includes('ledger')||s.includes('finance')));
}));
test('failed discovery or readback preserves recoverable Auth and never converts unknown to zero',async()=>temporary(async dir=>{
  const r=new Registry(path.join(dir,'m.json'),emptyManifest(REF,SHA,'012345abcdef'));await r.track('users',U);let deletions=0,authDeletes=0;
  const db={select:async()=>{throw Error('database unavailable');},delete:async()=>{deletions++;},count:async()=>null,deleteAuthUser:async()=>{authDeletes++;},authUserExists:async()=>false};
  assert.equal((await cleanup(db,r)).ok,false);assert.equal(deletions,0);
  db.select=async()=>[] as never;const failed=await cleanup(db,r);assert.equal(failed.ok,false);assert.equal(authDeletes,0);assert.ok(failed.entries.every((s:{ok:boolean})=>s.ok===false));
}));
test('every cleanup filter is bound to manifest UUIDs; no broad deletion or immutable finance rows',()=>{
  const m=emptyManifest(REF,SHA,'012345abcdef');for(const k of Object.keys(m.created))m.created[k]=[U];
  for(const step of cleanupPlan(m)){assert.ok(Object.keys(step.filter).length===1);assert.ok(Object.values(step.filter).every(v=>v===`in.(${U})`));assert.ok(!/finance|ledger|payment/.test(step.table));}
});
test('race classifier requires exactly one real commit and one explicit conflict, never counts two successes or network errors',()=>{
  assert.equal(assertRace([{status:200},{status:400,body:{code:'P0001'}}]),0);assert.equal(assertRace([{status:409},{status:200}]),1);
  assert.throws(()=>assertRace([{status:200},{status:200}]));assert.throws(()=>assertRace([{status:200},{status:503}]));assert.throws(()=>assertRace([{status:200}]));
  assert.equal(assertRace([{status:200,timing:{start:1,end:5}},{status:409,timing:{start:2,end:6}}],{requireOverlap:true}),0);
  assert.throws(()=>assertRace([{status:200,timing:{start:1,end:2}},{status:409,timing:{start:3,end:4}}],{requireOverlap:true}));
  assert.throws(()=>assertRace([{status:200},{status:409}],{requireOverlap:true}));
});
test('provider exact counts accept empty/partial ranges and fail closed on errors, wildcard, absent or unsafe counts',()=>{
  assert.equal(exactCount(200,'*/0'),0);assert.equal(exactCount(206,'0-49/117'),117);
  for(const header of [null,'','0-0/*','*/999999999999999999999'])assert.throws(()=>exactCount(200,header));assert.throws(()=>exactCount(403,'*/0'));
});
test('mutation 5xx responses remain transport-uncertain, not a definite rollback for cleanup',()=>{
  for(const status of [500,502,503,504])assert.equal(uncertainResponse('POST',status),true);
  for(const status of [200,201,204,400,403,409,422,429])assert.equal(uncertainResponse('POST',status),false);
  assert.equal(uncertainResponse('GET',503),false);
});
test('structured SQL P0002 at HTTP500 is a definite rollback and a valid foreign-row refusal, preserving the actual status',()=>{
  const body={code:'P0002',details:null,hint:null,message:'no_data_found'};
  const response={status:500,body};assert.equal(definiteMissingRow(body),true);assert.equal(uncertainResponse('POST',500,body),false);assert.equal(planningOwnershipRefused(response),true);assert.equal(response.status,500);
  assert.equal(planningOwnershipRefused({status:403,body:null}),true);assert.equal(planningOwnershipRefused({status:404,body:null}),true);
  for(const malformed of [null,'P0002',[],[body],{}, {code:'P0002'}, {code:'P0002',message:''}, {code:'P0002',message:123}, {code:'XX000',message:'P0002'}, {message:'P0002'}]) {
    assert.equal(definiteMissingRow(malformed),false);assert.equal(uncertainResponse('POST',500,malformed),true);assert.equal(planningOwnershipRefused({status:500,body:malformed}),false);
  }
  for(const status of [501,502,503,504])assert.equal(uncertainResponse('POST',status,body),true);
});
test('the actual CLI dry-run exits before cloud/browser work and never prints fixture keys',async()=>temporary(async dir=>{
  const app=path.join(dir,'app');await mkdir(app);await exec('git',['init','-q',app]);await exec('git',['-C',app,'-c','user.name=QA','-c','user.email=qa@qa.invalid','commit','--allow-empty','-qm','fixture']);
  const {stdout:head}=await exec('git',['-C',app,'rev-parse','HEAD']);const file=path.join(dir,'credentials.json');const secret='FAKE_PRIVATE_KEY_NO_NETWORK_123456789';
  await writeFile(file,JSON.stringify({supabase:{project_ref:REF,url:`https://${REF}.supabase.co`,publishable_key:'FAKE_PUBLIC_KEY_NO_NETWORK_123456789',service_role_key:secret}}),{mode:0o600});
  const entry=new URL('../scripts/qa-advanced/run.mjs',import.meta.url).pathname;
  const {stdout}=await exec(process.execPath,[entry,'--base-url','http://localhost:3017','--sha',head.trim(),'--app-dir',app,'--project',REF,'--credentials',file,'--out',path.join(dir,'evidence'),'--suite','api','--dry-run']);
  const plan=JSON.parse(stdout);assert.equal(plan.network,false);assert.equal(plan.sha_verified,true);assert.ok(!stdout.includes(secret));
}));
test('cleanup incomplete dominates exit code; interrupted or missing/failed criteria cannot be reported green',()=>{
  assert.equal(finalCode({steps:[{status:'PASS'}],cleanup:{ok:true},interrupted:false}),0);
  assert.equal(finalCode({steps:[{status:'PASS'}],cleanup:{ok:true},interrupted:true}),1);
  assert.equal(finalCode({steps:[{status:'FAIL'}],cleanup:{ok:true}}),1);
  assert.equal(finalCode({steps:[{status:'PASS'}],cleanup:{ok:false}}),3);
  assert.equal(finalCode({steps:[],cleanup:{ok:true}}),1);
  assert.equal(finalCode({mode:'cleanup',steps:[],cleanup:{ok:true}}),0);
});

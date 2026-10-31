import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore Pure source/adoption guards and the exact injected cleanup coordinator.
import {POST,PLAN,validatePostSource,metadataMatches,createPostCleanup} from '../scripts/qa-pwa-desktop/postclose-lib.mjs';
test('post-close source cannot adopt another run, an unconfirmed uninstall or arbitrary hash',()=>{
  const s={runId:POST.runId,harnessSha:POST.sha,status:'INCOMPLETE',cleanup:{registryAbsent:true,diskRegistryAbsent:true,browserExited:true,pending:0},recovery:{adoption:{inode:POST.profileInode},folder:{inode:POST.folderInode,localizedInode:POST.localizedInode}}};
  // The immutable source hash is pinned, so a newly synthesized source cannot authorize deletion.
  assert.throws(()=>validatePostSource(s,Buffer.from(JSON.stringify(s)),POST.manifestHash),/unapproved/);
  assert.throws(()=>validatePostSource(s,Buffer.from('anything'),'0'.repeat(64)),/unapproved/);
});
test('post-close metadata adoption requires pinned regenerated inode/content/xattrs/UID/mode/date',()=>{
  const expected=POST.files[0],actual={...expected,uid:501,mode:0o600,birthtimeMs:1500};
  assert.equal(metadataMatches(actual,expected,1000,2000,501),true);
  for(const patch of [{inode:1},{digest:'foreign'},{attributes:'different'},{uid:502},{mode:0o644},{birthtimeMs:999},{birthtimeMs:2001},{birthtimeMs:NaN}])assert.equal(metadataMatches({...actual,...patch},expected,1000,2000,501),false);
});
test('cleanup journals every intent then validates before its effect, deletes only the explicit plan, and verifies final absence',async()=>{
  const events:string[]=[];
  const c=createPostCleanup({journal:async(e:any)=>{events.push(e.intent?`intent:${e.intent}`:`done:${e.done}`);},inspect:async(done:string[])=>{events.push(`inspect:${done.length}`);},effect:async(step:string)=>{events.push(`effect:${step}`);}});
  assert.equal(await c.execute(),'RECOVERED_CLEAN');assert.deepEqual(c.completed,PLAN);
  for(let i=0;i<PLAN.length;i++)assert.deepEqual(events.slice(i*4,i*4+4),[`intent:${PLAN[i]}`,`inspect:${i}`,`effect:${PLAN[i]}`,`done:${PLAN[i]}`]);
  assert.equal(events.at(-1),'inspect:5');assert.equal(PLAN.some((s:string)=>/lock|install|browser/.test(s)),false);
});
test('foreign state detected after durable intent prevents any filesystem deletion',async()=>{
  const effects:string[]=[];
  const c=createPostCleanup({journal:async()=>{},inspect:async()=>{throw new Error('foreign inode or content');},effect:async(s:string)=>{effects.push(s);}});
  await assert.rejects(c.execute(),/foreign/);assert.deepEqual(effects,[]);assert.deepEqual(c.completed,[]);
});
test('interrupt while pre-effect validation is awaiting prevents that effect and all following effects',async()=>{
  let release!:()=>void;const barrier=new Promise<void>(r=>{release=r;});const effects:string[]=[];
  const c=createPostCleanup({journal:async()=>{},inspect:async()=>{await barrier;},effect:async(s:string)=>{effects.push(s);}});
  const p=c.execute();await new Promise(r=>setImmediate(r));c.gate.stop();release();await assert.rejects(p,/stopping/);assert.deepEqual(effects,[]);
});
test('uncertain in-flight deletion remains tracked; no following operation is issued after timeout',async()=>{
  let release!:()=>void;const barrier=new Promise<void>(r=>{release=r;});const effects:string[]=[];
  const c=createPostCleanup({timeoutMs:1,journal:async()=>{},inspect:async()=>{},effect:async(s:string)=>{effects.push(s);await barrier;}});
  await assert.rejects(c.execute(),/not cancelled/);c.gate.stop();assert.equal(await c.gate.drain(1),1);assert.deepEqual(effects,['unlink-icon']);assert.deepEqual(c.completed,[]);
  release();assert.equal(await c.gate.drain(100),0);assert.deepEqual(effects,['unlink-icon']);
});

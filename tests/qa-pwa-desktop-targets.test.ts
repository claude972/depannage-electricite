import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore Runtime pure target and generated-metadata ownership guards.
import {targetDiagnostic,selectLaunchedPage} from '../scripts/qa-pwa-desktop/targets.mjs';
// @ts-ignore No filesystem calls from these tests.
import {validRunFolder,adoptNormalPostClose,observeOriginalMutation} from '../scripts/qa-pwa-desktop/normal-cleanup.mjs';
// @ts-ignore Same gate used by runner.
import {createGate} from '../scripts/qa-pwa-desktop/lib.mjs';
const launch={targetId:'tab-new',type:'tab',windowId:12,browserContextId:'owned'};
const page={targetId:'page-new',type:'page',windowId:12,browserContextId:'owned',subtype:null,url:'http://127.0.0.1:3017/'};
test('Chrome tab and Playwright page have distinct IDs and bind through one exact owned window/context',()=>{
  assert.equal(selectLaunchedPage(launch,[page]),page);
  assert.equal(selectLaunchedPage({...page,targetId:'page-new'},[page]),page);
});
test('matching URL in another window, prerender or old page ID never supplies identity',()=>{
  assert.equal(selectLaunchedPage(launch,[{...page,windowId:13}]),null);
  assert.equal(selectLaunchedPage(launch,[{...page,subtype:'prerender'}]),null);
  assert.equal(selectLaunchedPage({...page,targetId:'new-exact-id'},[page]),null);
  assert.equal(selectLaunchedPage(launch,[]),null);
});
test('ambiguous pages, context contradictions and unsupported target types fail closed',()=>{
  assert.throws(()=>selectLaunchedPage(launch,[page,{...page,targetId:'second'}]),/ambiguous/);
  assert.throws(()=>selectLaunchedPage(launch,[{...page,browserContextId:'foreign'}]),/context/);
  assert.throws(()=>selectLaunchedPage({...launch,type:'worker'},[page]),/unsupported/);
  assert.throws(()=>selectLaunchedPage({...launch,windowId:null},[page]),/unsupported/);
});
test('diagnostics preserve IDs/types/opener/window but omit credentials, query and fragment',()=>{
  const d=targetDiagnostic({targetId:'page',type:'page',openerId:'opener',url:'http://user:password@127.0.0.1:3017/?token=secret#private'},{windowId:12});
  assert.equal(d.url,'http://127.0.0.1:3017/');assert.equal(d.openerId,'opener');assert.equal(d.parentId,null);assert.equal(d.windowId,12);
  assert.equal(targetDiagnostic({type:'page',url:'file:///Users/person/private'},null).url,null);
});
function generated(){return {path:'/Users/unit/Applications/Chromium Apps.localized',inode:100,localizedInode:101,uid:501,localizedUid:501,birthtimeMs:1100,localizedBirthtimeMs:1101,files:[{relative:'Icon\r',inode:102,uid:501,mode:0o600,birthtimeMs:1102,digest:'icon',attributes:'a'.repeat(64)},{relative:'.localized/fr.strings',inode:103,uid:501,mode:0o600,birthtimeMs:1103,digest:'lang',attributes:'b'.repeat(64)}]};}
const ownership={baseline:[],start:1000,closedAt:2000,uid:501,observed:{inode:100,localizedInode:101}};
test('a newly observed run-owned folder is accepted, not a foreign owner or earlier birth',()=>{
  assert.equal(validRunFolder({ino:100,uid:501,birthtimeMs:1001},1000,501),true);
  assert.equal(validRunFolder({ino:100,uid:502,birthtimeMs:1001},1000,501),false);
  assert.equal(validRunFolder({ino:100,uid:501,birthtimeMs:999},1000,501),false);
});
test('normal post-close may adopt regenerated metadata inodes/xattrs only with original contents and date in run',()=>{
  const initial=generated(),post=generated();post.files[0].inode=104;post.files[0].attributes='c'.repeat(64);post.files[0].birthtimeMs=1900;
  assert.equal(adoptNormalPostClose(initial,post,ownership),post);
});
test('normal cleanup never adopts a preexisting or replaced directory',()=>{
  const initial=generated();
  assert.throws(()=>adoptNormalPostClose(initial,generated(),{...ownership,baseline:[{path:initial.path}]}),/ownership/);
  assert.throws(()=>adoptNormalPostClose(initial,{...generated(),inode:200},ownership),/ownership/);
  assert.throws(()=>adoptNormalPostClose(initial,{...generated(),localizedInode:200},ownership),/ownership/);
  assert.throws(()=>adoptNormalPostClose(initial,{...generated(),uid:502},ownership),/ownership/);
});
test('changed contents, wrong UID/mode, unknown metadata or creation outside run prevent normal cleanup',()=>{
  for(const patch of [{digest:'foreign'},{uid:502},{mode:0o644},{birthtimeMs:999},{birthtimeMs:2001},{relative:'foreign-file'},{attributes:'invalid'}]){
    const initial=generated(),post=generated();Object.assign(post.files[0],patch);assert.throws(()=>adoptNormalPostClose(initial,post,ownership),/metadata/);
  }
});
function deferred(){let resolve!:()=>void;return {promise:new Promise<void>(r=>{resolve=r;}),resolve:()=>resolve()};}
test('folder observer failure preserves the original install until it settles, so drain cannot claim cancellation',async()=>{
  const install=deferred(),gate=createGate();
  const p=gate.effect(async()=>{},()=>observeOriginalMutation(install.promise,async()=>{throw new Error('observer failed');},{gate,pause:async()=>{}}));
  await new Promise(r=>setImmediate(r));gate.stop();assert.equal(await gate.drain(1),1);install.resolve();await assert.rejects(p,/observer failed/);assert.equal(await gate.drain(10),0);
});
test('stop during observation never drops original install or schedules another observation afterward',async()=>{
  const install=deferred(),gate=createGate();let observations=0;
  const p=gate.effect(async()=>{},()=>observeOriginalMutation(install.promise,async()=>{observations++;gate.stop();},{gate,pause:async()=>{}}));
  await new Promise(r=>setImmediate(r));assert.equal(await gate.drain(1),1);install.resolve();await assert.rejects(p,/stopping/);assert.equal(observations,1);
});

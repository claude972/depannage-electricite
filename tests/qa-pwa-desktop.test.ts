import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
// @ts-ignore JS pure module; no browser, filesystem, process, port, or network effects.
import {parseArgs,identity,chromeAppId,verifyBuild,collision,attributable,fullProfile,baselineUnchanged,absentRegistry,canUninstall,proofMatches,resultStatus,createGate,onceAsync,hash,bounded,sameProcess,profileRemovalAllowed} from '../scripts/qa-pwa-desktop/lib.mjs';

const origin='http://127.0.0.1:3017';
const manifest={id:'/',start_url:'/',scope:'/',display:'standalone'};
const id={...identity(manifest,`${origin}/manifest.webmanifest`,origin),appId:'abcdefghijklmnopabcdefghijklmnop'};
const profile='/private/tmp/depannage-pwa-os-unit';
const bundle=()=>({path:'/Users/unit/Applications/Chrome Apps.localized/Courant.app',inode:5,digest:'known',executable:'/Users/unit/Applications/Chrome Apps.localized/Courant.app/Contents/MacOS/app_mode_loader',plist:{CFBundleIdentifier:`com.google.chrome.for.testing.app.${id.appId}`,CrAppModeShortcutID:id.appId,CrAppModeShortcutURL:`${origin}/`,CrAppModeUserDataDir:profile,CrAppModeProfileDir:'Default'}});
const args=['--app-dir','/tmp/app','--app-sha','a'.repeat(40),'--build-id','build-123456','--origin',origin,'--chromium-path','/tmp/CfT','--playwright-path','/tmp/playwright','--out','/tmp/new-output'];
test('preflight is default; mandatory checkout, SHA and build checks cannot be omitted',()=>{
  assert.equal(parseArgs(args).execute,false);
  assert.equal(parseArgs([...args,'--execute']).execute,true);
  assert.throws(()=>parseArgs(args.slice(2)),/appDir required/);
  assert.throws(()=>parseArgs([...args,'--app-dir','/other']),/duplicate/);
  assert.throws(()=>parseArgs([...args,'--os-proof=true']),/unknown/);
});
test('remote origins, credentials and control flags are refused',()=>{
  for(const url of ['https://example.org','http://user@127.0.0.1:3017','http://127.0.0.1:3017/?token=x','http://127.0.0.1:3017/#demo','http://localhost:3017']){
    const a=[...args];a[a.indexOf('--origin')+1]=url;assert.throws(()=>parseArgs(a));
  }
  for(const flag of ['--headless','--test-type','--app=anything','--ignore-certificate-errors'])assert.throws(()=>parseArgs([...args,flag]));
});
test('checkout and served build mismatches are rejected before any browser dependency',()=>{
  const facts={expectedSha:'a'.repeat(40),expectedBuildId:'build-123456',head:'a'.repeat(40),diskBuildId:'build-123456',html:'<title>Dépannage électrique</title>build-123456'};
  assert.equal(verifyBuild(facts),true);
  for(const delta of [{head:'b'.repeat(40)},{diskBuildId:'other-build'},{html:'<title>Dépannage électrique</title>old-build'},{html:'build-123456 unrelated app'}])assert.throws(()=>verifyBuild({...facts,...delta}));
});
test('manifest identity resolves relative values and refuses another app or origin',()=>{
  assert.equal(id.manifestId,`${origin}/`);
  for(const m of [{...manifest,id:'https://evil.test/'},{...manifest,scope:'/private/'},{...manifest,display:'browser'},{...manifest,id:''}])assert.throws(()=>identity(m,`${origin}/manifest.webmanifest`,origin));
});
test('Chromium app id hashes binary SHA256 twice, then first 128 bits use alphabet a-p',()=>{
  const first=createHash('sha256').update(`${origin}/`).digest();
  const bytes=createHash('sha256').update(first).digest().subarray(0,16);
  const expected=Array.from(bytes).map(n=>String.fromCharCode(97+(n>>4))+String.fromCharCode(97+(n&15))).join('');
  assert.equal(chromeAppId(`${origin}/`),expected);
  assert.notEqual(chromeAppId(`${origin}/`),chromeAppId('http://127.0.0.1:3018/'));
});
test('same AppID in foreign profile or same origin different id blocks before installation',()=>{
  const b=bundle();b.plist.CrAppModeUserDataDir='/Users/person/Chrome';assert.equal(collision(b,id),true);
  b.plist.CrAppModeShortcutID='another';assert.equal(collision(b,id),true);
  b.plist.CrAppModeShortcutURL='https://unrelated.test/';assert.equal(collision(b,id),false);
});
test('strict bundle attribution accepts known layout and profile-scoped bundle id',()=>{
  assert.equal(attributable(bundle(),id,profile,[]),true);
  const b=bundle();b.plist.CFBundleIdentifier=`com.google.chrome.for.testing.app.Default-${id.appId}`;assert.equal(attributable(b,id,profile,[]),true);
  b.plist.CrAppModeUserDataDir=`${profile}/Default/Web Applications/_crx_${id.appId}`;assert.equal(fullProfile(b.plist),`${profile}/Default`);assert.equal(attributable(b,id,profile,[]),true);
});
test('bundle title/date, prefix lookalike, missing executable, symlink and preexisting path cannot confer ownership',()=>{
  for(const mutate of [(b:any)=>{b.symlink=true;},(b:any)=>{b.inode=0;},(b:any)=>{b.executable='';},(b:any)=>{b.plist.CrAppModeUserDataDir=`${profile}-foreign`;},(b:any)=>{b.plist.CrAppModeShortcutID='different';},(b:any)=>{b.plist.CrAppModeShortcutURL='https://evil.test/';},(b:any)=>{b.plist.CrAppModeProfileDir='../Default';}]){
    const b=bundle();mutate(b);assert.equal(attributable(b,id,profile,[]),false);
  }
  assert.equal(attributable(bundle(),id,profile,[bundle()]),false);
});
test('preexisting plist and inode changes prevent clean baseline verdict',()=>{
  assert.equal(baselineUnchanged([bundle()],[bundle()]),true);
  assert.equal(baselineUnchanged([bundle()],[{...bundle(),inode:6}]),false);
  assert.equal(baselineUnchanged([bundle()],[{...bundle(),digest:'changed'}]),false);
  assert.equal(baselineUnchanged([bundle()],[]),false);
});
test('only documented unknown-manifest response means absent registry',()=>{
  assert.equal(absentRegistry(new Error(`Protocol error (PWA.getOsAppState): Unknown web-app manifest id ${origin}/`)),true);
  for(const message of ['Target closed','Method not found','Timeout','not installed','Connection disconnected',`Timeout: Unknown web-app manifest id ${origin}/`])assert.equal(absentRegistry(new Error(message)),false);
});
test('unknown install does not waive identity guards before uninstall',()=>{
  const s={runId:'run',identity:id,profileRoot:profile,baseline:[],installIntent:{runId:'run',manifestId:id.manifestId,appId:id.appId},installOutcome:'unknown'};
  const current={ownedProcess:true,profileRoot:profile,registryPresent:true,bundle:bundle()};
  assert.equal(canUninstall(s,current),true);
  for(const patch of [{ownedProcess:false},{profileRoot:'/other'},{registryPresent:false},{bundle:null}])assert.equal(canUninstall(s,{...current,...patch}),false);
  assert.equal(canUninstall({...s,installIntent:{...s.installIntent,appId:'foreign'}},current),false);
  assert.equal(canUninstall({...s,baseline:[bundle()]},current),false);
});
test('OS evidence needs fresh externally supplied binding and matching PNG hash',()=>{
  const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.alloc(100)]);
  const expected={runId:'run',appId:id.appId,windowId:12,browserPid:123,nonce:'secret-proof-nonce',startedAt:Date.now()-1000};
  const proof={...expected,kind:'macos-visible-window',observedAt:new Date().toISOString(),sha256:hash(png)};
  assert.equal(proofMatches(proof,expected,png),true);
  for(const change of [{runId:'foreign'},{windowId:13},{browserPid:124},{nonce:'wrong'},{sha256:'wrong'},{observedAt:'invalid'},{observedAt:new Date(expected.startedAt-1).toISOString()}])assert.equal(proofMatches({...proof,...change},expected,png),false);
  assert.equal(proofMatches(true,expected,png),false);assert.equal(proofMatches(proof,expected,Buffer.alloc(108)),false);
});
test('no PASS without OS evidence, relaunch and cleanup; unknown effects remain INCOMPLETE',()=>{
  const s={proofs:{installed:true,shim:true,window:true,osProof:true,relaunched:true},cleanup:{ok:true}};
  assert.equal(resultStatus(s),'PASS');
  for(const k of Object.keys(s.proofs))assert.equal(resultStatus({...s,proofs:{...s.proofs,[k]:false}}),'BLOCKED');
  assert.equal(resultStatus({...s,cleanup:{ok:false}}),'INCOMPLETE');
  assert.equal(resultStatus({...s,error:{kind:'Blocked'}}),'BLOCKED');
  assert.equal(resultStatus({...s,error:{kind:'Error'}}),'FAIL');
});
function deferred(){let resolve!: (value?:any)=>void;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};}
test('durable intent is completed before mutation and stopping during intent prevents spawn',async()=>{
  const gate=createGate(),intent=deferred();let called=0;
  const p=gate.effect(()=>intent.promise,()=>{called++;});
  gate.stop();intent.resolve();await assert.rejects(p,/stopping/);assert.equal(called,0);
});
test('late install remains tracked across drain timeout; no new launch starts after stop',async()=>{
  const gate=createGate(),late=deferred();const events:string[]=[];
  const p=gate.effect(async()=>{events.push('intent');},async()=>{events.push('install-start');await late.promise;events.push('install-done');});
  await new Promise(r=>setImmediate(r));gate.stop();
  assert.equal(await gate.drain(1),1);assert.deepEqual(events,['intent','install-start']);
  await assert.rejects(gate.effect(async()=>{},()=>{events.push('new-launch');}),/stopping/);
  late.resolve();await p;assert.equal(await gate.drain(5),0);assert.deepEqual(events,['intent','install-start','install-done']);
});
test('finally and multiple signals share one finalization while pending operation drains',async()=>{
  const gate=createGate(),late=deferred();let cleaned=0;
  const effect=gate.effect(async()=>{},()=>late.promise);await new Promise(r=>setImmediate(r));
  const finalize=onceAsync(async()=>{gate.stop();assert.equal(await gate.drain(100),0);cleaned++;return 'clean';});
  const a=finalize(),b=finalize();assert.equal(a,b);late.resolve();await effect;assert.equal(await a,'clean');assert.equal(cleaned,1);
});
test('caller timeout never cancels an OS effect or removes it from the drain registry',async()=>{
  const gate=createGate(),late=deferred();let installed=false;
  const p=gate.effect(async()=>{},async()=>{await late.promise;installed=true;});
  await assert.rejects(bounded(p,1,'install'),/not cancelled/);gate.stop();
  assert.equal(await gate.drain(1),1);assert.equal(installed,false);
  late.resolve();await p;assert.equal(installed,true);assert.equal(await gate.drain(1),0);
});
test('PID reused or detached unknown cannot be stopped as owned',()=>{
  const p={pid:123,started:'time A',command:'CfT --user-data-dir=/unique'};
  assert.equal(sameProcess(p,{...p}),true);
  assert.equal(sameProcess(p,{...p,started:'time B'}),false);
  assert.equal(sameProcess(p,{...p,command:'personal Chrome'}),false);
  assert.equal(sameProcess(p,null),false);
});
test('failed uninstall, live process, pending mutation or foreign baseline modification preserves profile',()=>{
  const ok={registryAbsent:true,browserExited:true,shimsAbsent:true,baselineUnchanged:true,shimPids:[],pending:0,errors:[]};
  assert.equal(profileRemovalAllowed(ok),true);
  for(const delta of [{registryAbsent:false},{browserExited:false},{shimsAbsent:false},{baselineUnchanged:false},{shimPids:[{pid:55}]},{pending:1},{errors:['uninstall unknown']}])assert.equal(profileRemovalAllowed({...ok,...delta}),false);
});

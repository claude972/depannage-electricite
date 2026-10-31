import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore Pure exported guards; no filesystem/process/browser calls in these tests.
import {SOURCE,validateRecovery,recoveryEffectAllowed,validateAdoption,folderPlanAllowed} from '../scripts/qa-pwa-desktop/recovery.mjs';
// @ts-ignore Production attribution guards used by runner.
import {hash,attributable,uniqueDefault,canUninstall,parseArgs} from '../scripts/qa-pwa-desktop/lib.mjs';

const root=`/private/tmp/${SOURCE.basename}`;
const id={appId:SOURCE.appId,manifestId:'http://127.0.0.1:3017/',startUrl:'http://127.0.0.1:3017/',browserBundleId:'com.google.chrome.for.testing'};
const registry=()=>({profile:{info_cache:{Default:{}}},app_shims:{[id.appId]:{installed_profiles:['Default'],last_active_profiles:['Default']}}});
const bundle=()=>({path:'/Users/unit/Applications/Chromium Apps.localized/Courant.app',inode:9,executable:'/Users/unit/Applications/Chromium Apps.localized/Courant.app/Contents/MacOS/app_mode_loader',plist:{CrAppModeShortcutID:id.appId,CrAppModeShortcutURL:id.startUrl,CrBundleIdentifier:id.browserBundleId,CFBundleIdentifier:`${id.browserBundleId}.app.${id.appId}`,CrAppModeUserDataDir:`${root}/-/Web Applications/_crx_${id.appId}`}});
const source=()=>({runId:SOURCE.runId,harnessSha:SOURCE.sha,status:'INCOMPLETE',startedAt:1000,profileRoot:root,identity:id,installIntent:{at:3000,runId:SOURCE.runId,appId:id.appId,manifestId:id.manifestId},proofs:{installed:true},cleanup:{ok:false},baseline:[]});
test('multi-profile placeholder is attributable only with the exact sole Default registry',()=>{
  assert.equal(attributable(bundle(),id,root,[],registry()),true);
  assert.equal(attributable(bundle(),id,root,[]),false);
  assert.equal(attributable(bundle(),id,root,[bundle()],registry()),false);
  for(const alter of [(r:any)=>{r.app_shims={};},(r:any)=>{r.profile.info_cache.Guest={};},(r:any)=>{r.app_shims[id.appId].installed_profiles=['Default','Profile 2'];},(r:any)=>{r.app_shims[id.appId].last_active_profiles=['Profile 2'];},(r:any)=>{r.app_shims.other={installed_profiles:['Default']};}]){
    const r=registry();alter(r);assert.equal(uniqueDefault(r,id.appId),false);assert.equal(attributable(bundle(),id,root,[],r),false);
  }
});
test('placeholder attribution never normalizes traversal or accepts a root prefix, foreign bundle or conflicting ProfileDir',()=>{
  for(const alter of [(p:any)=>{p.CrAppModeUserDataDir=`${root}-foreign/-/Web Applications/_crx_${id.appId}`;},(p:any)=>{p.CrAppModeUserDataDir=`${root}/Default/../-/Web Applications/_crx_${id.appId}`;},(p:any)=>{p.CrAppModeUserDataDir=`${root}/-/Web Applications/_crx_other`;},(p:any)=>{p.CrAppModeProfileDir='Default';},(p:any)=>{p.CrBundleIdentifier='foreign';},(p:any)=>{p.CFBundleIdentifier=`foreign.app.${id.appId}`;},(p:any)=>{p.CrAppModeShortcutURL='https://other.test/';}]){
    const b=bundle();alter(b.plist);assert.equal(attributable(b,id,root,[],registry()),false);
  }
});
test('recovery source requires exact approved historical run, SHA256 and durable installation intent',()=>{
  const s=source(),bytes=Buffer.from(JSON.stringify(s));assert.equal(validateRecovery(s,bytes,hash(bytes)),s);
  assert.throws(()=>validateRecovery(s,bytes,'0'.repeat(64)),/not approved/);
  for(const patch of [{runId:'other'},{harnessSha:'a'.repeat(40)},{status:'PASS'},{profileRoot:'/Users/person/Chrome'},{proofs:{installed:false}},{cleanup:{ok:true}},{installIntent:null},{baseline:[bundle()]},{baseline:null}]){
    const bad={...source(),...patch},wire=Buffer.from(JSON.stringify(bad));assert.throws(()=>validateRecovery(bad,wire,hash(wire)),/not approved|invalid recovery/);
  }
});
test('recovery does not authorize fresh profile creation or another installation',()=>{
  for(const effect of ['create-profile','install'])assert.equal(recoveryEffectAllowed(effect,true),false);
  for(const effect of ['adopt-existing-profile','spawn','standalone','launch','uninstall','delete-owned-profile','rmdir-generated-shared-folder'])assert.equal(recoveryEffectAllowed(effect,true),true);
  assert.equal(recoveryEffectAllowed('install',false),true);
});
test('adoption has current inode and owner evidence without inventing historical inode',()=>{
  const st={mode:0o40700,uid:501,ino:123,birthtimeMs:1003};
  assert.deepEqual(validateAdoption(st,source(),'/private/tmp',501),{inode:123,birthtimeMs:1003,mode:0o40700,uid:501});
  for(const patch of [{mode:0o40755},{uid:502},{birthtimeMs:-1},{birthtimeMs:3001}])assert.throws(()=>validateAdoption({...st,...patch},source(),'/private/tmp',501));
  assert.throws(()=>validateAdoption(st,source(),'/different',501));
});
test('recovery uninstall is tied to verified source hash, exact placeholder and registry',()=>{
  const s={...source(),runId:'recovery-new',recovery:{sourceRunId:SOURCE.runId,sourceHashVerified:true}};
  const current={ownedProcess:true,profileRoot:root,registryPresent:true,bundle:bundle(),localState:registry()};
  assert.equal(canUninstall(s,current),true);
  assert.equal(canUninstall({...s,recovery:{...s.recovery,sourceHashVerified:false}},current),false);
  assert.equal(canUninstall(s,{...current,localState:null}),false);
  assert.equal(canUninstall(s,{...current,ownedProcess:false}),false);
});
test('generated shared folder cleanup plan rejects any remaining bundle, foreign entry or changed inode',()=>{
  const adopted={inode:123};assert.equal(folderPlanAllowed(adopted,['.localized','Icon\r'],123),true);
  for(const names of [['.localized','Foreign.app'],['.localized','user-file.txt'],['Courant.app']])assert.equal(folderPlanAllowed(adopted,names,123),false);
  assert.equal(folderPlanAllowed(adopted,['.localized','Icon\r'],124),false);
});
test('CLI requires source hash and limits continue-proof to recovery',()=>{
  const base=['--app-dir','/tmp/app','--app-sha','a'.repeat(40),'--build-id','build-12345','--origin','http://127.0.0.1:3017','--chromium-path','/tmp/cft','--playwright-path','/tmp/pw','--out','/tmp/out'];
  assert.throws(()=>parseArgs([...base,'--continue-proof']));assert.throws(()=>parseArgs([...base,'--recover-manifest','/tmp/source']));
  const o=parseArgs([...base,'--recover-manifest','/tmp/source','--recover-sha256','a'.repeat(64),'--continue-proof']);assert.equal(o.continueProof,true);assert.equal(o.execute,false);
});

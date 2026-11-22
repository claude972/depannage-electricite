#!/usr/bin/env node
// Real OS effects are opt-in, root-executed only after exact-SHA review. No server ownership.
import { mkdir, mkdtemp, readFile, writeFile, rename, lstat, realpath, readdir, rm, chmod } from 'node:fs/promises';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID, randomBytes } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { HELP, Blocked, hash, bounded, parseArgs, verifyBuild, identity, chromeAppId, collision, attributable, baselineUnchanged, absentRegistry, canUninstall, proofMatches, resultStatus, createGate, onceAsync, sameProcess, profileRemovalAllowed } from './lib.mjs';
import {createPipeClient,unavailablePwa,bindPwaChannel} from './pipe.mjs';
import {validateRecovery,recoveryEffectAllowed,readRegistry,validateAdoption,adoptFolder,removeAdoptedFolder,inspectSingletonLock,assertSameLock} from './recovery.mjs';
import {targetDiagnostic,selectLaunchedPage} from './targets.mjs';
import {validRunFolder,readGeneratedMetadata,adoptNormalPostClose,observeOriginalMutation} from './normal-cleanup.mjs';

const exec = promisify(execFile);
const pause = ms => new Promise(r => setTimeout(r,ms));
const present = async p => lstat(p).then(() => true, e => { if (e.code === 'ENOENT') return false; throw e; });
async function plain(p, directory = false) {
  const s = await lstat(p);
  if (s.isSymbolicLink() || (directory ? !s.isDirectory() : !s.isFile()) || await realpath(p) !== path.resolve(p)) throw new Blocked(`non-plain path: ${p}`);
  return s;
}
async function plist(file) {
  await plain(file);
  const { stdout } = await exec('/usr/bin/plutil',['-convert','json','-o','-',file],{timeout:5000,maxBuffer:1024*1024});
  return JSON.parse(stdout);
}
async function publicGet(url) {
  const r = await fetch(url,{redirect:'manual',signal:AbortSignal.timeout(8000),headers:{Accept:'text/html,application/json'}});
  if (r.status !== 200 || r.url !== url) throw new Blocked('public HTTP response/redirect mismatch');
  const text = await r.text(); if (text.length > 3_000_000) throw new Blocked('oversized public response');
  return text;
}
async function snapshot() {
  const entries = [];
  const userApps = path.join(os.homedir(),'Applications');
  async function folderFact(dir) {
    const st=await plain(dir,true);const facts={mode:st.mode,files:[],attributes:''};
    const {stdout}=await exec('/usr/bin/xattr',['-l',dir],{timeout:3000,maxBuffer:1024*1024});facts.attributes=stdout;
    for(const name of ['.localized','Icon\r']){
      const file=path.join(dir,name);if(!await present(file))continue;const s=await lstat(file);if(s.isSymbolicLink())throw new Blocked('shared metadata symlink');
      if(s.isFile())facts.files.push([name,hash(await readFile(file))]);
      else if(s.isDirectory())for(const item of (await readdir(file)).sort()){const p=path.join(file,item);await plain(p);facts.files.push([`${name}/${item}`,hash(await readFile(p))]);}
      const attrs=await exec('/usr/bin/xattr',['-l',file],{timeout:3000,maxBuffer:1024*1024});facts.files.push([`${name}/xattr`,hash(attrs.stdout)]);
    }
    entries.push({kind:'shared-folder',path:dir,inode:st.ino,digest:hash(JSON.stringify(facts)),plist:{},executable:null});
  }
  if (!await present(userApps)) return entries;
  await folderFact(userApps);
  for (const name of ['Chrome Apps.localized','Chromium Apps.localized','Chrome Canary Apps.localized']) {
    const dir = path.join(userApps,name);
    if (!await present(dir)) continue;
    await folderFact(dir);
    for (const item of await readdir(dir,{withFileTypes:true})) {
      if (!item.name.endsWith('.app')) continue;
      const bundle = path.join(dir,item.name); const st = await plain(bundle,true);
      const pfile = path.join(bundle,'Contents','Info.plist');
      const metadata = await plist(pfile); const bytes = await readFile(pfile);
      const executableName = metadata.CFBundleExecutable;
      if (typeof executableName !== 'string' || path.basename(executableName) !== executableName) throw new Blocked('unreadable bundle executable');
      const executable = path.join(bundle,'Contents','MacOS',executableName);
      const ex = await lstat(executable);
      if (!ex.isFile() || ex.isSymbolicLink()) throw new Blocked('unsafe bundle executable');
      entries.push({path:bundle,inode:st.ino,digest:hash(bytes),plist:metadata,executable});
    }
  }
  return entries;
}
async function preflight(o,recovery) {
  if (process.platform !== 'darwin') throw new Blocked('macOS required');
  const appDir = await realpath(o.appDir);
  const {stdout:head} = await exec('git',['-C',appDir,'rev-parse','HEAD'],{timeout:5000});
  const diskBuildId = (await readFile(path.join(appDir,'.next/BUILD_ID'),'utf8')).trim();
  const html = await publicGet(`${o.origin}/`);
  verifyBuild({expectedSha:o.appSha,expectedBuildId:o.buildId,head:head.trim(),diskBuildId,html});
  const manifestUrl = `${o.origin}/manifest.webmanifest`;
  if (!/manifest\.webmanifest/.test(html)) throw new Blocked('served page has no expected manifest link');
  const rawManifest = await publicGet(manifestUrl);
  const id = identity(JSON.parse(rawManifest),manifestUrl,o.origin);
  id.appId = chromeAppId(id.manifestId);
  const binary = await realpath(o.chromiumPath);
  if (!binary.includes('/Google Chrome for Testing.app/Contents/MacOS/')) throw new Blocked('full Chrome for Testing required');
  await plain(binary);
  const info = await plist(path.resolve(binary,'../../Info.plist'));
  id.browserBundleId=info.CFBundleIdentifier;
  if (!String(info.CFBundleShortVersionString).startsWith('156.')) throw new Blocked('CfT 156 required');
  const pwDir = await realpath(o.playwrightPath);
  await plain(path.join(pwDir,'index.mjs'));
  const pw = await import(pathToFileURL(path.join(pwDir,'index.mjs')).href);
  if (!pw.chromium?.connectOverCDP) throw new Blocked('existing Playwright CDP API unavailable');
  const baseline = await snapshot();
  let registryState,adoption,folderAdoption,lockAdoption;
  if(recovery){
    if(recovery.app.sha!==head.trim()||recovery.app.buildId!==diskBuildId||recovery.app.origin!==o.origin||recovery.app.manifestHash!==hash(rawManifest)||recovery.binary!==binary||recovery.browserBundleId!==info.CFBundleIdentifier||recovery.identity.manifestId!==id.manifestId||recovery.identity.appId!==id.appId)throw new Blocked('recovery product/binary identity changed');
    const st=await plain(recovery.profileRoot,true);adoption=validateAdoption(st,recovery,await realpath(os.tmpdir()),process.getuid());
    lockAdoption=await inspectSingletonLock({root:recovery.profileRoot,sourcePid:recovery.browserPid,hostname:os.hostname(),lookupProcess:processFact});
    const processes=(await exec('/bin/ps',['-axo','command='],{timeout:5000,maxBuffer:4*1024*1024})).stdout.split('\n');
    if(processes.some(command=>command.includes(`--user-data-dir=${recovery.profileRoot}`)))throw new Blocked('existing process uses recovery profile');
    registryState=await readRegistry(recovery.profileRoot,id.appId);
    const ownedBundles=baseline.filter(b=>attributable(b,id,recovery.profileRoot,recovery.baseline,registryState));
    if(ownedBundles.length!==1||baseline.filter(b=>collision(b,id)).length!==1||!baselineUnchanged(recovery.baseline,baseline))throw new Blocked('recovery shim/original baseline attribution failed');
    const folder=path.dirname(ownedBundles[0].path);
    if(folder!==path.join(os.homedir(),'Applications','Chromium Apps.localized'))throw new Blocked('unapproved recovery shim folder');
    folderAdoption=await adoptFolder(folder,recovery);
  }else if(baseline.some(b => collision(b,id)))throw new Blocked('pre-existing app identity/origin collision');
  return {appDir,head:head.trim(),diskBuildId,manifestUrl,manifestHash:hash(rawManifest),identity:id,binary,binaryVersion:info.CFBundleShortVersionString,browserBundleId:info.CFBundleIdentifier,baseline:recovery?recovery.baseline:baseline,pw,registryState,adoption,folderAdoption,lockAdoption};
}
async function processFact(pid) {
  try {
    const {stdout} = await exec('/bin/ps',['-p',String(pid),'-o','pid=,lstart=,command='],{timeout:3000});
    const m = stdout.trim().match(/^(\d+)\s+(.{24})\s+(.+)$/);
    return m ? {pid:Number(m[1]),started:m[2],command:m[3]} : null;
  } catch (e) { if (e.code === 1) return null; throw e; }
}
async function descendants(rootPid) {
  const {stdout}=await exec('/bin/ps',['-axo','pid=,ppid=,lstart=,command='],{timeout:5000,maxBuffer:4*1024*1024});
  const rows=stdout.split('\n').flatMap(line=>{const m=line.trim().match(/^(\d+)\s+(\d+)\s+(.{24})\s+(.+)$/);return m?[{pid:Number(m[1]),ppid:Number(m[2]),started:m[3],command:m[4]}]:[];});
  const ids=new Set([rootPid]);let changed=true;
  while(changed){changed=false;for(const row of rows)if(ids.has(row.ppid)&&!ids.has(row.pid)){ids.add(row.pid);changed=true;}}
  return rows.filter(r=>r.pid!==rootPid&&ids.has(r.pid));
}
async function pendingShimProcesses(bundles) {
  if (!bundles.length) return [];
  const {stdout} = await exec('/bin/ps',['-axo','pid=,command='],{timeout:5000,maxBuffer:4*1024*1024});
  return stdout.split('\n').flatMap(line => {
    const m = line.trim().match(/^(\d+)\s+(.+)$/);
    return m && bundles.some(b => m[2].startsWith(b.executable)) ? [{pid:Number(m[1]),bundle:bundles.find(b => m[2].startsWith(b.executable)).path}] : [];
  });
}
async function main(argv) {
  const o = parseArgs(argv); if (o.help) { console.log(HELP); return 0; }
  let recovery=null;
  if(o.recoverManifest){const source=path.resolve(o.recoverManifest);const st=await plain(source);if((st.mode&0o777)!==0o600||st.uid!==process.getuid())throw new Blocked('recovery manifest must be owned0600');const bytes=await readFile(source);recovery=validateRecovery(JSON.parse(bytes.toString()),bytes,o.recoverSha256);}
  const pf = await preflight(o,recovery);
  // Output must be NEW, outside all git worktrees, with a plain existing parent.
  const out = path.resolve(o.out); const parent = await realpath(path.dirname(out));
  if (parent !== path.dirname(out)) throw new Blocked('output parent symlink');
  const gitParent = await exec('git',['-C',parent,'rev-parse','--show-toplevel'],{timeout:3000}).then(() => true, () => false);
  if (gitParent) throw new Blocked('output must be outside git');
  await mkdir(out,{mode:0o700});
  const harnessSha=(await exec('git',['-C',path.dirname(new URL(import.meta.url).pathname),'rev-parse','HEAD'],{timeout:3000})).stdout.trim();
  const state = {schema:1,runId:randomUUID(),startedAt:Date.now(),phase:'preflight',status:'PREFLIGHT_ONLY',harnessSha,app:{dir:pf.appDir,sha:pf.head,buildId:pf.diskBuildId,origin:o.origin,manifestHash:pf.manifestHash},identity:pf.identity,binary:pf.binary,binaryVersion:pf.binaryVersion,browserBundleId:pf.browserBundleId,baseline:pf.baseline,proofs:{},intents:[],cleanup:null};
  if(recovery){state.recovery={sourceRunId:recovery.runId,sourceHash:o.recoverSha256,sourceHashVerified:true,sourceManifest:path.resolve(o.recoverManifest),continueProof:!!o.continueProof,adoption:pf.adoption,folder:pf.folderAdoption,lock:pf.lockAdoption};state.profileRoot=recovery.profileRoot;state.installIntent=recovery.installIntent;state.proofs.installed=true;}
  let writeQueue = Promise.resolve();
  function save() {
    const json = JSON.stringify(state,null,2); // snapshot now, serialize writes in invocation order
    writeQueue = writeQueue.then(async () => {const tmp=path.join(out,'manifest.next');await writeFile(tmp,json,{mode:0o600});await rename(tmp,path.join(out,'manifest.json'));});
    return writeQueue;
  }
  await save();
  if (!o.execute) { console.log(`PREFLIGHT_ONLY ${out}`); return 0; }
  const gate = createGate(); let child, browser, cdp, pipe, pwa, page, profileStat, childFact;
  const owned = async () => !!child && child.exitCode === null && child.signalCode === null && sameProcess(childFact,await processFact(child.pid));
  const record = async (kind,details = {}) => {
    if(!recoveryEffectAllowed(kind,!!recovery))throw new Blocked('recovery forbids installation/profile creation');
    const intent={kind,at:Date.now(),...details};
    if(kind==='install') state.installIntent={...intent,runId:state.runId,manifestId:state.identity.manifestId,appId:state.identity.appId};
    state.intents.push(intent); await save();
  };
  // Timeout only bounds the caller: the ORIGINAL promise remains in the gate until settled.
  const mutation = async (kind,task,details) => {
    const pending=gate.effect(() => record(kind,details),task);let timer;
    try{return await Promise.race([pending,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(`${kind} outcome unknown after timeout`)),20000);})]);}
    finally{clearTimeout(timer);}
  };
  async function waitFor(fn,ms=15000,{stopping=false}={}) {
    const end=Date.now()+ms;
    do { if (!stopping) gate.check(); const value=await fn(); if (!stopping) gate.check(); if (value) return value; await pause(100); } while (Date.now()<end);
    throw new Blocked('bounded wait expired');
  }
  async function registry() {
    try { await bounded(pwa.send('PWA.getOsAppState',{manifestId:state.identity.manifestId}),8000,'registry read'); return true; }
    catch(e) { if (absentRegistry(e)) return false; throw e; }
  }
  const generatedPath=path.join(os.homedir(),'Applications','Chromium Apps.localized');
  async function rememberGeneratedFolder(){
    if(recovery||state.baseline.some(b=>b.path===generatedPath))return;
    gate.check();if(!await present(generatedPath))return;gate.check();
    const st=await plain(generatedPath,true);gate.check();
    if(!validRunFolder(st,state.startedAt,process.getuid()))throw new Blocked('new generated folder not owned by current run');
    if(state.generatedFolder&&state.generatedFolder.inode!==st.ino)throw new Blocked('generated folder replaced during install');
    if(!state.generatedFolder){state.generatedFolder={path:generatedPath,inode:st.ino,birthtimeMs:st.birthtimeMs,uid:st.uid};await save();gate.check();}
    const locPath=path.join(generatedPath,'.localized');if(!await present(locPath))return;gate.check();const loc=await plain(locPath,true);gate.check();
    if(!validRunFolder(loc,state.startedAt,process.getuid()))throw new Blocked('new localization folder not owned by run');
    if(state.generatedFolder.localizedInode&&state.generatedFolder.localizedInode!==loc.ino)throw new Blocked('localization directory replaced during install');
    if(!state.generatedFolder.localizedInode){state.generatedFolder.localizedInode=loc.ino;state.generatedFolder.localizedBirthtimeMs=loc.birthtimeMs;await save();gate.check();}
  }
  async function stopChild() {
    if (!child) return true;
    if (child.exitCode !== null || child.signalCode !== null) return true;
    if (!await owned()) return false;
    child.kill('SIGTERM');
    try { await waitFor(() => child.exitCode !== null || child.signalCode !== null,5000,{stopping:true}); return true; } catch {}
    if (!await owned()) return child.exitCode !== null || child.signalCode !== null;
    child.kill('SIGKILL');
    try { await waitFor(() => child.exitCode !== null || child.signalCode !== null,3000,{stopping:true}); return true; } catch { return false; }
  }
  const finalize = onceAsync(async () => {
    gate.stop(); state.phase='cleanup'; await save();
    const cleanup = state.cleanup = {ok:false,errors:[]};
    const pending = await gate.drain(10000); cleanup.pending=pending;
    let newBundles=[];
    try {
      const now=await snapshot();const localState=state.installIntent?await readRegistry(state.profileRoot,state.identity.appId).catch(e=>{throw new Error(`installed profile registry not proved: ${e.message}`);}):null;
      newBundles=now.filter(b => attributable(b,state.identity,state.profileRoot,state.baseline,localState));
      if (state.installIntent && pending === 0 && pwa && await owned()) {
        const installed=await registry();
        if (installed) {
          const currentProfile=await plain(state.profileRoot,true);
          if (currentProfile.ino!==profileStat.ino || newBundles.length !== 1 || newBundles[0].plist.CrBundleIdentifier!==state.browserBundleId || !canUninstall(state,{ownedProcess:true,profileRoot:state.profileRoot,registryPresent:true,bundle:newBundles[0],localState})) throw new Error('uninstall identity/ownership not proved; preserved');
          await record('uninstall',{manifestId:state.identity.manifestId,bundle:newBundles[0].path});
          // bounded transport, but no assumption of cancellation if this times out
          let timer;
          try { await Promise.race([pwa.send('PWA.uninstall',{manifestId:state.identity.manifestId}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('uninstall unknown after timeout')),10000);})]); }
          finally { clearTimeout(timer); }
          cleanup.registryAbsent = await waitFor(async () => !await registry(),10000,{stopping:true});
        } else cleanup.registryAbsent=true;
      } else if (!state.installIntent) cleanup.registryAbsent=true;
      else cleanup.errors.push('pending mutation or lost owned session; install outcome not resolved');
    } catch(e) { cleanup.errors.push(e.message); }
    try { state.ownedHelpers=child&&await owned()?await descendants(child.pid):[];await save(); }catch(e){cleanup.errors.push(e.message);}
    try { if (cdp && await owned()) await Promise.race([cdp.send('Browser.close').catch(()=>{}),pause(2000)]); } catch(e) { cleanup.errors.push(e.message); }
    cleanup.browserExited=await stopChild().catch(e => {cleanup.errors.push(e.message);return false;});
    state.browserExitedAt=Date.now();
    try{pipe?.close();}catch(e){cleanup.errors.push(e.message);}
    // After owned process exit, no late browser installation/window can materialize.
    try {
      await waitFor(async()=>{
        const shimPids=await pendingShimProcesses(newBundles);
        const helperPids=[];for(const helper of state.ownedHelpers||[])if(sameProcess(helper,await processFact(helper.pid)))helperPids.push(helper.pid);
        return shimPids.length===0&&helperPids.length===0;
      },8000,{stopping:true}).catch(()=>{});
      if(recovery&&cleanup.registryAbsent&&cleanup.browserExited&&!pending){
        const local=JSON.parse(await readFile(path.join(state.profileRoot,'Local State'),'utf8'));
        cleanup.diskRegistryAbsent=!Object.hasOwn(local.app_shims||{},state.identity.appId);
        if(!cleanup.diskRegistryAbsent)throw new Error('app_shims registry remains after browser flush');
        const current=await snapshot();
        if(current.some(b=>collision(b,state.identity)))throw new Error('shim still present; shared folder preserved');
        if(!baselineUnchanged(state.baseline,current))throw new Error('preexisting baseline changed; shared folder preserved');
        if((await pendingShimProcesses(newBundles)).length)throw new Error('shim process still live; shared folder preserved');
        for(const helper of state.ownedHelpers||[])if(sameProcess(helper,await processFact(helper.pid)))throw new Error('helper still live; shared folder preserved');
        await removeAdoptedFolder(pf.folderAdoption,record);cleanup.sharedFolderRemoved=true;
      }
      if(!recovery&&state.generatedInitial&&cleanup.registryAbsent&&cleanup.browserExited&&!pending){
        const local=JSON.parse(await readFile(path.join(state.profileRoot,'Local State'),'utf8'));
        if(Object.keys(local.app_shims||{}).length)throw new Error('normal-run app_shims remain after close');
        const before=await snapshot();if(before.some(b=>collision(b,state.identity))||!baselineUnchanged(state.baseline,before))throw new Error('normal-run shim/baseline not clean before metadata adoption');
        if((await pendingShimProcesses(newBundles)).length)throw new Error('normal-run shim process still alive');
        for(const helper of state.ownedHelpers||[])if(sameProcess(helper,await processFact(helper.pid)))throw new Error('normal-run helper still alive');
        state.osQuiescentAt=Date.now();const post=await readGeneratedMetadata(generatedPath);
        state.generatedPostClose=adoptNormalPostClose(state.generatedInitial,post,{baseline:state.baseline,start:state.startedAt,closedAt:state.osQuiescentAt,uid:process.getuid(),observed:state.generatedFolder});
        await record('adopt-normal-post-close-metadata',{folder:state.generatedPostClose});
        await removeAdoptedFolder(state.generatedPostClose,record);cleanup.sharedFolderRemoved=true;
      }
      const after=await snapshot(); cleanup.baselineUnchanged=baselineUnchanged(state.baseline,after);
      cleanup.shimsAbsent=!after.some(b => collision(b,state.identity) || (state.profileRoot && String(b.plist.CrAppModeUserDataDir).startsWith(`${state.profileRoot}/`)));
      cleanup.shimPids=await pendingShimProcesses(newBundles);
      cleanup.helperPids=[];
      for(const helper of state.ownedHelpers||[])if(sameProcess(helper,await processFact(helper.pid)))cleanup.helperPids.push(helper.pid);
      if(cleanup.helperPids.length)cleanup.errors.push('owned helper processes still alive; preserved profile');
      cleanup.newSharedFolders=after.filter(b=>b.kind==='shared-folder'&&!state.baseline.some(a=>a.path===b.path)).map(b=>b.path);
      if(cleanup.newSharedFolders.length)cleanup.errors.push('new shared application folders remain; no global deletion authorized');
      cleanup.ok=profileRemovalAllowed(cleanup);
      if (cleanup.ok && state.profileRoot) {
        const st=await plain(state.profileRoot,true);
        if (st.ino !== profileStat.ino || path.dirname(state.profileRoot) !== await realpath(os.tmpdir()) || !path.basename(state.profileRoot).startsWith('depannage-pwa-os-')) throw new Error('profile deletion ownership changed');
        await record('delete-owned-profile',{path:state.profileRoot,inode:st.ino});
        await rm(state.profileRoot,{recursive:true}); cleanup.profileRemoved=true;
      }
    } catch(e) { cleanup.ok=false;cleanup.errors.push(e.message); }
    state.phase='finished';state.status=resultStatus(state);if(recovery&&!o.continueProof&&cleanup.ok&&!state.error)state.status='RECOVERED_CLEAN';await save();
    await writeFile(path.join(out,'report.json'),JSON.stringify(state,null,2),{mode:0o600});
    await writeFile(path.join(out,'report.md'),`# PWA desktop installation\n\nStatus: **${state.status}**\n\nApp ${state.app.sha}, build ${state.app.buildId}, origin ${o.origin}.\n\nProofs: ${JSON.stringify(state.proofs)}\n\nCleanup: ${JSON.stringify(cleanup)}\n\nNo claim of manual installer dialog, OS reboot persistence, production, iOS or Android.\n`,{mode:0o600});
    console.log(`${state.status} ${out}`);
    return ['PASS','RECOVERED_CLEAN'].includes(state.status)?0:state.status==='INCOMPLETE'?3:2;
  });
  let interrupted=false;
  const onSignal=signal=>{interrupted=true;gate.stop();state.error={kind:'Blocked',message:signal};void finalize().then(code=>{process.exitCode=code;}).catch(()=>{process.exitCode=3;});};
  const sigint=()=>onSignal('SIGINT'),sigterm=()=>onSignal('SIGTERM');
  process.on('SIGINT',sigint);process.on('SIGTERM',sigterm);
  try {
    if(recovery){profileStat=await plain(state.profileRoot,true);if(profileStat.ino!==pf.adoption.inode)throw new Blocked('adopted profile changed');await record('adopt-existing-profile',{path:state.profileRoot,...pf.adoption});}
    else await mutation('create-profile',async()=>{state.profileRoot=await mkdtemp(path.join(await realpath(os.tmpdir()),'depannage-pwa-os-'));await chmod(state.profileRoot,0o700);profileStat=await plain(state.profileRoot,true);state.profileOwnership={inode:profileStat.ino,birthtimeMs:profileStat.birthtimeMs,mode:profileStat.mode,uid:profileStat.uid};await save();});gate.check();
    const oldEndpoint=await readFile(path.join(state.profileRoot,'DevToolsActivePort')).then(hash,e=>{if(e.code==='ENOENT')return null;throw e;});gate.check();
    const args=[`--user-data-dir=${state.profileRoot}`,...(recovery?['--profile-directory=Default']:[]),'--remote-debugging-port=0','--remote-debugging-address=127.0.0.1','--remote-debugging-pipe','--enable-automation','--no-first-run','--no-default-browser-check','--disable-sync','about:blank'];
    child=await mutation('spawn',async()=>{
      if(recovery){const lockNow=await inspectSingletonLock({root:state.profileRoot,sourcePid:recovery.browserPid,hostname:os.hostname(),lookupProcess:processFact});assertSameLock(pf.lockAdoption,lockNow);gate.check();}
      const c=spawn(pf.binary,args,{stdio:['ignore','ignore','ignore','pipe','pipe'],env:{HOME:os.homedir(),PATH:'/usr/bin:/bin:/usr/sbin:/sbin',TMPDIR:os.tmpdir(),LANG:'fr_FR.UTF-8'}});
      child=c; c.on('error',e=>{state.spawnError=e.message;});state.browserPid=c.pid;
      pipe=createPipeClient(c.stdio[3],c.stdio[4]);
      // Capture identity inside the tracked spawn operation even if a signal arrives meanwhile.
      for(let n=0;n<30;n++){const fact=c.pid?await processFact(c.pid):null;if(fact){childFact=fact;break;}if(state.spawnError)throw new Error(state.spawnError);await pause(50);}
      if(!childFact)throw new Error('spawned process identity unavailable');
      return c;
    },{binary:pf.binary,profileRoot:state.profileRoot});
    gate.check();
    if (!childFact.command.includes(pf.binary) || !childFact.command.includes(`--user-data-dir=${state.profileRoot}`) || /--(?:test-type|headless|app=)/.test(childFact.command)) throw new Blocked('actual browser command mismatch');
    if(recovery&&!childFact.command.includes('--profile-directory=Default'))throw new Blocked('recovery browser did not select Default');
    state.child=childFact;await save();gate.check();
    const endpoint=await waitFor(async()=>{
      const f=path.join(state.profileRoot,'DevToolsActivePort');if (!await present(f)) return null;await plain(f);const bytes=await readFile(f);if(oldEndpoint&&hash(bytes)===oldEndpoint)return null;const [port,socket]=bytes.toString().trim().split('\n');
      if (!/^\d+$/.test(port) || Number(port)<1024 || Number(port)>65535 || !/^\/devtools\/browser\/[a-f0-9-]+$/.test(socket)) throw new Blocked('unsafe owned CDP endpoint');
      return `ws://127.0.0.1:${port}${socket}`;
    });
    state.debugPort=Number(new URL(endpoint).port);await save();gate.check();
    gate.check();browser=await pf.pw.chromium.connectOverCDP(endpoint,{timeout:10000});gate.check();cdp=await browser.newBrowserCDPSession();gate.check();
    state.cdp=await bounded(cdp.send('Browser.getVersion'),8000,'browser version');await save();gate.check();
    const pipeVersion=await bounded(pipe.send('Browser.getVersion'),8000,'pipe browser version');gate.check();
    const pipeProcesses=await bounded(pipe.send('SystemInfo.getProcessInfo'),8000,'pipe browser PID');gate.check();
    pwa=bindPwaChannel(pipe,pipeVersion,state.cdp,pipeProcesses.processInfo,child.pid);
    if(!await owned())throw new Blocked('browser ownership changed before PWA');gate.check();
    state.pipe={verified:true,transport:'inherited-fd3-fd4',browserPid:child.pid,version:pipeVersion};await save();gate.check();
    page=await browser.contexts()[0].newPage();gate.check();const response=await page.goto(`${o.origin}/`,{timeout:15000});gate.check();
    if (response?.status()!==200 || page.url()!==`${o.origin}/`) throw new Blocked('unexpected app page');
    const session=await page.context().newCDPSession(page);gate.check();const manifest=await bounded(session.send('Page.getAppManifest',{manifestId:state.identity.manifestId}),8000,'processed manifest');gate.check();
    if (manifest.url!==pf.manifestUrl || !manifest.data || identity(JSON.parse(manifest.data),manifest.url,o.origin).manifestId!==state.identity.manifestId) throw new Blocked('browser manifest mismatch');
    if(recovery){
      await readRegistry(state.profileRoot,state.identity.appId);gate.check();if(!await registry())throw new Blocked('recovered app not in Default CDP registry');gate.check();
      if(!o.continueProof){await record('cleanup-only-recovery-confirmed');return await finalize();}
    }else{
    const collisionCheck=await snapshot();gate.check();if (collisionCheck.some(b=>collision(b,state.identity)) || !baselineUnchanged(state.baseline,collisionCheck)) throw new Blocked('pre-install baseline/collision changed');
    // Unsupported domain/transport must not be interpreted as clean absence.
    if (await registry()) throw new Blocked('app already installed in fresh profile');gate.check();
    // A second recognized domain response rules out treating a one-off transport error as absence.
    if (await registry()) throw new Blocked('app registry changed before install');gate.check();
    await mutation('install',async()=>{
      const install=pwa.send('PWA.install',{manifestId:state.identity.manifestId,installUrlOrBundleUrl:state.identity.startUrl});
      await observeOriginalMutation(install,rememberGeneratedFolder,{gate,pause:()=>pause(100)});
    },{manifestId:state.identity.manifestId});
    gate.check();state.proofs.installed=await registry();
    }
    const bundle=await waitFor(async()=>{const all=await snapshot();let localState;try{localState=await readRegistry(state.profileRoot,state.identity.appId);}catch{return null;}const b=all.filter(x=>attributable(x,state.identity,state.profileRoot,state.baseline,localState));return b.length===1?b[0]:null;});
    if(bundle.plist.CrBundleIdentifier!==state.browserBundleId)throw new Blocked('shim browser bundle mismatch');
    state.bundle=bundle;state.proofs.shim=true;await save();gate.check();
    if(!recovery&&state.generatedFolder){
      const initial=await waitFor(async()=>{await rememberGeneratedFolder();try{return await readGeneratedMetadata(generatedPath,bundle.path,{allowPending:true});}catch(e){if(e.code==='ENOENT')return null;throw e;}});gate.check();
      adoptNormalPostClose(initial,initial,{baseline:state.baseline,start:state.startedAt,closedAt:Date.now(),uid:process.getuid(),observed:state.generatedFolder});
      state.generatedInitial=initial;await save();gate.check();
    }
    await mutation('standalone',()=>pwa.send('PWA.changeAppUserSettings',{manifestId:state.identity.manifestId,displayMode:'standalone'}));
    async function launch(label) {
      state.phase=`${label}:command`;await save();gate.check();
      const result=await mutation(label,()=>pwa.send('PWA.launch',{manifestId:state.identity.manifestId}));gate.check();
      const target=result.targetId;if (!target) throw new Error('launch returned no target');
      state.targetDiagnostics??={};const diagnostic=state.targetDiagnostics[label]={returnedTargetId:target,returnedAt:Date.now(),snapshots:[]};await save();gate.check();
      const targetInfo=await bounded(cdp.send('Target.getTargetInfo',{targetId:target}),3000,`${label}:returned-target`);gate.check();
      if(targetInfo.targetInfo.targetId!==target)throw new Blocked('returned launch target identity changed');
      const launchWindow=await bounded(cdp.send('Browser.getWindowForTarget',{targetId:target}),3000,`${label}:returned-window`);gate.check();
      diagnostic.returned=targetDiagnostic(targetInfo.targetInfo,launchWindow);state.phase=`${label}:resolve-page`;await save();gate.check();
      const deadline=Date.now()+15000;let p,lastFingerprint='';
      const remaining=()=>{gate.check();const left=deadline-Date.now();if(left<=0)throw new Blocked(`${label}:resolve-page timed out (15000ms)`);return Math.min(left,3000);};
      while(!p){
        remaining();const candidates=[],pages=browser.contexts()[0].pages();if(pages.length>20)throw new Blocked('too many owned page targets to resolve safely');
        for(const [index,candidate] of pages.entries()){
          gate.check();const session=await candidate.context().newCDPSession(candidate);gate.check();
          try{
            const info=await bounded(session.send('Target.getTargetInfo'),remaining(),`${label}:candidate-target`);gate.check();
            const w=await bounded(cdp.send('Browser.getWindowForTarget',{targetId:info.targetInfo.targetId}),remaining(),`${label}:candidate-window`);gate.check();
            candidates.push({...targetDiagnostic(info.targetInfo,w),index});
          }finally{await session.detach();}
        }
        const fingerprint=hash(JSON.stringify(candidates));
        if(fingerprint!==lastFingerprint){if(diagnostic.snapshots.length>=20)throw new Blocked('target diagnostic snapshot limit reached');diagnostic.snapshots.push({at:Date.now(),candidates});if(Buffer.byteLength(JSON.stringify(diagnostic.snapshots))>128*1024)throw new Blocked('target diagnostic byte limit reached');lastFingerprint=fingerprint;await save();gate.check();}
        const selected=selectLaunchedPage(diagnostic.returned,candidates);if(selected){p=pages[selected.index];diagnostic.selected=selected;await save();gate.check();}else await pause(100);
      }
      state.phase=`${label}:verify-page`;await save();gate.check();
      await p.waitForLoadState('domcontentloaded',{timeout:15000});gate.check();
      await p.waitForFunction(()=>document.readyState!=='loading'&&document.visibilityState==='visible'&&matchMedia('(display-mode: standalone)').matches,{},{timeout:15000});gate.check();
      if (p.url()!==state.identity.startUrl || !/Dépannage électrique/.test(await p.title())) throw new Error('launched page is not product');
      const selectedSession=await p.context().newCDPSession(p);gate.check();
      try{const manifest=await bounded(selectedSession.send('Page.getAppManifest',{manifestId:state.identity.manifestId}),8000,`${label}:selected-manifest`);gate.check();if(manifest.url!==pf.manifestUrl||!manifest.data||identity(JSON.parse(manifest.data),manifest.url,o.origin).manifestId!==state.identity.manifestId)throw new Blocked('selected app manifest mismatch');}finally{await selectedSession.detach();}
      const w=await bounded(cdp.send('Browser.getWindowForTarget',{targetId:target}),8000,'window identity');gate.check();
      const pageWindow=await bounded(cdp.send('Browser.getWindowForTarget',{targetId:diagnostic.selected.targetId}),3000,'selected page window identity');gate.check();
      if(w.windowId!==launchWindow.windowId||pageWindow.windowId!==launchWindow.windowId)throw new Blocked('launched window changed during page verification');
      if (!(w.bounds.width>0&&w.bounds.height>0) || w.bounds.windowState==='minimized') throw new Error('window not visible');
      await p.screenshot({path:path.join(out,`${label}-content.png`)});gate.check();
      await chmod(path.join(out,`${label}-content.png`),0o600);gate.check();
      state[label]={targetId:target,pageTargetId:diagnostic.selected.targetId,windowId:w.windowId,bounds:w.bounds,at:Date.now()};await save();return {page:p,...state[label]};
    }
    const first=await launch('launch');state.proofs.window=true;
    state.phase='await-os-proof';state.proofRequest={kind:'macos-visible-window',runId:state.runId,appId:state.identity.appId,windowId:first.windowId,browserPid:state.browserPid,nonce:randomBytes(16).toString('hex'),startedAt:first.at};await save();
    console.log(`AWAIT_OS_PROOF ${path.join(out,'manifest.json')} (bounded ${o.proofTimeoutMs}ms)`);
    await waitFor(async()=>{
      const file=path.join(out,'os-proof.json');if(!await present(file))return false;
      const stat=await plain(file);if((stat.mode&0o777)!==0o600)throw new Blocked('OS proof must be 0600');
      const proof=JSON.parse(await readFile(file,'utf8'));
      if(typeof proof.capture!=='string'||path.dirname(path.resolve(proof.capture))!==out)throw new Blocked('OS capture must be directly inside output');
      const captureStat=await plain(proof.capture);if((captureStat.mode&0o777)!==0o600)throw new Blocked('OS capture must be 0600');const bytes=await readFile(proof.capture);
      if(bytes.length>20*1024*1024||!proofMatches(proof,state.proofRequest,bytes))throw new Blocked('independent OS proof mismatch');
      state.osProof={...proof,capture:path.basename(proof.capture)};return true;
    },o.proofTimeoutMs);state.proofs.osProof=true;await save();gate.check();
    await mutation('close-first-window',()=>first.page.close());gate.check();
    await waitFor(async()=>{try{await bounded(cdp.send('Target.getTargetInfo',{targetId:first.targetId}),2000,'closed app target');return false;}catch(e){if(/No target with given id found/.test(e.message))return true;throw e;}});gate.check();
    const second=await launch('relaunch');if(second.targetId===first.targetId||second.pageTargetId===first.pageTargetId)throw new Error('relaunch reused closed target');state.proofs.relaunched=true;await save();
  } catch(e) { if(!state.error)state.error={kind:e instanceof Blocked||unavailablePwa(e)?'Blocked':'Error',message:String(e.message).slice(0,500)}; }
  finally {
    const code=await finalize();process.removeListener('SIGINT',sigint);process.removeListener('SIGTERM',sigterm);return interrupted?Math.max(code,2):code;
  }
}

// Durable install identity is recorded inside the intent hook before the CDP effect.
// main exported only for command dispatch; pure tests import lib.mjs and never execute this file.
main(process.argv.slice(2)).then(code=>{process.exitCode=code;}).catch(e=>{console.error(`${e instanceof Blocked?'BLOCKED':'FAIL'}: ${e.message}`);process.exitCode=2;});

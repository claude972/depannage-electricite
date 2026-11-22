#!/usr/bin/env node
// One root-reviewed cleanup lease. No browser, network, account, install, kill, or lock removal.
import {readFile,writeFile,lstat,realpath,readdir,mkdir,rename,unlink,rmdir,rm} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import path from 'node:path';
import os from 'node:os';
import {hash,Blocked} from './lib.mjs';
import {plainStat,validateRecovery,SOURCE} from './recovery.mjs';
import {POST,validatePostSource,metadataMatches,createPostCleanup} from './postclose-lib.mjs';
const exec=promisify(execFile);
const exists=async p=>lstat(p).then(()=>true,e=>{if(e.code==='ENOENT')return false;throw e;});
const attrs=async p=>hash((await exec('/usr/bin/xattr',['-l',p],{timeout:3000,maxBuffer:1024*1024})).stdout);
async function folderDigest(dir){
  const s=await plainStat(dir,true),facts={mode:s.mode,files:[],attributes:(await exec('/usr/bin/xattr',['-l',dir],{timeout:3000,maxBuffer:1024*1024})).stdout};
  for(const name of ['.localized','Icon\r']){
    const p=path.join(dir,name);if(!await exists(p))continue;const st=await lstat(p);if(st.isSymbolicLink())throw new Blocked('baseline metadata symlink');
    if(st.isFile())facts.files.push([name,hash(await readFile(p))]);
    else if(st.isDirectory())for(const f of (await readdir(p)).sort()){await plainStat(path.join(p,f));facts.files.push([`${name}/${f}`,hash(await readFile(path.join(p,f)))]);}
    facts.files.push([`${name}/xattr`,await attrs(p)]);
  }
  return hash(JSON.stringify(facts));
}
async function main(args){
  const o={execute:false};
  for(let i=0;i<args.length;i++){
    const a=args[i];if(a==='--help'){console.log('cleanup-postclose.mjs --source-manifest FILE --source-sha256 HASH --out NEW_DIR [--execute]');return 0;}
    if(a==='--execute'){if(o.execute)throw new Blocked('duplicate execute');o.execute=true;continue;}
    const k={'--source-manifest':'source','--source-sha256':'hash','--out':'out'}[a];if(!k||o[k]||!args[i+1]||args[i+1].startsWith('--'))throw new Blocked('invalid post-close options');o[k]=args[++i];
  }
  if(process.platform!=='darwin'||!o.source||!o.hash||!o.out)throw new Blocked('macOS and all source/out arguments required');
  const file=path.resolve(o.source),st=await plainStat(file);if(st.uid!==process.getuid()||(st.mode&0o777)!==0o600)throw new Blocked('source must be owned0600');
  const bytes=await readFile(file),s=validatePostSource(JSON.parse(bytes.toString()),bytes,o.hash);
  const originalFile=s.recovery.sourceManifest;await plainStat(originalFile);const originalBytes=await readFile(originalFile);const original=validateRecovery(JSON.parse(originalBytes.toString()),originalBytes,s.recovery.sourceHash);
  if(original.profileRoot!==s.profileRoot||s.identity.appId!==SOURCE.appId||s.installIntent.runId!==SOURCE.runId)throw new Blocked('source chain mismatch');
  const root=s.profileRoot,folder=s.recovery.folder.path,userApps=path.join(os.homedir(),'Applications');
  if(path.dirname(root)!==await realpath(os.tmpdir())||path.basename(root)!==SOURCE.basename||folder!==path.join(userApps,'Chromium Apps.localized')||original.baseline.some(b=>b.path===folder))throw new Blocked('cleanup root outside approved scope');
  const start=s.intents.find(x=>x.kind==='spawn')?.at,end=s.intents.find(x=>x.kind==='uninstall')?.at;
  if(!Number.isFinite(start)||!Number.isFinite(end)||end<start)throw new Blocked('missing recovery time interval');
  const ids=new Set([s.browserPid,...s.ownedHelpers.map(p=>p.pid)]);
  async function noProcesses(){
    const lines=(await exec('/bin/ps',['-axo','pid=,command='],{timeout:5000,maxBuffer:4*1024*1024})).stdout.split('\n');
    for(const line of lines){const m=line.trim().match(/^(\d+)\s+(.+)$/);if(m&&(ids.has(Number(m[1]))||m[2].includes(`--user-data-dir=${root}`)||m[2].startsWith(`${folder}/`)))throw new Blocked('owned PID reused/alive or matching profile/shim process');}
  }
  async function baseline(){for(const b of original.baseline){const stat=await plainStat(b.path,true);const digest=b.kind==='shared-folder'?await folderDigest(b.path):hash(await readFile(path.join(b.path,'Contents','Info.plist')));if(stat.ino!==b.inode||digest!==b.digest)throw new Blocked('preexisting user baseline changed');}}
  async function inspect(completed){
    await noProcesses();await baseline();
    if(completed.includes('remove-owned-profile')){if(await exists(root))throw new Blocked('profile remains');}
    else{
      const r=await plainStat(root,true);if(r.ino!==POST.profileInode||r.uid!==process.getuid()||(r.mode&0o777)!==0o700||r.birthtimeMs!==s.recovery.adoption.birthtimeMs)throw new Blocked('owned profile changed');
      const localFile=path.join(root,'Local State');await plainStat(localFile);const local=JSON.parse(await readFile(localFile,'utf8'));
      if(Object.keys(local.app_shims||{}).length||Object.keys(local.profile?.info_cache||{}).join()!=='Default')throw new Blocked('installed app/foreign profile remains');
    }
    if(completed.includes('rmdir-generated-folder')){if(await exists(folder))throw new Blocked('generated folder remains');return;}
    const dir=await plainStat(folder,true);if(dir.ino!==POST.folderInode||dir.uid!==process.getuid())throw new Blocked('generated folder ownership changed');
    const expectNames=[];if(!completed.includes('unlink-icon'))expectNames.push('Icon\r');if(!completed.includes('rmdir-localized'))expectNames.push('.localized');
    if(JSON.stringify((await readdir(folder)).sort())!==JSON.stringify(expectNames.sort()))throw new Blocked('foreign entry/bundle in generated folder');
    if(!completed.includes('rmdir-localized')){
      const loc=await plainStat(path.join(folder,'.localized'),true);if(loc.ino!==POST.localizedInode||loc.uid!==process.getuid())throw new Blocked('localization ownership changed');
      if(JSON.stringify(await readdir(path.join(folder,'.localized')))!==JSON.stringify(completed.includes('unlink-language')?[]:['fr.strings']))throw new Blocked('foreign localization entry');
    }
    for(const f of POST.files){const step=f.relative==='Icon\r'?'unlink-icon':'unlink-language';if(completed.includes(step))continue;
      const p=path.join(folder,f.relative),fs=await plainStat(p),actual={inode:fs.ino,uid:fs.uid,mode:fs.mode&0o777,birthtimeMs:fs.birthtimeMs,digest:hash(await readFile(p)),attributes:await attrs(p)};
      if(!metadataMatches(actual,f,start,end,process.getuid()))throw new Blocked('post-close metadata snapshot changed');
    }
  }
  await inspect([]); // refuse before output/effects if source or current artifacts differ
  const out=path.resolve(o.out),parent=await realpath(path.dirname(out));if(parent!==path.dirname(out))throw new Blocked('output parent symlink');
  if(await exec('git',['-C',parent,'rev-parse','--show-toplevel']).then(()=>true,()=>false))throw new Blocked('output inside git');await mkdir(out,{mode:0o700});
  const state={schema:1,status:'PREFLIGHT_ONLY',sourceManifest:file,sourceHash:o.hash,originalHash:s.recovery.sourceHash,runId:s.runId,adoption:POST,root,folder,events:[],completed:[]};
  let queue=Promise.resolve();const save=()=>{const data=JSON.stringify(state,null,2);queue=queue.then(async()=>{await writeFile(path.join(out,'manifest.next'),data,{mode:0o600});await rename(path.join(out,'manifest.next'),path.join(out,'manifest.json'));});return queue;};await save();
  if(!o.execute){console.log(`PREFLIGHT_ONLY ${out}`);return 0;}
  const controller=createPostCleanup({inspect,journal:async event=>{state.events.push({...event,at:Date.now()});state.completed=event.completed;await save();},effect:async step=>{
    if(step==='unlink-icon')await unlink(path.join(folder,'Icon\r'));
    else if(step==='unlink-language')await unlink(path.join(folder,'.localized','fr.strings'));
    else if(step==='rmdir-localized')await rmdir(path.join(folder,'.localized'));
    else if(step==='rmdir-generated-folder')await rmdir(folder);
    else if(step==='remove-owned-profile')await rm(root,{recursive:true});
    else throw new Blocked('unknown cleanup operation');
  }});
  const signal=()=>controller.gate.stop();process.on('SIGINT',signal);process.on('SIGTERM',signal);
  try{state.status=await controller.execute();}catch(error){state.status='INCOMPLETE';state.error=error.message;}
  finally{controller.gate.stop();state.pending=await controller.gate.drain(10000);if(state.pending)state.status='INCOMPLETE';state.completed=[...controller.completed];await save();process.removeListener('SIGINT',signal);process.removeListener('SIGTERM',signal);}
  console.log(`${state.status} ${out}`);return state.status==='RECOVERED_CLEAN'?0:3;
}
main(process.argv.slice(2)).then(code=>{process.exitCode=code;}).catch(error=>{console.error(`BLOCKED: ${error.message}`);process.exitCode=2;});

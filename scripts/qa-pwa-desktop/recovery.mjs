import {readFile,lstat,realpath,readdir,unlink,rmdir} from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {hash,Blocked,uniqueDefault} from './lib.mjs';

// One explicit recovery lease approved by root. No generic browser-profile adoption.
export const SOURCE={runId:'badffa11-c02f-4c07-ad88-199162fa53ac',sha:'be7791728d373576dbaf2b661b315938529a47f3',basename:'depannage-pwa-os-rrDlEC',appId:'mflagdbdnhheocmiajkbgeklnokffeie'};
const exec=promisify(execFile);
async function attributeHash(file){return hash((await exec('/usr/bin/xattr',['-l',file],{timeout:3000,maxBuffer:1024*1024})).stdout);}
export function validateRecovery(source,bytes,expectedHash) {
  if(!source||!Number.isFinite(source.startedAt)||!Number.isFinite(source.installIntent?.at)||source.installIntent.at<source.startedAt||typeof source.profileRoot!=='string'||!path.isAbsolute(source.profileRoot))throw new Blocked('invalid recovery source timestamps/path');
  if(hash(bytes)!==expectedHash||source.runId!==SOURCE.runId||source.harnessSha!==SOURCE.sha||source.status!=='INCOMPLETE'||source.proofs?.installed!==true||source.cleanup?.ok!==false||path.basename(source.profileRoot||'')!==SOURCE.basename||source.identity?.appId!==SOURCE.appId||source.installIntent?.runId!==source.runId||source.installIntent?.appId!==source.identity.appId||source.installIntent?.manifestId!==source.identity.manifestId||!Array.isArray(source.baseline)||source.baseline.some(b=>b.plist?.CrAppModeShortcutID===SOURCE.appId))throw new Blocked('source recovery manifest/hash/intent not approved');
  return source;
}
export function recoveryEffectAllowed(kind,recovering) {return !recovering||!['install','create-profile'].includes(kind);}
export async function plainStat(file,dir=false) {
  const st=await lstat(file);
  if(st.isSymbolicLink()||(dir?!st.isDirectory():!st.isFile())||await realpath(file)!==path.resolve(file))throw new Blocked('recovery path not plain');
  return st;
}
export async function readRegistry(root,id) {
  await plainStat(root,true);await plainStat(path.join(root,'Local State'));await plainStat(path.join(root,'Default'),true);await plainStat(path.join(root,'Default','Preferences'));
  const state=JSON.parse(await readFile(path.join(root,'Local State'),'utf8'));
  if(!uniqueDefault(state,id))throw new Blocked('not the sole Default installed-app registry');
  for(const item of await readdir(root,{withFileTypes:true})){
    if(item.name==='Default'||!item.isDirectory())continue;
    const hasPreferences=await lstat(path.join(root,item.name,'Preferences')).then(()=>true,e=>{if(e.code==='ENOENT')return false;throw e;});
    if(hasPreferences)throw new Blocked('another Chrome profile exists');
  }
  return state;
}
export function validateAdoption(st,source,tmpRoot,uid) {
  if(!Number.isFinite(st.birthtimeMs)||(st.mode&0o777)!==0o700||st.uid!==uid||path.dirname(source.profileRoot)!==tmpRoot||st.birthtimeMs<source.startedAt-1000||st.birthtimeMs>source.installIntent.at)throw new Blocked('profile adoption owner/birthtime/path mismatch');
  return {inode:st.ino,birthtimeMs:st.birthtimeMs,mode:st.mode,uid:st.uid};
}
export function folderPlanAllowed(adoption,entries,currentInode) {
  return adoption&&adoption.inode===currentInode&&entries.every(name=>['.localized','Icon\r'].includes(name));
}
export async function adoptFolder(folder,source) {
  if(source.baseline.some(b=>b.path===folder))throw new Blocked('shared folder was preexisting');
  const st=await plainStat(folder,true);
  if(st.birthtimeMs<source.startedAt-1000||st.birthtimeMs>source.installIntent.at+30000||st.uid!==process.getuid())throw new Blocked('new shared folder birthtime/owner mismatch');
  const names=await readdir(folder);const appNames=names.filter(n=>n.endsWith('.app'));
  if(appNames.length!==1||names.some(n=>!n.endsWith('.app')&&!['.localized','Icon\r'].includes(n)))throw new Blocked('unexpected shared folder content');
  const files=[];
  for(const relative of ['Icon\r','.localized/fr.strings']){
    const file=path.join(folder,relative);const s=await plainStat(file);files.push({relative,inode:s.ino,digest:hash(await readFile(file)),attributes:await attributeHash(file)});
  }
  const loc=await plainStat(path.join(folder,'.localized'),true);
  if((await readdir(path.join(folder,'.localized'))).join()!=='fr.strings')throw new Blocked('unexpected generated localization');
  return {path:folder,inode:st.ino,localizedInode:loc.ino,birthtimeMs:st.birthtimeMs,files};
}
export async function removeAdoptedFolder(adoption,record) {
  const st=await plainStat(adoption.path,true);
  if(!folderPlanAllowed(adoption,await readdir(adoption.path),st.ino))throw new Blocked('shared folder has foreign contents/inode');
  const loc=await plainStat(path.join(adoption.path,'.localized'),true);
  if(loc.ino!==adoption.localizedInode||(await readdir(path.join(adoption.path,'.localized'))).join()!=='fr.strings')throw new Blocked('localization changed');
  // Complete validation before the first unlink; no recursive operation or bundle deletion.
  for(const f of adoption.files){const p=path.join(adoption.path,f.relative),s=await plainStat(p);if(s.ino!==f.inode||hash(await readFile(p))!==f.digest||await attributeHash(p)!==f.attributes)throw new Blocked('generated metadata changed');}
  for(const f of adoption.files){await record('unlink-generated-metadata',{path:path.join(adoption.path,f.relative),inode:f.inode});const p=path.join(adoption.path,f.relative),s=await plainStat(p);if(s.ino!==f.inode||hash(await readFile(p))!==f.digest||await attributeHash(p)!==f.attributes)throw new Blocked('metadata changed before unlink');await unlink(p);}
  await record('rmdir-generated-localization',{path:path.join(adoption.path,'.localized')});if((await plainStat(path.join(adoption.path,'.localized'),true)).ino!==adoption.localizedInode)throw new Blocked('localization inode changed before rmdir');await rmdir(path.join(adoption.path,'.localized'));
  await record('rmdir-generated-shared-folder',{path:adoption.path,inode:adoption.inode});
  if((await plainStat(adoption.path,true)).ino!==adoption.inode)throw new Blocked('folder inode changed before rmdir');await rmdir(adoption.path);
}

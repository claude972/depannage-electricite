import {readFile,readdir} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import path from 'node:path';
import {Blocked,hash} from './lib.mjs';
import {plainStat} from './recovery.mjs';
const exec=promisify(execFile);
export function validRunFolder(st,start,uid){return Number.isSafeInteger(st.ino)&&st.uid===uid&&Number.isFinite(st.birthtimeMs)&&st.birthtimeMs>=start;}
export async function observeOriginalMutation(original,observe,{gate,pause}){
  let ended=false,observerError;const settled=original.then(()=>{ended=true;},()=>{ended=true;});
  while(!ended&&!gate.stopping){try{await observe();}catch(error){observerError=error;break;}await pause();}
  // Observer failure/stop never cancels or forgets the original browser mutation.
  try{await original;}finally{await settled;}
  if(observerError)throw observerError;gate.check();await observe();
}
export async function readGeneratedMetadata(folder,bundlePath=null,{allowPending=false}={}){
  const st=await plainStat(folder,true),loc=await plainStat(path.join(folder,'.localized'),true);
  const expected=['.localized','Icon\r',...(bundlePath?[path.basename(bundlePath)]:[])].sort();
  const names=(await readdir(folder)).sort(),localized=await readdir(path.join(folder,'.localized'));
  if(names.some(n=>!expected.includes(n))||localized.some(n=>n!=='fr.strings'))throw new Blocked('unknown normal-run generated folder content');
  if(JSON.stringify(names)!==JSON.stringify(expected)||localized.join()!=='fr.strings'){if(allowPending)return null;throw new Blocked('missing generated metadata');}
  const language=JSON.parse((await exec('/usr/bin/plutil',['-convert','json','-o','-',path.join(folder,'.localized','fr.strings')],{timeout:3000})).stdout);
  if(JSON.stringify(language)!==JSON.stringify({'Chromium Apps':'Applications Chromium'}))throw new Blocked('unknown generated locale dictionary');
  const files=[];
  for(const relative of ['Icon\r','.localized/fr.strings']){
    const p=path.join(folder,relative),s=await plainStat(p),bytes=await readFile(p);
    if(relative==='Icon\r'&&bytes.length!==0)throw new Blocked('generated icon must have empty data fork');
    files.push({relative,inode:s.ino,birthtimeMs:s.birthtimeMs,uid:s.uid,mode:s.mode&0o777,digest:hash(bytes),attributes:hash((await exec('/usr/bin/xattr',['-l',p],{timeout:3000,maxBuffer:1024*1024})).stdout)});
  }
  return {path:folder,inode:st.ino,birthtimeMs:st.birthtimeMs,uid:st.uid,localizedInode:loc.ino,localizedBirthtimeMs:loc.birthtimeMs,localizedUid:loc.uid,files};
}
export function adoptNormalPostClose(initial,post,{baseline,start,closedAt,uid,observed}){
  if(!initial||!post||!observed||baseline.some(b=>b.path===post.path)||initial.path!==post.path||post.inode!==initial.inode||post.inode!==observed.inode||post.localizedInode!==initial.localizedInode||post.localizedInode!==observed.localizedInode||post.uid!==uid||post.localizedUid!==uid||!Number.isFinite(post.birthtimeMs)||!Number.isFinite(post.localizedBirthtimeMs)||post.birthtimeMs<start||post.localizedBirthtimeMs<start||post.birthtimeMs>closedAt||post.localizedBirthtimeMs>closedAt)throw new Blocked('normal-run generated folder ownership changed');
  if(post.files.length!==2||initial.files.length!==2)throw new Blocked('unknown generated metadata set');
  for(const f of post.files){const original=initial.files.find(x=>x.relative===f.relative);if(!original||!['Icon\r','.localized/fr.strings'].includes(f.relative)||f.digest!==original.digest||f.uid!==uid||f.mode!==0o600||!Number.isFinite(f.birthtimeMs)||f.birthtimeMs<start||f.birthtimeMs>closedAt||!Number.isSafeInteger(f.inode)||typeof f.attributes!=='string'||!/^[a-f0-9]{64}$/.test(f.attributes))throw new Blocked('normal-run post-close metadata differs');}
  return post;
}

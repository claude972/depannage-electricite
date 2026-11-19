import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
const PW=process.env.QA_PLAYWRIGHT_PATH||'/Users/claudebrafa/rea/node_modules/playwright-core';
const CHROME=process.env.QA_CHROMIUM_PATH||'';
const available=existsSync(path.join(PW,'index.mjs'))&&existsSync(CHROME);
const entry=`
import {createElement as h,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {z} from 'zod';
import {useResource} from './apps/mobile/src/lib/api';
const schema=z.object({value:z.string()});
window.pending=[];
window.fetch=(url,init)=>new Promise(resolve=>window.pending.push({init,resolve}));
function Host(){
 const [config,set]=useState({token:'A',actor:'A',interval:40});window.configure=set;
 const result=useResource('/api/messages',schema,config.token,config.actor,config.interval);
 window.result=result;
 return h('div',null,result.data?.value||result.error||'loading');
}
window.root=createRoot(document.body.appendChild(document.createElement('div')));
window.root.render(h(Host));
window.answer=(index,status,value)=>window.pending[index].resolve(new Response(JSON.stringify(status===200?{value}:{error:value}),{status}));
`;
test('native refresh serializes reads, stops timers, clears refused data and fences old accounts', {skip:available?false:'Playwright/Chromium unavailable'},async()=>{
 const result=await build({stdin:{contents:entry,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,platform:'browser',format:'iife',alias:{react:path.resolve('node_modules/react')},plugins:[{name:'native-stubs',setup(b){
  b.onResolve({filter:/^react-native$/},()=>({path:'native',namespace:'stub'}));
  b.onResolve({filter:/^\.\/config$/},a=>a.importer.endsWith('/apps/mobile/src/lib/api.ts')?{path:'config',namespace:'stub'}:undefined);
  b.onLoad({filter:/.*/,namespace:'stub'},a=>({contents:a.path==='native'?"export const AppState={addEventListener:()=>({remove(){}})}":"export const apiOrigin='https://candidate.example'"}));
 }}]});
 const server=createServer((_q,r)=>r.end('<!doctype html><body><script>'+result.outputFiles[0].text+'</script>'));
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 const pw=await import(pathToFileURL(path.join(PW,'index.mjs')).href);
 const browser=await pw.chromium.launch({executablePath:CHROME,headless:true});
 try{
  const page=await browser.newPage();page.setDefaultTimeout(10000);const errors:string[]=[];page.on('pageerror',(e:Error)=>errors.push(e.message));
  await page.goto('http://127.0.0.1:'+(server.address() as {port:number}).port);
  await page.waitForFunction('window.pending?.length===1');
  await page.waitForTimeout(150);
  assert.equal(await page.evaluate('window.pending.length'),1,'slow reads never overlap');
  await page.evaluate("window.answer(0,200,'first')");
  await page.waitForFunction('window.pending.length===2');
  assert.equal(await page.evaluate('window.result.data.value'),'first','visible data remains during background read');
  await page.evaluate("window.answer(1,403,'Accès refusé')");
  await page.waitForFunction('window.result.error');
  assert.equal(await page.evaluate('window.result.data'),null,'a refusal clears private data');
  await page.waitForFunction('window.pending.length===3');
  await page.evaluate("window.configure({token:'B',actor:'B',interval:0})");
  await page.waitForFunction('window.pending.length===4');
  assert.equal(await page.evaluate('window.pending[2].init.signal.aborted'),true);
  await page.evaluate("window.answer(2,200,'late-A');window.answer(3,200,'current-B')");
  await page.waitForFunction("window.result.data?.value==='current-B'");
  await page.waitForTimeout(150);
  assert.equal(await page.evaluate('window.pending.length'),4,'disabled periodic refresh schedules nothing');
  await page.evaluate("window.configure({token:'B',actor:'B',interval:40})");
  await page.waitForFunction('window.pending.length===5');
  await page.evaluate('window.root.unmount()');
  assert.equal(await page.evaluate('window.pending[4].init.signal.aborted'),true);
  await page.evaluate("window.answer(4,200,'after-unmount')");
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate('window.pending.length'),5,'unmount cannot reschedule reads');
  assert.deepEqual(errors,[]);
 }finally{await browser.close();server.close();}
});

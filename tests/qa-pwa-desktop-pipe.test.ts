import test from 'node:test';
import assert from 'node:assert/strict';
import {PassThrough,Writable} from 'node:stream';
// @ts-ignore Existing Node JS module intentionally independent of any browser.
import {createPipeClient,unavailablePwa,verifySameBrowser,bindPwaChannel} from '../scripts/qa-pwa-desktop/pipe.mjs';
// @ts-ignore Same original-promise tracker used by runtime.
import {bounded,createGate,resultStatus} from '../scripts/qa-pwa-desktop/lib.mjs';

function fixture(maxBytes=8192){
  const incoming=new PassThrough();const sent:Buffer[]=[];
  const outgoing=new Writable({write(chunk,_encoding,callback){sent.push(Buffer.from(chunk));callback();}});
  const client=createPipeClient(outgoing,incoming,{maxBytes});
  return {incoming,outgoing,sent,client,reply:(value:unknown)=>incoming.write(`${JSON.stringify(value)}\0`)};
}
test('fragmented UTF8 NUL response resolves exactly once with intact French text',async()=>{
  const f=fixture();const p=f.client.send('Browser.getVersion');
  const wire=Buffer.from(`${JSON.stringify({id:1,result:{product:'Chrome électricité'}})}\0`);
  for(const byte of wire)f.incoming.write(Buffer.from([byte]));
  assert.deepEqual(await p,{product:'Chrome électricité'});assert.equal(f.client.pending,0);
  assert.deepEqual(JSON.parse(Buffer.concat(f.sent).subarray(0,-1).toString()),{id:1,method:'Browser.getVersion',params:{}});f.client.close();
});
test('multiple frames and responses out of order preserve request ownership; events settle nothing',async()=>{
  const f=fixture();const a=f.client.send('PWA.launch'),b=f.client.send('Browser.getVersion');
  f.reply({method:'Target.targetCreated',params:{}});assert.equal(f.client.pending,2);
  f.incoming.write(Buffer.from('{"id":2,"result":{"product":"Chrome"}}\0{"id":1,"result":{"targetId":"owned"}}\0'));
  assert.deepEqual(await a,{targetId:'owned'});assert.deepEqual(await b,{product:'Chrome'});f.client.close();
});
test('protocol errors retain numeric code and method; absent PWA domain is BLOCKED, no fake absent registry',async()=>{
  const f=fixture();const p=f.client.send('PWA.getOsAppState');
  f.reply({id:1,error:{code:-32601,message:"'PWA.getOsAppState' wasn't found"}});
  await assert.rejects(p,(error:any)=>error.code===-32601&&error.method==='PWA.getOsAppState'&&unavailablePwa(error));
  const real=new Error("cdpSession.send: Protocol error (PWA.getOsAppState): 'PWA.getOsAppState' wasn't found");
  assert.equal(unavailablePwa(real),true);
  for(const error of [new Error('Method not found'),new Error("Protocol error (Browser.getVersion): 'Browser.getVersion' wasn't found"),{code:-32601,method:'Browser.getVersion'},{code:-32000,method:'PWA.install',message:'wrong manifest'},new Error("Protocol error (PWA.install): 'PWA.launch' wasn't found")])assert.equal(unavailablePwa(error),false);
  const state={proofs:{},error:{kind:unavailablePwa(real)?'Blocked':'Error'},cleanup:{ok:true}};
  assert.equal(resultStatus(state),'BLOCKED');assert.equal(resultStatus({...state,cleanup:{ok:false}}),'INCOMPLETE');f.client.close();
});
test('unknown response IDs fail closed and reject original pending operations',async()=>{
  const f=fixture();const p=f.client.send('PWA.install');f.reply({id:44,result:{}});
  await assert.rejects(p,/unknown or duplicate/);await assert.rejects(f.client.send('PWA.install'),/unknown or duplicate/);assert.equal(f.sent.length,1);f.client.close();
});
test('duplicate response closes protocol rather than confirming another pending command',async()=>{
  const f=fixture();const first=f.client.send('Browser.getVersion');f.reply({id:1,result:{}});await first;
  const second=f.client.send('PWA.install');f.reply({id:1,result:{}});await assert.rejects(second,/unknown or duplicate/);f.client.close();
});
test('malformed objects, invalid JSON, invalid UTF8, ambiguous payloads never produce success',async()=>{
  for(const wire of ['broken\0','null\0','[]\0','{"id":0,"result":{}}\0','{"id":1,"result":{},"error":{"code":-1,"message":"x"}}\0','{"id":1,"error":null}\0','{"id":1,"result":null}\0','{"id":1,"error":{"code":"bad","message":"x"}}\0',Buffer.from([0xff,0])]){
    const f=fixture();const p=f.client.send('PWA.install');f.incoming.write(wire);await assert.rejects(p);assert.ok(f.client.failure);f.client.close();
  }
});
test('size limit covers terminated and unterminated input and oversized outgoing command',async()=>{
  for(const suffix of ['', '\0']){
    const f=fixture(100);const p=f.client.send('PWA.install');f.incoming.write('x'.repeat(101)+suffix);await assert.rejects(p);f.client.close();
  }
  const f=fixture(100);await assert.rejects(f.client.send('PWA.install',{data:'x'.repeat(101)}),/oversized/);assert.equal(f.sent.length,0);f.client.close();
});
test('EOF during installation rejects unknown, never retries, and leaves caller cleanup responsible',async()=>{
  const f=fixture();const p=f.client.send('PWA.install');f.incoming.end();await assert.rejects(p,/EOF/);assert.equal(f.sent.length,1);f.client.close();
});
test('EPIPE write failure rejects pending without an unhandled stream error',async()=>{
  const incoming=new PassThrough();const outgoing=new Writable({write(_c,_e,callback){callback(Object.assign(new Error('broken pipe'),{code:'EPIPE'}));}});
  const client=createPipeClient(outgoing,incoming);await assert.rejects(client.send('PWA.install'),/broken pipe/);assert.equal(client.pending,0);client.close();
});
test('timeout preserves original pipe request and gate tracking until late response, with no retry',async()=>{
  const f=fixture(),gate=createGate();const p=gate.effect(async()=>{},()=>f.client.send('PWA.install'));
  await assert.rejects(bounded(p,1,'install'),/not cancelled/);gate.stop();assert.equal(f.client.pending,1);assert.equal(await gate.drain(1),1);
  await assert.rejects(gate.effect(async()=>{},()=>f.client.send('PWA.launch')),/stopping/);assert.equal(f.sent.length,1);
  f.reply({id:1,result:{}});await p;assert.equal(await gate.drain(1),0);assert.equal(f.client.pending,0);f.client.close();
});
test('same browser verification requires exact PID plus every version field before PWA effects',()=>{
  const v={product:'Chrome/156.0.8078.4',revision:'same',protocolVersion:'1.3',jsVersion:'v8',userAgent:'ua'};
  const list=[{id:123,type:'browser'},{id:124,type:'renderer'}];assert.equal(verifySameBrowser(v,v,list,123),true);
  assert.throws(()=>verifySameBrowser({...v,revision:'other'},v,list,123),/version mismatch/);
  assert.throws(()=>verifySameBrowser(v,v,list,999),/PID/);
  assert.throws(()=>verifySameBrowser(v,v,[...list,{id:456,type:'browser'}],123),/PID/);
  assert.throws(()=>verifySameBrowser({},v,list,123),/version/);
});
test('bound runtime channel routes PWA commands exclusively to verified inherited pipe',async()=>{
  const calls:string[]=[];const pipe={send:async(method:string)=>{calls.push(method);return {};}};
  const v={product:'Chrome',revision:'same',protocolVersion:'1.3',jsVersion:'v8',userAgent:'ua'};
  assert.throws(()=>bindPwaChannel(pipe,v,v,[{id:999,type:'browser'}],123),/PID/);assert.deepEqual(calls,[]);
  const channel=bindPwaChannel(pipe,v,v,[{id:123,type:'browser'}],123);
  for(const method of ['PWA.getOsAppState','PWA.install','PWA.changeAppUserSettings','PWA.launch','PWA.uninstall'])await channel.send(method,{});
  assert.deepEqual(calls,['PWA.getOsAppState','PWA.install','PWA.changeAppUserSettings','PWA.launch','PWA.uninstall']);
  await assert.rejects(channel.send('Page.getAppManifest',{}),/other domains/);assert.equal(calls.length,5);
});

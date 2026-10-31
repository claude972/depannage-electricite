// Chromium 156.0.8078.4 DevToolsPipeHandler: UTF-8 JSON frames terminated by NUL.
// Only inherited streams of our owned spawn; no sockets, reconnect, timeout, or retry here.
export function createPipeClient(writeStream, readStream, {maxBytes=8*1024*1024}={}) {
  if (!writeStream?.write || !readStream?.on || !Number.isInteger(maxBytes) || maxBytes<1) throw new Error('invalid inherited pipe streams');
  let nextId=0, buffer=Buffer.alloc(0), failure=null;
  const pending=new Map();
  const fail=error=>{
    if(failure)return;
    failure=error instanceof Error?error:new Error(String(error));buffer=Buffer.alloc(0);
    for(const item of pending.values())item.reject(failure);
    pending.clear();
  };
  function frame(bytes) {
    if(bytes.length===0||bytes.length>maxBytes)throw new Error('invalid CDP frame size');
    const parsed=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
    if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw new Error('invalid CDP frame object');
    if(!Object.hasOwn(parsed,'id')) {
      if(typeof parsed.method!=='string'||!parsed.method)throw new Error('invalid CDP event');
      return; // Browser events are not commands and cannot settle any request.
    }
    if(!Number.isSafeInteger(parsed.id)||parsed.id<=0)throw new Error('invalid CDP response ID');
    const item=pending.get(parsed.id);
    if(!item)throw new Error('unknown or duplicate CDP response ID');
    const hasError=Object.hasOwn(parsed,'error');
    if(Object.hasOwn(parsed,'result')===hasError)throw new Error('ambiguous CDP response');
    if(hasError && (!parsed.error||typeof parsed.error!=='object'||!Number.isInteger(parsed.error.code)||typeof parsed.error.message!=='string'))throw new Error('invalid CDP protocol error');
    if(!hasError && (!parsed.result||typeof parsed.result!=='object'||Array.isArray(parsed.result)))throw new Error('invalid CDP result');
    pending.delete(parsed.id);
    if(hasError){
      const e=new Error(`Protocol error (${item.method}): ${parsed.error.message}`);
      e.code=parsed.error.code;e.method=item.method;item.reject(e);
    }else item.resolve(parsed.result);
  }
  const onData=chunk=>{
    if(failure)return;
    try{
      buffer=Buffer.concat([buffer,Buffer.from(chunk)]);
      for(let end;(end=buffer.indexOf(0))!==-1;){
        const bytes=buffer.subarray(0,end);buffer=buffer.subarray(end+1);frame(bytes);
      }
      if(buffer.length>maxBytes)throw new Error('oversized unterminated CDP frame');
    }catch(e){fail(e);}
  };
  const onEnd=()=>fail(new Error('CDP pipe EOF; pending outcome unknown'));
  const onError=e=>fail(e);
  readStream.on('data',onData);readStream.on('end',onEnd);readStream.on('close',onEnd);readStream.on('error',onError);
  writeStream.on('error',onError);writeStream.on('close',onEnd);
  return {
    get pending(){return pending.size;},
    get failure(){return failure;},
    send(method,params={}){
      if(failure)return Promise.reject(failure);
      if(typeof method!=='string'||!method||!params||typeof params!=='object'||Array.isArray(params))return Promise.reject(new Error('invalid CDP command'));
      const id=++nextId;if(!Number.isSafeInteger(id))return Promise.reject(new Error('CDP ID exhausted'));
      let body;try{body=JSON.stringify({id,method,params});}catch(e){return Promise.reject(e);}
      if(Buffer.byteLength(body)>maxBytes)return Promise.reject(new Error('oversized CDP command'));
      return new Promise((resolve,reject)=>{
        pending.set(id,{method,resolve,reject});
        try{writeStream.write(`${body}\0`,error=>{if(error)fail(error);});}catch(e){fail(e);}
      });
    },
    close(){
      fail(new Error('CDP pipe closed by owner'));
      readStream.removeListener('data',onData);
      // Retain error handlers while stream destruction completes: no unhandled EPIPE.
      writeStream.end();readStream.destroy();
    },
  };
}

export function unavailablePwa(error) {
  if(error?.code===-32601 && /^PWA\.[A-Za-z]+$/.test(error?.method||''))return true;
  // Exact real Playwright error observed in b5f, not a generic "not found" matcher.
  return /Protocol error \((PWA\.[A-Za-z]+)\): '\1' wasn't found/.test(String(error?.message));
}

export function verifySameBrowser(pipeVersion,websocketVersion,processes,ownedPid) {
  for(const key of ['product','revision','protocolVersion','jsVersion','userAgent']) {
    if(typeof pipeVersion?.[key]!=='string'||pipeVersion[key]!==websocketVersion?.[key])throw new Error('pipe/WebSocket browser version mismatch');
  }
  const browser=processes?.filter(p=>p.type==='browser');
  if(browser?.length!==1||browser[0].id!==ownedPid)throw new Error('pipe browser PID is not the owned spawn');
  return true;
}
export function bindPwaChannel(pipe,pipeVersion,websocketVersion,processes,ownedPid) {
  verifySameBrowser(pipeVersion,websocketVersion,processes,ownedPid);
  return {send(method,params){
    if(!/^PWA\.[A-Za-z]+$/.test(method))return Promise.reject(new Error('PWA channel refuses other domains'));
    return pipe.send(method,params);
  }};
}

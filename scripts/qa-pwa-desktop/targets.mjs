import {Blocked} from './lib.mjs';
export function targetDiagnostic(info,window){
  let url=null;try{const u=new URL(info.url);if(['http:','https:'].includes(u.protocol))url=(u.origin+u.pathname).slice(0,500);}catch{}
  return {targetId:info.targetId,type:info.type,subtype:info.subtype??null,parentId:info.parentId??null,openerId:info.openerId??null,browserContextId:info.browserContextId??null,windowId:window?.windowId??null,url};
}
export function selectLaunchedPage(launch,candidates){
  if(!['tab','page'].includes(launch.type)||!launch.targetId||!Number.isInteger(launch.windowId))throw new Blocked('launch returned unsupported target/window');
  const matching=candidates.filter(c=>c.type==='page'&&!c.subtype&&c.windowId===launch.windowId&&(launch.type!=='page'||c.targetId===launch.targetId));
  if(matching.some(c=>launch.browserContextId&&c.browserContextId&&launch.browserContextId!==c.browserContextId))throw new Blocked('launch/page browser context contradiction');
  if(matching.length>1)throw new Blocked('launch page ambiguous in returned window');
  return matching[0]??null;
}

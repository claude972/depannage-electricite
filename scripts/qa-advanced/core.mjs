import { mkdir, writeFile, rename, readFile, stat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const exec = promisify(execFile);
export async function gitSha(dir) {const {stdout}=await exec('git',['-C',dir,'rev-parse','HEAD']);const sha=stdout.trim();if(!/^[a-f0-9]{40}$/.test(sha))throw Error('invalid Git revision');return sha;}
// PostgREST maps the SQL NO_DATA_FOUND exception to HTTP500. Unlike an upstream
// failure, this structured SQL error proves the transaction was rolled back.
// Keep this allowlist narrow: do not infer rollback from a plain "500" or message text.
export function definiteMissingRow(body) { return Boolean(body && typeof body==='object' && !Array.isArray(body) && body.code==='P0002' && typeof body.message==='string' && body.message.length>0); }
export function isPostgrestEndpoint(endpoint) { return typeof endpoint==='string' && /^\/rest\/v1\/(?:rpc\/[a-z][a-z0-9_]*|[a-z][a-z0-9_]*)(?:\?[^#]*)?$/.test(endpoint); }
export function uncertainResponse(method,status,body=null,endpoint='') { return !['GET','HEAD','OPTIONS'].includes(method) && status>=500 && !(status===500 && isPostgrestEndpoint(endpoint) && definiteMissingRow(body)); }
export function planningOwnershipRefused(result) { return result.status===403 || (result.status===404 && /^\/api\/planning(?:[/?]|$)/.test(result.endpoint||'')) || (result.status===500 && isPostgrestEndpoint(result.endpoint) && definiteMissingRow(result.body)); }
// Keep the shared launcher and its configured executable/timeout, but prevent an older
// launcher from letting Playwright exit the process before our stop/drain/cleanup.
export function withoutPlaywrightSignals(pw) {return {chromium:{launch:options=>pw.chromium.launch({...options,handleSIGINT:false,handleSIGTERM:false,handleSIGHUP:false})}};}
export function installInterruptHandlers(proc,{stop,finish,onInterrupted,onError}) {
  let requested=false;
  const handler=()=>{onInterrupted();stop();if(requested)return;requested=true;void Promise.resolve().then(finish).catch(onError);};
  proc.on('SIGINT',handler);proc.on('SIGTERM',handler);
  return ()=>{proc.off('SIGINT',handler);proc.off('SIGTERM',handler);};
}
export function parseArgs(argv) {
  const o = { suite: 'all', timeoutMs: 120000, allowed: [] };
  const flags = { '--base-url':'baseUrl', '--sha':'sha', '--app-dir':'appDir', '--project':'project', '--credentials':'credentials', '--out':'out', '--suite':'suite', '--playwright-path':'playwrightPath', '--chromium-path':'chromiumPath', '--cleanup-manifest':'cleanupManifest', '--timeout-ms':'timeoutMs' };
  const seen = new Set();
  for (let i=0;i<argv.length;i++) {
    const a=argv[i];
    if (a==='--help') { o.help=true; continue; }
    if (a==='--dry-run') { o.dryRun=true; continue; }
    if (a==='--allow-base-url') { if (!argv[i+1] || argv[i+1].startsWith('--')) throw Error('missing allowlist origin'); o.allowed.push(argv[++i]); continue; }
    if (!flags[a] || seen.has(a) || !argv[i+1] || argv[i+1].startsWith('--')) throw Error('unknown, duplicate or incomplete flag: '+a);
    seen.add(a);o[flags[a]]=argv[++i];
  }
  if (o.help) return o;
  for (const k of ['project','credentials','out',...(o.cleanupManifest?[]:['baseUrl','sha','appDir'])]) if (!o[k]) throw Error('missing '+k);
  if (!/^[a-z0-9]{20}$/.test(o.project)) throw Error('invalid project');
  if (!o.cleanupManifest && !/^[a-f0-9]{40}$/.test(o.sha)) throw Error('full git SHA required');
  if (!['all','api','browser'].includes(o.suite)) throw Error('invalid suite');
  if (o.dryRun && o.cleanupManifest) throw Error('dry-run and cleanup are exclusive');
  o.timeoutMs=Number(o.timeoutMs);if (!Number.isInteger(o.timeoutMs) || o.timeoutMs<1000 || o.timeoutMs>300000) throw Error('timeout must be 1000..300000ms');
  return o;
}
export async function preflight(o) {
  const info=await stat(o.credentials);if (!info.isFile() || (info.mode&0o077)) throw Error('credentials must be a private0600 file');
  const c=JSON.parse(await readFile(o.credentials,'utf8'));const s=c.supabase;
  if (!s || s.project_ref!==o.project || s.url!==`https://${o.project}.supabase.co` || ![s.publishable_key,s.service_role_key].every(v=>typeof v==='string' && v.length>=20)) throw Error('credentials project, origin or keys mismatch');
  if (!o.cleanupManifest) {
    const u=new URL(o.baseUrl);const local=['localhost','127.0.0.1','[::1]'].includes(u.hostname);
    if (u.username || u.password || u.search || u.hash || u.pathname!=='/' || !['http:','https:'].includes(u.protocol)) throw Error('base-url must be a plain origin');
    const allow=[...o.allowed,...(c.allowed_base_urls||[])];
    if (!local && !(u.protocol==='https:' && allow.includes(u.origin))) throw Error('remote base-url requires exact allowlist');
    o.baseUrl=u.origin;o.target=local?'local':'remote-allowed';
    if (await gitSha(o.appDir)!==o.sha) throw Error('served checkout SHA mismatch');
  }
  // Walk to an existing ancestor, including symlinks, before checking Git ancestry.
  let ancestor=path.resolve(o.out);
  for (;;) { try { ancestor=await realpath(ancestor);break; } catch { const p=path.dirname(ancestor);if (p===ancestor) throw Error('no output ancestor');ancestor=p; } }
  try { const {stdout}=await exec('git',['-C',ancestor,'rev-parse','--show-toplevel']);if (stdout.trim()) throw Error('output must be outside Git'); } catch(e) { if (e.message==='output must be outside Git') throw e; if (!e.code) throw e; }
  return c;
}
export async function atomicJson(file,value) {
  await mkdir(path.dirname(file),{recursive:true,mode:0o700});const tmp=file+'.'+randomUUID()+'.tmp';
  await writeFile(tmp,JSON.stringify(value,null,2)+'\n',{mode:0o600});await rename(tmp,file);
}
export function exactCount(status,contentRange) {
  const m=typeof contentRange==='string'?/\/(\d+)$/.exec(contentRange):null;
  const n=m?Number(m[1]):NaN;
  if(![200,206].includes(status) || !Number.isSafeInteger(n) || n<0)throw Error('exact count unavailable');return n;
}
export function emptyManifest(project,sha,runId) { return { version:1, project, sha, runId, created:{users:[],organizations:[],sites:[],interventions:[],tickets:[]}, intents:[], uncertain:[] }; }
export function validateManifest(m,project) {
  if (!m || m.version!==1 || m.project!==project || !/^[a-f0-9]{12}$/.test(m.runId) || !m.created || !Array.isArray(m.intents) || !Array.isArray(m.uncertain)) throw Error('invalid or foreign manifest');
  const keys=['users','organizations','sites','interventions','tickets'];
  if (Object.keys(m.created).some(k=>!keys.includes(k))) throw Error('unknown manifest collection');
  for (const k of keys) if (!Array.isArray(m.created[k]) || !m.created[k].every(x=>typeof x==='string' && UUID.test(x))) throw Error('invalid manifest IDs');
  for (const i of m.intents) if (!i || typeof i.id!=='string' || typeof i.done!=='boolean' || typeof i.label!=='string') throw Error('invalid manifest intent');
  return m;
}
export class Registry {
  constructor(file,m) { this.file=file;this.m=m;this.queue=Promise.resolve(); }
  save() { const next=this.queue.then(()=>atomicJson(this.file,this.m));this.queue=next.catch(()=>{});return next; }
  async track(k,id) { if (!Object.hasOwn(this.m.created,k) || !UUID.test(id)) throw Error('invalid tracked ID');if (!this.m.created[k].includes(id)) this.m.created[k].push(id);await this.save();return id; }
  async intent(label) { const x={id:randomUUID(),label,done:false};this.m.intents.push(x);await this.save();return x; }
  async done(x) { x.done=true;await this.save(); }
  async uncertain(x) { if (!this.m.uncertain.includes(x.id)) this.m.uncertain.push(x.id);await this.save(); }
}
export class Gate {
  constructor() { this.stopped=false;this.pending=new Set(); }
  check() { if(this.stopped) throw Error('run stopping'); }
  stop() { this.stopped=true; }
  run(fn) { this.check();const p=Promise.resolve().then(fn);this.pending.add(p);p.then(()=>this.pending.delete(p),()=>this.pending.delete(p));return p; }
  async drain(ms) { if (!this.pending.size) return true;let timer;const done=await Promise.race([Promise.allSettled([...this.pending]).then(()=>true),new Promise(r=>{timer=setTimeout(()=>r(false),ms);})]);clearTimeout(timer);return done; }
}
export async function mutate(gate,registry,label,fn) {
  return gate.run(async()=>{ const intent=await registry.intent(label);try { const result=await fn();await registry.done(intent);return result; } catch(e) { if (e.remoteUnknown) await registry.uncertain(intent);else await registry.done(intent);throw e; } });
}
const filter=(key,ids)=>({[key]:`in.(${ids.join(',')})`});
export function cleanupPlan(m) {
  validateManifest(m,m.project);const c=m.created,steps=[];
  const add=(table,key,ids)=>{if(ids.length)steps.push({table,filter:filter(key,ids)});};
  add('notifications','recipient_id',c.users);add('notification_preferences','user_id',c.users);
  add('artisan_planning_entries','artisan_id',c.users);add('artisan_availability_rules','artisan_id',c.users);
  add('support_events','ticket_id',c.tickets);add('support_messages','ticket_id',c.tickets);add('support_tickets','id',c.tickets);
  for(const t of ['audit_log','messages','intervention_operation_events','intervention_appointments','intervention_reports','mission_declines','quote_drafts'])add(t,'intervention_id',c.interventions);
  add('interventions','id',c.interventions);
  for(const t of ['organization_membership_events','organization_invitations','organization_member_site_grants','organization_member_site_scopes','organization_members','professional_audit'])add(t,'organization_id',c.organizations);
  add('sites','id',c.sites);add('organizations','id',c.organizations);
  add('audit_log','actor_id',c.users);add('professional_audit','actor_id',c.users);add('action_limits','actor_id',c.users);add('artisan_profiles','user_id',c.users);
  return steps;
}
export async function cleanup(db,registry) {
  const m=registry.m,entries=[];
  // Unknown remote outcomes cannot be settled by a timer or by deleting the account.
  if (m.uncertain.length || m.intents.some(i=>!i.done)) return {ok:false,entries,reason:'remote outcome unknown; preserve manifest and reconcile operator-side before cleanup'};
  try {
    if(m.created.users.length) {
      const owned=[['interventions','client_id','interventions'],['organizations','owner_id','organizations'],['support_tickets','creator_id','tickets']];
      for(const [table,column,key] of owned) {
        const rows=await db.select(table,filter(column,m.created.users),'id');
        if(!Array.isArray(rows))throw Error('cohort discovery unavailable');
        for(const r of rows)await registry.track(key,r.id);
      }
      if(m.created.organizations.length) {
        const sites=await db.select('sites',filter('organization_id',m.created.organizations),'id');
        if(!Array.isArray(sites))throw Error('site discovery unavailable');
        for(const r of sites)await registry.track('sites',r.id);
      }
    }
  } catch(e) {return {ok:false,entries,reason:'cohort discovery failed: '+e.message};}
  for(const s of cleanupPlan(m)) {
    try { await db.delete(s.table,s.filter);const n=await db.count(s.table,s.filter);if(n!==0)throw Error('readback not zero');entries.push({...s,ok:true,remaining:0}); }
    catch(e) { entries.push({...s,ok:false,error:e.message}); }
  }
  // Preserve Auth when a child could not be removed; this retains recoverable ownership.
  if(entries.every(s=>s.ok)) for(const id of m.created.users) {
    try {await db.deleteAuthUser(id);if(await db.authUserExists(id))throw Error('Auth still present');if(await db.count('profiles',{id:`eq.${id}`}))throw Error('profile still present');entries.push({auth:id,ok:true});}
    catch(e){entries.push({auth:id,ok:false,error:e.message});}
  }
  return {ok:entries.every(e=>e.ok),entries};
}
export function assertRace(results,{requireOverlap=false}={}) {
  const winner=results.findIndex(r=>r.status===200);const successes=results.filter(r=>r.status===200).length;
  const conflicts=results.filter(r=>r.status===409 || (r.status===400 && r.body?.code==='P0001')).length;
  if(results.length!==2 || successes!==1 || conflicts!==1)throw Error('expected exactly one commit and one conflict');
  if(requireOverlap) {
    const [a,b]=results.map(r=>r.timing);
    if(!a || !b || ![a.start,a.end,b.start,b.end].every(Number.isFinite) || Math.max(a.start,b.start)>=Math.min(a.end,b.end))throw Error('HTTP requests did not overlap; concurrency criterion not exercised');
  }
  return winner;
}
export function finalCode(result) { if(result.cleanup?.ok===false)return 3;return result.interrupted || (!result.steps.length && result.mode!=='cleanup') || result.steps.some(s=>s.status!=='PASS')?1:0; }

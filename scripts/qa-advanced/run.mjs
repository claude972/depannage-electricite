#!/usr/bin/env node
// Explicit executable only. Importing core.mjs never runs a cloud request.
import { readFile, mkdir, chmod } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { createRedactor } from '../qa/lib/redact.mjs';
import { createCohort, newPassword, newRunId } from '../qa/lib/cohort.mjs';
import { parseArgs,preflight,gitSha,uncertainResponse,atomicJson,exactCount,Registry,emptyManifest,validateManifest,Gate,mutate,cleanup,finalCode } from './core.mjs';

const usage='node scripts/qa-advanced/run.mjs --base-url <origin> --sha <40hex> --app-dir <served-checkout> --project <ref> --credentials <private0600.json> --out <outside-git> [--suite api|browser|all] [--dry-run]\ncleanup: --cleanup-manifest <manifest.json> --project <ref> --credentials <private0600.json> --out <outside-git>';
async function main() {
  let o,c;
  try {
    o=parseArgs(process.argv.slice(2));if(o.help){console.log(usage);return 0;}c=await preflight(o);
    if(!o.cleanupManifest && o.suite!=='api')await (await import('../qa/lib/browser.mjs')).loadPlaywright(o.playwrightPath||process.env.QA_PLAYWRIGHT_PATH);
  }
  catch {console.error('Preflight refused. Check flags, credentials0600, exact project/origin, served SHA and output outside Git.');return 2;}
  if(o.dryRun){console.log(JSON.stringify({dry_run:true,sha:o.sha,sha_verified:true,project:o.project,target:o.target,suite:o.suite,network:false}));return 0;}
  await mkdir(o.out,{recursive:true,mode:0o700});await chmod(o.out,0o700);
  const harnessSha=await gitSha(fileURLToPath(new URL('../../',import.meta.url)));
  const sb=c.supabase,redactor=createRedactor([sb.service_role_key,sb.publishable_key]);
  const m=o.cleanupManifest?validateManifest(JSON.parse(await readFile(o.cleanupManifest,'utf8')),o.project):emptyManifest(o.project,o.sha,newRunId());
  m.harness_sha??=harnessSha;
  const registry=new Registry(path.join(o.out,'manifest.json'),m);await registry.save();
  const gate=new Gate(),cohort=createCohort(m.runId);
  const result={sha:m.sha,harness_sha:harnessSha,manifest_harness_sha:m.harness_sha,project:o.project,target:o.target||'cleanup-only',mode:o.cleanupManifest?'cleanup':'run',suite:o.suite,started_at:new Date().toISOString(),steps:[],requests:[],interrupted:false,cleanup:null,non_proofs:['No Vercel deployment, Stripe, OS PWA or native device test.','RPC races use concurrent real HTTP requests; PGlite is not used.','Support notifications are service-seeded fixtures with actor_id null. This tests access/revocation, not operator-trigger generation. No admin profile is created.']};
  let finalizing=null,browser=null,activeStep='startup';
  const save=()=>atomicJson(path.join(o.out,'result.json'),redactor.redact(result));
  const record=async(name,status,detail='')=>{result.steps.push({name,status,detail:redactor.redactString(detail)});console.log(`${status}: ${name}`);await save();};
  const request=async(actor,method,endpoint,body)=>{
    const base=endpoint.startsWith('/api/')?o.baseUrl:sb.url;
    const key=actor==='service'?sb.service_role_key:sb.publishable_key;
    const headers={apikey:key,'Content-Type':'application/json'};
    if(actor==='service')headers.Authorization=`Bearer ${sb.service_role_key}`;
    else if(actor?.token)headers.Authorization=`Bearer ${actor.token}`;
    const trace={method,path:new URL(endpoint,base).pathname,actor:actor==='service'?'fixture-service':actor?.label||'anonymous',started_at:new Date().toISOString(),finished_at:null,status:0};result.requests.push(trace);
    let r,text;
    try {r=await fetch(base+endpoint,{method,headers,body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(o.timeoutMs),redirect:'error'});text=await r.text();trace.status=r.status;trace.finished_at=new Date().toISOString();}
    catch {trace.finished_at=new Date().toISOString();const e=Error('HTTP transport outcome unknown');e.remoteUnknown=method!=='GET'&&method!=='HEAD';throw e;}
    let parsed=null;try {parsed=text?JSON.parse(text):null;}catch {if(r.ok && method!=='GET'&&method!=='HEAD'){const e=Error('Mutation reply unreadable');e.remoteUnknown=true;throw e;}}
    if(uncertainResponse(method,r.status,parsed)){const e=Error('Mutation upstream failure; remote commit unknown');e.remoteUnknown=true;throw e;}
    if(r.status===500 && parsed?.code==='P0002')trace.rollback_code='P0002';
    return {status:r.status,body:parsed,headers:r.headers,timing:{start:Date.parse(trace.started_at),end:Date.parse(trace.finished_at)}};
  };
  const change=(label,actor,method,endpoint,body)=>mutate(gate,registry,label,()=>request(actor,method,endpoint,body));
  const rpc=(actor,name,args)=>change('rpc:'+name,actor,'POST','/rest/v1/rpc/'+name,args);
  const ok=(r,status=200)=>{if(r.status>=200 && r.status<300 && r.status!==status){const e=Error('unexpected success reply; verify remote outcome');e.remoteUnknown=true;throw e;}assert.equal(r.status,status,'unexpected HTTP status');return r.body;};
  const select=async(table,filters={},columns='id')=>{
    const q=new URLSearchParams({select:columns,...filters,limit:'1000'});
    // Exact count distinguishes an empty result from truncation or malformed provider output.
    const r=await fetch(sb.url+'/rest/v1/'+table+'?'+q,{headers:{apikey:sb.service_role_key,Authorization:`Bearer ${sb.service_role_key}`,Prefer:'count=exact'},signal:AbortSignal.timeout(o.timeoutMs)});
    const rows=await r.json();const total=exactCount(r.status,r.headers.get('content-range'));
    if(!Array.isArray(rows) || total!==rows.length)throw Error('cohort read unavailable or truncated: '+table);return rows;
  };
  const db={select,async count(table,filters){
    const q=new URLSearchParams({select:'*',...filters});
    const r=await fetch(sb.url+'/rest/v1/'+table+'?'+q,{method:'HEAD',headers:{apikey:sb.service_role_key,Authorization:`Bearer ${sb.service_role_key}`,Prefer:'count=exact'},signal:AbortSignal.timeout(o.timeoutMs)});
    return exactCount(r.status,r.headers.get('content-range'));
  },async delete(table,filters){const q=new URLSearchParams(filters);if(!q.size)throw Error('unfiltered delete refused');const r=await request('service','DELETE','/rest/v1/'+table+'?'+q);if(r.status>=300)throw Error('delete refused: '+table);},async deleteAuthUser(id){const r=await request('service','DELETE','/auth/v1/admin/users/'+id);if(![200,204,404].includes(r.status))throw Error('Auth delete refused');},async authUserExists(id){const r=await request('service','GET','/auth/v1/admin/users/'+id);if(r.status===404)return false;if(r.status!==200 || r.body?.id!==id)throw Error('Auth readback unknown');return true;}};
  async function finish() {
    if(finalizing)return finalizing;
    gate.stop();finalizing=(async()=>{
      if(browser){await browser.close().catch(()=>{});browser=null;}
      const drained=await gate.drain(o.timeoutMs+1000);
      try {result.cleanup=drained?await cleanup(db,registry):{ok:false,reason:'writes still in flight; no deletion performed'};}
      catch {result.cleanup={ok:false,reason:'cleanup failed; preserve manifest and inspect private evidence'};}
      await atomicJson(path.join(o.out,'cleanup.json'),redactor.redact(result.cleanup));
      result.finished_at=new Date().toISOString();result.exit_code=finalCode(result);await save();
      const text=['# Advanced planning / notifications QA',`SHA ${result.sha}; project ${o.project}; ${result.target}.`,...result.steps.map(s=>`${s.status} — ${s.name}: ${s.detail}`),`Cleanup: ${result.cleanup.ok?'PASS':'INCOMPLETE'}`, ...result.non_proofs].join('\n\n');
      await import('node:fs/promises').then(fs=>fs.writeFile(path.join(o.out,'summary.md'),redactor.redactString(text),{mode:0o600}));
      return result.exit_code;
    })();return finalizing;
  }
  const interrupt=()=>{result.interrupted=true;gate.stop();};
  const fatal=(error)=>{result.interrupted=true;gate.stop();result.steps.push({name:'fatal:'+activeStep,status:'FAIL',detail:redactor.redactError(error).message});void finish().then(code=>{process.exitCode=code;}).catch(()=>{process.exitCode=3;});};
  process.on('SIGINT',interrupt);process.on('SIGTERM',interrupt);process.on('unhandledRejection',fatal);process.on('uncaughtException',fatal);
  const step=async(name,fn)=>{gate.check();activeStep=name;await fn();await record(name,'PASS');};
  async function user(label,role){
    const password=newPassword(),email=cohort.email(label);redactor.add(password);
    const u=await mutate(gate,registry,'Auth create '+email,async()=>{const r=await request('service','POST','/auth/v1/admin/users',{email,password,email_confirm:true,user_metadata:{full_name:cohort.fullName(label),role}});const b=[200,201].includes(r.status)?r.body:ok(r);if(!b?.id){const e=Error('Auth creation missing ID');e.remoteUnknown=true;throw e;}await registry.track('users',b.id);return {id:b.id,email,password,role,label};});
    ok(await change('profile:'+label,'service','PATCH','/rest/v1/profiles?id=eq.'+u.id,{role,artisan_approved:role==='artisan'}),204);
    if(role==='artisan')ok(await change('artisan:'+label,'service','POST','/rest/v1/artisan_profiles',{user_id:u.id,company_name:cohort.name(label),available:true,application_status:'approved',postal_codes:['97200'],categories:['outage']}),201);
    await token(u);return u;
  }
  async function token(u){const b=ok(await change('session:'+u.label,null,'POST','/auth/v1/token?grant_type=password',{email:u.email,password:u.password}),200);if(!b?.access_token)throw Error('missing user token');redactor.add(b.access_token);redactor.add(b.refresh_token);u.token=b.access_token;return {...u};}
  const users={};
  try {
    if(!o.cleanupManifest){
      await step('preflight: API anonymous refused / migration016 available',async()=>{assert.equal((await request(null,'GET','/api/planning')).status,401);await db.count('artisan_planning_entries',{artisan_id:'eq.00000000-0000-4000-8000-000000000000'});});
      await step('seed isolated cohort (no admin role)',async()=>{for(const [label,role] of [['artisan','artisan'],['other','artisan'],['client','client'],['owner','manager'],['delegate','manager'],['fresh','client']])users[label]=await user(label,role);});
      const ctx={o,sb,registry,gate,cohort,users,rpc,request,change,ok,db,token,step,setBrowser:b=>{browser=b;},redactor};
      if(o.suite!=='browser')await (await import('./scenarios.mjs')).apiScenarios(ctx);
      if(o.suite!=='api')await (await import('./scenarios.mjs')).browserScenarios(ctx);
    }
  }catch(e){await record(activeStep,'FAIL',redactor.redactError(e).message);}
  finally {
    const code=await finish();process.off('SIGINT',interrupt);process.off('SIGTERM',interrupt);process.off('unhandledRejection',fatal);process.off('uncaughtException',fatal);return code;
  }
}
main().then(code=>{process.exitCode=code;}).catch(()=>{console.error('Runner failed; preserve the private manifest and run --cleanup-manifest after checking unknown operations.');process.exitCode=3;});

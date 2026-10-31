import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { assertRace, mutate, uncertainResponse, planningOwnershipRefused } from './core.mjs';

export async function apiScenarios(ctx) {
  const {users:u,rpc,ok,request,change,registry,cohort,db,token,step}=ctx;
  const day=new Date(Date.now()+3*86400000);day.setUTCHours(16,0,0,0);
  const from=new Date(+day-12*3600000).toISOString(),to=new Date(+day+7*86400000).toISOString();
  ctx.range={from,to};
  const rule={p_request_id:randomUUID(),p_id:null,p_weekday:day.getUTCDay()||7,p_start_minute:540,p_end_minute:1080,p_time_zone:'America/Martinique',p_valid_from:day.toISOString().slice(0,10),p_valid_until:null,p_expected_version:null};
  let ruleRow;
  await step('planning: private recurrence, idempotent replay and stale version',async()=>{
    const first=ok(await rpc(u.artisan,'save_availability_rule',rule));assert.equal(first.replayed,false);ruleRow=first.rule;assert.ok(ruleRow?.id);
    const replay=ok(await rpc(u.artisan,'save_availability_rule',rule));assert.equal(replay.replayed,true);assert.equal(replay.rule.id,ruleRow.id);
    assert.equal((await db.select('artisan_availability_rules',{artisan_id:`eq.${u.artisan.id}`})).length,1);
    assert.equal((await request(u.other,'GET',`/rest/v1/artisan_availability_rules?id=eq.${ruleRow.id}&select=id`)).body?.length,0);
    const denied=await rpc(u.client,'artisan_planning',{p_from:from,p_to:to});assert.equal(denied.status,403);
    assert.equal((await rpc(u.client,'save_availability_rule',{...rule,p_request_id:randomUUID()})).status,403);
    const wrong=await rpc(u.other,'delete_availability_rule',{p_id:ruleRow.id,p_expected_version:ruleRow.version});assert.ok(planningOwnershipRefused(wrong));
    const changed=ok(await rpc(u.artisan,'save_availability_rule',{...rule,p_id:ruleRow.id,p_request_id:randomUUID(),p_expected_version:ruleRow.version,p_start_minute:600}));assert.equal(changed.rule.version,2);
    const stale=await rpc(u.artisan,'save_availability_rule',{...rule,p_id:ruleRow.id,p_request_id:randomUUID(),p_expected_version:1});assert.equal(stale.body?.code,'P0001');
    const view=ok(await rpc(u.artisan,'artisan_planning',{p_from:from,p_to:to}));assert.equal(view.rules.length,1);assert.ok(view.free.length>0);
  });
  const entry=(id,title)=>({p_request_id:id,p_id:null,p_kind:'busy',p_starts_at:day.toISOString(),p_ends_at:new Date(+day+3600000).toISOString(),p_title:title,p_note:cohort.name('private note'),p_expected_version:null});
  await step('planning: true simultaneous overlapping HTTP RPC requests, one commit',async()=>{
    const second=await token({...u.artisan});
    const bodies=[entry(randomUUID(),cohort.name('race A')),entry(randomUUID(),cohort.name('race B'))];
    const results=await Promise.all([rpc(u.artisan,'save_planning_entry',bodies[0]),rpc(second,'save_planning_entry',bodies[1])]);const winner=assertRace(results,{requireOverlap:true});
    const rows=await db.select('artisan_planning_entries',{artisan_id:`eq.${u.artisan.id}`},'id,title,version');assert.equal(rows.length,1);assert.equal(rows[0].title,bodies[winner].p_title);
    const replay=ok(await rpc(u.artisan,'save_planning_entry',bodies[winner]));assert.equal(replay.replayed,true);assert.equal(replay.entry.id,rows[0].id);
    const notMine=await rpc(u.other,'delete_planning_entry',{p_id:rows[0].id,p_expected_version:1});assert.ok(planningOwnershipRefused(notMine));
    ctx.busy=rows[0];
  });
  await step('planning: exception changes availability; suspended artisan read-only',async()=>{
    const before=ok(await rpc(u.artisan,'artisan_planning',{p_from:from,p_to:to}));
    ok(await rpc(u.artisan,'save_planning_entry',{...entry(randomUUID(),cohort.name('leave')),p_kind:'unavailable',p_starts_at:new Date(+day-3600000).toISOString(),p_ends_at:new Date(+day+3*3600000).toISOString()}));
    const after=ok(await rpc(u.artisan,'artisan_planning',{p_from:from,p_to:to}));assert.notDeepEqual(after.free,before.free);
    ok(await change('suspend cohort artisan','service','PATCH',`/rest/v1/artisan_profiles?user_id=eq.${u.artisan.id}`,{application_status:'suspended'}),204);
    assert.equal(ok(await rpc(u.artisan,'artisan_planning',{p_from:from,p_to:to})).permissions.can_edit,false);
    assert.equal((await rpc(u.artisan,'save_planning_entry',entry(randomUUID(),'refused'))).status,403);
    ok(await change('restore cohort artisan','service','PATCH',`/rest/v1/artisan_profiles?user_id=eq.${u.artisan.id}`,{application_status:'approved'}),204);
  });
  await step('notifications: two concurrent FIRST preference saves, winner retained',async()=>{
    assert.equal((await db.select('notification_preferences',{user_id:`eq.${u.fresh.id}`},'user_id')).length,0);
    const second=await token({...u.fresh});
    const choices=[{p_muted_kinds:['message_received'],p_email:false,p_sms:false,p_push:false,p_expected_version:0},{p_muted_kinds:['work_started'],p_email:false,p_sms:false,p_push:false,p_expected_version:0}];
    const results=await Promise.all([rpc(u.fresh,'save_notification_preferences',choices[0]),rpc(second,'save_notification_preferences',choices[1])]);const winner=assertRace(results,{requireOverlap:true});
    const rows=await db.select('notification_preferences',{user_id:`eq.${u.fresh.id}`},'version,muted_kinds');assert.equal(rows.length,1);assert.equal(rows[0].version,1);assert.deepEqual(rows[0].muted_kinds,choices[winner].p_muted_kinds);
  });
  await step('support: linked notification revoked; personal ticket contrast preserved',async()=>{
    const org=randomUUID(),site=randomUUID();await registry.track('organizations',org);await registry.track('sites',site);
    ok(await change('seed org','service','POST','/rest/v1/organizations',{id:org,name:cohort.name('org'),owner_id:u.owner.id}),201);
    ok(await change('seed memberships','service','POST','/rest/v1/organization_members',[{organization_id:org,user_id:u.owner.id,role:'owner'},{organization_id:org,user_id:u.delegate.id,role:'manager'}]),201);
    ok(await change('seed site','service','POST','/rest/v1/sites',{id:site,organization_id:org,name:cohort.name('site'),type:'office',address:'Adresse technique QA',budget_cents:0}),201);
    const job=await mutate(ctx.gate,registry,'create site intervention',async()=>{const r=await request(u.delegate,'POST','/rest/v1/rpc/create_intervention',{p_category:'outage',p_description:cohort.description('demande technique sans déplacement'),p_address:'Adresse technique QA',p_postal_code:'97200',p_city:'Fort-de-France',p_urgency:'scheduled',p_site_id:site});const b=ok(r);if(!b?.id){const e=Error('intervention result missing ID');e.remoteUnknown=true;throw e;}await registry.track('interventions',b.id);return b;});
    ctx.site=site;ctx.organization=org;
    ok(await change('assign cohort site intervention','service','PATCH',`/rest/v1/interventions?id=eq.${job.id}`,{artisan_id:u.artisan.id,status:'assigned'}),204);
    const slots=ok(await rpc(u.delegate,'intervention_free_slots',{p_intervention_id:job.id,p_from:from,p_to:new Date(Date.parse(from)+7*86400000).toISOString()}));
    assert.ok(Array.isArray(slots.slots));for(const slot of slots.slots)assert.deepEqual(Object.keys(slot).sort(),['ends_at','starts_at']);
    assert.equal((await rpc(u.other,'intervention_free_slots',{p_intervention_id:job.id,p_from:from,p_to:to})).status,403);
    const tickets=[];
    for(const linked of [true,false]) {
      const ticket=await mutate(ctx.gate,registry,'create '+(linked?'linked':'personal')+' support ticket',async()=>{const b=ok(await request(u.delegate,'POST','/rest/v1/rpc/create_support_ticket',{p_request_id:randomUUID(),p_subject:cohort.name(linked?'linked confidential':'personal question'),p_body:cohort.description('Question technique de recette, pas de données personnelles réelles.'),p_intervention_id:linked?job.id:null}));if(!b?.ticket?.id){const e=Error('ticket result missing ID');e.remoteUnknown=true;throw e;}await registry.track('tickets',b.ticket.id);return b.ticket;});
      const id=randomUUID();
      // Synthetic notifications isolate the access predicate. No fake admin profile or
      // operator reply: generating support notifications through triggers is NOT claimed.
      ok(await change('seed system notification fixture','service','POST','/rest/v1/notifications',{id,recipient_id:u.delegate.id,kind:'support_replied',title:linked?'Réponse liée QA':'Réponse personnelle QA',body:cohort.name(linked?'linked private subject':'personal subject'),support_ticket_id:ticket.id,payload:{ticket_id:ticket.id},dedupe_key:'qa:'+mKey(registry)+':'+id,actor_id:null}),201);
      tickets.push({ticket,id,linked});
    }
    ctx.support=tickets;
    const linked=tickets[0],personal=tickets[1];
    const ownBefore=ok(await request(u.delegate,'GET','/rest/v1/notifications?select=id,support_ticket_id,read_at'));assert.ok(ownBefore.some(n=>n.id===linked.id));
    assert.equal(ok(await request(u.client,'GET',`/rest/v1/notifications?id=eq.${linked.id}&select=id`)).length,0);
    const before=ok(await rpc(u.delegate,'notification_summary',{})).unread_count;
    // Migration009 returns void: PostgREST confirms this command with204, not a JSON200.
    ok(await rpc(u.owner,'set_organization_member_site_access',{p_organization_id:org,p_user_id:u.delegate.id,p_scope:'selected',p_grants:[]}),204);
    const afterRows=ok(await request(u.delegate,'GET','/rest/v1/notifications?select=id,support_ticket_id,read_at'));assert.ok(!afterRows.some(n=>n.id===linked.id));assert.ok(afterRows.some(n=>n.id===personal.id));
    assert.equal(ok(await request(u.delegate,'GET',`/rest/v1/support_tickets?id=eq.${linked.ticket.id}&select=id`)).length,0);
    assert.equal(ok(await request(u.delegate,'GET',`/rest/v1/support_tickets?id=eq.${personal.ticket.id}&select=id`)).length,1);
    const summary=ok(await rpc(u.delegate,'notification_summary',{}));assert.equal(summary.unread_count,afterRows.filter(n=>!n.read_at).length);assert.ok(summary.unread_count<before);
    assert.equal((await rpc(u.delegate,'intervention_free_slots',{p_intervention_id:job.id,p_from:from,p_to:to})).status,403);
    assert.equal(ok(await rpc(u.delegate,'mark_notifications',{p_action:'read',p_ids:[linked.id],p_before:null})).updated,0);
    assert.equal(ok(await rpc(u.delegate,'mark_notifications',{p_action:'read',p_ids:[personal.id],p_before:null})).updated,1);
    const retained=await db.select('notifications',{id:`eq.${linked.id}`},'read_at');assert.equal(retained.length,1);assert.equal(retained[0].read_at,null);
  });
}
const mKey=r=>r.m.runId;

export async function browserScenarios(ctx) {
  const {o,users:u,step,redactor,change,ok}=ctx;
  const b=await import('../qa/lib/browser.mjs');b.configureBrowser({timeoutMs:o.timeoutMs});
  const pw=await b.loadPlaywright(o.playwrightPath||process.env.QA_PLAYWRIGHT_PATH);const browser=await b.launchBrowser(pw,{headless:true,chromiumPath:o.chromiumPath});ctx.setBrowser(browser);
  const handle=await b.newPage(browser,{baseUrl:o.baseUrl,redactor});const {page}=handle;
  const app=async(method,route,body)=>{
    const invoke=()=>page.evaluate(async({method,route,body,timeout})=>{const r=await fetch(route,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(timeout)});return {status:r.status,body:await r.json().catch(()=>null)};},{method,route,body,timeout:o.timeoutMs});
    if(method==='GET')return invoke();return mutate(ctx.gate,ctx.registry,'browser '+route,async()=>{try{const r=await invoke();if(uncertainResponse(method,r.status,r.body,route))throw Error('upstream failure');return r;}catch{const e=Error('browser mutation outcome unknown');e.remoteUnknown=true;throw e;}});
  };
  await step('browser: real artisan session, planning and notifications contracts',async()=>{
    await b.login(handle,o.baseUrl,u.artisan,o.project,{timeout:o.timeoutMs});
    await b.openHash(page,o.baseUrl,'planning');await page.getByRole('heading',{name:/Semaine du/}).waitFor();
    assert.equal((await app('GET','/api/planning')).status,200);
    const rejected=await app('POST','/api/planning',{action:'save_entry',request_id:randomUUID(),kind:'busy',starts_at:'invalid',ends_at:'invalid',title:'',note:''});assert.equal(rejected.status,422);
    for(const width of [360,1280]){await page.setViewportSize({width,height:900});await b.noHorizontalOverflow(page,width);await page.screenshot({path:path.join(o.out,`planning-${width}.png`),fullPage:true});}
    await b.openHash(page,o.baseUrl,'notifications');assert.equal((await app('GET','/api/notifications')).status,200);
    await page.getByRole('button',{name:'Préférences',exact:true}).click();await page.getByRole('heading',{name:'Préférences de notification',exact:true}).waitFor();
    assert.ok((await page.locator('body').innerText()).includes('Aucun e-mail'));
    await page.screenshot({path:path.join(o.out,'notifications-1280.png'),fullPage:true});
    assert.equal(handle.pageErrors.length,0,'browser runtime errors');
  });
  await step('browser: actual planning form commits exactly one private entry',async()=>{
    await b.openHash(page,o.baseUrl,'planning');
    const form=page.locator('form').filter({has:page.getByRole('heading',{name:'Nouvelle entrée ponctuelle',exact:true})});
    await form.getByRole('combobox',{name:'Nature',exact:true}).selectOption('busy');
    // Time inputs have no implicit textbox role; use their actual label association.
    await form.getByLabel('Début',{exact:true}).fill('07:00');await form.getByLabel('Fin',{exact:true}).fill('07:30');
    const title=ctx.cohort.name('browser entry');
    await form.getByRole('textbox',{name:'Intitulé (privé, facultatif)',exact:true}).fill(title);
    await mutate(ctx.gate,ctx.registry,'browser planning form',async()=>{
      const response=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/planning' && r.request().method()==='POST').catch(()=>null);
      try {await form.getByRole('button',{name:'Enregistrer',exact:true}).click();const r=await response;if(!r || uncertainResponse('POST',r.status()))throw Error('unknown response');assert.equal(r.status(),200);}
      catch {const e=Error('browser planning form outcome unknown');e.remoteUnknown=true;throw e;}
    });
    const rows=await ctx.db.select('artisan_planning_entries',{artisan_id:`eq.${u.artisan.id}`,title:`eq.${title}`},'id');assert.equal(rows.length,1);
  });
  await step('browser: server suspension reflected as read-only planning',async()=>{
    ok(await change('suspend browser cohort artisan','service','PATCH',`/rest/v1/artisan_profiles?user_id=eq.${u.artisan.id}`,{application_status:'suspended'}),204);
    await b.openHash(page,o.baseUrl,'planning');await page.getByText('Votre compte est suspendu',{exact:false}).first().waitFor();
    const r=await app('POST','/api/planning',{action:'save_entry',request_id:randomUUID(),kind:'busy',starts_at:new Date(Date.now()+86400000).toISOString(),ends_at:new Date(Date.now()+90000000).toISOString(),title:'refused',note:''});assert.equal(r.status,403);
    assert.equal(await page.getByRole('heading',{name:'Nouvelle entrée ponctuelle',exact:true}).count(),0);
    ok(await change('restore browser cohort artisan','service','PATCH',`/rest/v1/artisan_profiles?user_id=eq.${u.artisan.id}`,{application_status:'approved'}),204);
  });
  await step('browser: deterministic GET failure surfaces retry, then recovers',async()=>{
    await page.route('**/api/planning?*',async route=>{await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Panne technique injectée pour la recette.'})});});
    try {await b.openHash(page,o.baseUrl,'planning');await page.getByRole('button',{name:'Réessayer',exact:true}).first().waitFor();await page.screenshot({path:path.join(o.out,'planning-error.png'),fullPage:true});}
    finally {await page.unrouteAll({behavior:'wait'});}
    await page.getByRole('button',{name:'Réessayer',exact:true}).first().click();await page.getByRole('heading',{name:'Disponibilités habituelles',exact:true}).waitFor();
  });
  if(ctx.support)await step('browser: notification HTTP list/count/mark obey linked-ticket revocation',async()=>{
    await handle.close();const h=await b.newPage(browser,{baseUrl:o.baseUrl,redactor});
    try {
      await b.login(h,o.baseUrl,u.delegate,o.project,{timeout:o.timeoutMs});const rows=await b.api(h.page,'/api/notifications');assert.equal(rows.status,200);assert.ok(!rows.body.notifications.some(n=>n.id===ctx.support[0].id));assert.ok(rows.body.notifications.some(n=>n.id===ctx.support[1].id));
      await b.openHash(h.page,o.baseUrl,'notifications');
      await mutate(ctx.gate,ctx.registry,'browser personal notification mark',async()=>{
        try {
          // Attach rejection handling immediately, even when the click itself fails.
          const response=h.page.waitForResponse(r=>new URL(r.url()).pathname==='/api/notifications' && r.request().method()==='POST').catch(()=>null);
          await h.page.getByRole('article',{name:'Réponse personnelle QA',exact:true}).getByRole('button',{name:'Marquer comme non lue',exact:true}).click();
          const r=await response;if(!r || uncertainResponse('POST',r.status()))throw Error('upstream failure');assert.equal(r.status(),200);
        }catch {const e=Error('browser notification mark outcome unknown');e.remoteUnknown=true;throw e;}
      });
      const row=await ctx.db.select('notifications',{id:`eq.${ctx.support[1].id}`},'read_at');assert.equal(row.length,1);assert.equal(row[0].read_at,null);
    }
    finally {await h.close();}
  });
  await step('browser: client cannot read private artisan planning API',async()=>{
    const h=await b.newPage(browser,{baseUrl:o.baseUrl,redactor});
    try {await b.login(h,o.baseUrl,u.client,o.project,{timeout:o.timeoutMs});assert.equal((await b.api(h.page,'/api/planning')).status,403);}
    finally {await h.close();}
  });
  await handle.close();await browser.close();ctx.setBrowser(null);
}

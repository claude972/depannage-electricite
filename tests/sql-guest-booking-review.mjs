// Local PostgreSQL only. Auth/Storage and pg_cron are explicit stubs; no provider transaction.
import {readFile,readdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {isolatedMigrationSql} from './sql-isolated-migrations.mjs';
const {PGlite}=await import(process.env.PGLITE_MODULE||'@electric-sql/pglite');const db=new PGlite();let checks=0;
const eq=(a,b)=>{assert.deepEqual(a,b);checks++};const denied=async(p,code)=>{await assert.rejects(p,e=>e.code===code);checks++};
try{
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create schema auth;create table auth.users(id uuid primary key,raw_user_meta_data jsonb default '{}',email text,email_confirmed_at timestamptz,phone text,phone_confirmed_at timestamptz);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth to authenticated,anon,service_role;grant execute on function auth.uid() to authenticated,anon,service_role;
 create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;
 grant usage on schema storage to authenticated,service_role;grant select on storage.objects to authenticated;`);
 const dir=new URL('../supabase/migrations/',import.meta.url),target='202611010022_guest_booking.sql';const files=(await readdir(dir)).filter(n=>n.endsWith('.sql')&&n<target).sort();eq(files.length,21);
 for(const f of files)await db.exec((await isolatedMigrationSql(db,f,await readFile(new URL(f,dir),'utf8'))).replace('create extension if not exists pgcrypto;','-- TEST ONLY extension omitted'));
 const defs=async()=>Promise.all(['create_intervention(text,text,text,text,text,text,uuid)','create_intervention_once(uuid,text,text,text,text,text,text,uuid)','can_access_intervention(uuid)'].map(async f=>(await db.query('select pg_get_functiondef($1::regprocedure) v',['public.'+f])).rows[0].v));
 const before=await defs();await db.exec(await readFile(new URL(target,dir),'utf8'));eq(await defs(),before);
 const actors={};let n=0;for(const label of ['a','b','email','unverified','artisan','rolecase','card','cancel','atomic']){const id=randomUUID(),phone='596696'+String(++n).padStart(6,'0');actors[label]={id,phone:'+'+phone};await db.query('insert into auth.users(id,raw_user_meta_data,email,email_confirmed_at,phone,phone_confirmed_at) values($1,$2,$3,$4,$5,$6)',[id,JSON.stringify({role:label==='artisan'?'artisan':'client',full_name:'QA '+label}),label==='email'?'legacy@example.invalid':'',label==='email'?'2026-11-01T00:00:00Z':null,phone,['email','unverified'].includes(label)?null:'2026-11-01T00:00:00Z'])}
 const as=async(label,sql,args=[])=>{await db.exec('set role authenticated');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[actors[label]?.id||'']);try{return await db.query(sql,args)}finally{await db.exec('reset role')}};
 const service=async(sql,args)=>{await db.exec('set role service_role');try{return await db.query(sql,args)}finally{await db.exec('reset role')}};
 const scalar=async(sql,args=[])=>(await db.query(sql,args)).rows[0].v;
 const payload={service_slug:'plusieurs-prises-sans-courant',category:'socket',description:'Panne des prises du salon, demande synthétique QA',address:'Adresse technique QA sans déplacement',postal_code:'97200',city:'Commune synthétique QA',urgency:'scheduled'};
 const contact=label=>({first_name:'QA',last_name:'Essai privé',email:'contact@example.invalid',phone:actors[label]?.phone||actors.a.phone});
 const prepare=(label,key,method='on_site',p=payload,c=contact(label))=>as(label,'select public.prepare_phone_booking($1,$2,$3,$4) v',[key,JSON.stringify(p),JSON.stringify(c),method]);
 const submit=(label,key)=>as(label,'select public.submit_phone_booking($1) v',[key]);const status=(label,key)=>as(label,'select public.phone_booking_status($1) v',[key]);const beginCancel=(label,key)=>as(label,'select public.begin_phone_booking_cancel($1) v',[key]);const cancel=(label,key)=>as(label,'select public.cancel_phone_booking($1) v',[key]);
 for(const role of ['public','anon','authenticated'])for(const permission of ['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'])eq(await scalar("select has_table_privilege($1,'public.phone_booking_requests',$2) v",[role,permission]),false);
 eq(await scalar("select relrowsecurity v from pg_class where oid='public.phone_booking_requests'::regclass"),true);
 for(const role of ['public','anon','authenticated','service_role'])eq(await scalar("select has_function_privilege($1,'public.record_phone_booking_provider(uuid,uuid,text,text,text,integer,text,text)','EXECUTE') v",[role]),role==='service_role');
 const key=randomUUID();eq((await prepare('a',key)).rows[0].v.status,'prepared');eq(await scalar('select count(*)::int v from public.interventions'),0);
 const first=(await submit('a',key)).rows[0].v;eq(first.status,'confirmed');eq(first.payment,{method:'on_site',status:'due_on_site',checked_at:null});eq(first.intervention.estimate_max_cents,18000);eq(first.intervention.status,'requested');
 const job=first.intervention.id;eq((await submit('a',key)).rows[0].v.intervention.id,job);eq((await prepare('a',key)).rows[0].v.intervention.id,job);
 eq(await scalar('select count(*)::int v from public.interventions where client_id=$1',[actors.a.id]),1);eq(await scalar("select count(*)::int v from public.audit_log where intervention_id=$1 and action='created'",[job]),1);
 eq(await scalar("select count v from public.action_limits where actor_id=$1 and action='create_intervention'",[actors.a.id]),1);eq(await scalar("select count v from public.action_limits where actor_id=$1 and action='prepare_phone_booking'",[actors.a.id]),1);
 eq(await scalar('select full_name v from public.profiles where id=$1',[actors.a.id]),'QA Essai privé');eq(await scalar('select phone v from public.profiles where id=$1',[actors.a.id]),actors.a.phone);eq(await scalar('select email v from auth.users where id=$1',[actors.a.id]),'');
 eq(await scalar('select description v from public.interventions where id=$1',[job]),payload.description);eq(await scalar('select paid_at is null v from public.interventions where id=$1',[job]),true);
 await denied(prepare('a',key,'on_site',{...payload,description:'Une autre panne synthétique'}),'P0001');await denied(prepare('a',key,'on_site',payload,{...contact('a'),first_name:'Autre'}),'P0001');await denied(prepare('a',key,'card_hold'),'P0001');
 await prepare('b',key);const b=(await submit('b',key)).rows[0].v;assert.notEqual(b.intervention.id,job);checks++;eq((await as('b','select id from public.interventions where id=$1',[job])).rows.length,0);
 await denied(status('b',randomUUID()),'P0002');await denied(as('a','select * from public.phone_booking_requests'),'42501');await denied(prepare('unverified',randomUUID()),'42501');await denied(prepare('artisan',randomUUID()),'42501');await denied(prepare('',randomUUID()),'42501');
 const legacyKey=randomUUID();await prepare('email',legacyKey);eq((await submit('email',legacyKey)).rows[0].v.payment.status,'due_on_site');eq(await scalar('select phone_verified v from public.phone_booking_requests where actor_id=$1',[actors.email.id]),false);
 for(const bad of [{...payload,price:1},{...payload,category:'panel'},{...payload,description:'short'},{...payload,service_slug:'unknown'}])await denied(prepare('a',randomUUID(),'on_site',bad),'22023');
 const roleKey=randomUUID();await prepare('rolecase',roleKey);await db.query("update public.profiles set role='artisan' where id=$1",[actors.rolecase.id]);await denied(submit('rolecase',roleKey),'42501');await db.query("update public.profiles set role='client' where id=$1",[actors.rolecase.id]);await db.query("update auth.users set phone='33612345678' where id=$1",[actors.rolecase.id]);await denied(submit('rolecase',roleKey),'42501');
 const cancelled=randomUUID();await prepare('cancel',cancelled);await denied(prepare('cancel',randomUUID()),'P0001');eq((await beginCancel('cancel',cancelled)).rows[0].v.status,'cancelled');eq((await cancel('cancel',cancelled)).rows[0].v.status,'cancelled');await denied(submit('cancel',cancelled),'P0001');await prepare('cancel',randomUUID());await denied(cancel('a',key),'P0001');
 const cardKey=randomUUID();await prepare('card',cardKey,'card_hold');await denied(submit('card',cardKey),'42501');eq(await scalar('select count(*)::int v from public.interventions where client_id=$1',[actors.card.id]),0);
 const record='select public.record_phone_booking_provider($1,$2,$3,$4,$5,$6,$7,$8)';const args=[actors.card.id,cardKey,'cs_test_QAcard1','pi_QAcard1'];
 await denied(as('card',record,[...args,'session',null,null,null]),'42501');await service(record,[...args,'session',null,null,null]);await denied(service(record,[...args,'authorize',1,'eur','requires_capture']),'42501');
 await service(record,[...args,'authorize',18000,'eur','requires_capture']);const checked=await scalar('select authorization_checked_at::text v from public.phone_booking_requests where actor_id=$1 and request_id=$2',[actors.card.id,cardKey]);await service(record,[...args,'session',null,null,null]);eq(await scalar('select status v from public.phone_booking_requests where actor_id=$1 and request_id=$2',[actors.card.id,cardKey]),'authorized');eq(await scalar('select authorization_checked_at::text v from public.phone_booking_requests where actor_id=$1 and request_id=$2',[actors.card.id,cardKey]),checked);await db.query("update public.phone_booking_requests set authorization_checked_at=clock_timestamp()-interval '31 seconds' where actor_id=$1",[actors.card.id]);await denied(submit('card',cardKey),'42501');await service(record,[...args,'authorize',18000,'eur','requires_capture']);
 const held=(await submit('card',cardKey)).rows[0].v;eq(held.payment.method,'card_hold');eq(held.payment.status,'authorized');eq(typeof held.payment.checked_at,'string');eq((await status('card',cardKey)).rows[0].v.payment.status,'authorization_recorded');eq((await as('card','select public.phone_booking_status(null,$1) v',[held.intervention.id])).rows[0].v.intervention.id,held.intervention.id);await denied(as('a','select public.phone_booking_status(null,$1) v',[held.intervention.id]),'P0002');eq(held.intervention.status,'requested');eq(await scalar('select paid_at is null v from public.interventions where id=$1',[held.intervention.id]),true);await denied(beginCancel('card',cardKey),'P0001');
 const qid=randomUUID();await db.query("insert into public.quotes(id,intervention_id,artisan_id,lines,subtotal_cents,tax_rate,tax_cents,total_cents,status) values($1,$2,$3,'[{\"label\":\"QA\",\"quantity\":1,\"unit_price_cents\":10000}]',10000,20,2000,12000,'accepted')",[qid,held.intervention.id,actors.artisan.id]);await denied(as('card','select public.guard_phone_booking_checkout($1)',[qid]),'P0001');
 const releaseKey=randomUUID();await prepare('card',releaseKey,'card_hold');const releaseArgs=[actors.card.id,releaseKey,'cs_test_QAcard2','pi_QAcard2'];await service(record,[...releaseArgs,'session',null,null,null]);await service(record,[...releaseArgs,'authorize',18000,'eur','requires_capture']);await denied(service(record,[...releaseArgs,'release',null,null,'canceled']),'42501');
 await beginCancel('card',releaseKey);await service(record,[...releaseArgs,'session',null,null,null]);eq(await scalar('select status v from public.phone_booking_requests where actor_id=$1 and request_id=$2',[actors.card.id,releaseKey]),'cancelling');await denied(submit('card',releaseKey),'P0001');await denied(service(record,[...releaseArgs,'authorize',18000,'eur','requires_capture']),'42501');await denied(prepare('card',randomUUID()),'P0001');await service(record,[...releaseArgs,'release',null,null,'canceled']);eq((await cancel('card',releaseKey)).rows[0].v.status,'cancelled');await prepare('card',randomUUID(),'card_hold');
 // A real exception after prepare + create/audit/quota, during private profile update, rolls ALL back.
 const atomicPhoneBefore=await scalar('select phone v from public.profiles where id=$1',[actors.atomic.id]);const atomicKey=randomUUID();const atomic=(p=payload)=>as('atomic','select public.create_on_site_booking($1,$2,$3) v',[atomicKey,JSON.stringify(p),JSON.stringify(contact('atomic'))]);
 await db.exec(`create function public.qa_booking_abort() returns trigger language plpgsql as $$begin raise exception 'QA rollback after preparation' using errcode='53300';end;$$;create trigger qa_booking_abort before update on public.profiles for each row when(new.id='${actors.atomic.id}'::uuid) execute function public.qa_booking_abort();`);
 await denied(atomic(),'53300');
 for(const table of ['phone_booking_requests','intervention_request_keys','action_limits'])eq(await scalar(`select count(*)::int v from public.${table} where actor_id=$1`,[actors.atomic.id]),0);
 eq(await scalar('select count(*)::int v from public.interventions where client_id=$1',[actors.atomic.id]),0);eq(await scalar('select count(*)::int v from public.audit_log where actor_id=$1',[actors.atomic.id]),0);eq(await scalar('select full_name v from public.profiles where id=$1',[actors.atomic.id]),'QA atomic');eq(await scalar('select phone v from public.profiles where id=$1',[actors.atomic.id]),atomicPhoneBefore);
 await db.exec('drop trigger qa_booking_abort on public.profiles;drop function public.qa_booking_abort()');
 const atomicFirst=(await atomic({...payload,description:'Description modifiée après échec synthétique QA'})).rows[0].v;
 eq(atomicFirst.status,'confirmed');eq((await atomic({...payload,description:'Description modifiée après échec synthétique QA'})).rows[0].v.intervention.id,atomicFirst.intervention.id);eq(await scalar("select count v from public.action_limits where actor_id=$1 and action='prepare_phone_booking'",[actors.atomic.id]),1);eq(await scalar("select count v from public.action_limits where actor_id=$1 and action='create_intervention'",[actors.atomic.id]),1);
 const legacyNonce=randomUUID();await as('a','select public.create_intervention_once($1,$2,$3,$4,$5,$6,$7,null)',[legacyNonce,payload.category,payload.description,payload.address,payload.postal_code,payload.city,payload.urgency]);await denied(prepare('a',legacyNonce),'P0001');
 const racedNonce=randomUUID();await prepare('a',racedNonce);await as('a','select public.create_intervention_once($1,$2,$3,$4,$5,$6,$7,null)',[racedNonce,payload.category,payload.description,payload.address,payload.postal_code,payload.city,payload.urgency]);await denied(submit('a',racedNonce),'P0001');eq(await scalar('select intervention_id is null v from public.phone_booking_requests where actor_id=$1 and request_id=$2',[actors.a.id,racedNonce]),true);
 // A previously owned dossier that changed owner is hidden by the same 404 as an absent one.
 await db.query('update public.interventions set client_id=$1 where id=$2',[actors.b.id,job]);
 await denied(status('a',key),'P0002');
 await denied(as('a','select public.phone_booking_status(null,$1) v',[job]),'P0002');
 eq(await scalar('select count(*)::int v from public.payments'),0);eq(await scalar('select count(*)::int v from public.payment_attempts'),0);
 // The signed-in client form uses a generic slug, with no catalogue service inferred from the category.
 actors.signed={id:randomUUID(),phone:'+596696999901'};
 await db.query("insert into auth.users(id,email,email_confirmed_at) values($1,'signed-qa@example.invalid',now())",[actors.signed.id]);
 const signedPayload=category=>({...payload,category,service_slug:`demande-${category}`});
 await denied(prepare('signed',randomUUID(),'on_site',signedPayload('socket')),'22023');
 const categoryMigrations=(await readdir(dir)).filter(name=>name.endsWith('_signed_booking_categories.sql'));
 eq(categoryMigrations.length,1);
 await db.exec(await readFile(new URL(categoryMigrations[0],dir),'utf8'));
 eq(await defs(),before);
 for(const category of ['outage','panel','socket','lighting','diagnostic']){
  const command=randomUUID(),input=signedPayload(category);
  const confirm=()=>as('signed','select public.create_on_site_booking($1,$2,$3) v',[command,JSON.stringify(input),JSON.stringify(contact('signed'))]);
  const receipt=(await confirm()).rows[0].v;
  eq(receipt.status,'confirmed');
  eq(receipt.payment.status,'due_on_site');
  eq(await scalar('select category v from public.interventions where id=$1',[receipt.intervention.id]),category);
  eq((await confirm()).rows[0].v.intervention.id,receipt.intervention.id);
 }
 await denied(prepare('signed',randomUUID(),'on_site',{...signedPayload('panel'),category:'socket'}),'22023');
 await denied(prepare('artisan',randomUUID(),'on_site',signedPayload('socket')),'42501');
 eq(await scalar('select count(*)::int v from public.payments'),0);
 console.log(JSON.stringify({sql:'PASS',checks,migrations:23,auth_storage_cron:'STUBS',provider:'NO REAL STRIPE OR SMS',real_concurrency_proved:false}));
}finally{await db.close()}

import { isolatedMigrationSql } from './sql-isolated-migrations.mjs';
process.on('uncaughtException',error=>{console.error(error.code||'',error.message,error.where||'');process.exit(1);});
// Isolated Auth/Storage stubs only. --emit-rollback writes reviewable SQL; never runs cloud SQL.
import { readFile, readdir, open } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';
const actors=['admin','creator','owner','delegate','other','read','reply','status','both','writeOnly'];
const ids=Object.fromEntries(actors.map(name=>[name,randomUUID()]));
const run=randomUUID();
const invitationToken=randomUUID().replaceAll('-','')+randomUUID().replaceAll('-','');
const invitationHash=createHash('sha256').update(invitationToken).digest('hex');
const q=s=>`'${s.replaceAll("'","''")}'`;
const sql=`-- QA-SUPPORT-OPERATORS-018: fixture UUIDs ${JSON.stringify(ids)}; run ${run}
-- ROOT REVIEW ONLY: single transaction; no permanent admin/grant/audit, no provider calls.
begin;
set local statement_timeout='30s';
set local lock_timeout='2s';
do $$ begin
 if to_regprocedure('public.support_operator_permissions()') is null then raise exception '018 absent' using errcode='QA001'; end if;
 if exists(select 1 from auth.users where id=any(array[${Object.values(ids).map(v=>q(v)+'::uuid').join(',')}])) then raise exception 'fixture collision' using errcode='QA001'; end if;
end $$;
create function pg_temp.qa_check(ok boolean,label text) returns void language plpgsql as $$ begin
 if ok is distinct from true then raise exception 'QA SUPPORT FAIL: %',label using errcode='QA001'; end if;
 raise notice 'QA SUPPORT PASS: %',label;
end $$;
create function pg_temp.qa_as(actor uuid,statement text) returns jsonb language plpgsql as $$
declare answer jsonb;
begin
 if actor is null then execute 'set local role anon'; else execute 'set local role authenticated'; end if;
 perform set_config('request.jwt.claim.sub',coalesce(actor::text,''),true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role',case when actor is null then 'anon' else 'authenticated' end,'aal',case when actor is null then null else 'aal2' end)::text,true);
 execute 'select to_jsonb(qa_result.qa_value) from ('||statement||') qa_result(qa_value)' into answer;
 execute 'reset role';
 return answer;
exception when others then execute 'reset role'; raise;
end $$;
create function pg_temp.qa_denied(actor uuid,statement text,expected text,label text) returns void language plpgsql as $$
declare code text;
begin
 begin perform pg_temp.qa_as(actor,statement);
 exception when others then get stacked diagnostics code=returned_sqlstate; end;
 perform pg_temp.qa_check(code=expected,label||' ['||coalesce(code,'success')||']');
end $$;
${actors.map(name=>`insert into auth.users(id,aud,role,email,raw_user_meta_data,email_confirmed_at,created_at,updated_at)
 values(${q(ids[name])},'authenticated','authenticated',${q('qa-support-'+run+'-'+name+'@qa.invalid')},${q(JSON.stringify({role:name==='owner'||name==='delegate'?'manager':'client',full_name:'QA support '+name}))}::jsonb,now(),now(),now());`).join('\n')}
update public.profiles set role='admin' where id=${q(ids.admin)};
do $$
declare a jsonb; ticket uuid; linked uuid; personal uuid; site_a uuid; org uuid; job uuid; grant_id uuid;
 v integer=1; before_n integer; perms jsonb; actor uuid;
 admin uuid=${q(ids.admin)}; creator uuid=${q(ids.creator)}; owner_id uuid=${q(ids.owner)}; delegate uuid=${q(ids.delegate)};
 reader uuid=${q(ids.read)}; replier uuid=${q(ids.reply)}; status_actor uuid=${q(ids.status)}; both_actor uuid=${q(ids.both)}; write_only uuid=${q(ids.writeOnly)}; outsider uuid=${q(ids.other)};
begin
 a=pg_temp.qa_as(creator,format('select public.create_support_ticket(%L::uuid,%L,%L,null)',gen_random_uuid(),'Question QA support','Demande technique de recette sans donnée réelle.'));
 ticket=(a->'ticket'->>'id')::uuid;
 perform pg_temp.qa_check(a->'initial_message'->>'author_kind'='user','initial creator message remains user');
 perform pg_temp.qa_denied(null,'select public.support_operator_permissions()','42501','anonymous helper denied');
 perform pg_temp.qa_denied(reader,'select public.lock_support_operator_permissions(''reply'')','42501','private lock helper denied');
 perform pg_temp.qa_denied(reader,format('select public.platform_grant_scope(%L::uuid,''support_read'','''')',reader),'42501','operator cannot grant scopes');
 perform pg_temp.qa_as(admin,format('select public.platform_grant_scope(%L::uuid,''support_read'',''QA rollback only'')',reader));
 foreach actor in array array[replier,status_actor,both_actor] loop
  perform pg_temp.qa_as(admin,format('select public.platform_grant_scope(%L::uuid,''support_read'',''QA rollback only'')',actor));
 end loop;
 foreach actor in array array[replier,both_actor,write_only] loop
  perform pg_temp.qa_as(admin,format('select public.platform_grant_scope(%L::uuid,''support_reply'',''QA rollback only'')',actor));
 end loop;
 foreach actor in array array[status_actor,both_actor,write_only] loop
  perform pg_temp.qa_as(admin,format('select public.platform_grant_scope(%L::uuid,''support_status'',''QA rollback only'')',actor));
 end loop;
 perms=pg_temp.qa_as(write_only,'select public.support_operator_permissions()');
 perform pg_temp.qa_check(perms='{"can_read_all":false,"can_reply_all":false,"can_set_status_all":false}'::jsonb,'write scopes alone grant nothing');
 perms=pg_temp.qa_as(reader,'select public.support_operator_permissions()');
 perform pg_temp.qa_check(perms='{"can_read_all":true,"can_reply_all":false,"can_set_status_all":false}'::jsonb,'read-only matrix');
 foreach actor in array array[reader,replier,status_actor,both_actor] loop
  perform pg_temp.qa_check(pg_temp.qa_as(actor,format('select to_jsonb(count(*)) from public.support_tickets where id=%L::uuid',ticket))='1'::jsonb,'operator reads ticket');
  perform pg_temp.qa_check(pg_temp.qa_as(actor,format('select to_jsonb(count(*)) from public.support_messages where ticket_id=%L::uuid',ticket))='1'::jsonb,'operator reads messages');
  perform pg_temp.qa_check(pg_temp.qa_as(actor,format('select to_jsonb(count(*)) from public.support_events where ticket_id=%L::uuid',ticket))='1'::jsonb,'operator reads events');
  perform pg_temp.qa_denied(actor,'select public.platform_finance_report()','42501','support cannot read finance');
  perform pg_temp.qa_check(pg_temp.qa_as(actor,'select to_jsonb(count(*)) from public.platform_audit')='0'::jsonb,'support cannot read platform audit');
  perform pg_temp.qa_check(pg_temp.qa_as(actor,'select to_jsonb(public.is_admin())')='false'::jsonb,'support is never admin');
 end loop;
 foreach actor in array array[outsider,write_only] loop
  perform pg_temp.qa_check(pg_temp.qa_as(actor,format('select to_jsonb(count(*)) from public.support_tickets where id=%L::uuid',ticket))='0'::jsonb,'unscoped reader hidden');
 end loop;
 foreach actor in array array[reader,status_actor,write_only,outsider] loop
  perform pg_temp.qa_denied(actor,format('select public.mutate_support_ticket(%L::uuid,''reply'',1,''Forbidden reply'',null)',ticket),'42501','reply requires both scopes');
 end loop;
 foreach actor in array array[reader,replier,write_only,outsider,creator] loop
  perform pg_temp.qa_denied(actor,format('select public.mutate_support_ticket(%L::uuid,''set_status'',1,null,''in_progress'')',ticket),'42501','status requires both scopes');
 end loop;
 select count(*) into before_n from public.notifications where recipient_id=creator;
 a=pg_temp.qa_as(replier,format('select public.mutate_support_ticket(%L::uuid,''reply'',%s,''Réponse opérateur QA'',null)',ticket,v)); v=v+1;
 perform pg_temp.qa_check(a->'message'->>'author_kind'='operator' and a->'message'->>'author_id'=replier::text,'reply keeps real operator identity');
 perform pg_temp.qa_check((select count(*)=before_n+1 from public.notifications where recipient_id=creator),'operator reply notifies exactly once');
 perform pg_temp.qa_check((select count(*)=1 from public.notifications where recipient_id=creator and actor_id=replier and support_ticket_id=ticket and kind='support_replied'),'reply notification ticket/actor');
 perform pg_temp.qa_denied(replier,format('select public.mutate_support_ticket(%L::uuid,''reply'',1,''Obsolete reply'',null)',ticket),'P0001','stale version denied');
 perform pg_temp.qa_check((select count(*)=before_n+1 from public.notifications where recipient_id=creator),'failed reply emits nothing');
 a=pg_temp.qa_as(status_actor,format('select public.mutate_support_ticket(%L::uuid,''set_status'',%s,null,''resolved'')',ticket,v)); v=v+1;
 perform pg_temp.qa_check(a->'event'->>'actor_id'=status_actor::text and a->'event'->>'kind'='status_changed','status event authoritative actor');
 perform pg_temp.qa_check((select count(*)=1 from public.notifications where recipient_id=creator and actor_id=status_actor and support_ticket_id=ticket and kind='support_status_changed'),'operator status notification');
 perform pg_temp.qa_denied(replier,format('select public.mutate_support_ticket(%L::uuid,''reply'',%s,''Must reopen'',null)',ticket,v),'P0001','operator must explicitly reopen');
 -- Creator with read+status but no reply scope still follows user reply/autoreopen semantics.
 perform pg_temp.qa_as(admin,format('select public.platform_grant_scope(%L::uuid,''support_read'','''')',creator));
 perform pg_temp.qa_as(admin,format('select public.platform_grant_scope(%L::uuid,''support_status'','''')',creator));
 select count(*) into before_n from public.notifications where recipient_id=creator;
 a=pg_temp.qa_as(creator,format('select public.mutate_support_ticket(%L::uuid,''reply'',%s,''Réouverture utilisateur'',null)',ticket,v)); v=v+1;
 perform pg_temp.qa_check(a->'message'->>'author_kind'='user' and a->'ticket'->>'status'='open','creator autoreopen remains user');
 perform pg_temp.qa_check((select count(*)=before_n from public.notifications where recipient_id=creator),'autoreopen is not operator status notification');
 -- Revoke read; remaining write scope must not preserve global access or writes.
 select id into grant_id from public.platform_operator_grants where user_id=replier and scope='support_read' and status='active';
 perform pg_temp.qa_as(admin,format('select public.platform_revoke_scope(%L::uuid,''QA rollback'')',grant_id));
 perform pg_temp.qa_check(pg_temp.qa_as(replier,format('select to_jsonb(count(*)) from public.support_tickets where id=%L::uuid',ticket))='0'::jsonb,'revocation hides foreign ticket');
 perform pg_temp.qa_denied(replier,format('select public.mutate_support_ticket(%L::uuid,''reply'',%s,''Revoked'',null)',ticket,v),'42501','revocation blocks reply');
 select id into grant_id from public.platform_operator_grants where user_id=creator and scope='support_read' and status='active';
 perform pg_temp.qa_as(admin,format('select public.platform_revoke_scope(%L::uuid,''QA rollback'')',grant_id));
 perform pg_temp.qa_check(pg_temp.qa_as(creator,format('select to_jsonb(count(*)) from public.support_tickets where id=%L::uuid',ticket))='1'::jsonb,'own ticket survives operator revocation');
 a=pg_temp.qa_as(creator,format('select public.mutate_support_ticket(%L::uuid,''reply'',%s,''Créateur toujours autorisé'',null)',ticket,v)); v=v+1;
 perform pg_temp.qa_check(a->'message'->>'author_kind'='user','own reply survives operator revocation');
 -- Site-linked visibility and notifications retain the original 009/011/016 boundary.
 a=pg_temp.qa_as(owner_id,'select to_jsonb(s) from public.create_site(''Site QA support'',''office'',''12 rue du Test'',0,null) s');
 site_a=(a->>'id')::uuid; org=(a->>'organization_id')::uuid;
 -- Owner joins the member via the normal invitation/acceptance workflow.
 a=pg_temp.qa_as(owner_id,format('select public.create_organization_invitation(%L::uuid,%L,''manager'',%L,7,''selected'',%L::jsonb)',org,${q('qa-support-'+run+'-delegate@qa.invalid')},${q(invitationHash)},jsonb_build_array(jsonb_build_object('site_id',site_a,'can_write',true))));
 perform pg_temp.qa_as(delegate,format('select public.accept_organization_invitation(%L)',${q(invitationToken)}));
 a=pg_temp.qa_as(owner_id,format('select to_jsonb(i) from public.create_intervention(''panel'',''Panne électrique QA support'',''12 rue du Test'',''97200'',''Fort-de-France'',''scheduled'',%L::uuid) i',site_a)); job=(a->>'id')::uuid;
 a=pg_temp.qa_as(delegate,format('select public.create_support_ticket(%L::uuid,''Question liée QA'',''Question sur le site de recette'',%L::uuid)',gen_random_uuid(),job)); linked=(a->'ticket'->>'id')::uuid;
 a=pg_temp.qa_as(delegate,format('select public.create_support_ticket(%L::uuid,''Question privée QA'',''Question personnelle de recette'',null)',gen_random_uuid())); personal=(a->'ticket'->>'id')::uuid;
 foreach actor in array array[reader,status_actor,both_actor] loop
  perform pg_temp.qa_check(pg_temp.qa_as(actor,format('select to_jsonb(count(*)) from public.interventions where id=%L::uuid',job))='0'::jsonb,'support scope grants no intervention access');
  perform pg_temp.qa_check(pg_temp.qa_as(actor,'select to_jsonb(count(*)) from public.documents')='0'::jsonb,'support scope grants no document access');
 end loop;
 perform pg_temp.qa_as(both_actor,format('select public.mutate_support_ticket(%L::uuid,''reply'',1,''Réponse liée QA'',null)',linked));
 perform pg_temp.qa_as(both_actor,format('select public.mutate_support_ticket(%L::uuid,''reply'',1,''Réponse personnelle QA'',null)',personal));
 perform pg_temp.qa_check(pg_temp.qa_as(delegate,'select to_jsonb(count(*)) from public.notifications where kind=''support_replied''')='2'::jsonb,'creator sees both support notifications');
 perform pg_temp.qa_as(owner_id,format('select public.set_organization_member_site_access(%L::uuid,%L::uuid,''selected'',''[]''::jsonb)',org,delegate));
 perform pg_temp.qa_check(pg_temp.qa_as(delegate,format('select to_jsonb(count(*)) from public.support_tickets where id=%L::uuid',linked))='0'::jsonb,'site revocation hides linked ticket');
 perform pg_temp.qa_check(pg_temp.qa_as(delegate,format('select to_jsonb(count(*)) from public.support_tickets where id=%L::uuid',personal))='1'::jsonb,'site revocation preserves personal ticket');
 perform pg_temp.qa_check(pg_temp.qa_as(delegate,'select to_jsonb(count(*)) from public.notifications where kind=''support_replied''')='1'::jsonb,'site revocation hides linked notification only');
 perform pg_temp.qa_check(pg_temp.qa_as(both_actor,'select to_jsonb(count(*)) from public.notifications')='0'::jsonb,'operator cannot read recipient notifications');
 perform pg_temp.qa_check((select count(*)=1 from public.profiles where id=any(array[${Object.values(ids).map(v=>q(v)+'::uuid').join(',')}]) and role='admin'),'only transaction-local fixture admin exists in cohort');
 raise notice 'QA SUPPORT COMPLETE: single-session matrix only; concurrency and HTTP/browser NOT PROVED';
end $$;
rollback;
`;
if(process.argv[2]==='--emit-rollback'){
 if(process.argv.length!==4)throw Error('Usage: --emit-rollback <new private file outside checkout>');
 const dest=path.resolve(process.argv[3]);const root=path.resolve(new URL('..',import.meta.url).pathname);
 if(dest===root||dest.startsWith(root+path.sep))throw Error('SQL review output must be outside checkout');
 const file=await open(dest,'wx',0o600);try{await file.writeFile(sql);}finally{await file.close();}
 console.log(JSON.stringify({sql:dest,run,fixture_ids:ids,executed:false}));
}else{
 if(process.argv.length!==2)throw Error('Unknown argument; no SQL executed');
 const {PGlite}=await import(process.env.PGLITE_MODULE||'@electric-sql/pglite');const db=new PGlite();
 try{
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create schema auth;create table auth.users(id uuid primary key,aud text,role text,raw_user_meta_data jsonb default '{}',email text,email_confirmed_at timestamptz,created_at timestamptz,updated_at timestamptz,phone text,phone_confirmed_at timestamptz);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create function auth.jwt() returns jsonb language sql stable as $$select nullif(current_setting('request.jwt.claims',true),'')::jsonb$$;
 grant usage on schema auth to authenticated,anon,service_role;grant execute on function auth.uid() to authenticated,anon,service_role;
 create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;`);
 const dir=new URL('../supabase/migrations/',import.meta.url);const files=(await readdir(dir)).filter(n=>n.endsWith('.sql')).sort();
 for(const name of files)await db.exec((await isolatedMigrationSql(db, name, await readFile(new URL(name,dir),'utf8'))).replace('create extension if not exists pgcrypto;','-- local stub: no pgcrypto extension'));
 const tables=(await db.query("select table_schema s,table_name n from information_schema.tables where table_type='BASE TABLE' and table_schema in ('public','auth','storage') order by table_schema,table_name")).rows;
 const snapshot=async()=>{const out={};for(const t of tables)out[t.s+'.'+t.n]=(await db.query(`select count(*)::int n from "${t.s}"."${t.n}"`)).rows[0].n;return out;};
 const before=await snapshot();await db.exec(sql);assert.deepEqual(await snapshot(),before,'rollback leaves every persistent table count unchanged');
 console.log(`PASS ${files.length} migrations; full scoped support matrix and real triggers under isolated Auth/Storage stubs; rollback counts unchanged. NOT cloud/concurrency/HTTP.`);
 // A deliberately broken assertion must abort and still leave no fixture data after rollback.
 const broken=sql.replace("a->'initial_message'->>'author_kind'='user'","false");
 await assert.rejects(db.exec(broken),error=>error.code==='QA001');await db.exec('rollback');assert.deepEqual(await snapshot(),before);
 console.log('PASS failed criterion aborts and rollback leaves no fixture data.');
 }finally{await db.close();}
}

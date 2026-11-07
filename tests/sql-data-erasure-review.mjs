import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { isolatedMigrationSql } from "./sql-isolated-migrations.mjs";

const { PGlite } = await import(
  process.env.PGLITE_MODULE || "@electric-sql/pglite"
);
const db = new PGlite();
try {
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth;
    create table auth.users(
      id uuid primary key, raw_user_meta_data jsonb default '{}', email text,
      is_anonymous boolean not null default false, email_confirmed_at timestamptz, phone text, phone_confirmed_at timestamptz
    );
    create function auth.uid() returns uuid language sql stable as
      $$select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid$$;
    grant usage on schema auth to authenticated, anon, service_role;
    grant execute on function auth.uid() to authenticated, anon, service_role;
    create schema storage;
    create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text);
    alter table storage.objects enable row level security;
  `);
  const dir = new URL("../supabase/migrations/", import.meta.url);
  let previousJobs;
  for (const name of (await readdir(dir))
    .filter((n) => n.endsWith(".sql"))
    .sort()) {
    if (name.endsWith("_operational_reminders_schedule.sql"))
      previousJobs = (
        await db.query("select to_jsonb(j)v from cron.job j order by jobname")
      ).rows;
    const migration = await isolatedMigrationSql(
      db,
      name,
      await readFile(new URL(name, dir), "utf8"),
    );
    await db.exec(
      migration.replace(
        "create extension if not exists pgcrypto;",
        "-- stub for isolated test",
      ),
    );
  }
 let checks=0;const eq=(a,b)=>{assert.deepEqual(a,b);checks++};
 const q=async(sql,args=[])=> (await db.query(sql,args)).rows;
 const one=async(sql,args=[])=> (await q(sql,args))[0].v;
 const users=Object.fromEntries(['client','other','reader','decider','finance'].map(x=>[x,crypto.randomUUID()]));
 for(const id of Object.values(users))await q("insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data)values($1,$2,now(),'{\"role\":\"client\",\"full_name\":\"QA\"}')",[id,`${id}@example.test`]);
 for(const [who,scopes]of [['reader',['support_read']],['decider',['support_read','support_status']],['finance',['finance_write','support_status']]])for(const scope of scopes)await q('insert into public.platform_operator_grants(user_id,scope,note,granted_by)values($1,$2,\'QA\',$1)',[users[who],scope]);
 async function as(id=users.client,role='authenticated'){await db.exec('reset role');await q("select set_config('request.jwt.claim.sub',$1,false)",[id]);await db.exec(`set role ${role}`)}
 const deny=async(p,code='42501')=>{await assert.rejects(p,e=>e.code===code);checks++};
 const key=crypto.randomUUID();const create=(command=key)=>one('select public.create_data_erasure_request($1)v',[command]);
 const list=(all=false,after=null,limit=25)=>one('select public.list_data_erasure_requests($1,$2,$3)v',[all,after,limit]);
 await as();eq((await list()).rows,[]);const first=await create();eq(first.request.account_id,users.client);eq(first.request.state,'requested');eq(first.request.execution_state,'not_started');eq(first.replayed,false);eq((await create()).request.id,first.request.id);eq((await create()).replayed,true);
 await deny(q('select *from data_request_private.requests'));await deny(list(true));eq((await list()).rows.length,1);
 const detail=()=>one('select public.get_data_erasure_review($1)v',[first.request.id]);
 await deny(detail());await as(users.other);eq((await list()).rows,[]);await deny(detail());const other=await create();eq(other.request.id!==first.request.id,true);eq(other.ticket_id!==first.ticket_id,true);
 await as(users.finance);await deny(list(true));await deny(detail());
 const command=crypto.randomUUID();const decide=(state='in_review',version=1,cmd=command,reason='Examen demandé')=>one('select public.decide_data_erasure_request($1,$2,$3,$4,$5)v',[first.request.id,cmd,version,state,reason]);
 await deny(decide());await as(users.reader);eq((await list(true)).rows.length,2);eq((await detail()).can_decide,false);await deny(decide());
 await as(users.decider);eq((await detail()).can_decide,true);const reviewing=await decide();eq(reviewing.request.state,'in_review');eq(reviewing.request.version,2);eq((await decide()).replayed,true);eq((await detail()).history.length,2);await deny(decide('in_review',1,command,'Autre motif'),'P0001');
 await deny(decide('approved',1),'P0001');await deny(decide('needs_information',1,crypto.randomUUID()),'P0001');await deny(decide('needs_information',2,crypto.randomUUID(),''),'22023');
 const needs=await decide('needs_information',2,crypto.randomUUID(),'Complément nécessaire');eq(needs.request.version,3);
 // A support closure cannot claim approval or execution.
 const ticket=await one('select to_jsonb(t)v from public.support_tickets t where id=$1',[first.ticket_id]);
 await q("select public.mutate_support_ticket($1,'set_status',$2,null,'resolved')",[first.ticket_id,ticket.version]);eq((await detail()).request.state,'needs_information');eq((await detail()).request.execution_state,'not_started');
 const approval=crypto.randomUUID();eq((await decide('approved',3,approval,'Décision consignée, exécution séparée')).request.state,'approved');eq((await decide('approved',3,approval,'Décision consignée, exécution séparée')).replayed,true);await deny(decide('rejected',4,crypto.randomUUID()),'P0001');
 eq((await detail()).history.length,4);eq((await detail()).request.execution_state,'not_started');
 // Actual revocation, including replay, removes current authority immediately.
 await as('', 'postgres');await q("update public.platform_operator_grants set status='revoked',revoked_at=now(),revoked_by=user_id where user_id=$1 and scope='support_status'",[users.decider]);await as(users.decider);await deny(decide('approved',3,approval,'Décision consignée, exécution séparée'));
 await as();const recovered=await create();eq(recovered.status,'resolved');eq(recovered.request.state,'approved');eq(recovered.request.execution_state,'not_started');
 // Existing exact ticket command can be adopted; unrelated UUID content cannot.
 const legacyKey=crypto.randomUUID();const legacy=await one("select public.create_support_ticket($1,'Demande d’effacement de données personnelles','Je demande l’examen de l’effacement des données personnelles associées à mon compte.',null)v",[legacyKey]);eq((await create(legacyKey)).ticket_id,legacy.ticket.id);
 const unrelated=crypto.randomUUID();await q("select public.create_support_ticket($1,'Autre sujet','Un ticket distinct sans demande de données.',null)",[unrelated]);await deny(create(unrelated),'P0001');
 const page=await list(false,null,1);eq(page.rows.length,1);eq(page.next_cursor,page.rows[0].id);const next=await list(false,page.next_cursor,1);eq(next.rows.length,1);eq(next.rows[0].id!==page.rows[0].id,true);await deny(list(false,null,101),'22023');
 await as('', 'anon');await deny(create());await deny(list());await deny(detail());await deny(decide());
 console.log(`PASS data erasure: ${checks} SQL checks; private ownership, support grants/revocation, exact retry, version conflicts, separate decision/execution and legacy ticket linkage`);
}catch(e){console.error(e.message,e.code,e.where,e.stack?.split('\n').slice(0,5).join('\n'));process.exitCode=1}finally{await db.close()}

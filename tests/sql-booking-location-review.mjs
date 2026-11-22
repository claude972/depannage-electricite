// Isolated PostgreSQL proof of location boundary only. Existing booking functions are explicit
// stubs here; full payment/identity integration remains covered by the existing booking suite.
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const {PGlite}=await import(process.env.PGLITE_MODULE||'@electric-sql/pglite');
const db=new PGlite();
const a='10000000-0000-4000-8000-000000000001',b='10000000-0000-4000-8000-000000000002',key='20000000-0000-4000-8000-000000000001';
try {
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create schema auth;create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;
 create table public.phone_booking_requests(actor_id uuid,request_id uuid,primary key(actor_id,request_id));
 create function public.guest_booking_actor() returns uuid language plpgsql as $$begin if auth.uid() is null then raise insufficient_privilege;end if;return auth.uid();end;$$;
 create function public.prepare_phone_booking_reviewed(uuid,jsonb,jsonb,text,integer) returns jsonb language plpgsql as $$begin insert into public.phone_booking_requests values(auth.uid(),$1) on conflict do nothing;return '{"status":"prepared"}'::jsonb;end;$$;
 create function public.submit_phone_booking(uuid) returns jsonb language sql as $$select '{"status":"confirmed"}'::jsonb$$;`);
 await db.exec(await readFile(new URL('../supabase/migrations/20261111120000_booking_location.sql',import.meta.url),'utf8'));
 const as=async(actor,sql,args=[])=>{await db.exec('set role authenticated');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[actor]);try{return await db.query(sql,args)}finally{await db.exec('reset role')}};
 const location={latitude:14.61,longitude:-61.07,access_details:'Entrée privée QA'};
 const call=(actor,l=location,k=key)=>as(actor,'select public.prepare_phone_booking_located($1,$2,$3,$4,$5,$6)',[k,'{}','{}','on_site',1,JSON.stringify(l)]);
 await call(a);await call(a);
 assert.equal((await as(a,'select * from public.booking_locations')).rows.length,1);
 assert.equal((await as(b,'select * from public.booking_locations')).rows.length,0);
 await assert.rejects(as(b,'update public.booking_locations set access_details=\'changed\''),e=>e.code==='42501');
 await assert.rejects(call(a,{...location,latitude:14.62}),e=>e.code==='P0001');
 for(const bad of [{...location,latitude:91},{...location,latitude:null},{...location,access_details:'a'.repeat(1001)},{...location,actor_id:b}])await assert.rejects(call(a,bad),e=>e.code==='22023');
 await assert.rejects(call(''),e=>e.code==='42501');
 await call(b);assert.equal((await as(b,'select * from public.booking_locations')).rows.length,1);
 assert.equal((await db.query('select count(*)::int n from public.booking_locations')).rows[0].n,2);
 console.log('Location SQL: replay, conflicting replay, RLS cross-account, write denial, bounds, malformed pair, anonymous denial passed. Booking/payment functions explicitly stubbed.');
} finally {await db.close()}

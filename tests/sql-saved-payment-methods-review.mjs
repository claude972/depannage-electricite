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
 const users=Object.fromEntries(['client','other','manager','artisan','unconfirmed','anonymous'].map(k=>[k,crypto.randomUUID()]));
 for(const [name,id]of Object.entries(users))await q("insert into auth.users(id,email,email_confirmed_at,is_anonymous,raw_user_meta_data)values($1,$2,$3,$4,$5)",[id,`${id}@example.test`,name==='unconfirmed'?null:new Date().toISOString(),name==='anonymous',JSON.stringify({role:['manager','artisan'].includes(name)?name:'client',full_name:'Test'})]);
 const as=async(role,uid='')=>{await db.exec('reset role');await q("select set_config('request.jwt.claim.sub',$1,false)",[uid]);await db.exec(`set role ${role}`)};
 const denied=async(sql,args=[],code='42501')=>{await assert.rejects(db.query(sql,args),e=>e.code===code);checks++};
 for(const role of ['manager','artisan','unconfirmed','anonymous']){await as('authenticated',users[role]);await denied('select public.saved_methods_guard()')}
 await as('authenticated',users.client);eq(await one('select public.saved_methods_guard()v'),users.client);
 await denied("select public.saved_methods_context($1,false)",[users.client]);
 await denied('select *from saved_payment_private.customers');
 await as('service_role');
 const context=(u=users.client,live=false)=>one('select public.saved_methods_context($1,$2)v',[u,live]);
 const cmd=crypto.randomUUID();
 const begin=(id=cmd,action='setup',method=null,u=users.client,live=false,consent=action==='setup'?true:null)=>one('select public.begin_saved_method_command($1,$2,$3,$4,$5,$6,$7)v',[u,live,id,action,method,action==='setup'?'https://app.example.test':null,consent]);
 eq((await context()).customer,null);
 let source=await begin();eq(source.customer.customer_id,null);eq(source.command.consent,true);
 eq((await begin()).command.id,source.command.id);
 await denied("select public.begin_saved_method_command($1,false,$2,'setup',null,'https://app.example.test',false)",[users.client,crypto.randomUUID()],'22023');
 await denied("select public.begin_saved_method_command($1,false,$2,'remove','pm_other',null,null)",[users.client,cmd],'P0001');
 await denied("select public.begin_saved_method_command($1,false,$2,'setup',null,'https://app.example.test',true)",[users.client,crypto.randomUUID()],'P0001');
 await denied('select public.bind_saved_customer($1,false,$2,\'cus_one\')',[users.other,source.customer.id]);
 await q("select public.bind_saved_customer($1,false,$2,'cus_one')",[users.client,source.customer.id]);
 await q("select public.bind_saved_customer($1,false,$2,'cus_one')",[users.client,source.customer.id]);
 await denied("select public.bind_saved_customer($1,false,$2,'cus_two')",[users.client,source.customer.id],'P0001');
 eq((await context()).customer.customer_id,'cus_one');eq((await context(users.other)).customer,null);eq((await context(users.client,true)).customer,null);
 await q("select public.record_saved_method_proof($1,false,$2,'cus_one','setup','cs_test_setup')",[users.client,cmd]);
 await denied("select public.record_saved_method_proof($1,false,$2,'cus_one','setup','cs_test_other')",[users.client,cmd],'P0001');
 const remove=crypto.randomUUID();await begin(remove,'remove','pm_card');
 await denied("select public.record_saved_method_proof($1,false,$2,'cus_one','removed',null)",[users.client,remove],'22023');
 await q("select public.record_saved_method_proof($1,false,$2,'cus_one','verified',null)",[users.client,remove]);
 await q("select public.record_saved_method_proof($1,false,$2,'cus_one','removed',null)",[users.client,remove]);
 eq((await begin(remove,'remove','pm_card')).command.removed,true);
 await denied("select public.record_saved_method_proof($1,false,$2,'cus_one','removed',null)",[users.other,remove]);
 // Creation uncertainty beyond the bounded key window cannot bind a new Customer.
 const old=await begin(crypto.randomUUID(),'setup',null,users.other);
 await as('postgres');await q("update saved_payment_private.customers set created_at=now()-interval '24 hours'where id=$1",[old.customer.id]);await as('service_role');
 await denied("select public.bind_saved_customer($1,false,$2,'cus_old')",[users.other,old.customer.id],'P0001');
 // Current Auth revocation applies even to an existing idempotent command.
 await as('postgres');await q('update auth.users set email_confirmed_at=null where id=$1',[users.client]);await as('service_role');await denied('select public.saved_methods_context($1,false)',[users.client]);
 await as('postgres');await q('update auth.users set email_confirmed_at=now()where id=$1',[users.client]);
 // Actual HTTP handlers + actual SQL functions, only Stripe is injected.
 const {createSavedMethodHandlers}=await import('../lib/features/saved-payment-methods/handlers.ts');
 const service={async rpc(name,args={}){await as('service_role');try{return {data:await one(`select public.${name}(${Object.keys(args).map((_,i)=>'$'+(i+1)).join(',')})v`,Object.values(args)),error:null}}catch(e){return {data:null,error:{code:e.code}}}}};
 const authenticated={async rpc(name){await as('authenticated',users.client);try{return {data:await one(`select public.${name}()v`),error:null}}catch(e){return {data:null,error:{code:e.code}}}}};
 let made=null,pm={id:'pm_integration',object:'payment_method',type:'card',customer:'cus_one',livemode:false,card:{brand:'visa',last4:'4242',exp_month:12,exp_year:2030}},detachCount=0;
 const stripe={customers:{retrieve:async()=>({id:'cus_one',object:'customer',livemode:false,metadata:{saved_customer_binding:source.customer.id}})},checkout:{sessions:{create:async(params)=>{made={id:'cs_test_integration',object:'checkout.session',...params,status:'open',url:'https://checkout.stripe.com/c/pay/test',amount_total:null,payment_intent:null,subscription:null,livemode:false};return made},retrieve:async()=>made}},paymentMethods:{list:async()=>({object:'list',data:pm.customer?[pm]:[],has_more:false}),retrieve:async()=>pm,detach:async()=>{detachCount++;pm={...pm,customer:null};return pm}}};
 const h=createSavedMethodHandlers({authenticate:async()=>({userId:users.client,db:authenticated}),admin:()=>service,stripe:()=>stripe,env:()=>({STRIPE_SECRET_KEY:'sk_test_injected',NEXT_PUBLIC_APP_URL:'https://app.example.test'})});
 const post=(body)=>h.POST(new Request('https://app.example.test/api/payments/methods',{method:'POST',headers:{origin:'https://app.example.test','Content-Type':'application/json'},body:JSON.stringify(body)}));
 const setup=crypto.randomUUID();eq((await post({action:'setup',consent:true,command_id:setup})).status,200);
 eq(made.mode,'setup');eq(made.success_url,'https://app.example.test/?saved_methods=returned#profile');
 const listed=await h.GET(new Request('https://app.example.test/api/payments/methods'));eq(listed.status,200);eq(Object.keys((await listed.json()).methods[0]).sort(),['brand','exp_month','exp_year','id','last4']);
 const removeId=crypto.randomUUID();eq((await post({action:'remove',method_id:pm.id,command_id:removeId})).status,200);eq(detachCount,1);
 eq((await post({action:'remove',method_id:pm.id,command_id:removeId})).status,200);eq(detachCount,1);

 // Only a new personal ledger in the configured mode can freeze a saved Customer.
 await as('postgres');
 await q("update public.profiles set artisan_approved=true,stripe_account_id='acct_QA' where id=$1",[users.artisan]);
 await q("insert into public.artisan_profiles(user_id,application_status)values($1,'approved')",[users.artisan]);
 const makeQuote=async()=>{
  const job=(await q("insert into public.interventions(client_id,artisan_id,category,description,address,postal_code,city,urgency,estimate_min_cents,estimate_max_cents,status)values($1,$2,'panel','Fixture client','Adresse de test','97200','QA','scheduled',100,200,'completed')returning id",[users.client,users.artisan]))[0].id;
  return (await q("insert into public.quotes(intervention_id,artisan_id,lines,subtotal_cents,tax_rate,tax_cents,total_cents,status)values($1,$2,'[{\"label\":\"QA\",\"quantity\":1,\"unit_price_cents\":10000}]',10000,20,2000,12000,'accepted')returning id",[job,users.artisan]))[0].id;
 };
 const legacyQuote=await makeQuote(), newQuote=await makeQuote();
 await as('authenticated',users.client);
 const beginCheckout=(quote,live=false)=>one('select public.begin_platform_checkout_with_saved_customer($1,$2)v',[quote,live]);
 const oldCheckout=await beginCheckout(legacyQuote);
 await as('postgres');await q('update saved_payment_private.checkout_control set live_mode=false');
 await as('authenticated',users.client);
 await denied('select public.begin_platform_checkout_with_saved_customer($1,true)',[newQuote]);
 eq(await beginCheckout(legacyQuote),oldCheckout);
 const newCheckout=await beginCheckout(newQuote);
 eq(await beginCheckout(newQuote),newCheckout);
 await denied('select public.platform_checkout_with_customer_private($1,$2,false)',[newCheckout,users.client]);
 await as('service_role');
 const readCheckout=(checkout,actor=users.client,live=false)=>one('select public.platform_checkout_with_customer_private($1,$2,$3)v',[checkout,actor,live]);
 eq((await readCheckout(oldCheckout)).saved_customer,null);
 eq((await readCheckout(newCheckout)).saved_customer,{id:'cus_one',binding_id:source.customer.id});
 await denied('select public.platform_checkout_private($1,$2)',[newCheckout,users.client]);
 await denied('select public.platform_checkout_with_customer_private($1,$2,false)',[newCheckout,users.other],'P0002');
 await denied('select public.platform_checkout_with_customer_private($1,$2,true)',[newCheckout,users.client]);
 await as('postgres');await q('update saved_payment_private.checkout_control set live_mode=null');
 await as('service_role');eq((await readCheckout(newCheckout)).saved_customer.id,'cus_one');
 console.log(`PASS saved payment methods: ${checks} checks, full SQL migrations and actual handlers with injected Stripe`);
}catch(e){console.error(e.message,e.code,e.query,e.stack?.split('\n').slice(0,5).join('\n'));process.exitCode=1}finally{await db.close()}

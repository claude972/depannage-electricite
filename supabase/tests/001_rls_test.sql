-- Run with `supabase test db` against an isolated dedicated TEST project only.
-- Runtime verification is pending provisioning; fixtures are rolled back.
begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select plan(18);
insert into auth.users(id,email,raw_user_meta_data) values
 ('10000000-0000-4000-8000-000000000001','client-a@example.test','{"full_name":"Client A","role":"client"}'),
 ('10000000-0000-4000-8000-000000000002','client-b@example.test','{"full_name":"Client B","role":"client"}'),
 ('10000000-0000-4000-8000-000000000003','artisan-a@example.test','{"full_name":"Artisan A","role":"artisan"}'),
 ('10000000-0000-4000-8000-000000000004','artisan-b@example.test','{"full_name":"Artisan B","role":"artisan"}'),
 ('10000000-0000-4000-8000-000000000005','malicious@example.test','{"full_name":"No Admin","role":"admin","artisan_approved":true}');
select is((select role from public.profiles where id='10000000-0000-4000-8000-000000000005'),'client','Signup metadata cannot grant admin');
select is((select artisan_approved from public.profiles where id='10000000-0000-4000-8000-000000000005'),false,'Signup metadata cannot approve artisan');

set local role authenticated;
set local request.jwt.claims='{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}';
select is((select count(*)::integer from public.profiles),1,'Profile scope is current account only');
select throws_ok($$update public.profiles set role='admin' where id=auth.uid()$$,'42501',null,'Direct profile escalation denied');
select lives_ok($$select public.create_intervention('outage','Le courant ne fonctionne plus','12 rue du Test','75001','Paris','urgent')$$,'Client can create an intervention');
select is((select count(*)::integer from public.interventions),1,'Creator sees own intervention');
select set_config('test.job_id',(select id::text from public.interventions limit 1),true);
select throws_ok($$update public.interventions set status='paid' where id=current_setting('test.job_id')::uuid$$,'42501',null,'Direct status mutation denied');
select throws_ok($$select public.confirm_stripe_payment('evt_forged','checkout.session.completed','cs_forged','10000000-0000-4000-8000-000000000001',100,'eur')$$,'42501',null,'Client cannot confirm Stripe payment');

set local request.jwt.claims='{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated"}';
select is((select count(*)::integer from public.interventions),0,'Another client cannot read intervention');
select throws_ok($$select public.intervention_action(current_setting('test.job_id')::uuid,'cancel')$$,'42501',null,'Another client cannot cancel intervention');

set local request.jwt.claims='{"sub":"10000000-0000-4000-8000-000000000003","role":"authenticated"}';
select is((select count(*)::integer from public.available_missions()),0,'Pending artisan sees no offers');
select throws_ok($$select public.intervention_action(current_setting('test.job_id')::uuid,'accept_mission')$$,'42501',null,'Pending artisan cannot claim mission');
reset role;
update public.profiles set artisan_approved=true where id in ('10000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000004');
-- Explicit eligibility fixture; approval alone no longer grants a global offer feed.
insert into public.artisan_profiles(user_id,company_name,siret,address,postal_codes,categories,available,application_status)
select id,'Entreprise test','12345678901234','12 rue du Test',array['75001'],array['outage'],true,'approved'
from public.profiles where id in ('10000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000004');
set local role authenticated;
set local request.jwt.claims='{"sub":"10000000-0000-4000-8000-000000000003","role":"authenticated"}';
select is((select count(*)::integer from public.interventions),0,'Approved artisan still cannot read full unassigned request');
select is((select count(*)::integer from public.available_missions()),1,'Approved artisan sees anonymized offer');
select lives_ok($$select public.intervention_action(current_setting('test.job_id')::uuid,'accept_mission')$$,'Approved artisan claims request');
set local request.jwt.claims='{"sub":"10000000-0000-4000-8000-000000000004","role":"authenticated"}';
select throws_ok($$select public.intervention_action(current_setting('test.job_id')::uuid,'accept_mission')$$,'42501',null,'Second artisan loses claim');
select is((select count(*)::integer from public.interventions),0,'Losing artisan cannot read customer details');
select throws_ok($$select public.approve_artisan(auth.uid(),true)$$,'42501',null,'Artisan cannot self-approve');
select * from finish();
rollback;

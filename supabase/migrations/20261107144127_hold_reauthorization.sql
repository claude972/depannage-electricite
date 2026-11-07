-- Versioned replacement holds, without changing original booking/provider facts.
begin;
alter table public.guest_settlements add column generation integer not null default 1,add column retired_at timestamptz;
alter table public.guest_settlements drop constraint guest_settlements_intervention_id_key;
create unique index guest_settlement_active_job on public.guest_settlements(intervention_id)where retired_at is null;
create unique index guest_settlement_generation on public.guest_settlements(intervention_id,generation);
create table public.hold_reauthorizations(
 id uuid primary key,intervention_id uuid not null references public.interventions(id),actor_id uuid not null references public.profiles(id),snapshot_id text not null,
 snapshot jsonb not null,old_ledger_id uuid references public.guest_settlements(id),old_intent text not null,old_session text not null,old_max integer not null,
 account_id text not null,fee_bps integer not null,fee_cents integer not null,return_origin text not null,
 session_id text unique,intent_id text unique,old_released boolean not null default false,
 status text not null default 'opening'check(status in('opening','awaiting_authorization','new_authorized','old_release_pending','ready_for_capture','aborting','aborted','needs_review')),
 created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp()
);
create unique index hold_reauthorization_active_job on public.hold_reauthorizations(intervention_id)where status<>'aborted';
create table public.guest_settlement_operations(ledger_id uuid primary key references public.guest_settlements(id),phase text not null check(phase in('capture_inflight','capture_confirmed','transfer_inflight','settled')),updated_at timestamptz not null default clock_timestamp());
create table public.hold_reauthorization_events(id bigint generated always as identity primary key,attempt_id uuid not null references public.hold_reauthorizations(id),action text not null,ledger_id uuid references public.guest_settlements(id),proof jsonb,created_at timestamptz not null default clock_timestamp());
alter table public.hold_reauthorizations enable row level security;alter table public.guest_settlement_operations enable row level security;alter table public.hold_reauthorization_events enable row level security;
revoke all on public.hold_reauthorizations,public.guest_settlement_operations,public.hold_reauthorization_events from public,anon,authenticated,service_role;
grant select on public.hold_reauthorizations,public.guest_settlement_operations to service_role;
-- Private service callers must use the checked write RPCs, including legacy review writes.
revoke insert,update,delete on public.guest_settlements from service_role;
-- Every existing lookup/guard sees a unique ACTIVE ledger. IDs remain unique across history.
do $$declare f record;original text;patched text;begin
 for f in select p.oid from pg_proc p where p.pronamespace='public'::regnamespace and p.prosrc like '%guest_settlements%'loop
  original=pg_get_functiondef(f.oid);
  patched=replace(original,'public.guest_settlements where','public.guest_settlements where retired_at is null and');
  if patched<>original then execute patched;end if;
 end loop;
end;$$;
-- Extend snapshot immutability only for an audited retirement marker; all old fields remain immutable.
create or replace function public.guard_guest_settlement_snapshot()returns trigger language plpgsql security definer set search_path=''as $$
begin
 if(to_jsonb(new)-array['status','account_id','fee_bps','fee_cents','transfer_cents','charge_id','transfer_id','captured_at','transfer_started_at','paid_at','retired_at'])is distinct from(to_jsonb(old)-array['status','account_id','fee_bps','fee_cents','transfer_cents','charge_id','transfer_id','captured_at','transfer_started_at','paid_at','retired_at'])or
 (old.account_id is not null and new.account_id is distinct from old.account_id)or(old.fee_bps is not null and(new.fee_bps is distinct from old.fee_bps or new.fee_cents is distinct from old.fee_cents or new.transfer_cents is distinct from old.transfer_cents))or
 (old.charge_id is not null and new.charge_id is distinct from old.charge_id)or(old.transfer_id is not null and new.transfer_id is distinct from old.transfer_id)or(old.captured_at is not null and new.captured_at is distinct from old.captured_at)or(old.transfer_started_at is not null and new.transfer_started_at is distinct from old.transfer_started_at)or(old.paid_at is not null and new.paid_at is distinct from old.paid_at)or(old.status='paid'and new.status<>'paid')or(old.retired_at is not null and to_jsonb(new) is distinct from to_jsonb(old))then raise exception 'Financial snapshot immutable'using errcode='P0001';end if;
 if old.retired_at is null and new.retired_at is not null and(old.status<>'processing'or old.charge_id is not null or old.transfer_id is not null or old.captured_at is not null or old.transfer_started_at is not null or old.paid_at is not null)then raise exception 'Captured ledger cannot retire'using errcode='P0001';end if;
 return new;
end;$$;
create function public.guest_settlement_generation_insert()returns trigger language plpgsql security definer set search_path=''as $$begin
 perform 1 from public.interventions where id=new.intervention_id for update;
 select coalesce(max(generation),0)+1 into new.generation from public.guest_settlements where intervention_id=new.intervention_id;return new;end;$$;
revoke all on function public.guest_settlement_generation_insert()from public,anon,authenticated,service_role;
create trigger guest_settlement_generation_insert before insert on public.guest_settlements for each row execute function public.guest_settlement_generation_insert();
create function public.hold_actor_allowed(p_actor uuid,p_job uuid)returns boolean language sql stable security definer set search_path=''as $$
 select public.platform_checkout_actor_can_pay(p_job,p_actor)and exists(select 1 from auth.users u join public.profiles p on p.id=u.id where u.id=p_actor and p.role='client' and (u.email_confirmed_at is not null or(u.phone_confirmed_at is not null and u.phone is not null)));
$$;revoke all on function public.hold_actor_allowed(uuid,uuid)from public,anon,authenticated,service_role;
-- Preserve source OID as an inaccessible historical implementation.
alter function public.guest_settlement_source(uuid,uuid)rename to guest_settlement_source_before_reauthorization;
revoke all on function public.guest_settlement_source_before_reauthorization(uuid,uuid)from public,anon,authenticated,service_role;
create function public.hold_reauthorization_context(p_job uuid,p_actor uuid)returns jsonb language plpgsql stable security definer set search_path=''as $$
declare s jsonb;context jsonb;
begin
 s=public.guest_settlement_source_before_reauthorization(p_job,p_actor);
 select jsonb_build_object('site_id',j.site_id,'organization_id',site.organization_id,'quote_document',to_jsonb(q),
 'amendment_documents',(select coalesce(jsonb_agg(to_jsonb(m) order by m.id),'[]'::jsonb)from public.quote_amendments m where m.base_quote_id=q.id and m.status='accepted'))into context
 from public.interventions j left join public.sites site on site.id=j.site_id left join public.quotes q on q.id=(s->>'quote_id')::uuid where j.id=p_job;
 return s||context;
end;$$;revoke all on function public.hold_reauthorization_context(uuid,uuid)from public,anon,authenticated,service_role;
create function public.hold_reauthorization_source(p_job uuid,p_actor uuid)returns jsonb language plpgsql stable security definer set search_path=''as $$
#variable_conflict use_column
declare s jsonb;l public.guest_settlements;a public.hold_reauthorizations;
begin
 if not public.hold_actor_allowed(p_actor,p_job)then raise no_data_found;end if;
 s=public.hold_reauthorization_context(p_job,p_actor);
 select *into l from public.guest_settlements where intervention_id=p_job and retired_at is null;
 select *into a from public.hold_reauthorizations where intervention_id=p_job and status<>'aborted';
 return jsonb_build_object('source',s,'ledger',case when l.id is null then null else to_jsonb(l)end,'attempt',case when a.id is null then null else to_jsonb(a)end,'capture_inflight',exists(select 1 from public.guest_settlement_operations where ledger_id=l.id),
 'snapshot_id',encode(sha256(convert_to((s-array['reason','session_id','intent_id','authorized_max'])::text,'UTF8')),'hex'));
end;$$;revoke all on function public.hold_reauthorization_source(uuid,uuid)from public,anon,authenticated,service_role;grant execute on function public.hold_reauthorization_source(uuid,uuid)to service_role;
create function public.guest_settlement_source(p_job uuid,p_actor uuid)returns jsonb language plpgsql security definer set search_path=''as $$
#variable_conflict use_column
declare s jsonb;a public.hold_reauthorizations;
begin
 if not public.hold_actor_allowed(p_actor,p_job)then raise no_data_found;end if;
 s=public.guest_settlement_source_before_reauthorization(p_job,p_actor);
 select *into a from public.hold_reauthorizations where intervention_id=p_job and status<>'aborted';
 if found then
  if a.status='ready_for_capture'and s->>'quote_id'=a.snapshot->>'quote_id'and s->'amendments'=a.snapshot->'amendments'and s->>'amount_cents'=a.snapshot->>'amount_cents'and(s->>'reason'in('quote_exceeds_hold','authorization_missing')or s->>'reason'is null)then
   return s||jsonb_build_object('session_id',a.session_id,'intent_id',a.intent_id,'authorized_max',(a.snapshot->>'amount_cents')::integer,'account_id',a.account_id,'reason',null);
  end if;
  return s||jsonb_build_object('reason','reauthorization_pending');
 end if;
 if exists(select 1 from public.hold_reauthorizations where intervention_id=p_job and old_released)then return s||jsonb_build_object('reason','authorization_missing');end if;
 return s;
end;$$;revoke all on function public.guest_settlement_source(uuid,uuid)from public,anon,authenticated,service_role;grant execute on function public.guest_settlement_source(uuid,uuid)to service_role;
-- Active replacement freezes financial changes and the old capture route.
create function public.guard_hold_reauthorization_work()returns trigger language plpgsql security definer set search_path=''as $$
declare job uuid;
begin
 if tg_table_name='profiles'then
  if new.stripe_account_id is distinct from old.stripe_account_id and exists(select 1 from public.hold_reauthorizations a where a.snapshot->>'artisan_id'=old.id::text and a.status<>'aborted')then raise exception 'Replacement freezes recipient'using errcode='P0001';end if;return new;
 end if;
 if tg_table_name='interventions'then job=old.id;elsif tg_op='DELETE'then job=old.intervention_id;else job=new.intervention_id;end if;
 if exists(select 1 from public.hold_reauthorizations where intervention_id=job and status<>'aborted')then
  if tg_table_name='interventions'then
   if new.client_id is distinct from old.client_id or new.artisan_id is distinct from old.artisan_id or new.site_id is distinct from old.site_id or(new.status is distinct from old.status and new.status<>'paid')then raise exception 'Replacement freezes financial context'using errcode='P0001';end if;
  else raise exception 'Replacement freezes financial context'using errcode='P0001';end if;
 end if;
 if tg_op='DELETE'then return old;end if;return new;
end;$$;revoke all on function public.guard_hold_reauthorization_work()from public,anon,authenticated,service_role;
create trigger hold_job_guard before update on public.interventions for each row execute function public.guard_hold_reauthorization_work();
create trigger hold_quote_guard before insert or update or delete on public.quotes for each row execute function public.guard_hold_reauthorization_work();
create trigger hold_amendment_guard before insert or update or delete on public.quote_amendments for each row execute function public.guard_hold_reauthorization_work();
create trigger hold_account_guard before update on public.profiles for each row execute function public.guard_hold_reauthorization_work();
-- The current client can prepare only the EXACT financial snapshot shown. Policy values are service-only.
create function public.begin_hold_reauthorization(p_job uuid,p_command uuid,p_snapshot text)returns uuid language plpgsql security definer set search_path=''as $$
#variable_conflict use_column
declare actor uuid=public.guest_booking_actor();v jsonb;s jsonb;a public.hold_reauthorizations;l public.guest_settlements;
begin
 perform public.lock_intervention_organization(p_job);perform 1 from public.interventions where id=p_job for update;
 v=public.hold_reauthorization_source(p_job,actor);s=v->'source';
 select *into a from public.hold_reauthorizations where id=p_command;
 if found then if a.actor_id<>actor or a.intervention_id<>p_job or a.snapshot_id<>p_snapshot then raise exception 'Command conflict'using errcode='P0001';end if;return a.id;end if;
 if p_command is null or p_snapshot is distinct from v->>'snapshot_id'or(s->>'amount_cents')::bigint not between 1 and 2147483647 or s->>'job_status'<>'completed'or s->>'reason'not in('quote_exceeds_hold','authorization_missing')and s->>'reason'is not null then raise exception 'Snapshot not eligible'using errcode='P0001';end if;
 if exists(select 1 from public.hold_reauthorizations where intervention_id=p_job and status<>'aborted')or exists(select 1 from public.payments p join public.quotes q on q.id=p.quote_id where q.intervention_id=p_job)then raise exception 'Another financial operation exists'using errcode='P0001';end if;
 select *into l from public.guest_settlements where intervention_id=p_job and retired_at is null;
 if found and(l.status<>'processing'or l.charge_id is not null or l.transfer_id is not null or l.captured_at is not null or l.transfer_started_at is not null or exists(select 1 from public.guest_settlement_operations where ledger_id=l.id))then raise exception 'Old capture ambiguous'using errcode='P0001';end if;
 -- Service qualification fills immutable policy/recipient before opening a provider session.
 insert into public.hold_reauthorizations(id,intervention_id,actor_id,snapshot_id,snapshot,old_ledger_id,old_intent,old_session,old_max,account_id,fee_bps,fee_cents,return_origin)
 values(p_command,p_job,actor,p_snapshot,s,l.id,coalesce(l.intent_id,s->>'intent_id'),coalesce(l.session_id,s->>'session_id'),coalesce(l.authorized_max,(s->>'authorized_max')::integer),s->>'account_id',-1,-1,'');
 insert into public.hold_reauthorization_events(attempt_id,action)values(p_command,'client_consented');return p_command;
end;$$;revoke all on function public.begin_hold_reauthorization(uuid,uuid,text)from public,anon,authenticated,service_role;grant execute on function public.begin_hold_reauthorization(uuid,uuid,text)to authenticated;
create function public.hold_reauthorization_private(p_id uuid,p_actor uuid)returns jsonb language plpgsql stable security definer set search_path=''as $$declare a public.hold_reauthorizations;begin
 select *into a from public.hold_reauthorizations where id=p_id and actor_id=p_actor;if not found then raise no_data_found;end if;return to_jsonb(a);end;$$;
revoke all on function public.hold_reauthorization_private(uuid,uuid)from public,anon,authenticated,service_role;grant execute on function public.hold_reauthorization_private(uuid,uuid)to service_role;
create function public.qualify_hold_reauthorization(p_id uuid,p_actor uuid,p_account text,p_fee integer,p_origin text)returns void language plpgsql security definer set search_path=''as $$
#variable_conflict use_column
declare a public.hold_reauthorizations;s jsonb;fee integer;
begin
 select *into a from public.hold_reauthorizations where id=p_id and actor_id=p_actor;if not found then raise no_data_found;end if;
 perform public.lock_intervention_organization(a.intervention_id);perform 1 from public.interventions where id=a.intervention_id for update;select *into a from public.hold_reauthorizations where id=p_id for update;
 s=public.hold_reauthorization_context(a.intervention_id,p_actor);
 if not public.hold_actor_allowed(p_actor,a.intervention_id)or a.status not in('opening','awaiting_authorization','new_authorized')or s->>'account_id'is distinct from p_account or(s-array['reason','session_id','intent_id','authorized_max'])is distinct from(a.snapshot-array['reason','session_id','intent_id','authorized_max'])then raise exception 'Replacement context changed'using errcode='P0001';end if;
 if exists(select 1 from public.guest_settlements l where l.id=a.old_ledger_id and (l.account_id is distinct from p_account or (l.fee_bps is not null and l.fee_bps is distinct from p_fee)))then raise exception 'Historical recipient or fee changed'using errcode='P0001';end if;
 if p_account is null or p_account!~'^acct_[A-Za-z0-9]{1,200}$'or p_fee is null or p_fee not between 0 and 9999 or p_origin is null or p_origin!~'^https://[A-Za-z0-9.-]+(:[0-9]+)?$'then raise invalid_parameter_value;end if;
 fee=round((a.snapshot->>'amount_cents')::numeric*p_fee/10000);if fee>=(a.snapshot->>'amount_cents')::integer then raise invalid_parameter_value;end if;
 if a.fee_bps<>-1 and(a.fee_bps<>p_fee or a.account_id<>p_account or a.return_origin<>p_origin)then raise exception 'Frozen policy changed'using errcode='P0001';end if;
 update public.hold_reauthorizations set account_id=p_account,fee_bps=p_fee,fee_cents=fee,return_origin=p_origin,updated_at=clock_timestamp()where id=p_id;
end;$$;revoke all on function public.qualify_hold_reauthorization(uuid,uuid,text,integer,text)from public,anon,authenticated,service_role;grant execute on function public.qualify_hold_reauthorization(uuid,uuid,text,integer,text)to service_role;
create function public.bind_hold_reauthorization(p_id uuid,p_actor uuid,p_session text,p_intent text,p_authorized boolean)returns void language plpgsql security definer set search_path=''as $$
#variable_conflict use_column
declare a public.hold_reauthorizations;
begin
 select *into a from public.hold_reauthorizations where id=p_id and actor_id=p_actor;if not found then raise no_data_found;end if;perform 1 from public.interventions where id=a.intervention_id for update;select *into a from public.hold_reauthorizations where id=p_id for update;
 if(a.status<>'aborting'and not public.hold_actor_allowed(p_actor,a.intervention_id))or a.fee_bps<0 or a.status not in('opening','awaiting_authorization','new_authorized','aborting')or p_session is null or p_session!~'^cs_[A-Za-z0-9_]{1,240}$'or(p_intent is not null and p_intent!~'^pi_[A-Za-z0-9]{1,200}$')or(p_authorized is true and p_intent is null)or p_authorized is null or(a.session_id is not null and a.session_id<>p_session)or(a.intent_id is not null and a.intent_id is distinct from p_intent)then raise exception 'Replacement binding mismatch'using errcode='P0001';end if;
 update public.hold_reauthorizations set session_id=p_session,intent_id=coalesce(intent_id,p_intent),status=case when status='aborting'then'aborting'when p_authorized then 'new_authorized'else 'awaiting_authorization'end,updated_at=clock_timestamp()where id=p_id;
end;$$;revoke all on function public.bind_hold_reauthorization(uuid,uuid,text,text,boolean)from public,anon,authenticated,service_role;grant execute on function public.bind_hold_reauthorization(uuid,uuid,text,text,boolean)to service_role;
create function public.authorize_hold_reauthorization(p_id uuid,p_actor uuid,p_action text)returns void language plpgsql security definer set search_path=''as $$
#variable_conflict use_column
declare a public.hold_reauthorizations;
begin
 select *into a from public.hold_reauthorizations where id=p_id and actor_id=p_actor;if not found then raise no_data_found;end if;perform public.lock_intervention_organization(a.intervention_id);perform 1 from public.interventions where id=a.intervention_id for update;select *into a from public.hold_reauthorizations where id=p_id for update;
 if p_action is null or p_action not in('open','release_old','abort')or a.status in('aborted','needs_review')then raise exception 'Replacement needs reconciliation'using errcode='P0001';end if;
 if p_action<>'abort'and (not public.hold_actor_allowed(p_actor,a.intervention_id) or (public.hold_reauthorization_context(a.intervention_id,p_actor)-array['reason','session_id','intent_id','authorized_max']) is distinct from(a.snapshot-array['reason','session_id','intent_id','authorized_max']))then raise no_data_found;end if;
 if(p_action='open'and(a.status<>'opening'or a.fee_bps<0))or(p_action='release_old'and(a.status not in('new_authorized','old_release_pending')or a.intent_id is null))or(p_action='abort'and (a.status='ready_for_capture'or(a.status='old_release_pending'and not a.old_released)))then raise exception 'Replacement phase conflict'using errcode='P0001';end if;
 update public.hold_reauthorizations set status=case p_action when'release_old'then'old_release_pending'when'abort'then'aborting'else status end,updated_at=clock_timestamp()where id=p_id;
end;$$;revoke all on function public.authorize_hold_reauthorization(uuid,uuid,text)from public,anon,authenticated,service_role;grant execute on function public.authorize_hold_reauthorization(uuid,uuid,text)to service_role;
create function public.hold_zero_capture_proof(p_proof jsonb,p_intent text,p_max integer)returns boolean language sql immutable set search_path=''as $$
 select p_proof is not null and p_proof->>'intent_id'=p_intent and p_proof->>'status'='canceled'and jsonb_typeof(p_proof->'amount_received')='number'and p_proof->'amount_received'='0'::jsonb and jsonb_typeof(p_proof->'amount_capturable')='number'and p_proof->'amount_capturable'='0'::jsonb and
 jsonb_typeof(p_proof->'amount_captured')='number'and p_proof->'amount_captured'='0'::jsonb and jsonb_typeof(p_proof->'amount')='number'and(p_proof->>'amount')::numeric=p_max and p_proof->'transfer_count'='0'::jsonb and p_proof->'complete'='true'::jsonb and p_proof->>'charge_id'~'^ch_[A-Za-z0-9]{1,200}$';
$$;revoke all on function public.hold_zero_capture_proof(jsonb,text,integer)from public,anon,authenticated,service_role;
create function public.record_hold_release(p_id uuid,p_actor uuid,p_proof jsonb,p_abort boolean)returns void language plpgsql security definer set search_path=''as $$
#variable_conflict use_column
declare a public.hold_reauthorizations;l public.guest_settlements;target text;maximum integer;
begin
 select *into a from public.hold_reauthorizations where id=p_id and actor_id=p_actor;if not found then raise no_data_found;end if;perform public.lock_intervention_organization(a.intervention_id);perform 1 from public.interventions where id=a.intervention_id for update;select *into a from public.hold_reauthorizations where id=p_id for update;
 if p_abort is null or(p_abort and a.status<>'aborting')or(not p_abort and a.status<>'old_release_pending')then raise exception 'Release phase conflict'using errcode='P0001';end if;
 target=case when p_abort then a.intent_id else a.old_intent end;maximum=case when p_abort then(a.snapshot->>'amount_cents')::integer else a.old_max end;
 if public.hold_zero_capture_proof(p_proof,target,maximum)is distinct from true then raise exception 'Complete zero-capture proof required'using errcode='P0001';end if;
 select *into l from public.guest_settlements where intervention_id=a.intervention_id and intent_id=target and retired_at is null for update;
 if found then
  if l.status<>'processing'or l.charge_id is not null or l.transfer_id is not null or l.captured_at is not null or l.transfer_started_at is not null or l.paid_at is not null or exists(select 1 from public.guest_settlement_operations where ledger_id=l.id)then raise exception 'Capture in flight or unknown'using errcode='P0001';end if;
  update public.guest_settlements set retired_at=clock_timestamp()where id=l.id;
  insert into public.hold_reauthorization_events(attempt_id,action,ledger_id)values(p_id,'ledger_retired_zero_capture',l.id);
 end if;
 if not p_abort and a.old_released then return;end if;
 update public.hold_reauthorizations set old_released=old_released or not p_abort,status=case when p_abort then'aborted'else'old_release_pending'end,updated_at=clock_timestamp()where id=p_id;
 insert into public.hold_reauthorization_events(attempt_id,action,proof)values(p_id,case when p_abort then'new_hold_released'else'old_hold_released'end,p_proof);
end;$$;revoke all on function public.record_hold_release(uuid,uuid,jsonb,boolean)from public,anon,authenticated,service_role;grant execute on function public.record_hold_release(uuid,uuid,jsonb,boolean)to service_role;
-- A never-authorized open Checkout may be closed only after its session is independently expired and no PI exists.
create function public.record_hold_session_expired(p_id uuid,p_actor uuid,p_session text)returns void language plpgsql security definer set search_path=''as $$
#variable_conflict use_column
declare a public.hold_reauthorizations;
begin
 select *into a from public.hold_reauthorizations where id=p_id and actor_id=p_actor for update;
 if not found or a.status<>'aborting'or a.intent_id is not null or a.session_id is distinct from p_session or(p_session is null and a.fee_bps<>-1)then raise exception 'Session closure mismatch'using errcode='P0001';end if;
 update public.hold_reauthorizations set status='aborted',updated_at=clock_timestamp()where id=p_id;insert into public.hold_reauthorization_events(attempt_id,action)values(p_id,'new_checkout_expired_no_intent');
end;$$;revoke all on function public.record_hold_session_expired(uuid,uuid,text)from public,anon,authenticated,service_role;grant execute on function public.record_hold_session_expired(uuid,uuid,text)to service_role;
create function public.adopt_hold_reauthorization(p_id uuid,p_actor uuid)returns void language plpgsql security definer set search_path=''as $$
#variable_conflict use_column
declare a public.hold_reauthorizations;s jsonb;
begin
 select *into a from public.hold_reauthorizations where id=p_id and actor_id=p_actor;if not found then raise no_data_found;end if;perform public.lock_intervention_organization(a.intervention_id);perform 1 from public.interventions where id=a.intervention_id for update;select *into a from public.hold_reauthorizations where id=p_id for update;
 s=public.hold_reauthorization_context(a.intervention_id,p_actor);
 if (s-array['reason','session_id','intent_id','authorized_max']) is distinct from(a.snapshot-array['reason','session_id','intent_id','authorized_max'])or not public.hold_actor_allowed(p_actor,a.intervention_id)or not a.old_released or a.intent_id is null or a.session_id is null or a.status<>'old_release_pending'or exists(select 1 from public.guest_settlements where intervention_id=a.intervention_id and retired_at is null)then raise exception 'Replacement cannot activate'using errcode='P0001';end if;
 update public.hold_reauthorizations set status='ready_for_capture',updated_at=clock_timestamp()where id=p_id;insert into public.hold_reauthorization_events(attempt_id,action)values(p_id,'new_hold_adopted');
end;$$;revoke all on function public.adopt_hold_reauthorization(uuid,uuid)from public,anon,authenticated,service_role;grant execute on function public.adopt_hold_reauthorization(uuid,uuid)to service_role;
create function public.review_hold_reauthorization(p_id uuid,p_actor uuid)returns void language plpgsql security definer set search_path=''as $$begin
 update public.hold_reauthorizations set status='needs_review',updated_at=clock_timestamp()where id=p_id and actor_id=p_actor and status<>'aborted';end;$$;revoke all on function public.review_hold_reauthorization(uuid,uuid)from public,anon,authenticated,service_role;grant execute on function public.review_hold_reauthorization(uuid,uuid)to service_role;
-- Protect old private OIDs and fill the replacement's historical policy at new ledger creation.
alter function public.begin_guest_settlement(uuid)rename to begin_guest_settlement_before_reauthorization;
revoke all on function public.begin_guest_settlement_before_reauthorization(uuid)from public,anon,authenticated,service_role;
create function public.begin_guest_settlement(p_intervention_id uuid)returns uuid language plpgsql security definer set search_path=''as $$
#variable_conflict use_column
declare result uuid;a public.hold_reauthorizations;
begin
 result=public.begin_guest_settlement_before_reauthorization(p_intervention_id);
 select *into a from public.hold_reauthorizations where intervention_id=p_intervention_id and status='ready_for_capture';
 if found then update public.guest_settlements set fee_bps=a.fee_bps,fee_cents=a.fee_cents,transfer_cents=amount_cents-a.fee_cents where id=result and retired_at is null and fee_bps is null;end if;return result;
end;$$;revoke all on function public.begin_guest_settlement(uuid)from public,anon,authenticated,service_role;grant execute on function public.begin_guest_settlement(uuid)to authenticated;
create function public.authorize_guest_settlement_operation(p_id uuid,p_actor uuid,p_phase text)returns void language plpgsql security definer set search_path=''as $$
#variable_conflict use_column
declare l public.guest_settlements;s jsonb;
begin
 select *into l from public.guest_settlements where id=p_id and actor_id=p_actor;if not found then raise no_data_found;end if;perform public.lock_intervention_organization(l.intervention_id);perform 1 from public.interventions where id=l.intervention_id for update;select *into l from public.guest_settlements where id=p_id for update;
 s=public.guest_settlement_source(l.intervention_id,p_actor);
 if l.retired_at is not null or l.status in('paid','needs_review')or s->>'reason'is not null or s->>'intent_id'<>l.intent_id or(s->>'amount_cents')::integer<>l.amount_cents or s->'amendments'<>l.amendments or(p_phase='capture'and l.status<>'processing')or(p_phase='transfer'and l.status<>'captured_transfer_pending')or p_phase not in('capture','transfer')then raise exception 'Stale settlement generation'using errcode='P0001';end if;
 insert into public.guest_settlement_operations(ledger_id,phase)values(l.id,p_phase||'_inflight')on conflict(ledger_id)do update set phase=excluded.phase,updated_at=clock_timestamp();
end;$$;revoke all on function public.authorize_guest_settlement_operation(uuid,uuid,text)from public,anon,authenticated,service_role;grant execute on function public.authorize_guest_settlement_operation(uuid,uuid,text)to service_role;
alter function public.record_guest_settlement(uuid,uuid,text,integer,text,integer,text)rename to record_guest_settlement_before_reauthorization;
revoke all on function public.record_guest_settlement_before_reauthorization(uuid,uuid,text,integer,text,integer,text)from public,anon,authenticated,service_role;
create function public.record_guest_settlement(p_id uuid,p_actor uuid,p_charge text,p_amount integer,p_transfer text default null,p_net integer default null,p_account text default null)returns void language plpgsql security definer set search_path=''as $$
declare l public.guest_settlements;a public.hold_reauthorizations;
begin
 select *into l from public.guest_settlements where id=p_id and actor_id=p_actor;
 if not found then raise no_data_found;end if;perform public.lock_intervention_organization(l.intervention_id);perform 1 from public.interventions where id=l.intervention_id for update;select *into l from public.guest_settlements where id=p_id for update;
 if l.retired_at is not null then
  if p_charge is null or p_charge!~'^ch_[A-Za-z0-9]{1,200}$'or p_amount is distinct from l.amount_cents then raise insufficient_privilege;end if;
  select *into a from public.hold_reauthorizations where old_ledger_id=l.id order by created_at desc limit 1;
  insert into public.hold_reauthorization_events(attempt_id,action,ledger_id,proof)values(a.id,'retired_provider_observation',l.id,jsonb_build_object('charge_id',p_charge,'amount_cents',p_amount,'transfer_id',p_transfer,'net_cents',p_net,'account_id',p_account));
  update public.hold_reauthorizations set status='needs_review',updated_at=clock_timestamp()where id=a.id and status<>'aborted';
  return;
 end if;
 perform public.record_guest_settlement_before_reauthorization(p_id,p_actor,p_charge,p_amount,p_transfer,p_net,p_account);
 insert into public.guest_settlement_operations(ledger_id,phase)values(p_id,case when p_transfer is null then'capture_confirmed'else'settled'end)on conflict(ledger_id)do update set phase=excluded.phase,updated_at=clock_timestamp();end;$$;
revoke all on function public.record_guest_settlement(uuid,uuid,text,integer,text,integer,text)from public,anon,authenticated,service_role;grant execute on function public.record_guest_settlement(uuid,uuid,text,integer,text,integer,text)to service_role;
create function public.review_guest_settlement(p_id uuid,p_actor uuid)returns void language plpgsql security definer set search_path=''as $$begin update public.guest_settlements set status='needs_review'where id=p_id and actor_id=p_actor and retired_at is null and status<>'paid';end;$$;
revoke all on function public.review_guest_settlement(uuid,uuid)from public,anon,authenticated,service_role;grant execute on function public.review_guest_settlement(uuid,uuid)to service_role;
commit;

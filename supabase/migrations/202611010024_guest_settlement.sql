-- Final capture is distinct from initial authorization. All provider state stays private.
begin;
create table public.guest_settlements (
 id uuid primary key default gen_random_uuid(), intervention_id uuid not null unique references public.interventions(id) on delete cascade,
 actor_id uuid not null references auth.users(id) on delete cascade, quote_id uuid not null references public.quotes(id) on delete cascade,
 artisan_id uuid not null references public.profiles(id), request_id uuid not null,
 session_id text not null unique, intent_id text not null unique, authorized_max integer not null check(authorized_max>0),
 amount_cents integer not null check(amount_cents>0 and amount_cents<=authorized_max), amendments jsonb not null,
 account_id text, fee_bps integer check(fee_bps between 0 and 10000), fee_cents integer, transfer_cents integer check(transfer_cents>0),
 status text not null default 'processing' check(status in ('processing','captured_transfer_pending','paid','needs_review')),
 charge_id text unique, transfer_id text unique, captured_at timestamptz, transfer_started_at timestamptz, paid_at timestamptz,
 created_at timestamptz not null default clock_timestamp()
);
alter table public.guest_settlements enable row level security;
revoke all on public.guest_settlements from public,anon,authenticated;
grant select,insert,update,delete on public.guest_settlements to service_role;

-- Internal read: same actor and job, no global lookup. Only the server may read provider identifiers.
create function public.guest_settlement_source(p_job uuid,p_actor uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare b public.phone_booking_requests; j public.interventions; q public.quotes; a public.profiles; amendments jsonb; amount bigint; reason text;
begin
 select * into b from public.phone_booking_requests where actor_id=p_actor and intervention_id=p_job and method='card_hold' and status='confirmed';
 if not found then raise no_data_found; end if;
 select * into j from public.interventions where id=p_job and client_id=p_actor;
 if not found then raise no_data_found; end if;
 select * into q from public.quotes where intervention_id=j.id and status='accepted';
 select * into a from public.profiles where id=j.artisan_id;
 select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'version',m.version,'total_cents',m.total_cents) order by m.id),'[]'::jsonb),coalesce(sum(m.total_cents),0) into amendments,amount from public.quote_amendments m where m.base_quote_id=q.id and m.status='accepted';
 amount=amount+q.total_cents;
 reason=case when j.status not in ('completed','paid') then 'not_completed' when q.id is null then 'quote_required'
  when q.artisan_id is distinct from j.artisan_id or not coalesce(a.artisan_approved,false) or a.role is distinct from 'artisan' or a.stripe_account_id is null then 'artisan_incomplete'
  when amount>b.expected_max_cents or amount>2147483647 then 'quote_exceeds_hold'
  when b.stripe_payment_intent_id is null or b.stripe_session_id is null then 'authorization_missing' else null end;
 return jsonb_build_object('actor_id',p_actor,'intervention_id',j.id,'quote_id',q.id,'artisan_id',j.artisan_id,'account_id',a.stripe_account_id,
  'request_id',b.request_id,'session_id',b.stripe_session_id,'intent_id',b.stripe_payment_intent_id,'authorized_max',b.expected_max_cents,
  'amount_cents',amount,'amendments',amendments,'reason',reason,'job_status',j.status);
end; $$;
revoke all on function public.guest_settlement_source(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.guest_settlement_source(uuid,uuid) to service_role;

create function public.guest_settlement_status(p_intervention_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid=public.guest_booking_actor(); s jsonb; l public.guest_settlements;
begin
 s=public.guest_settlement_source(p_intervention_id,actor);
 select * into l from public.guest_settlements where intervention_id=p_intervention_id and actor_id=actor;
 return jsonb_build_object('method','card_hold','status',coalesce(l.status,'not_started'),'amount_cents',coalesce(l.amount_cents,(s->>'amount_cents')::bigint),'currency','eur',
  'available',s->>'reason' is null and coalesce(l.status,'not_started') not in ('paid','needs_review'),
  'reason',case when l.status='paid' then 'settled' when l.status='needs_review' then 'manual_review' else s->>'reason' end);
end; $$;
revoke all on function public.guest_settlement_status(uuid) from public,anon,authenticated,service_role;
grant execute on function public.guest_settlement_status(uuid) to authenticated;

create function public.begin_guest_settlement(p_intervention_id uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare actor uuid=public.guest_booking_actor(); s jsonb; l public.guest_settlements;
begin
 perform public.lock_intervention_organization(p_intervention_id);
 perform 1 from public.interventions where id=p_intervention_id and client_id=actor for update;
 if not found then raise no_data_found; end if;
 s=public.guest_settlement_source(p_intervention_id,actor);
 select * into l from public.guest_settlements where intervention_id=p_intervention_id for update;
 if found then
  if l.actor_id<>actor or l.quote_id::text is distinct from s->>'quote_id' or l.artisan_id::text is distinct from s->>'artisan_id' or l.amount_cents is distinct from (s->>'amount_cents')::bigint or l.amendments is distinct from s->'amendments' then raise exception 'Financial snapshot changed' using errcode='P0001'; end if;
  return l.id;
 end if;
 if s->>'reason' is not null or s->>'job_status'<>'completed' or exists(select 1 from public.payments where quote_id=(s->>'quote_id')::uuid) then raise exception 'Settlement is not ready' using errcode='P0001'; end if;
 perform public.consume_action('guest_settlement',5);
 insert into public.guest_settlements(intervention_id,actor_id,quote_id,artisan_id,request_id,session_id,intent_id,authorized_max,amount_cents,amendments,account_id)
 values(p_intervention_id,actor,(s->>'quote_id')::uuid,(s->>'artisan_id')::uuid,(s->>'request_id')::uuid,s->>'session_id',s->>'intent_id',(s->>'authorized_max')::integer,(s->>'amount_cents')::integer,s->'amendments',s->>'account_id') returning * into l;
 return l.id;
end; $$;
revoke all on function public.begin_guest_settlement(uuid) from public,anon,authenticated,service_role;
grant execute on function public.begin_guest_settlement(uuid) to authenticated;

-- Recipient + fee come only from the server after an independent Connect read.
create function public.qualify_guest_settlement(p_id uuid,p_actor uuid,p_account text,p_fee integer) returns void language plpgsql security definer set search_path='' as $$
declare l public.guest_settlements; s jsonb; fee integer; job uuid;
begin
 select intervention_id into job from public.guest_settlements where id=p_id and actor_id=p_actor;
 if not found then raise no_data_found;end if;
 perform 1 from public.interventions where id=job for update;
 if not found then raise no_data_found;end if;
 select * into l from public.guest_settlements where id=p_id and actor_id=p_actor and intervention_id=job for update;
 if not found then raise no_data_found; end if;
 s=public.guest_settlement_source(l.intervention_id,p_actor);
 if s->>'reason' is not null or s->>'account_id' is distinct from p_account or p_account is null or p_account !~ '^acct_[A-Za-z0-9]{1,200}$' or p_fee is null or p_fee not between 0 and 10000 then raise insufficient_privilege; end if;
 fee=round(l.amount_cents::numeric*p_fee/10000)::integer;
 if fee>=l.amount_cents then raise invalid_parameter_value; end if;
 if l.account_id is not null and (l.account_id<>p_account or (l.fee_bps is not null and l.fee_bps<>p_fee)) then raise exception 'Recipient or fee changed' using errcode='P0001'; end if;
 update public.guest_settlements set account_id=p_account,fee_bps=p_fee,fee_cents=fee,transfer_cents=amount_cents-fee where id=l.id;
end; $$;
revoke all on function public.qualify_guest_settlement(uuid,uuid,text,integer) from public,anon,authenticated,service_role;
grant execute on function public.qualify_guest_settlement(uuid,uuid,text,integer) to service_role;

-- Trusted provider proof, verified by server retrieves. No user can declare their own payment.
create function public.record_guest_settlement(p_id uuid,p_actor uuid,p_charge text,p_amount integer,p_transfer text default null,p_net integer default null,p_account text default null) returns void language plpgsql security definer set search_path='' as $$
declare l public.guest_settlements; s jsonb; job uuid;
begin
 -- Same order as begin/qualify: job first, then ledger. The first read takes no lock.
 select intervention_id into job from public.guest_settlements where id=p_id and actor_id=p_actor;
 if not found then raise no_data_found;end if;
 perform 1 from public.interventions where id=job for update;
 if not found then raise no_data_found;end if;
 select * into l from public.guest_settlements where id=p_id and actor_id=p_actor and intervention_id=job for update;
 if not found then raise no_data_found; end if;
 if p_charge is null or p_charge !~ '^ch_[A-Za-z0-9]{1,200}$' or p_amount is distinct from l.amount_cents or l.account_id is null or l.transfer_cents is null or (l.charge_id is not null and l.charge_id<>p_charge) then raise insufficient_privilege; end if;
 if l.status='paid' then
  if (p_transfer is null and (p_net is not null or p_account is not null)) or (p_transfer is not null and(p_transfer is distinct from l.transfer_id or p_net is distinct from l.transfer_cents or p_account is distinct from l.account_id)) then raise insufficient_privilege;end if;return;
 end if;
 s=public.guest_settlement_source(l.intervention_id,l.actor_id);
 if s->>'reason' is not null or s->>'job_status'<>'completed' or (s->>'amount_cents')::bigint<>l.amount_cents or s->'amendments'<>l.amendments then raise exception 'Settlement context changed' using errcode='P0001'; end if;
 if p_transfer is null then
  update public.guest_settlements set charge_id=p_charge,captured_at=coalesce(captured_at,clock_timestamp()),transfer_started_at=coalesce(transfer_started_at,clock_timestamp()),status='captured_transfer_pending' where id=l.id;
  return;
 end if;
 if p_transfer !~ '^tr_[A-Za-z0-9]{1,200}$' or p_net is distinct from l.transfer_cents or p_account is distinct from l.account_id then raise insufficient_privilege; end if;
 if exists(select 1 from public.payments where quote_id=l.quote_id) then raise exception 'Another payment exists' using errcode='P0001'; end if;
 update public.guest_settlements set charge_id=p_charge,transfer_id=p_transfer,captured_at=coalesce(captured_at,clock_timestamp()),paid_at=clock_timestamp(),status='paid' where id=l.id;
 insert into public.payments(quote_id,session_id,total_cents,currency,status,paid_at) values(l.quote_id,l.session_id,l.amount_cents,'eur','paid',clock_timestamp());
 update public.interventions set status='paid',paid_at=clock_timestamp(),updated_at=now() where id=l.intervention_id;
 insert into public.audit_log(actor_id,intervention_id,action) values(l.actor_id,l.intervention_id,'payment_confirmed');
end; $$;
revoke all on function public.record_guest_settlement(uuid,uuid,text,integer,text,integer,text) from public,anon,authenticated,service_role;
grant execute on function public.record_guest_settlement(uuid,uuid,text,integer,text,integer,text) to service_role;

-- A financial intent freezes the agreed work/recipient across network calls (no long SQL lock).
create function public.guard_guest_settlement_work() returns trigger language plpgsql security definer set search_path='' as $$
declare job uuid; frozen boolean;
begin
 if tg_table_name='interventions' then
  if exists(select 1 from public.guest_settlements where intervention_id=old.id) and
   (new.client_id is distinct from old.client_id or new.artisan_id is distinct from old.artisan_id or new.site_id is distinct from old.site_id or
    (new.status is distinct from old.status and not(old.status='completed' and new.status='paid' and exists(select 1 from public.guest_settlements where intervention_id=old.id and status='paid')))) then raise exception 'Financial intent freezes intervention' using errcode='P0001'; end if;
  return new;
 end if;
 job=case when tg_op='DELETE' then old.intervention_id else new.intervention_id end;
 perform 1 from public.interventions where id=job for update;
 frozen=exists(select 1 from public.guest_settlements where intervention_id=job);
 if tg_table_name='quote_amendments' then
  if tg_op<>'DELETE' then frozen=frozen or exists(select 1 from public.guest_settlements where quote_id=new.base_quote_id);end if;
  if tg_op<>'INSERT' then frozen=frozen or exists(select 1 from public.guest_settlements where quote_id=old.base_quote_id);end if;
 end if;
 if tg_op='UPDATE' then frozen=frozen or exists(select 1 from public.guest_settlements where intervention_id=old.intervention_id);end if;
 if frozen and (tg_op<>'UPDATE' or to_jsonb(new) is distinct from to_jsonb(old)) then raise exception 'Financial intent freezes quote versions' using errcode='P0001';end if;
 if tg_op='DELETE' then return old;end if;return new;
end; $$;
revoke all on function public.guard_guest_settlement_work() from public,anon,authenticated,service_role;
create trigger settlement_job_guard before update on public.interventions for each row execute function public.guard_guest_settlement_work();
create trigger settlement_quote_guard before insert or update or delete on public.quotes for each row execute function public.guard_guest_settlement_work();
create trigger settlement_amendment_guard before insert or update or delete on public.quote_amendments for each row execute function public.guard_guest_settlement_work();
create function public.guard_guest_settlement_account() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.stripe_account_id is distinct from old.stripe_account_id and exists(select 1 from public.guest_settlements where artisan_id=old.id and status<>'paid') then raise exception 'Financial intent freezes recipient account' using errcode='P0001';end if;
 return new;
end; $$;
revoke all on function public.guard_guest_settlement_account() from public,anon,authenticated,service_role;
create trigger settlement_account_guard before update on public.profiles for each row execute function public.guard_guest_settlement_account();
create function public.guard_guest_settlement_snapshot() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if (to_jsonb(new)-array['status','account_id','fee_bps','fee_cents','transfer_cents','charge_id','transfer_id','captured_at','transfer_started_at','paid_at']) is distinct from
    (to_jsonb(old)-array['status','account_id','fee_bps','fee_cents','transfer_cents','charge_id','transfer_id','captured_at','transfer_started_at','paid_at']) or
  (old.account_id is not null and new.account_id is distinct from old.account_id) or
  (old.fee_bps is not null and (new.fee_bps is distinct from old.fee_bps or new.fee_cents is distinct from old.fee_cents or new.transfer_cents is distinct from old.transfer_cents)) or
  (old.charge_id is not null and new.charge_id is distinct from old.charge_id) or (old.transfer_id is not null and new.transfer_id is distinct from old.transfer_id) or
  (old.transfer_started_at is not null and new.transfer_started_at is distinct from old.transfer_started_at) or
  (old.captured_at is not null and new.captured_at is distinct from old.captured_at) or
  (old.paid_at is not null and new.paid_at is distinct from old.paid_at) or (old.status='paid' and new.status<>'paid') then raise exception 'Financial snapshot is immutable' using errcode='P0001';end if;
 return new;
end; $$;
revoke all on function public.guard_guest_settlement_snapshot() from public,anon,authenticated,service_role;
create trigger settlement_snapshot_guard before update on public.guest_settlements for each row execute function public.guard_guest_settlement_snapshot();
commit;

-- Every new quote Checkout freezes the accepted financial snapshot before network
-- access. Internal on_site means platform payment after work, never direct cash.
begin;
create table public.platform_checkouts (
 id uuid primary key default gen_random_uuid(), quote_id uuid not null references public.quotes(id),
 intervention_id uuid not null references public.interventions(id) on delete cascade,
 actor_id uuid not null references public.profiles(id), artisan_id uuid not null references public.profiles(id),
 amount_cents integer not null check(amount_cents>0), currency text not null default 'eur' check(currency='eur'),
 amendments jsonb not null, account_id text not null,
 return_origin text, fee_bps integer check(fee_bps between 0 and 9999), fee_cents integer check(fee_cents>=0 and fee_cents<amount_cents),
 status text not null default 'preparing' check(status in ('preparing','open','awaiting_bank','paid','expired','needs_review')),
 session_id text unique, created_at timestamptz not null default clock_timestamp(), expires_at timestamptz, paid_at timestamptz
);
create unique index platform_checkout_active_quote on public.platform_checkouts(quote_id) where status<>'expired';
alter table public.platform_checkouts enable row level security;
revoke all on public.platform_checkouts from public,anon,authenticated;
grant select,insert,update,delete on public.platform_checkouts to service_role;

-- Re-check site membership/write scope using the actor explicitly. A historical
-- client_id alone is not authority after leaving an organization. Service-side
-- qualification must not rely on auth.uid(), which is absent on service requests.
create function public.platform_checkout_actor_can_pay(p_job uuid,p_actor uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.interventions i where i.id=p_job and i.client_id=p_actor and
  (i.site_id is null or exists(select 1 from public.sites s join public.organizations o on o.id=s.organization_id
   join public.organization_members m on m.organization_id=o.id and m.user_id=p_actor
   left join public.organization_member_site_scopes sc on sc.organization_id=m.organization_id and sc.user_id=m.user_id
   where s.id=i.site_id and m.role in('owner','manager') and(o.owner_id=p_actor or coalesce(sc.scope,'all')='all' or
    exists(select 1 from public.organization_member_site_grants g where g.organization_id=m.organization_id
     and g.user_id=m.user_id and g.site_id=s.id and g.can_write)))));
$$;
revoke all on function public.platform_checkout_actor_can_pay(uuid,uuid) from public,anon,authenticated,service_role;

-- Private source: callers already supply the verified JWT user ID; only the
-- service role can call directly. The authenticated entry point below calls it
-- with auth.uid(), never a client-provided actor/amount/destination.
create function public.platform_checkout_source(p_quote uuid,p_actor uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare q public.quotes; j public.interventions; a public.profiles; amount bigint; amendments jsonb;
begin
 select * into q from public.quotes where id=p_quote;
 if not found then raise no_data_found; end if;
 select * into j from public.interventions where id=q.intervention_id and client_id=p_actor;
 if not found or not public.platform_checkout_actor_can_pay(j.id,p_actor) then raise no_data_found; end if;
 if q.status<>'accepted' or j.status not in ('completed','paid') or q.artisan_id is distinct from j.artisan_id then
  raise exception 'Accepted completed work required' using errcode='P0001'; end if;
 if exists(select 1 from public.phone_booking_requests where intervention_id=j.id and
  (actor_id is distinct from p_actor or method<>'on_site' or status<>'confirmed')) or
  exists(select 1 from public.guest_settlements where intervention_id=j.id) or
  exists(select 1 from public.on_site_receipts where intervention_id=j.id) then
  raise exception 'Conflicting settlement method' using errcode='P0001'; end if;
 select * into a from public.profiles where id=j.artisan_id and role='artisan' and artisan_approved;
 if not found or a.stripe_account_id is null or a.stripe_account_id !~ '^acct_[A-Za-z0-9]{1,200}$' or
  exists(select 1 from public.artisan_profiles where user_id=a.id and application_status<>'approved') then
  raise exception 'Recipient account not ready' using errcode='P0001'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'version',m.version,'total_cents',m.total_cents) order by m.id),'[]'::jsonb),
  q.total_cents+coalesce(sum(m.total_cents),0) into amendments,amount
  from public.quote_amendments m where m.base_quote_id=q.id and m.status='accepted';
 if amount is null or amount<1 or amount>2147483647 or exists(select 1 from public.quote_amendments where base_quote_id=q.id
  and status='accepted' and (intervention_id<>j.id or artisan_id is distinct from j.artisan_id)) then
  raise exception 'Invalid agreed amount' using errcode='P0001'; end if;
 return jsonb_build_object('quote_id',q.id,'intervention_id',j.id,'actor_id',p_actor,'artisan_id',a.id,
  'account_id',a.stripe_account_id,'amount_cents',amount,'currency','eur','amendments',amendments,'job_status',j.status);
end; $$;
revoke all on function public.platform_checkout_source(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.platform_checkout_source(uuid,uuid) to service_role;

-- Preserve the pre-provider guard used by clients, now distinguishing a deferred
-- platform booking from a card hold. begin_platform_checkout repeats the check
-- under the intervention/organization locks and creates the durable snapshot.
create or replace function public.guard_phone_booking_checkout(p_quote_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare q public.quotes; j public.interventions;
begin
 if auth.uid() is null then raise insufficient_privilege; end if;
 select * into q from public.quotes where id=p_quote_id;
 select * into j from public.interventions where id=q.intervention_id and client_id=auth.uid();
 if not found or not public.platform_checkout_actor_can_pay(j.id,auth.uid()) then raise no_data_found; end if;
 if exists(select 1 from public.phone_booking_requests where intervention_id=j.id and
  (actor_id is distinct from auth.uid() or method<>'on_site' or status<>'confirmed')) or
  exists(select 1 from public.on_site_receipts where intervention_id=j.id) or
  exists(select 1 from public.guest_settlements where intervention_id=j.id) then
  raise exception 'Conflicting settlement method' using errcode='P0001'; end if;
end; $$;
revoke all on function public.guard_phone_booking_checkout(uuid) from public,anon,authenticated,service_role;
grant execute on function public.guard_phone_booking_checkout(uuid) to authenticated;

create function public.begin_platform_checkout(p_quote_id uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare actor uuid=auth.uid(); job uuid; s jsonb; l public.platform_checkouts; pay public.payments;
begin
 if actor is null then raise insufficient_privilege; end if;
 select i.id into job from public.quotes q join public.interventions i on i.id=q.intervention_id
  where q.id=p_quote_id and i.client_id=actor;
 if not found then raise no_data_found; end if;
 perform public.lock_intervention_organization(job);
 perform 1 from public.interventions where id=job and client_id=actor for update;
 perform 1 from public.quotes where id=p_quote_id for update;
 s=public.platform_checkout_source(p_quote_id,actor);
 if(s->>'intervention_id')::uuid is distinct from job then raise exception 'Intervention changed during Checkout' using errcode='P0001';end if;
 select * into pay from public.payments where quote_id=p_quote_id for update;
 if found and (pay.status='paid' or pay.method<>'stripe') then raise exception 'Payment already settled' using errcode='P0001'; end if;
 select * into l from public.platform_checkouts where quote_id=p_quote_id and status<>'expired' for update;
 if found then
  if l.actor_id<>actor or l.intervention_id<>job or l.amount_cents<>(s->>'amount_cents')::integer or
   l.artisan_id::text is distinct from s->>'artisan_id' or l.account_id is distinct from s->>'account_id' or
   l.amendments is distinct from s->'amendments' then raise exception 'Checkout snapshot changed' using errcode='P0001'; end if;
  return l.id;
 end if;
 if s->>'job_status'<>'completed' or (pay.id is not null and not(pay.status='failed' and pay.failure_code='expired')) then
  raise exception 'Existing payment must be reconciled' using errcode='P0001'; end if;
 perform public.consume_action('platform_checkout',5);
 insert into public.platform_checkouts(quote_id,intervention_id,actor_id,artisan_id,amount_cents,amendments,account_id)
 values(p_quote_id,job,actor,(s->>'artisan_id')::uuid,(s->>'amount_cents')::integer,s->'amendments',s->>'account_id') returning id into job;
 return job;
end; $$;
revoke all on function public.begin_platform_checkout(uuid) from public,anon,authenticated,service_role;
grant execute on function public.begin_platform_checkout(uuid) to authenticated;

create function public.platform_checkout_private(p_id uuid,p_actor uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare l public.platform_checkouts;
begin
 select * into l from public.platform_checkouts where id=p_id and actor_id=p_actor;
 if not found then raise no_data_found; end if;
 return to_jsonb(l);
end; $$;
revoke all on function public.platform_checkout_private(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.platform_checkout_private(uuid,uuid) to service_role;

create function public.qualify_platform_checkout(p_id uuid,p_actor uuid,p_account text,p_fee integer,p_origin text) returns void
language plpgsql security definer set search_path='' as $$
declare l public.platform_checkouts; s jsonb; job uuid; fee integer;
begin
 select intervention_id into job from public.platform_checkouts where id=p_id and actor_id=p_actor;
 if not found then raise no_data_found; end if;
 perform public.lock_intervention_organization(job);perform 1 from public.interventions where id=job for update;
 select * into l from public.platform_checkouts where id=p_id and actor_id=p_actor for update;
 s=public.platform_checkout_source(l.quote_id,p_actor);
 if l.status not in ('preparing','open') or l.account_id is distinct from p_account or
  l.account_id is distinct from s->>'account_id' or l.amount_cents<>(s->>'amount_cents')::integer or
  l.amendments is distinct from s->'amendments' or p_fee is null or p_fee not between 0 and 9999 or p_origin is null or char_length(p_origin)>255 or
  p_origin !~ '^(https://[A-Za-z0-9.-]+(:[0-9]{1,5})?|http://(localhost|127[.]0[.]0[.]1)(:[0-9]{1,5})?)$' then raise insufficient_privilege; end if;
 fee=round(l.amount_cents::numeric*p_fee/10000)::integer;
 if fee>=l.amount_cents or(l.fee_bps is not null and (l.fee_bps<>p_fee or l.fee_cents<>fee or l.return_origin is distinct from p_origin)) then
  raise exception 'Checkout fee changed' using errcode='P0001'; end if;
 update public.platform_checkouts set fee_bps=p_fee,fee_cents=fee,return_origin=p_origin where id=l.id;
end; $$;
revoke all on function public.qualify_platform_checkout(uuid,uuid,text,integer,text) from public,anon,authenticated,service_role;
grant execute on function public.qualify_platform_checkout(uuid,uuid,text,integer,text) to service_role;

create function public.bind_platform_checkout(p_id uuid,p_actor uuid,p_session text,p_amount integer,p_currency text,p_expires timestamptz) returns void
language plpgsql security definer set search_path='' as $$
declare l public.platform_checkouts; s jsonb; job uuid; pay public.payments;
begin
 select intervention_id into job from public.platform_checkouts where id=p_id and actor_id=p_actor;
 if not found then raise no_data_found; end if;
 perform public.lock_intervention_organization(job);perform public.lock_intervention_organization(job);perform 1 from public.interventions where id=job for update;
 select * into l from public.platform_checkouts where id=p_id and actor_id=p_actor for update;
 s=public.platform_checkout_source(l.quote_id,p_actor);
 if l.status not in ('preparing','open') or l.fee_bps is null or l.fee_cents is null or
  p_session is null or p_session !~ '^cs_[A-Za-z0-9_]{1,240}$' or p_amount is distinct from l.amount_cents or
  p_currency is distinct from l.currency or l.account_id is distinct from s->>'account_id' or
  l.amendments is distinct from s->'amendments' or l.amount_cents<>(s->>'amount_cents')::integer or
  p_expires is null or p_expires<=l.created_at or p_expires>l.created_at+interval '25 hours' or
  (l.session_id is not null and l.session_id<>p_session) then raise exception 'Checkout session mismatch' using errcode='P0001'; end if;
 select * into pay from public.payments where quote_id=l.quote_id for update;
 if found then
  if pay.session_id=p_session and pay.total_cents=l.amount_cents and pay.currency=l.currency and pay.status='pending' then null;
  elsif pay.status='failed' and pay.failure_code='expired' and pay.method='stripe' then
   update public.payments set session_id=p_session,total_cents=l.amount_cents,currency=l.currency,status='pending',failure_code=null,paid_at=null where id=pay.id;
  else raise exception 'Concurrent payment exists' using errcode='P0001'; end if;
 else
  insert into public.payments(quote_id,session_id,total_cents,currency,status,method)values(l.quote_id,p_session,l.amount_cents,l.currency,'pending','stripe');
 end if;
 update public.platform_checkouts set session_id=p_session,status='open',expires_at=p_expires where id=l.id;
end; $$;
revoke all on function public.bind_platform_checkout(uuid,uuid,text,integer,text,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.bind_platform_checkout(uuid,uuid,text,integer,text,timestamptz) to service_role;

-- Only the trusted server may pass a freshly retrieved provider status. Unknown
-- sessions become needs_review; only explicit unpaid expiry releases a retry.
create function public.reconcile_platform_checkout(p_id uuid,p_actor uuid,p_session text,p_state text) returns void
language plpgsql security definer set search_path='' as $$
declare l public.platform_checkouts; job uuid;
begin
 select intervention_id into job from public.platform_checkouts where id=p_id and actor_id=p_actor;
 if not found then raise no_data_found; end if;
 perform public.lock_intervention_organization(job);perform 1 from public.interventions where id=job for update;
 select * into l from public.platform_checkouts where id=p_id and actor_id=p_actor for update;
 if l.status='paid' then return; end if;
 if p_state='needs_review' then
  if p_session is distinct from l.session_id then raise insufficient_privilege; end if;
  update public.platform_checkouts set status='needs_review' where id=l.id;
 elsif p_state in ('expired','awaiting_bank') and p_session is not null and p_session=l.session_id and l.status in ('open','awaiting_bank') then
  if p_state='expired' then
   update public.payments set status='failed',failure_code='expired' where quote_id=l.quote_id and session_id=p_session and status<>'paid';
  end if;
  update public.platform_checkouts set status=p_state where id=l.id;
 else raise insufficient_privilege; end if;
end; $$;
revoke all on function public.reconcile_platform_checkout(uuid,uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.reconcile_platform_checkout(uuid,uuid,text,text) to service_role;

create function public.guard_platform_checkout_work() returns trigger language plpgsql security definer set search_path='' as $$
declare job uuid; frozen boolean;
begin
 if tg_table_name='interventions' then
  if exists(select 1 from public.platform_checkouts where intervention_id=old.id and status<>'expired') and
   (new.client_id is distinct from old.client_id or new.artisan_id is distinct from old.artisan_id or new.site_id is distinct from old.site_id or
    (new.status is distinct from old.status and not(old.status='completed' and new.status='paid' and
     exists(select 1 from public.platform_checkouts where intervention_id=old.id and status='paid')))) then
   raise exception 'Checkout freezes intervention' using errcode='P0001'; end if;return new;
 end if;
 job=case when tg_op='DELETE' then old.intervention_id else new.intervention_id end;
 perform 1 from public.interventions where id=job for update;
 frozen=exists(select 1 from public.platform_checkouts where intervention_id=job and status<>'expired');
 if tg_op='UPDATE' then frozen=frozen or exists(select 1 from public.platform_checkouts where intervention_id=old.intervention_id and status<>'expired');end if;
 if tg_table_name='quote_amendments' then
  if tg_op<>'DELETE' then frozen=frozen or exists(select 1 from public.platform_checkouts where quote_id=new.base_quote_id and status<>'expired');end if;
  if tg_op<>'INSERT' then frozen=frozen or exists(select 1 from public.platform_checkouts where quote_id=old.base_quote_id and status<>'expired');end if;
 end if;
 if frozen and(tg_op<>'UPDATE' or to_jsonb(new) is distinct from to_jsonb(old))then raise exception 'Checkout freezes quote versions' using errcode='P0001';end if;
 if tg_op='DELETE' then return old;end if;return new;
end; $$;
revoke all on function public.guard_platform_checkout_work() from public,anon,authenticated,service_role;
create trigger platform_checkout_job_guard before update on public.interventions for each row execute function public.guard_platform_checkout_work();
create trigger platform_checkout_quote_guard before insert or update or delete on public.quotes for each row execute function public.guard_platform_checkout_work();
create trigger platform_checkout_amendment_guard before insert or update or delete on public.quote_amendments for each row execute function public.guard_platform_checkout_work();
create function public.guard_platform_checkout_account() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.stripe_account_id is distinct from old.stripe_account_id and exists(select 1 from public.platform_checkouts where artisan_id=old.id and status not in ('expired','paid')) then
  raise exception 'Checkout freezes recipient account' using errcode='P0001';end if;return new;
end; $$;
revoke all on function public.guard_platform_checkout_account() from public,anon,authenticated,service_role;
create trigger platform_checkout_account_guard before update on public.profiles for each row execute function public.guard_platform_checkout_account();
create function public.guard_platform_checkout_snapshot() returns trigger language plpgsql set search_path='' as $$
begin
 if (to_jsonb(new)-array['status','fee_bps','fee_cents','return_origin','session_id','expires_at','paid_at']) is distinct from
  (to_jsonb(old)-array['status','fee_bps','fee_cents','return_origin','session_id','expires_at','paid_at']) or
  (old.fee_bps is not null and(new.fee_bps is distinct from old.fee_bps or new.fee_cents is distinct from old.fee_cents or new.return_origin is distinct from old.return_origin)) or
  (old.session_id is not null and new.session_id is distinct from old.session_id) or
  (old.expires_at is not null and new.expires_at is distinct from old.expires_at) or
  (old.paid_at is not null and new.paid_at is distinct from old.paid_at) or
  (old.status='paid' and new.status<>'paid') or(old.status='expired' and new.status<>'expired') then
  raise exception 'Checkout snapshot is immutable' using errcode='P0001';end if;return new;
end; $$;
revoke all on function public.guard_platform_checkout_snapshot() from public,anon,authenticated,service_role;
create trigger platform_checkout_snapshot_guard before update on public.platform_checkouts for each row execute function public.guard_platform_checkout_snapshot();

-- Event writers use the immutable ledger amount, not quotes.total_cents alone.
-- Old sessions without a ledger must match all currently accepted amendments;
-- a stale or underpriced old session is rejected rather than marked paid.
create function public.stripe_checkout_expected_total(p_quote uuid,p_session text) returns integer
language plpgsql stable security definer set search_path='' as $$
declare q public.quotes; j public.interventions; l public.platform_checkouts; amount bigint;
begin
 select * into q from public.quotes where id=p_quote;
 select * into j from public.interventions where id=q.intervention_id;
 if q.id is null or j.id is null or q.status<>'accepted' or q.artisan_id is distinct from j.artisan_id or
  exists(select 1 from public.on_site_receipts where intervention_id=j.id) then
  raise exception 'Invalid financial reference' using errcode='P0001'; end if;
 select * into l from public.platform_checkouts where quote_id=p_quote and session_id=p_session;
 if found then
  if l.intervention_id<>j.id or l.artisan_id<>q.artisan_id or l.actor_id<>j.client_id or l.fee_bps is null or l.fee_cents is null then
   raise exception 'Checkout snapshot mismatch' using errcode='P0001'; end if;
  return l.amount_cents;
 end if;
 if exists(select 1 from public.phone_booking_requests where intervention_id=j.id and method<>'on_site') or
  exists(select 1 from public.guest_settlements where intervention_id=j.id) then
  raise exception 'Wrong settlement channel' using errcode='P0001'; end if;
 select q.total_cents+coalesce(sum(total_cents),0) into amount from public.quote_amendments where base_quote_id=q.id and status='accepted';
 if amount is null or amount<1 or amount>2147483647 or exists(select 1 from public.quote_amendments where base_quote_id=q.id and status='accepted'
  and(intervention_id<>j.id or artisan_id is distinct from j.artisan_id))then raise exception 'Invalid agreed amount' using errcode='P0001';end if;
 return amount::integer;
end; $$;
revoke all on function public.stripe_checkout_expected_total(uuid,text) from public,anon,authenticated,service_role;

create or replace function public.confirm_stripe_payment(p_event_id text,p_event_type text,p_session_id text,p_quote_id uuid,p_amount integer,p_currency text)
returns boolean language plpgsql security definer set search_path='' as $$
declare pay public.payments; q public.quotes; job public.interventions; l public.platform_checkouts; expected integer;
begin
 if p_event_id is null or char_length(p_event_id) not between 1 and 255 or p_event_type is null or p_event_type not in('checkout.session.completed','checkout.session.async_payment_succeeded') or p_session_id is null or p_quote_id is null or p_amount is null or p_amount<1 or p_currency is distinct from 'eur' then raise invalid_parameter_value;end if;
 if exists(select 1 from public.stripe_events where id=p_event_id)then return false;end if;
 select * into q from public.quotes where id=p_quote_id;
 if not found then raise exception 'Invalid quote' using errcode='P0001';end if;
 perform public.lock_intervention_organization(q.intervention_id);
 select * into job from public.interventions where id=q.intervention_id for update;
 select * into q from public.quotes where id=p_quote_id for update;
 if q.intervention_id is distinct from job.id then raise exception 'Intervention changed during confirmation' using errcode='P0001';end if;
 select * into l from public.platform_checkouts where quote_id=p_quote_id and session_id=p_session_id for update;
 if found and l.status='expired' then raise exception 'Expired Checkout cannot be paid' using errcode='P0001';end if;
 expected=public.stripe_checkout_expected_total(p_quote_id,p_session_id);
 select * into pay from public.payments where quote_id=p_quote_id for update;
 if not found or pay.session_id is distinct from p_session_id or pay.total_cents is distinct from p_amount or expected is distinct from p_amount or pay.currency<>p_currency or pay.method<>'stripe' then raise exception 'Payment mismatch' using errcode='P0001';end if;
 if job.status not in('completed','paid')then raise exception 'Intervention not completed' using errcode='P0001';end if;
 insert into public.stripe_events(id,event_type)values(p_event_id,p_event_type)on conflict do nothing;
 if not found then return false;end if;
 if pay.status='paid' then return false;end if;
 if l.id is not null then update public.platform_checkouts set status='paid',paid_at=coalesce(paid_at,clock_timestamp())where id=l.id;end if;
 update public.payments set status='paid',paid_at=coalesce(paid_at,now())where id=pay.id;
 update public.interventions set status='paid',paid_at=coalesce(paid_at,now()),updated_at=now()where id=job.id;
 insert into public.audit_log(intervention_id,action)values(job.id,'payment_confirmed');return true;
end; $$;
revoke all on function public.confirm_stripe_payment(text,text,text,uuid,integer,text) from public,anon,authenticated,service_role;
grant execute on function public.confirm_stripe_payment(text,text,text,uuid,integer,text) to service_role;

create or replace function public.record_stripe_payment_failure(p_event_id text,p_event_type text,p_session_id text,p_quote_id uuid,p_amount integer,p_currency text)
returns boolean language plpgsql security definer set search_path='' as $$
declare q public.quotes; pay public.payments; attempt public.payment_attempts; l public.platform_checkouts; expected integer; applied boolean=false; failure text; locked_job uuid;
begin
 if p_event_id is null or char_length(p_event_id) not between 1 and 255 or p_event_type is null or p_event_type not in('checkout.session.expired','checkout.session.async_payment_failed') or p_session_id is null or p_quote_id is null or p_amount is null or p_amount<1 or p_currency is distinct from 'eur' then raise invalid_parameter_value;end if;
 if exists(select 1 from public.stripe_events where id=p_event_id)then return false;end if;
 select * into q from public.quotes where id=p_quote_id;
 if not found then raise exception 'Invalid quote' using errcode='P0001';end if;
 locked_job=q.intervention_id;perform public.lock_intervention_organization(locked_job);
 perform 1 from public.interventions where id=locked_job for update;
 select * into q from public.quotes where id=p_quote_id for update;
 if q.intervention_id is distinct from locked_job then raise exception 'Intervention changed during failure confirmation' using errcode='P0001';end if;
 select * into l from public.platform_checkouts where quote_id=p_quote_id and session_id=p_session_id for update;
 expected=public.stripe_checkout_expected_total(p_quote_id,p_session_id);
 if expected is distinct from p_amount then raise exception 'Checkout amount mismatch' using errcode='P0001';end if;
 select * into pay from public.payments where quote_id=p_quote_id for update;
 if not found or pay.method<>'stripe' then raise exception 'Payment reference missing' using errcode='P0001';end if;
 select * into attempt from public.payment_attempts where session_id=p_session_id and quote_id=p_quote_id for update;
 if not found or attempt.total_cents<>p_amount or attempt.currency<>p_currency or attempt.method<>'stripe' then raise exception 'Attempt mismatch' using errcode='P0001';end if;
 insert into public.stripe_events(id,event_type)values(p_event_id,p_event_type)on conflict do nothing;
 if not found then return false;end if;
 failure=case when p_event_type='checkout.session.expired' then 'expired' else 'async_payment_failed' end;
 if attempt.status<>'paid' then
  update public.payment_attempts set status='failed',failure_code=failure,updated_at=now()where id=attempt.id;
  if pay.session_id=p_session_id and pay.status<>'paid' then
   update public.payments set status='failed',failure_code=failure where id=pay.id;applied=true;
   if l.id is not null and l.status not in('paid','expired')then update public.platform_checkouts set status=case when failure='expired' then 'expired' else 'needs_review' end where id=l.id;end if;
  end if;
 end if;return applied;
end; $$;
revoke all on function public.record_stripe_payment_failure(text,text,text,uuid,integer,text) from public,anon,authenticated,service_role;
grant execute on function public.record_stripe_payment_failure(text,text,text,uuid,integer,text) to service_role;
create function public.assert_platform_checkout_event(p_id uuid,p_quote uuid,p_session text,p_amount integer) returns void
language plpgsql stable security definer set search_path='' as $$
begin
 if not exists(select 1 from public.platform_checkouts where id=p_id and quote_id=p_quote and session_id=p_session
  and amount_cents=p_amount and fee_bps is not null and fee_cents is not null)then raise insufficient_privilege;end if;
end; $$;
revoke all on function public.assert_platform_checkout_event(uuid,uuid,text,integer) from public,anon,authenticated,service_role;
grant execute on function public.assert_platform_checkout_event(uuid,uuid,text,integer) to service_role;
commit;

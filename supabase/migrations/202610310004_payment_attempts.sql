-- Keep Checkout attempts and process terminal failures without downgrading settled payments.
-- Event names/object contract: https://docs.stripe.com/api/events/types
begin;
alter table public.payments add column failure_code text check(failure_code in ('expired','async_payment_failed'));
alter table public.payments add column updated_at timestamptz not null default now();
create table public.payment_attempts (
 id uuid primary key default gen_random_uuid(), quote_id uuid not null references public.quotes(id),
 session_id text not null unique, total_cents integer not null check(total_cents>0),
 currency text not null check(currency='eur'), status text not null check(status in ('pending','paid','failed')),
 failure_code text check(failure_code in ('expired','async_payment_failed')),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), paid_at timestamptz
);
create index payment_attempts_quote on public.payment_attempts(quote_id,created_at desc,id);
alter table public.payment_attempts enable row level security;
revoke all on public.payment_attempts from public,anon,authenticated;
grant select on public.payment_attempts to authenticated;
grant all on public.payment_attempts to service_role;
create policy payment_attempts_read on public.payment_attempts for select to authenticated using(
 exists(select 1 from public.quotes q where q.id=quote_id and public.can_access_intervention(q.intervention_id)));
insert into public.payment_attempts(quote_id,session_id,total_cents,currency,status,created_at,updated_at,paid_at)
select quote_id,session_id,total_cents,currency,status,created_at,updated_at,paid_at from public.payments;

create function public.guard_settled_payment() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if old.status='paid' and (new.status is distinct from 'paid' or new.session_id is distinct from old.session_id) then raise exception 'Settled payment cannot be replaced' using errcode='P0001'; end if;
 new.updated_at=now();
 if new.status<>'failed' then new.failure_code=null; end if;
 return new;
end; $$;
create function public.record_payment_attempt() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.payment_attempts where session_id=new.session_id and (quote_id<>new.quote_id or total_cents<>new.total_cents or currency<>new.currency)) then raise exception 'Attempt reference mismatch' using errcode='P0001'; end if;
 insert into public.payment_attempts(quote_id,session_id,total_cents,currency,status,failure_code,created_at,updated_at,paid_at)
 values(new.quote_id,new.session_id,new.total_cents,new.currency,new.status,new.failure_code,case when tg_op='INSERT' then new.created_at else now() end,now(),new.paid_at)
 on conflict(session_id) do update set status=case when public.payment_attempts.status='paid' then 'paid' else excluded.status end,
 failure_code=case when public.payment_attempts.status='paid' then null else excluded.failure_code end,updated_at=now(),paid_at=coalesce(public.payment_attempts.paid_at,excluded.paid_at);
 return new;
end; $$;
revoke execute on function public.guard_settled_payment(),public.record_payment_attempt() from public,anon,authenticated;
create trigger payment_settled_guard before update on public.payments for each row execute function public.guard_settled_payment();
create trigger payment_attempt_history after insert or update on public.payments for each row execute function public.record_payment_attempt();

create function public.record_stripe_payment_failure(p_event_id text,p_event_type text,p_session_id text,p_quote_id uuid,p_amount integer,p_currency text)
returns boolean language plpgsql security definer set search_path='' as $$
declare q public.quotes; pay public.payments; attempt public.payment_attempts; applied boolean=false; failure text;
begin
 if p_event_id is null or char_length(p_event_id) not between 1 and 255 or p_event_type is null or p_event_type not in ('checkout.session.expired','checkout.session.async_payment_failed') or p_session_id is null or p_quote_id is null or p_amount is null or p_amount<1 or p_currency is distinct from 'eur' then raise invalid_parameter_value; end if;
 if exists(select 1 from public.stripe_events where id=p_event_id) then return false; end if;
 -- Same lock order as successful confirmation: quote, current payment, then attempt.
 select * into q from public.quotes where id=p_quote_id for update;
 if not found or q.status<>'accepted' or q.total_cents<>p_amount then raise exception 'Invalid quote' using errcode='P0001'; end if;
 select * into pay from public.payments where quote_id=p_quote_id for update;
 if not found then raise exception 'Payment reference missing' using errcode='P0001'; end if;
 select * into attempt from public.payment_attempts where session_id=p_session_id and quote_id=p_quote_id for update;
 if not found or attempt.total_cents<>p_amount or attempt.currency<>p_currency then raise exception 'Attempt mismatch' using errcode='P0001'; end if;
 insert into public.stripe_events(id,event_type) values(p_event_id,p_event_type) on conflict do nothing;
 if not found then return false; end if;
 failure=case when p_event_type='checkout.session.expired' then 'expired' else 'async_payment_failed' end;
 -- A late terminal event never overwrites either a paid attempt or the current settled payment.
 if attempt.status<>'paid' then
  update public.payment_attempts set status='failed',failure_code=failure,updated_at=now() where id=attempt.id;
  if pay.session_id=p_session_id and pay.status<>'paid' then
   update public.payments set status='failed',failure_code=failure where id=pay.id;
   applied=true;
  end if;
 end if;
 return applied;
end; $$;
revoke execute on function public.record_stripe_payment_failure(text,text,text,uuid,integer,text) from public,anon,authenticated;
grant execute on function public.record_stripe_payment_failure(text,text,text,uuid,integer,text) to service_role;
create or replace function public.confirm_stripe_payment(p_event_id text,p_event_type text,p_session_id text,p_quote_id uuid,p_amount integer,p_currency text)
returns boolean language plpgsql security definer set search_path='' as $$
declare pay public.payments; q public.quotes; job public.interventions;
begin
 if p_event_id is null or char_length(p_event_id) not between 1 and 255 or p_event_type is null or p_event_type not in ('checkout.session.completed','checkout.session.async_payment_succeeded') or p_session_id is null or p_quote_id is null or p_amount is null or p_amount<1 or p_currency is distinct from 'eur' then raise invalid_parameter_value; end if;
 if exists(select 1 from public.stripe_events where id=p_event_id) then return false; end if;
 select * into q from public.quotes where id=p_quote_id for update;
 if not found or q.status<>'accepted' then raise exception 'Invalid quote' using errcode='P0001'; end if;
 select * into pay from public.payments where quote_id=p_quote_id for update;
 if not found or pay.session_id is distinct from p_session_id or pay.total_cents is distinct from p_amount or q.total_cents is distinct from p_amount or p_currency is distinct from 'eur' then raise exception 'Payment mismatch' using errcode='P0001'; end if;
 select * into job from public.interventions where id=q.intervention_id for update;
 if job.status not in ('completed','paid') then raise exception 'Intervention not completed' using errcode='P0001'; end if;
 insert into public.stripe_events(id,event_type) values(p_event_id,p_event_type) on conflict do nothing;
 if not found then return false; end if;
 -- Distinct Stripe events for the same settled session do not repeat the business effect.
 if pay.status='paid' then return false; end if;
 update public.payments set status='paid',paid_at=coalesce(paid_at,now()) where id=pay.id;
 update public.interventions set status='paid',paid_at=coalesce(paid_at,now()),updated_at=now() where id=job.id;
 insert into public.audit_log(intervention_id,action) values(job.id,'payment_confirmed');
 return true;
end; $$;


revoke execute on function public.confirm_stripe_payment(text,text,text,uuid,integer,text) from public,anon,authenticated;
grant execute on function public.confirm_stripe_payment(text,text,text,uuid,integer,text) to service_role;
commit;

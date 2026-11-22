-- An approved assigned artisan's declaration is a business receipt, NOT a bank/provider proof.
begin;
alter table public.payments add column method text not null default 'stripe' check(method in ('stripe','on_site_declared'));
alter table public.payment_attempts add column method text not null default 'stripe' check(method in ('stripe','on_site_declared'));
create table public.on_site_receipts (
 intervention_id uuid primary key references public.interventions(id) on delete cascade,
 quote_id uuid not null unique references public.quotes(id), actor_id uuid not null references public.profiles(id),
 amount_cents integer not null check(amount_cents>0), amendments jsonb not null, declared_at timestamptz not null default clock_timestamp()
);
alter table public.on_site_receipts enable row level security;
revoke all on public.on_site_receipts from public,anon,authenticated;
grant select,insert,update,delete on public.on_site_receipts to service_role;

create function public.onsite_receipt_context(p_job uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid=auth.uid(); profile public.profiles; j public.interventions; q public.quotes; receipt public.on_site_receipts;
 amendments jsonb; amount bigint; approved boolean; reason text; can_declare boolean;
begin
 if actor is null then raise insufficient_privilege;end if;
 select * into profile from public.profiles where id=actor;
 if profile.role not in ('client','artisan') then raise insufficient_privilege;end if;
 select * into j from public.interventions where id=p_job and ((profile.role='client' and client_id=actor) or(profile.role='artisan' and artisan_id=actor));
 if not found or not exists(select 1 from public.phone_booking_requests where intervention_id=p_job and actor_id=j.client_id and method='on_site' and status='confirmed') then raise no_data_found;end if;
 if profile.role='client' then perform public.guest_booking_actor();end if;
 select * into receipt from public.on_site_receipts where intervention_id=p_job;
 if found then return jsonb_build_object('method','on_site_declared','status','declared_received','amount_cents',receipt.amount_cents,'currency','eur','can_declare',false,'available',false);end if;
 select * into q from public.quotes where intervention_id=p_job and status='accepted';
 select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'version',a.version,'total_cents',a.total_cents) order by a.id),'[]'::jsonb),coalesce(sum(a.total_cents),0) into amendments,amount from public.quote_amendments a where base_quote_id=q.id and status='accepted';
 amount=amount+q.total_cents;
 approved=profile.role='artisan' and profile.artisan_approved and exists(select 1 from public.artisan_profiles where user_id=actor and application_status='approved');
 reason=case when profile.role<>'artisan' then 'artisan_only' when not approved then 'artisan_approval_required' when j.status<>'completed' then 'not_completed' when q.id is null or q.artisan_id<>actor then 'quote_required'
 when amount<=0 or amount>2147483647 or exists(select 1 from public.quote_amendments where base_quote_id=q.id and status='accepted' and (intervention_id<>j.id or artisan_id<>j.artisan_id)) then 'amount_invalid'
 when exists(select 1 from public.payments where quote_id=q.id) then 'payment_conflict' else null end;
 can_declare=reason is null;
 return jsonb_build_object('method','on_site','status','due_on_site','amount_cents',amount,'currency','eur','can_declare',can_declare,'available',can_declare,'reason',reason);
end; $$;
revoke all on function public.onsite_receipt_context(uuid) from public,anon,authenticated,service_role;
grant execute on function public.onsite_receipt_context(uuid) to authenticated;

create function public.declare_onsite_receipt(p_intervention_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid=auth.uid(); j public.interventions; q public.quotes; context jsonb; receipt public.on_site_receipts; amendments jsonb;
begin
 if actor is null or not exists(select 1 from public.profiles p join public.artisan_profiles a on a.user_id=p.id where p.id=actor and p.role='artisan' and p.artisan_approved and a.application_status='approved') then raise insufficient_privilege;end if;
 perform public.lock_intervention_organization(p_intervention_id);
 select * into j from public.interventions where id=p_intervention_id and artisan_id=actor for update;
 if not found then raise no_data_found;end if;
 context=public.onsite_receipt_context(j.id);
 select * into receipt from public.on_site_receipts where intervention_id=j.id;
 if found then
  if receipt.actor_id<>actor then raise insufficient_privilege;end if;
  return context;
 end if;
 if context->>'can_declare' is distinct from 'true' then raise exception 'On-site receipt not ready' using errcode='P0001';end if;
 select * into q from public.quotes where intervention_id=j.id and status='accepted';
 select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'version',a.version,'total_cents',a.total_cents) order by a.id),'[]'::jsonb) into amendments from public.quote_amendments a where base_quote_id=q.id and status='accepted';
 perform public.consume_action('declare_onsite_receipt',5);
 insert into public.on_site_receipts(intervention_id,quote_id,actor_id,amount_cents,amendments)values(j.id,q.id,actor,(context->>'amount_cents')::integer,amendments);
 insert into public.payments(quote_id,session_id,total_cents,currency,status,paid_at,method)values(q.id,'onsite:'||j.id::text,(context->>'amount_cents')::integer,'eur','paid',clock_timestamp(),'on_site_declared');
 update public.interventions set status='paid',paid_at=clock_timestamp(),updated_at=now() where id=j.id;
 insert into public.audit_log(actor_id,intervention_id,action)values(actor,j.id,'on_site_receipt_declared');
 return public.onsite_receipt_context(j.id);
end; $$;
revoke all on function public.declare_onsite_receipt(uuid) from public,anon,authenticated,service_role;
grant execute on function public.declare_onsite_receipt(uuid) to authenticated;

create function public.guard_payment_receipt_method() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='UPDATE' and new.method is distinct from old.method then raise exception 'Payment provenance is immutable' using errcode='P0001';end if;
 if new.method='on_site_declared' then
  if new.status<>'paid' or not exists(select 1 from public.on_site_receipts r where quote_id=new.quote_id and new.session_id='onsite:'||r.intervention_id::text and new.total_cents=r.amount_cents) then raise insufficient_privilege;end if;
 elsif new.session_id like 'onsite:%' then raise invalid_parameter_value;end if;
 return new;
end; $$;
revoke all on function public.guard_payment_receipt_method() from public,anon,authenticated,service_role;
create trigger payment_receipt_method_guard before insert or update on public.payments for each row execute function public.guard_payment_receipt_method();
create function public.copy_payment_receipt_method() returns trigger language plpgsql security definer set search_path='' as $$
begin update public.payment_attempts set method=new.method where session_id=new.session_id;return new;end; $$;
revoke all on function public.copy_payment_receipt_method() from public,anon,authenticated,service_role;
-- Alphabetically AFTER payment_attempt_history, in the same transaction.
create trigger payment_receipt_method_history after insert or update on public.payments for each row execute function public.copy_payment_receipt_method();

create function public.guard_onsite_receipt_work() returns trigger language plpgsql security definer set search_path='' as $$
declare job uuid; frozen boolean;
begin
 if tg_table_name='on_site_receipts' then if to_jsonb(new) is distinct from to_jsonb(old) then raise exception 'Receipt is immutable' using errcode='P0001';end if;return new;end if;
 if tg_table_name='interventions' then
  if exists(select 1 from public.on_site_receipts where intervention_id=old.id) and(new.client_id is distinct from old.client_id or new.artisan_id is distinct from old.artisan_id or new.site_id is distinct from old.site_id or(new.status is distinct from old.status and not(old.status='completed' and new.status='paid'))) then raise exception 'Declared receipt freezes intervention' using errcode='P0001';end if;return new;
 end if;
 job=case when tg_op='DELETE' then old.intervention_id else new.intervention_id end;perform 1 from public.interventions where id=job for update;
 frozen=exists(select 1 from public.on_site_receipts where intervention_id=job);
 if tg_op='UPDATE' then frozen=frozen or exists(select 1 from public.on_site_receipts where intervention_id=old.intervention_id);end if;
 if tg_table_name='quote_amendments' then
  if tg_op<>'DELETE' then frozen=frozen or exists(select 1 from public.on_site_receipts where quote_id=new.base_quote_id);end if;
  if tg_op<>'INSERT' then frozen=frozen or exists(select 1 from public.on_site_receipts where quote_id=old.base_quote_id);end if;
 end if;
 if frozen and(tg_op<>'UPDATE' or to_jsonb(new) is distinct from to_jsonb(old))then raise exception 'Declared receipt freezes quote versions' using errcode='P0001';end if;
 if tg_op='DELETE' then return old;end if;return new;
end; $$;
revoke all on function public.guard_onsite_receipt_work() from public,anon,authenticated,service_role;
create trigger onsite_receipt_immutable before update on public.on_site_receipts for each row execute function public.guard_onsite_receipt_work();
create trigger onsite_receipt_job_guard before update on public.interventions for each row execute function public.guard_onsite_receipt_work();
create trigger onsite_receipt_quote_guard before insert or update or delete on public.quotes for each row execute function public.guard_onsite_receipt_work();
create trigger onsite_receipt_amendment_guard before insert or update or delete on public.quote_amendments for each row execute function public.guard_onsite_receipt_work();

-- A booking already chose its settlement method. Never start a legacy Checkout
-- alongside its card hold or an on-site receipt declaration.
create or replace function public.guard_phone_booking_checkout(p_quote_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare job uuid;
begin
 select i.id into job from public.quotes q join public.interventions i on i.id=q.intervention_id where q.id=p_quote_id and i.client_id=auth.uid();
 if not found then raise insufficient_privilege; end if;
 if exists(select 1 from public.phone_booking_requests where intervention_id=job) then raise exception 'Booking requires its dedicated settlement method' using errcode='P0001'; end if;
end; $$;

-- Keep the business total, and disclose its bank/declaration provenance.
-- Preserve the existing private admin workflow and support capability wrapper.
create or replace function public.admin_overview() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not public.is_admin() then raise insufficient_privilege; end if;
 result=jsonb_set(public.admin_overview_before_support(),'{capabilities,support_tickets}','true'::jsonb,false);
 return jsonb_set(result,'{financial}',(result->'financial')||jsonb_build_object(
  'bank_paid_service_cents',(select coalesce(sum(total_cents),0) from public.payments where status='paid' and method='stripe'),
  'on_site_declared_cents',(select coalesce(sum(total_cents),0) from public.payments where status='paid' and method='on_site_declared'),
  'note','Prestations réglées : paiements bancaires confirmés et règlements sur place déclarés par les artisans, distingués ci-dessous. Pas le revenu net de la plateforme.'
 ),false);
end; $$;
commit;

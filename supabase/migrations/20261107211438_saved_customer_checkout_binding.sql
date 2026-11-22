begin;

create table saved_payment_private.checkout_customers (
  checkout_id uuid primary key references public.platform_checkouts(id) on delete cascade,
  binding_id uuid not null,
  customer_id text not null check (customer_id ~ '^cus_[A-Za-z0-9]{1,200}$'),
  live boolean not null
);
alter table saved_payment_private.checkout_customers enable row level security;
revoke all on saved_payment_private.checkout_customers from public, anon, authenticated, service_role;

-- NULL disables new bindings. The operator chooses the Stripe mode during receipt tests.
create table saved_payment_private.checkout_control (
  singleton boolean primary key default true check (singleton), live_mode boolean
);
insert into saved_payment_private.checkout_control values (true, null);
alter table saved_payment_private.checkout_control enable row level security;
revoke all on saved_payment_private.checkout_control from public, anon, authenticated, service_role;

-- Serialize with both the old and new checkout paths. Only a newly created ledger can
-- acquire a customer, since an earlier ledger may already have sent its first Stripe request.
create function public.begin_platform_checkout_with_saved_customer(p_quote_id uuid, p_live boolean)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  job uuid;
  previous uuid;
  checkout uuid;
  enabled_mode boolean;
  binding saved_payment_private.customers;
begin
  if actor is null or p_live is null then raise insufficient_privilege; end if;
  select live_mode into enabled_mode from saved_payment_private.checkout_control;
  if enabled_mode is null then return public.begin_platform_checkout(p_quote_id); end if;
  if enabled_mode is distinct from p_live then raise insufficient_privilege; end if;
  select i.id into job from public.quotes q join public.interventions i on i.id = q.intervention_id
  where q.id = p_quote_id and public.platform_checkout_can_pay(i.id, actor);
  if not found then raise no_data_found; end if;
  perform public.lock_intervention_organization(job);
  perform 1 from public.interventions where id = job for update;
  perform 1 from public.quotes where id = p_quote_id for update;
  select id into previous from public.platform_checkouts where quote_id = p_quote_id and status <> 'expired';
  checkout := public.begin_platform_checkout(p_quote_id);

  if previous is null and saved_payment_private.authorized(actor)
    and exists (select 1 from public.interventions where id = job and site_id is null and client_id = actor) then
    select * into binding from saved_payment_private.customers
    where user_id = actor and live = p_live and customer_id is not null;
    if found then
      insert into saved_payment_private.checkout_customers values (checkout, binding.id, binding.customer_id, binding.live);
    end if;
  end if;
  return checkout;
end;
$$;
revoke all on function public.begin_platform_checkout_with_saved_customer(uuid, boolean) from public, anon, authenticated, service_role;
grant execute on function public.begin_platform_checkout_with_saved_customer(uuid, boolean) to authenticated;

create function public.platform_checkout_with_customer_private(p_id uuid, p_actor uuid, p_live boolean)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  item public.platform_checkouts;
  binding saved_payment_private.checkout_customers;
begin
  select * into item from public.platform_checkouts where id = p_id and actor_id = p_actor;
  if not found then raise no_data_found; end if;
  if p_live is null or not public.platform_checkout_payer_current(p_id, p_actor) then raise insufficient_privilege; end if;
  select * into binding from saved_payment_private.checkout_customers where checkout_id = p_id;
  if found and (binding.live is distinct from p_live or not saved_payment_private.authorized(p_actor)
    or not exists (select 1 from public.interventions where id = item.intervention_id and site_id is null and client_id = p_actor)
    or not exists (select 1 from saved_payment_private.customers
                   where id = binding.binding_id and user_id = p_actor and live = p_live and customer_id = binding.customer_id)) then
    raise insufficient_privilege;
  end if;
  return jsonb_build_object('ledger', to_jsonb(item), 'saved_customer',
    case when binding.checkout_id is not null then jsonb_build_object('id', binding.customer_id, 'binding_id', binding.binding_id) end);
end;
$$;
revoke all on function public.platform_checkout_with_customer_private(uuid, uuid, boolean) from public, anon, authenticated, service_role;
grant execute on function public.platform_checkout_with_customer_private(uuid, uuid, boolean) to service_role;

-- Older previews cannot send a different Checkout body with the same idempotency key.
create or replace function public.platform_checkout_private(p_id uuid, p_actor uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare item public.platform_checkouts;
begin
  select * into item from public.platform_checkouts where id = p_id and actor_id = p_actor;
  if not found then raise no_data_found; end if;
  if not public.platform_checkout_payer_current(p_id, p_actor) or
    exists (select 1 from saved_payment_private.checkout_customers where checkout_id = p_id) then
    raise insufficient_privilege;
  end if;
  return to_jsonb(item);
end;
$$;

commit;

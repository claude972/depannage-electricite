-- Booking retries: a key belongs to one authenticated actor and one normalized payload.
-- The ledger is private; cascading actor/job deletion also removes its payload.
begin;
create table public.intervention_request_keys (
 actor_id uuid not null references auth.users(id) on delete cascade,
 request_id uuid not null,
 payload jsonb not null check(jsonb_typeof(payload)='object'),
 intervention_id uuid not null references public.interventions(id) on delete cascade,
 created_at timestamptz not null default now(),
 primary key(actor_id,request_id)
);
alter table public.intervention_request_keys enable row level security;
revoke all on public.intervention_request_keys from public,anon,authenticated;

create function public.create_intervention_once(
 p_request_id uuid,p_category text,p_description text,p_address text,p_postal_code text,
 p_city text,p_urgency text,p_site_id uuid default null
) returns public.interventions language plpgsql security definer set search_path='' as $$
declare
 actor uuid=auth.uid(); normalized jsonb; kept public.intervention_request_keys;
 result public.interventions;
begin
 if actor is null or not exists(select 1 from public.profiles where id=actor and role in ('client','manager','admin')) then
  raise insufficient_privilege;
 end if;
 if p_request_id is null then raise invalid_parameter_value; end if;
 -- The key lock is transaction-scoped. The primary key remains a second uniqueness guard.
 perform pg_advisory_xact_lock(hashtextextended('booking:'||actor::text||':'||p_request_id::text,0));
 -- Re-check current write access on EVERY call, including identical retries.
 if p_site_id is not null then perform public.lock_site_access(p_site_id); end if;
 normalized=jsonb_build_object('category',trim(p_category),'description',trim(p_description),
  'address',trim(p_address),'postal_code',trim(p_postal_code),'city',trim(p_city),
  'urgency',trim(p_urgency),'site_id',p_site_id);
 select * into kept from public.intervention_request_keys where actor_id=actor and request_id=p_request_id;
 if found then
  if kept.payload is distinct from normalized then
   raise exception 'Request key already used for another payload' using errcode='P0001';
  end if;
  -- Match the existing organization-before-dossier locking order. Return the current row,
  -- never an old serialized response whose permissions or business state may have changed.
  perform public.lock_intervention_organization(kept.intervention_id);
  select * into result from public.interventions where id=kept.intervention_id for share;
  if not found then raise no_data_found; end if;
  if not public.can_access_intervention(result.id) then raise insufficient_privilege; end if;
  if result.site_id is not null then
   perform public.lock_site_access(result.site_id);
  elsif result.client_id<>actor and not public.is_admin() then
   raise insufficient_privilege;
  end if;
  return result;
 end if;
 -- Only the first successful attempt consumes quota and emits the original creation audit.
 result=public.create_intervention(trim(p_category),trim(p_description),trim(p_address),
  trim(p_postal_code),trim(p_city),trim(p_urgency),p_site_id);
 insert into public.intervention_request_keys(actor_id,request_id,payload,intervention_id)
 values(actor,p_request_id,normalized,result.id);
 return result;
end; $$;
revoke all on function public.create_intervention_once(uuid,text,text,text,text,text,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.create_intervention_once(uuid,text,text,text,text,text,text,uuid) to authenticated;
commit;

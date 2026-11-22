begin;

create table public.mission_offer_photo_consent (
  document_id uuid primary key references public.documents(id) on delete cascade,
  intervention_id uuid not null references public.interventions(id),
  owner_id uuid not null references public.profiles(id),
  offer_updated_at timestamptz not null,
  shared boolean not null
);
alter table public.mission_offer_photo_consent enable row level security;
revoke all on public.mission_offer_photo_consent from public, anon, authenticated, service_role;

create function public.set_mission_offer_photo(p_id uuid, p_document_id uuid, p_shared boolean)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  job public.interventions;
begin
  if actor is null or p_shared is null then raise insufficient_privilege; end if;
  select * into job from public.interventions where id = p_id and client_id = actor for update;
  if not found or not exists(select 1 from public.profiles where id = actor and role = 'client') then
    raise insufficient_privilege;
  end if;
  if job.status <> 'requested' or job.artisan_id is not null then
    raise exception 'Offer no longer open' using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from public.documents
    where id = p_document_id and intervention_id = p_id and owner_id = actor
      and mime_type in ('image/jpeg','image/png','image/webp')
  ) then raise insufficient_privilege; end if;
  perform public.consume_action('operations', 30);
  if p_shared and (
    select count(*) from public.mission_offer_photo_consent
    where intervention_id = p_id and owner_id = actor and offer_updated_at = job.updated_at and shared and document_id <> p_document_id
  ) >= 6 then raise invalid_parameter_value; end if;
  insert into public.mission_offer_photo_consent(document_id, intervention_id, owner_id, offer_updated_at, shared)
  values (p_document_id, p_id, actor, job.updated_at, p_shared)
  on conflict (document_id) do update set offer_updated_at = excluded.offer_updated_at, shared = excluded.shared;
  return p_shared;
end;
$$;
revoke all on function public.set_mission_offer_photo(uuid,uuid,boolean) from public, anon, authenticated, service_role;
grant execute on function public.set_mission_offer_photo(uuid,uuid,boolean) to authenticated;

-- Paths (which include uploader identity) stay behind the service role.
-- A change in the dossier invalidates its previous opt-ins.
create function public.read_mission_offer_photos(p_id uuid, p_actor uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare job public.interventions;
begin
  select * into job from public.interventions where id = p_id and status = 'requested' and artisan_id is null;
  if not found or not (
    public.mission_eligible(p_id, p_actor) or
    (job.client_id = p_actor and exists(select 1 from public.profiles where id = p_actor and role = 'client'))
  ) then raise no_data_found; end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'path',d.path) order by d.id),'[]'::jsonb)
    from public.mission_offer_photo_consent c
    join public.documents d on d.id = c.document_id and d.intervention_id = c.intervention_id and d.owner_id = c.owner_id
    where c.intervention_id = p_id and c.owner_id = job.client_id and c.shared
      and c.offer_updated_at = job.updated_at and d.mime_type in ('image/jpeg','image/png','image/webp')
  );
end;
$$;
revoke all on function public.read_mission_offer_photos(uuid,uuid) from public, anon, authenticated, service_role;
grant execute on function public.read_mission_offer_photos(uuid,uuid) to service_role;

commit;

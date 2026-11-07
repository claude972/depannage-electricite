begin;

-- The only inputs are the chosen reference commune and an offer's private postal code.
create function mission_radius_private.distance_km(p_reference_code text, p_postal text)
returns double precision language sql stable security definer set search_path = '' as $$
  select 2 * 6371.0088 * asin(sqrt(least(1.0, greatest(0.0,
    power(sin(radians(destination.latitude - origin.latitude) / 2), 2)
    + cos(radians(origin.latitude)) * cos(radians(destination.latitude))
      * power(sin(radians(destination.longitude - origin.longitude) / 2), 2)
  ))))
  from mission_radius_private.commune_centres origin
  cross join lateral (
    select min(latitude) latitude, min(longitude) longitude
    from mission_radius_private.commune_centres where p_postal = any(postal_codes)
    having count(*) = 1
  ) destination
  where origin.code = p_reference_code;
$$;
revoke all on function mission_radius_private.distance_km(text, text) from public, anon, authenticated, service_role;

create or replace function mission_radius_private.within_radius(p_job uuid, p_artisan uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((
    select mission_radius_private.distance_km(p.reference_code, i.postal_code) <= p.radius_km
    from mission_radius_private.preferences p cross join public.interventions i
    where p.artisan_id = p_artisan and i.id = p_job
  ), true);
$$;

create function public.available_missions_by_distance(
  p_after_at timestamptz default null,
  p_after_id uuid default null,
  p_after_km_band integer default null,
  p_radius_version integer default null
)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  preference mission_radius_private.preferences;
  eligible boolean;
begin
  if actor is null or not exists (select 1 from public.profiles where id = actor and role = 'artisan') then
    raise insufficient_privilege;
  end if;
  if (p_after_at is null) <> (p_after_id is null) or (p_after_at is null) <> (p_radius_version is null)
    or (p_after_at is null and p_after_km_band is not null)
    or not isfinite(coalesce(p_after_at, now()))
    or (p_after_km_band is not null and (p_after_km_band not between 5 and 200 or p_after_km_band % 5 <> 0)) then
    raise invalid_parameter_value;
  end if;
  select * into preference from mission_radius_private.preferences where artisan_id = actor;
  if preference.reference_code is null or (p_radius_version is not null and p_radius_version <> preference.version) then
    raise invalid_parameter_value;
  end if;
  select coalesce(p.artisan_approved and a.application_status = 'approved' and a.available, false) into eligible
  from public.profiles p left join public.artisan_profiles a on a.user_id = p.id where p.id = actor;

  return jsonb_build_object('eligible', eligible, 'captured_at', now(), 'radius_version', preference.version, 'items', (
    with candidates as materialized (
      select i.id, i.category, i.city, left(i.postal_code, 3) || '**' as postal_code,
        i.urgency, i.status, i.estimate_min_cents, i.estimate_max_cents, i.created_at,
        mission_radius_private.distance_km(preference.reference_code, i.postal_code) km
      from public.interventions i
      where eligible and i.status = 'requested' and i.artisan_id is null and public.mission_eligible(i.id, actor)
    ), bands as (
      select id, category, city, postal_code, urgency, status, estimate_min_cents, estimate_max_cents, created_at,
        case when km is not null then greatest(5, ceil(km / 5)::integer * 5) end as distance_band_km
      from candidates
    )
    select coalesce(jsonb_agg(to_jsonb(r) order by r.distance_band_km nulls last, r.created_at, r.id), '[]'::jsonb)
    from (
      select * from bands
      where p_after_at is null or (coalesce(distance_band_km, 201), created_at, id)
        > (coalesce(p_after_km_band, 201), p_after_at, p_after_id)
      order by distance_band_km nulls last, created_at, id
      limit 51
    ) r
  ));
end;
$$;
revoke all on function public.available_missions_by_distance(timestamptz, uuid, integer, integer) from public, anon, authenticated, service_role;
grant execute on function public.available_missions_by_distance(timestamptz, uuid, integer, integer) to authenticated;

commit;

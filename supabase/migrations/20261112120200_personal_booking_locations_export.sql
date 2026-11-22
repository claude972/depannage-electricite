begin;

-- The actor is derived from the session. The export includes the actor's
-- stored reservation even while it is pending, and only personal dossiers
-- once a reservation is attached to an intervention.
create function public.export_personal_booking_locations(p_after uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  result jsonb;
begin
  if actor is null then
    raise insufficient_privilege;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', row.request_id,
    'actor_id', row.actor_id,
    'intervention_id', row.intervention_id,
    'location', jsonb_build_object(
      'latitude', row.latitude,
      'longitude', row.longitude,
      'access_details', row.access_details
    )
  ) order by row.request_id), '[]'::jsonb)
  into result
  from (
    select l.request_id, l.actor_id, b.intervention_id, l.latitude, l.longitude, l.access_details
    from public.booking_locations l
    join public.phone_booking_requests b on b.actor_id = l.actor_id and b.request_id = l.request_id
    left join public.interventions i on i.id = b.intervention_id and i.client_id = actor and i.site_id is null
    where l.actor_id = actor
      and (p_after is null or l.request_id > p_after)
      and (b.intervention_id is null or i.id is not null)
    order by l.request_id
    limit 101
  ) row;

  return result;
end;
$$;

revoke all on function public.export_personal_booking_locations(uuid) from public, anon, authenticated, service_role;
grant execute on function public.export_personal_booking_locations(uuid) to authenticated;

commit;

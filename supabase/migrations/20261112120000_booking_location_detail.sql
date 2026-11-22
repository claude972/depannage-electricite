begin;

-- The booking join stays private. The caller can only read the location of a
-- confirmed dossier they own or that is currently assigned to them.
create function public.read_booking_location(p_intervention_id uuid)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'latitude', l.latitude,
    'longitude', l.longitude,
    'access_details', l.access_details
  )
  from public.interventions i
  join public.phone_booking_requests b
    on b.intervention_id = i.id and b.actor_id = i.client_id and b.status = 'confirmed'
  join public.booking_locations l on l.actor_id = b.actor_id and l.request_id = b.request_id
  where i.id = p_intervention_id
    and (
      (i.site_id is null and i.client_id = auth.uid())
      or (i.artisan_id = auth.uid() and i.status <> 'requested')
    )
    and public.can_access_intervention(i.id);
$$;

revoke all on function public.read_booking_location(uuid) from public, anon, authenticated, service_role;
grant execute on function public.read_booking_location(uuid) to authenticated;

commit;

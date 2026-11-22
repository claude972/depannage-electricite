begin;

create or replace function public.save_intervention_appointment(
  p_id uuid, p_starts_at timestamptz, p_ends_at timestamptz, p_note text, p_expected_version integer
)
returns public.intervention_appointments
language plpgsql security definer set search_path = ''
as $$
declare
  job public.interventions;
  current_version integer;
begin
  if p_expected_version is null or p_expected_version < 0 then
    raise invalid_parameter_value;
  end if;
  perform public.lock_intervention_organization(p_id);
  select * into job from public.interventions where id = p_id for update;
  if not coalesce((
    public.owns_intervention(p_id) or (job.artisan_id = auth.uid() and exists (
      select 1 from public.profiles where id = auth.uid() and artisan_approved
    ))
  ), false) then
    raise insufficient_privilege;
  end if;
  -- The dossier lock serializes first creation and updates, including a missing appointment row.
  select reminder_version into current_version
    from public.intervention_appointments where intervention_id = p_id;
  if coalesce(current_version, 0) <> p_expected_version then
    raise exception 'Appointment revision conflict' using errcode = 'P0001';
  end if;
  return public.save_intervention_appointment_before_site_access(p_id, p_starts_at, p_ends_at, p_note);
end;
$$;

revoke all on function public.save_intervention_appointment(uuid, timestamptz, timestamptz, text)
  from public, anon, authenticated, service_role;
revoke all on function public.save_intervention_appointment(uuid, timestamptz, timestamptz, text, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.save_intervention_appointment(uuid, timestamptz, timestamptz, text, integer)
  to authenticated;

commit;

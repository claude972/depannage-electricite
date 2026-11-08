begin;

create or replace function public.resolve_warranty(
  p_case_id uuid, p_status text, p_resolution text, p_expected_version timestamptz
)
returns public.warranty_cases
language plpgsql security definer set search_path = ''
as $$
declare
  result public.warranty_cases;
begin
  if not public.is_admin() then raise insufficient_privilege; end if;
  if p_status is null or p_status not in ('reviewing', 'resolved', 'declined')
    or p_expected_version is null or not isfinite(p_expected_version) then
    raise invalid_parameter_value;
  end if;

  select * into result from public.warranty_cases where id = p_case_id for update;
  if not found then raise no_data_found; end if;
  if result.updated_at is distinct from p_expected_version then
    raise exception 'Warranty revision conflict' using errcode = 'P0001';
  end if;

  update public.warranty_cases
    set status = p_status, resolution = p_resolution,
        updated_at = greatest(clock_timestamp(), result.updated_at + interval '1 microsecond')
    where id = p_case_id returning * into result;
  insert into public.audit_log(actor_id, intervention_id, action)
    values (auth.uid(), result.intervention_id, 'warranty_' || p_status);
  return result;
end;
$$;

revoke all on function public.resolve_warranty(uuid, text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.resolve_warranty(uuid, text, text, timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.resolve_warranty(uuid, text, text, timestamptz)
  to authenticated;

commit;

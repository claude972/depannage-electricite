begin;

-- Store the preference without deciding which interventions consume capacity.
alter table public.artisan_profiles
  add column if not exists capacity_limit integer check (capacity_limit > 0),
  add column if not exists capacity_version integer not null default 0 check (capacity_version >= 0);

create or replace function public.set_artisan_capacity_limit(p_limit integer, p_expected_version integer)
returns public.artisan_profiles language plpgsql security definer set search_path = '' as $$
declare
  current_profile public.artisan_profiles;
begin
  perform public.guard_artisan_self_edit();
  if (p_limit is not null and p_limit <= 0) or p_expected_version is null or p_expected_version < 0 then
    raise invalid_parameter_value;
  end if;
  select * into current_profile from public.artisan_profiles where user_id = auth.uid();
  if not found then raise no_data_found; end if;
  if current_profile.capacity_version <> p_expected_version or current_profile.capacity_version = 2147483647 then
    raise exception 'Capacity revision changed' using errcode = 'P0001';
  end if;
  if current_profile.capacity_limit is not distinct from p_limit then return current_profile; end if;
  perform public.consume_action('artisan_capacity', 30);
  update public.artisan_profiles
    set capacity_limit = p_limit, capacity_version = capacity_version + 1
    where user_id = auth.uid()
    returning * into current_profile;
  return current_profile;
end;
$$;
revoke all on function public.set_artisan_capacity_limit(integer, integer) from public, anon, authenticated, service_role;
grant execute on function public.set_artisan_capacity_limit(integer, integer) to authenticated;

commit;

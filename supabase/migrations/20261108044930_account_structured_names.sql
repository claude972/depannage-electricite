begin;

alter table public.profiles
  add column first_name text,
  add column last_name text,
  add constraint profiles_structured_name check (
    (first_name is null and last_name is null)
    or (
      first_name is not null and last_name is not null
      and char_length(first_name) between 1 and 60
      and char_length(last_name) between 1 and 60
      and btrim(first_name) = first_name and btrim(last_name) = last_name
      and full_name = first_name || ' ' || last_name
    )
  );

-- The legacy RPC still accepts an entire name. Retain a known split on a phone-only change.
create function public.clear_outdated_profile_name_parts()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.first_name is not null and new.last_name is not null
    and new.full_name <> new.first_name || ' ' || new.last_name
    and new.first_name is not distinct from old.first_name
    and new.last_name is not distinct from old.last_name then
    new.first_name := null;
    new.last_name := null;
  end if;
  return new;
end;
$$;
revoke all on function public.clear_outdated_profile_name_parts() from public, anon, authenticated, service_role;
create trigger profiles_name_parts_before_change
  before update of full_name on public.profiles
  for each row execute function public.clear_outdated_profile_name_parts();

create or replace function public.create_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  given_name text;
  family_name text;
  complete_name text;
begin
  if jsonb_typeof(new.raw_user_meta_data->'first_name') = 'string'
    and jsonb_typeof(new.raw_user_meta_data->'last_name') = 'string' then
    given_name := btrim(new.raw_user_meta_data->>'first_name');
    family_name := btrim(new.raw_user_meta_data->>'last_name');
  end if;

  if char_length(given_name) between 1 and 60
    and char_length(family_name) between 1 and 60
    and char_length(given_name || ' ' || family_name) <= 120 then
    complete_name := given_name || ' ' || family_name;
  else
    given_name := null;
    family_name := null;
    complete_name := left(coalesce(nullif(trim(new.raw_user_meta_data->>'full_name'), ''), 'Mon compte'), 120);
  end if;

  insert into public.profiles (id, role, full_name, first_name, last_name)
  values (new.id,
    case when new.raw_user_meta_data->>'role' in ('artisan','manager') then new.raw_user_meta_data->>'role' else 'client' end,
    complete_name, given_name, family_name);
  return new;
end;
$$;

create function public.update_profile_name(p_first_name text, p_last_name text, p_phone text)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  given_name text := btrim(p_first_name);
  family_name text := btrim(p_last_name);
  result public.profiles;
begin
  if auth.uid() is null then
    raise insufficient_privilege;
  end if;
  if given_name is null or char_length(given_name) not between 1 and 60
    or family_name is null or char_length(family_name) not between 1 and 60
    or char_length(given_name || ' ' || family_name) > 120 or p_phone is null or char_length(p_phone) > 30 then
    raise invalid_parameter_value;
  end if;

  update public.profiles
    set first_name = given_name, last_name = family_name,
        full_name = given_name || ' ' || family_name, phone = p_phone
    where id = auth.uid() returning * into result;
  if not found then
    raise no_data_found;
  end if;
  return result;
end;
$$;
revoke all on function public.update_profile_name(text, text, text) from public, anon, authenticated, service_role;
grant execute on function public.update_profile_name(text, text, text) to authenticated;

commit;

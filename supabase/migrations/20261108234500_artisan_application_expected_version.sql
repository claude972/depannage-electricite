begin;

alter table public.artisan_profiles
  add column if not exists application_version integer not null default 1 check (application_version > 0);

create or replace function public.bump_artisan_application_version()
returns trigger language plpgsql set search_path = ''
as $$
begin
  new.application_version := old.application_version + 1;
  return new;
end;
$$;
revoke all on function public.bump_artisan_application_version() from public, anon, authenticated, service_role;
drop trigger if exists artisan_application_version on public.artisan_profiles;
create trigger artisan_application_version before update on public.artisan_profiles
  for each row execute function public.bump_artisan_application_version();

create or replace function public.decide_artisan_application(
  p_user_id uuid, p_action text, p_expected_version integer
)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  account public.profiles;
  dossier public.artisan_profiles;
begin
  if not public.is_admin() then raise insufficient_privilege; end if;
  if p_action is null or p_action not in ('approve', 'request_changes', 'suspend', 'reinstate')
    or p_expected_version is null or p_expected_version < 0 then
    raise invalid_parameter_value;
  end if;

  -- Same lock order as the underlying approval command.
  select * into account from public.profiles where id = p_user_id for update;
  if not found or account.role <> 'artisan' then raise no_data_found; end if;
  select * into dossier from public.artisan_profiles where user_id = p_user_id for update;
  if coalesce(dossier.application_version, 0) <> p_expected_version then
    raise exception 'Artisan application revision conflict' using errcode = 'P0001';
  end if;
  if not coalesce(case p_action
    when 'approve' then dossier.application_status = 'submitted'
    when 'request_changes' then dossier.application_status = 'submitted'
    when 'reinstate' then dossier.application_status = 'suspended'
    when 'suspend' then dossier.application_status in ('approved', 'suspended')
      or (dossier.user_id is null and account.artisan_approved)
  end, false) then
    raise exception 'Artisan application action does not match the current status' using errcode = 'P0001';
  end if;

  perform public.approve_artisan(p_user_id, p_action in ('approve', 'reinstate'));
end;
$$;
revoke all on function public.approve_artisan(uuid, boolean) from public, anon, authenticated, service_role;
revoke all on function public.decide_artisan_application(uuid, text, integer) from public, anon, authenticated, service_role;
grant execute on function public.decide_artisan_application(uuid, text, integer) to authenticated;

commit;

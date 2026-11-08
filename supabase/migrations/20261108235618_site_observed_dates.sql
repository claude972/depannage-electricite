begin;

create or replace function public.check_sla_observed_dates()
returns trigger language plpgsql set search_path = ''
as $$
declare
  cutoff timestamptz := statement_timestamp();
begin
  if new.opened_at > cutoff or new.responded_at > cutoff or new.resolved_at > cutoff then
    raise invalid_parameter_value;
  end if;
  return new;
end;
$$;
revoke all on function public.check_sla_observed_dates() from public, anon, authenticated, service_role;
drop trigger if exists site_sla_observed_dates on public.site_sla_cases;
create trigger site_sla_observed_dates
  before insert or update of opened_at, responded_at, resolved_at on public.site_sla_cases
  for each row execute function public.check_sla_observed_dates();

create or replace function public.check_erp_observed_dates()
returns trigger language plpgsql set search_path = ''
as $$
declare
  today date := (statement_timestamp() at time zone 'America/Martinique')::date;
begin
  if new.performed_on > today or exists (
    select 1 from jsonb_array_elements(new.items) as item
    cross join lateral (select (item->>'reserve_resolved_on')::date as resolved_on) as event
    where event.resolved_on is not null
      and (new.performed_on is null or event.resolved_on < new.performed_on or event.resolved_on > today)
  ) then raise invalid_parameter_value; end if;
  return new;
end;
$$;
revoke all on function public.check_erp_observed_dates() from public, anon, authenticated, service_role;
drop trigger if exists site_erp_observed_dates on public.site_erp_checklists;
create trigger site_erp_observed_dates
  before insert or update of performed_on, items on public.site_erp_checklists
  for each row execute function public.check_erp_observed_dates();

commit;

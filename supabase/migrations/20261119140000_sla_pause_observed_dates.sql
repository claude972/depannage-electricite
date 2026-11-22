-- D21 (O9) : une pause de délai est un fait constaté, comme l'ouverture, la réponse et la résolution
-- (check_sla_observed_dates, 20261108235618). Son début et sa fin ne peuvent pas être postérieurs à
-- l'instant de l'écriture. Il n'existe pas de pause « planifiée » dans le modèle : rien d'autorisé
-- n'est retiré. Migration additive, sans réécriture des lignes existantes.
begin;

create or replace function public.check_sla_pause_observed_dates()
returns trigger language plpgsql set search_path = ''
as $$
declare
  cutoff timestamptz := statement_timestamp();
begin
  if new.started_at > cutoff or new.ended_at > cutoff then
    raise invalid_parameter_value;
  end if;
  return new;
end;
$$;
revoke all on function public.check_sla_pause_observed_dates() from public, anon, authenticated, service_role;
drop trigger if exists site_sla_pause_observed_dates on public.site_sla_pauses;
create trigger site_sla_pause_observed_dates
  before insert or update of started_at, ended_at on public.site_sla_pauses
  for each row execute function public.check_sla_pause_observed_dates();

commit;

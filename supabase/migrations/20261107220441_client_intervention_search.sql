begin;

create index interventions_client_history_keyset on public.interventions(client_id, created_at desc, id desc);

-- This is an invoker read under the same RLS as the dossier. The account filter is
-- deliberately narrower than all the interventions readable under other role scopes.
create function public.client_intervention_search(
  p_filter text, p_search text, p_after_at timestamptz default null, p_after_id uuid default null
)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  actor uuid := auth.uid();
  needle text := lower(btrim(p_search));
begin
  if actor is null or not exists (select 1 from public.profiles where id = actor and role = 'client') then
    raise insufficient_privilege;
  end if;
  if p_filter is null or p_filter not in ('active', 'all', 'past') or needle is null or length(needle) > 120
    or p_search ~ '[[:cntrl:]]' or (p_after_at is null) <> (p_after_id is null)
    or not isfinite(coalesce(p_after_at, now())) then raise invalid_parameter_value; end if;

  return (
    with matched as not materialized (
      select i.id, i.category, i.address, i.postal_code, i.city, i.urgency, i.status,
        i.estimate_min_cents, i.estimate_max_cents, i.created_at
      from public.interventions i
      where i.client_id = actor
        and (p_filter = 'all' or (p_filter = 'past') = (i.status in ('paid', 'cancelled')))
        and (needle = '' or strpos(lower(concat_ws(' ',
          case i.category
            when 'outage' then 'Coupure de courant'
            when 'panel' then 'Tableau électrique'
            when 'socket' then 'Prise ou interrupteur'
            when 'lighting' then 'Éclairage'
            else 'Recherche de panne'
          end, i.address, i.city, i.postal_code, 'INT-' || left(replace(i.id::text, '-', ''), 6)
        )), needle) > 0)
    ), page as (
      select * from matched
      where p_after_at is null or (created_at, id) < (p_after_at, p_after_id)
      order by created_at desc, id desc limit 51
    )
    select jsonb_build_object('total', (select count(*) from matched),
      'items', coalesce((select jsonb_agg(to_jsonb(p) order by p.created_at desc, p.id desc) from page p), '[]'::jsonb))
  );
end;
$$;
revoke all on function public.client_intervention_search(text, text, timestamptz, uuid) from public, anon, authenticated, service_role;
grant execute on function public.client_intervention_search(text, text, timestamptz, uuid) to authenticated;

commit;

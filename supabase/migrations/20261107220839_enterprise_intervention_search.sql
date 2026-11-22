begin;

create index interventions_site_history on public.interventions(site_id, created_at, id);

create function public.enterprise_intervention_search(
  p_organization uuid, p_site uuid, p_category text, p_status text, p_search text, p_sort text,
  p_page integer, p_export boolean
)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  actor uuid := auth.uid();
  needle text := lower(btrim(p_search));
  batch_size integer := case when p_export then 5001 else 10 end;
begin
  if actor is null or not exists (select 1 from public.profiles where id = actor and role = 'manager') then
    raise insufficient_privilege;
  end if;
  if p_organization is null or p_sort is null or p_sort not in ('recent', 'oldest') or p_export is null
    or p_page is null or p_page not between 1 and 1000000 or (p_export and p_page <> 1)
    or (p_category is not null and p_category not in ('outage', 'panel', 'socket', 'lighting', 'diagnostic'))
    or (p_status is not null and p_status not in ('requested', 'assigned', 'quoted', 'accepted', 'in_progress', 'completed', 'paid', 'cancelled'))
    or needle is null or length(needle) > 120 or p_search ~ '[[:cntrl:]]' then raise invalid_parameter_value; end if;
  if not exists (select 1 from public.organization_members where organization_id = p_organization and user_id = actor)
    or (p_site is not null and not exists (select 1 from public.sites where id = p_site and organization_id = p_organization)) then
    raise no_data_found;
  end if;

  return (
    with matched as not materialized (
      select i.id, i.site_id, s.name as site_name, i.category, i.address, i.postal_code, i.city, i.urgency, i.status,
        i.artisan_id is not null as artisan_assigned, i.estimate_min_cents, i.estimate_max_cents, i.created_at
      from public.sites s join public.interventions i on i.site_id = s.id
      where s.organization_id = p_organization and (p_site is null or s.id = p_site)
        and (p_category is null or i.category = p_category) and (p_status is null or i.status = p_status)
        and (needle = '' or strpos(lower(concat_ws(' ', s.name, i.description,
          'INT-' || left(replace(i.id::text, '-', ''), 6), i.address, i.postal_code, i.city,
          case i.category
            when 'outage' then 'Coupure de courant'
            when 'panel' then 'Tableau électrique'
            when 'socket' then 'Prise ou interrupteur'
            when 'lighting' then 'Éclairage'
            else 'Recherche de panne'
          end)), needle) > 0)
    ), matched_count as (select count(*) as total from matched), page as (
      select * from matched
      where not p_export or (select total <= 5000 from matched_count)
      order by case when p_sort = 'recent' then created_at end desc,
        case when p_sort = 'recent' then id end desc, created_at, id
      limit batch_size offset (p_page - 1) * 10
    )
    select jsonb_build_object('total', (select total from matched_count),
      'items', coalesce((select jsonb_agg(to_jsonb(p) order by
        case when p_sort = 'recent' then p.created_at end desc,
        case when p_sort = 'recent' then p.id end desc, p.created_at, p.id) from page p), '[]'::jsonb))
  );
end;
$$;
revoke all on function public.enterprise_intervention_search(uuid, uuid, text, text, text, text, integer, boolean) from public, anon, authenticated, service_role;
grant execute on function public.enterprise_intervention_search(uuid, uuid, text, text, text, text, integer, boolean) to authenticated;

commit;

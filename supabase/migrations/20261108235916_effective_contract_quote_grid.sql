begin;

create or replace function public.applicable_contract_quote_grids(p_site_id uuid)
returns setof public.organization_contract_grids
language sql stable security invoker set search_path = ''
as $$
  -- Publication supersedes the editorial revision immediately. Pricing selects
  -- the latest effective publication in each lineage independently of that status.
  select effective.*
  from public.sites s
  join lateral (
    select distinct on (g.lineage_id) g.*
    from public.organization_contract_grids g
    where g.organization_id = s.organization_id
      and (g.status = 'published' or (g.status = 'superseded' and g.published_at is not null))
      and (g.effective_from is null or g.effective_from <= current_date)
    order by g.lineage_id, g.version_number desc
  ) effective on true
  left join public.contracts c on c.id = effective.contract_id and c.organization_id = effective.organization_id
  where s.id = p_site_id and s.archived_at is null
    and jsonb_array_length(effective.lines) > 0
    and (effective.contract_id is null or (c.status = 'active' and c.starts_on <= current_date
      and (c.ends_on is null or c.ends_on >= current_date)));
$$;
revoke all on function public.applicable_contract_quote_grids(uuid) from public, anon, authenticated, service_role;

commit;

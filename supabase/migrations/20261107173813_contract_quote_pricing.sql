begin;

create table public.quote_contract_sources (
  intervention_id uuid not null references public.interventions(id),
  artisan_id uuid not null references public.profiles(id),
  draft_version integer not null check (draft_version > 0),
  grid_id uuid not null references public.organization_contract_grids(id),
  grid_version integer not null check (grid_version > 0),
  grid_label text not null,
  quote_id uuid unique references public.quotes(id),
  applied_at timestamptz not null default clock_timestamp(),
  primary key (intervention_id, artisan_id, draft_version)
);
alter table public.quote_contract_sources enable row level security;
revoke all on public.quote_contract_sources from public, anon, authenticated, service_role;
grant select (quote_id, grid_id, grid_version, grid_label, applied_at) on public.quote_contract_sources to authenticated;
create policy quote_contract_source_read on public.quote_contract_sources
  for select to authenticated using (
    quote_id is not null and exists (select 1 from public.quotes q where q.id = quote_id)
  );

create function public.applicable_contract_quote_grids(p_site_id uuid)
returns setof public.organization_contract_grids
language sql stable security invoker set search_path = '' as $$
  select g.*
  from public.sites s
  join public.organization_contract_grids g on g.organization_id = s.organization_id
  left join public.contracts c on c.id = g.contract_id and c.organization_id = g.organization_id
  where s.id = p_site_id and s.archived_at is null and g.status = 'published'
    and (g.effective_from is null or g.effective_from <= current_date)
    and jsonb_array_length(g.lines) > 0
    and (g.contract_id is null or (c.status = 'active' and c.starts_on <= current_date
      and (c.ends_on is null or c.ends_on >= current_date)));
$$;
revoke all on function public.applicable_contract_quote_grids(uuid) from public, anon, authenticated, service_role;

create function public.read_quote_grid_options(p_id uuid, p_after uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare current_draft jsonb; site uuid; source jsonb; options jsonb;
begin
  current_draft := public.manage_quote_draft(p_id, 'load');
  select site_id into strict site from public.interventions where id = p_id;
  if current_draft->'draft' <> 'null'::jsonb then
    select jsonb_build_object('grid_id', g.grid_id, 'grid_version', g.grid_version, 'grid_label', g.grid_label)
    into source from public.quote_contract_sources g
    where g.intervention_id = p_id and g.artisan_id = auth.uid()
      and g.draft_version = (current_draft->>'version')::integer;
  end if;

  select coalesce(jsonb_agg(to_jsonb(g) order by g.id), '[]'::jsonb) into options from (
    select a.id, a.label, a.version_number as version,
      (select jsonb_agg(jsonb_build_object(
        'index', n - 1, 'label', line->>'label', 'unit', line->>'unit',
        'unit_price_cents', (line->>'amount_cents')::integer
      ) order by n)
        from jsonb_array_elements(a.lines) with ordinality as item(line, n)) as lines
    from public.applicable_contract_quote_grids(site) a
    where p_after is null or a.id > p_after
    order by a.id limit 21
  ) g;
  return jsonb_build_object('current', source,
    'grids', case when jsonb_array_length(options) > 20 then options - 20 else options end,
    'next_cursor', case when jsonb_array_length(options) > 20 then options->19->>'id' else null end);
end;
$$;

create function public.apply_quote_contract_grid(
  p_id uuid, p_grid_id uuid, p_grid_version integer, p_selection jsonb,
  p_expected_version integer, p_assignment_token text, p_base_quote_id uuid, p_tax_rate numeric
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  grid public.organization_contract_grids;
  site uuid;
  selected_count integer;
  normalized jsonb;
  saved jsonb;
begin
  perform public.manage_quote_draft(p_id, 'load');
  if p_grid_id is null or p_grid_version is null or p_grid_version < 1
    or jsonb_typeof(p_selection) is distinct from 'array' then raise invalid_parameter_value; end if;
  selected_count := jsonb_array_length(p_selection);
  if selected_count not between 1 and 30 then raise invalid_parameter_value; end if;
  if exists (
    select 1 from jsonb_array_elements(p_selection) x
    where jsonb_typeof(x) <> 'object' or x - array['index', 'quantity'] <> '{}'::jsonb
      or jsonb_typeof(x->'index') is distinct from 'number'
      or jsonb_typeof(x->'quantity') is distinct from 'number'
      or x->>'index' !~ '^[0-9]{1,2}$' or x->>'quantity' !~ '^[0-9]{1,4}$'
  ) then raise invalid_parameter_value; end if;

  select site_id into strict site from public.interventions where id = p_id;
  select * into grid from public.applicable_contract_quote_grids(site)
  where id = p_grid_id and version_number = p_grid_version;
  if not found then raise no_data_found; end if;

  if exists (
    select 1 from jsonb_to_recordset(p_selection) as s(index integer, quantity integer)
    where s.index >= jsonb_array_length(grid.lines) or s.quantity not between 1 and 1000
  ) or (select count(distinct (x->>'index')::integer) from jsonb_array_elements(p_selection) x) <> selected_count then
    raise invalid_parameter_value;
  end if;
  select jsonb_agg(jsonb_build_object(
    'label', grid.lines->((x->>'index')::integer)->>'label',
    'quantity', (x->>'quantity')::integer,
    'unit_price_cents', (grid.lines->((x->>'index')::integer)->>'amount_cents')::integer
  ) order by n) into normalized
  from jsonb_array_elements(p_selection) with ordinality as s(x, n);

  saved := public.manage_quote_draft(p_id, 'save', p_expected_version, p_assignment_token,
    p_base_quote_id, normalized, p_tax_rate);
  insert into public.quote_contract_sources(intervention_id, artisan_id, draft_version, grid_id, grid_version, grid_label)
  values (p_id, auth.uid(), (saved->>'version')::integer, grid.id, grid.version_number, grid.label);
  return saved;
end;
$$;

create function public.finalize_quote_contract_source()
returns trigger language plpgsql security definer set search_path = '' as $$
declare source public.quote_contract_sources; site uuid;
begin
  select * into source from public.quote_contract_sources
  where intervention_id = old.intervention_id and artisan_id = old.artisan_id
    and draft_version = old.version and quote_id is null;
  if not found then return new; end if;
  select site_id into strict site from public.interventions where id = new.intervention_id;
  if not exists (select 1 from public.applicable_contract_quote_grids(site)
    where id = source.grid_id and version_number = source.grid_version) then
    raise exception 'The chosen grid is no longer applicable' using errcode = 'P0001';
  end if;
  update public.quote_contract_sources set quote_id = new.published_quote_id
  where intervention_id = old.intervention_id and artisan_id = old.artisan_id and draft_version = old.version;
  return new;
end;
$$;
revoke all on function public.finalize_quote_contract_source() from public, anon, authenticated, service_role;
create trigger finalize_quote_contract_source after update of state on public.quote_drafts
for each row when (old.state = 'draft' and new.state = 'sent' and new.published_quote_id is not null)
execute function public.finalize_quote_contract_source();

revoke all on function public.read_quote_grid_options(uuid, uuid),
  public.apply_quote_contract_grid(uuid, uuid, integer, jsonb, integer, text, uuid, numeric)
  from public, anon, authenticated, service_role;
grant execute on function public.read_quote_grid_options(uuid, uuid),
  public.apply_quote_contract_grid(uuid, uuid, integer, jsonb, integer, text, uuid, numeric)
  to authenticated;

commit;

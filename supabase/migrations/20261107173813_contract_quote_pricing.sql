begin;

create table public.quote_contract_sources (
  intervention_id uuid not null references public.interventions(id),
  artisan_id uuid not null references public.profiles(id),
  draft_version integer not null check (draft_version > 0),
  grid_id uuid not null references public.organization_contract_grids(id),
  grid_version integer not null check (grid_version > 0),
  access_version integer not null check (access_version > 0),
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

create table public.intervention_quote_grid_access (
  intervention_id uuid primary key references public.interventions(id),
  grid_id uuid references public.organization_contract_grids(id),
  version integer not null check (version > 0)
);
create table public.intervention_quote_grid_commands (
  command_id uuid primary key,
  intervention_id uuid not null references public.interventions(id),
  actor_id uuid not null references public.profiles(id),
  grid_id uuid references public.organization_contract_grids(id),
  expected_version integer,
  version integer not null
);
alter table public.intervention_quote_grid_access enable row level security;
alter table public.intervention_quote_grid_commands enable row level security;
revoke all on public.intervention_quote_grid_access, public.intervention_quote_grid_commands
  from public, anon, authenticated, service_role;

create function public.quote_grid_owner_site(p_id uuid)
returns uuid language sql stable security invoker set search_path = '' as $$
  select s.id from public.interventions i
  join public.sites s on s.id = i.site_id
  join public.organizations o on o.id = s.organization_id
  join public.organization_members m on m.organization_id = o.id and m.user_id = auth.uid()
  where i.id = p_id and o.owner_id = auth.uid() and m.role = 'owner';
$$;
revoke all on function public.quote_grid_owner_site(uuid) from public, anon, authenticated, service_role;

create function public.read_quote_grid_access(p_id uuid, p_after uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare site uuid; access public.intervention_quote_grid_access; options jsonb;
begin
  site := public.quote_grid_owner_site(p_id);
  if site is null then raise no_data_found; end if;
  select * into access from public.intervention_quote_grid_access where intervention_id = p_id;
  select coalesce(jsonb_agg(to_jsonb(g) order by g.id), '[]'::jsonb) into options from (
    select a.id, a.label, a.version_number as version
    from public.applicable_contract_quote_grids(site) a
    where p_after is null or a.id > p_after
    order by a.id limit 21
  ) g;
  return jsonb_build_object('grid_id', access.grid_id, 'version', access.version,
    'grids', case when jsonb_array_length(options) > 20 then options - 20 else options end,
    'next_cursor', case when jsonb_array_length(options) > 20 then options->19->>'id' else null end);
end;
$$;

create function public.write_quote_grid_access(
  p_id uuid, p_command_id uuid, p_grid_id uuid, p_expected_version integer
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  job public.interventions;
  site uuid;
  current_access public.intervention_quote_grid_access;
  command public.intervention_quote_grid_commands;
begin
  if actor is null then raise insufficient_privilege; end if;
  if p_id is null or p_command_id is null
    or (p_expected_version is not null and p_expected_version not between 1 and 2147483646)
  then raise invalid_parameter_value; end if;
  if public.quote_grid_owner_site(p_id) is null then raise no_data_found; end if;
  perform public.lock_intervention_organization(p_id);
  select * into job from public.interventions where id = p_id for update;
  site := public.quote_grid_owner_site(p_id);
  if site is null or site is distinct from job.site_id then raise no_data_found; end if;

  select * into command from public.intervention_quote_grid_commands where command_id = p_command_id;
  if found then
    if command.actor_id <> actor or command.intervention_id <> p_id
      or command.grid_id is distinct from p_grid_id or command.expected_version is distinct from p_expected_version
    then raise unique_violation; end if;
    return jsonb_build_object('grid_id', command.grid_id, 'version', command.version, 'replayed', true);
  end if;
  select * into current_access from public.intervention_quote_grid_access where intervention_id = p_id for update;
  if current_access.version is distinct from p_expected_version
    or current_access.grid_id is not distinct from p_grid_id
  then raise exception 'Grid authorization changed' using errcode = 'P0001'; end if;
  if p_grid_id is not null and (job.artisan_id is null or job.status not in ('assigned', 'quoted')
    or not exists (select 1 from public.applicable_contract_quote_grids(site) where id = p_grid_id))
  then raise no_data_found; end if;

  perform public.consume_action('contract_grid_access', 20);
  insert into public.intervention_quote_grid_access(intervention_id, grid_id, version)
  values (p_id, p_grid_id, coalesce(current_access.version, 0) + 1)
  on conflict (intervention_id) do update set grid_id = excluded.grid_id, version = excluded.version
  returning * into current_access;
  insert into public.intervention_quote_grid_commands(
    command_id, intervention_id, actor_id, grid_id, expected_version, version
  ) values (p_command_id, p_id, actor, p_grid_id, p_expected_version, current_access.version);
  insert into public.audit_log(actor_id, intervention_id, action)
  values (actor, p_id, case when p_grid_id is null then 'quote_grid_revoked' else 'quote_grid_authorized' end);
  return jsonb_build_object('grid_id', current_access.grid_id, 'version', current_access.version, 'replayed', false);
end;
$$;

create function public.revoke_quote_grid_on_scope_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.intervention_quote_grid_access set grid_id = null, version = version + 1
  where intervention_id = new.id and grid_id is not null;
  return new;
end;
$$;
revoke all on function public.revoke_quote_grid_on_scope_change() from public, anon, authenticated, service_role;
create trigger revoke_quote_grid_on_scope_change
  after update of artisan_id, client_id, site_id, status on public.interventions for each row
  when (old.artisan_id is distinct from new.artisan_id
    or old.site_id is distinct from new.site_id
    or old.client_id is distinct from new.client_id
    or (new.status = 'cancelled' and old.status is distinct from new.status))
  execute function public.revoke_quote_grid_on_scope_change();

revoke all on function public.read_quote_grid_access(uuid, uuid),
  public.write_quote_grid_access(uuid, uuid, uuid, integer) from public, anon, authenticated, service_role;
grant execute on function public.read_quote_grid_access(uuid, uuid),
  public.write_quote_grid_access(uuid, uuid, uuid, integer) to authenticated;

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
    where (p_after is null or a.id > p_after)
      and exists (select 1 from public.intervention_quote_grid_access b
        where b.intervention_id = p_id and b.grid_id = a.id)
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
  authorized_version integer;
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
  select version into authorized_version from public.intervention_quote_grid_access
  where intervention_id = p_id and grid_id = grid.id;
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
  insert into public.quote_contract_sources(intervention_id, artisan_id, draft_version, grid_id, grid_version, access_version, grid_label)
  values (p_id, auth.uid(), (saved->>'version')::integer, grid.id, grid.version_number, authorized_version, grid.label);
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
    where id = source.grid_id and version_number = source.grid_version)
    or not exists (select 1 from public.intervention_quote_grid_access a
      where a.intervention_id = new.intervention_id and a.grid_id = source.grid_id
        and a.version = source.access_version) then
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

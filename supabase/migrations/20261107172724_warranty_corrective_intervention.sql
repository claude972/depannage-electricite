begin;

create table public.warranty_corrective_interventions (
  case_id uuid primary key references public.warranty_cases(id),
  intervention_id uuid not null unique references public.interventions(id),
  linked_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);
alter table public.warranty_corrective_interventions enable row level security;
revoke all on public.warranty_corrective_interventions from public, anon, authenticated, service_role;
grant select (case_id, intervention_id) on public.warranty_corrective_interventions to authenticated;
create policy corrective_link_read on public.warranty_corrective_interventions
  for select to authenticated using (
    public.can_access_intervention(intervention_id)
    and exists (select 1 from public.warranty_cases c where c.id = case_id)
  );

create function public.read_warranty_corrective_intervention(p_case_id uuid)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  source public.warranty_cases;
  link jsonb;
  candidates jsonb := '[]'::jsonb;
  has_more boolean := false;
begin
  select * into source from public.warranty_cases where id = p_case_id;
  if not found then raise no_data_found; end if;

  select jsonb_build_object('id', i.id, 'category', i.category, 'status', i.status, 'created_at', i.created_at)
  into link
  from public.warranty_corrective_interventions l
  join public.interventions i on i.id = l.intervention_id
  where l.case_id = p_case_id;

  if public.is_admin() and source.status = 'reviewing' and link is null then
    with eligible as (
      select i.id, i.category, i.status, i.created_at
      from public.interventions i
      join public.interventions original on original.id = source.intervention_id
      where i.client_id = source.client_id
        and i.site_id is not distinct from original.site_id
        and i.created_at > original.created_at
        and i.created_at >= coalesce(original.completed_at, original.created_at)
        and i.status <> 'cancelled'
        and not exists (
          select 1 from public.warranty_corrective_interventions l where l.intervention_id = i.id
        )
      order by i.created_at desc, i.id desc
      limit 31
    ), numbered as (
      select eligible.*, row_number() over (order by created_at desc, id desc) as n from eligible
    )
    select coalesce(jsonb_agg(to_jsonb(numbered) - 'n' order by n) filter (where n <= 30), '[]'::jsonb),
      count(*) > 30
    into candidates, has_more
    from numbered;
  end if;

  return jsonb_build_object('link', link, 'candidates', candidates, 'has_more', has_more);
end;
$$;

create function public.link_warranty_corrective_intervention(p_case_id uuid, p_intervention_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  source public.warranty_cases;
  original public.interventions;
  corrective public.interventions;
  linked_id uuid;
  replayed boolean;
begin
  perform 1 from public.profiles where id = auth.uid() and role = 'admin' for share;
  if not found then raise insufficient_privilege; end if;
  if p_case_id is null or p_intervention_id is null then raise invalid_parameter_value; end if;

  select * into source from public.warranty_cases where id = p_case_id for update;
  if not found then raise no_data_found; end if;
  select intervention_id into linked_id
  from public.warranty_corrective_interventions where case_id = p_case_id;
  replayed := linked_id is not null;
  if replayed and linked_id <> p_intervention_id then raise unique_violation; end if;

  if not replayed then
    if source.status <> 'reviewing' then
      raise exception 'Warranty case must be under review' using errcode = 'P0001';
    end if;
    select * into strict original from public.interventions where id = source.intervention_id;
  end if;

  select * into corrective from public.interventions where id = p_intervention_id for update;
  if not found then raise no_data_found; end if;

  if not replayed then
    if corrective.client_id <> source.client_id
      or corrective.site_id is distinct from original.site_id
      or corrective.created_at <= original.created_at
      or corrective.created_at < coalesce(original.completed_at, original.created_at)
      or corrective.status = 'cancelled' then
      raise invalid_parameter_value;
    end if;
    perform public.consume_action('warranty_corrective_link', 10);
    insert into public.warranty_corrective_interventions(case_id, intervention_id, linked_by)
    values (p_case_id, p_intervention_id, auth.uid());
    insert into public.audit_log(actor_id, intervention_id, action)
    values (auth.uid(), source.intervention_id, 'warranty_corrective_linked');
  end if;

  return jsonb_build_object(
    'link', jsonb_build_object(
      'id', corrective.id, 'category', corrective.category,
      'status', corrective.status, 'created_at', corrective.created_at
    ),
    'replayed', replayed
  );
end;
$$;

revoke all on function public.read_warranty_corrective_intervention(uuid),
  public.link_warranty_corrective_intervention(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.read_warranty_corrective_intervention(uuid),
  public.link_warranty_corrective_intervention(uuid, uuid) to authenticated;
commit;

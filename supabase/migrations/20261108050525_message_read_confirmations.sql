begin;

create table public.message_read_confirmations (
  message_id uuid not null references public.messages(id) on delete cascade,
  reader_id uuid not null references public.profiles(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (message_id, reader_id)
);
alter table public.message_read_confirmations enable row level security;
revoke all on public.message_read_confirmations from public, anon, authenticated, service_role;

create function public.message_read_state(p_intervention_id uuid, p_message_ids uuid[], p_mark boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  result jsonb;
begin
  if actor is null or public.is_admin() then raise insufficient_privilege; end if;
  if p_intervention_id is null or p_mark is null or p_message_ids is null
    or cardinality(p_message_ids) not between 1 and 100 or array_ndims(p_message_ids) <> 1
    or (select count(distinct id) from unnest(p_message_ids) id) <> cardinality(p_message_ids) then
    raise invalid_parameter_value;
  end if;
  if not public.can_access_intervention(p_intervention_id) then raise no_data_found; end if;

  if p_mark then
    perform public.lock_intervention_organization(p_intervention_id);
    perform 1 from public.interventions where id = p_intervention_id for share;
    if not found or not public.can_access_intervention(p_intervention_id) then raise no_data_found; end if;
    if (select count(*) from public.messages m
      where m.id = any(p_message_ids) and m.intervention_id = p_intervention_id and m.author_id <> actor
    ) <> cardinality(p_message_ids) then raise no_data_found; end if;

    insert into public.message_read_confirmations (message_id, reader_id)
      select m.id, actor from public.messages m
      where m.id = any(p_message_ids) and m.intervention_id = p_intervention_id and m.author_id <> actor
      order by m.id
      on conflict (message_id, reader_id) do nothing;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'message_id', m.id,
    'read', exists (
      select 1 from public.message_read_confirmations r
      where r.message_id = m.id and case
        when m.author_id = actor then r.reader_id <> actor
        else r.reader_id = actor
      end
    )
  ) order by requested.ordinality), '[]'::jsonb) into result
  from unnest(p_message_ids) with ordinality requested(id, ordinality)
  join public.messages m on m.id = requested.id and m.intervention_id = p_intervention_id
  where public.can_access_intervention(p_intervention_id);
  if jsonb_array_length(result) <> cardinality(p_message_ids) then raise no_data_found; end if;
  return jsonb_build_object('rows', result);
end;
$$;

revoke all on function public.message_read_state(uuid, uuid[], boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.message_read_state(uuid, uuid[], boolean) to authenticated;

commit;

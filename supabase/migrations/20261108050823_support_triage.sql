begin;

create table public.support_ticket_triage (
  ticket_id uuid primary key references public.support_tickets(id),
  assigned_to uuid references public.profiles(id),
  escalated boolean not null,
  version integer not null check (version > 0)
);
create index support_triage_assigned on public.support_ticket_triage (assigned_to, ticket_id)
  where assigned_to is not null;
create index support_triage_escalated on public.support_ticket_triage (ticket_id)
  where escalated;

create table public.support_ticket_triage_events (
  id uuid primary key,
  ticket_id uuid not null references public.support_ticket_triage(ticket_id),
  actor_id uuid not null references public.profiles(id),
  version integer not null check (version > 0),
  action text not null check (action in ('assign', 'set_escalated')),
  reason text not null check (char_length(reason) between 1 and 500),
  assigned_to uuid references public.profiles(id),
  escalated boolean not null,
  created_at timestamptz not null default now(),
  unique (ticket_id, version)
);
alter table public.support_ticket_triage enable row level security;
alter table public.support_ticket_triage_events enable row level security;
revoke all on public.support_ticket_triage, public.support_ticket_triage_events
  from public, anon, authenticated, service_role;

create function public.support_triage_eligible(p_user uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p where p.id = p_user and (
      p.role = 'admin' or (
        exists (select 1 from public.platform_operator_grants g
          where g.user_id = p.id and g.status = 'active' and g.scope = 'support_read')
        and exists (select 1 from public.platform_operator_grants g
          where g.user_id = p.id and g.status = 'active' and g.scope in ('support_reply', 'support_status'))
      )
    )
  );
$$;

create function public.support_triage_projection(p_ticket uuid)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'ticket_id', t.id, 'assigned_to', s.assigned_to, 'assignee_name', p.full_name,
    'assignee_active', public.support_triage_eligible(s.assigned_to),
    'escalated', coalesce(s.escalated, false), 'version', coalesce(s.version, 0)
  )
  from public.support_tickets t
  left join public.support_ticket_triage s on s.ticket_id = t.id
  left join public.profiles p on p.id = s.assigned_to
  where t.id = p_ticket;
$$;

create function public.read_support_ticket_triage(p_ticket uuid, p_after integer)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  current_state jsonb;
  ticket_status text;
  records jsonb;
  next_version integer;
  current_version integer;
begin
  if not public.has_platform_scope('support_read') then raise insufficient_privilege; end if;
  if p_ticket is null or p_after is null or p_after < 0 then raise invalid_parameter_value; end if;
  select status into ticket_status from public.support_tickets where id = p_ticket;
  if not found then raise no_data_found; end if;
  current_state := public.support_triage_projection(p_ticket);
  current_version := (current_state ->> 'version')::integer;
  if p_after > current_version then raise invalid_parameter_value; end if;

  select coalesce(jsonb_agg(to_jsonb(e) - 'ticket_id' order by e.version), '[]'::jsonb)
    into records
    from (select * from public.support_ticket_triage_events
      where ticket_id = p_ticket and version > p_after and version <= current_version
      order by version limit 51) e;
  if jsonb_array_length(records) = 51 then
    next_version := (records -> 49 ->> 'version')::integer;
    records := records - 50;
  end if;
  return jsonb_build_object(
    'triage', current_state, 'events', records, 'next_after_version', next_version,
    'can_manage', ticket_status <> 'resolved' and public.has_platform_scope('support_status')
  );
end;
$$;

create function public.list_support_triage(p_kind text, p_after uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  records jsonb;
  next_id uuid;
begin
  if not public.has_platform_scope('support_read') then raise insufficient_privilege; end if;
  if p_kind = 'operators' then
    if not public.has_platform_scope('support_status') then raise insufficient_privilege; end if;
    select coalesce(jsonb_agg(to_jsonb(o) order by o.id), '[]'::jsonb) into records
      from (
        select p.id, p.full_name as name from public.profiles p
        join (
          select id from public.profiles where role = 'admin'
          union
          select user_id from public.platform_operator_grants where scope = 'support_read' and status = 'active'
        ) candidates on candidates.id = p.id
        where (p_after is null or p.id > p_after) and public.support_triage_eligible(p.id)
        order by p.id limit 51
      ) o;
  elsif p_kind in ('mine', 'escalated') then
    select coalesce(jsonb_agg(to_jsonb(q) order by q.id), '[]'::jsonb) into records
      from (
        select t.id, t.subject, t.status, s.assigned_to, s.escalated
        from public.support_ticket_triage s join public.support_tickets t on t.id = s.ticket_id
        where t.status <> 'resolved' and (p_after is null or t.id > p_after)
          and ((p_kind = 'mine' and s.assigned_to = auth.uid()) or (p_kind = 'escalated' and s.escalated))
        order by t.id limit 51
      ) q;
  else
    raise invalid_parameter_value;
  end if;
  if jsonb_array_length(records) = 51 then
    next_id := (records -> 49 ->> 'id')::uuid;
    records := records - 50;
  end if;
  return jsonb_build_object('rows', records, 'next_cursor', next_id);
end;
$$;

create function public.mutate_support_triage(
  p_ticket uuid, p_command uuid, p_expected integer, p_action text, p_reason text,
  p_assignee uuid default null, p_escalated boolean default null
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  note text := regexp_replace(p_reason, '^[[:space:]]+|[[:space:]]+$', '', 'g');
  prior public.support_ticket_triage_events;
  current_state public.support_ticket_triage;
  ticket_status text;
  next_assignee uuid;
  next_escalated boolean;
  next_version integer;
begin
  if not (public.has_platform_scope('support_read') and public.has_platform_scope('support_status')) then
    raise insufficient_privilege;
  end if;
  if p_ticket is null or p_command is null or p_expected is null or p_expected < 0
    or p_action is null or p_action not in ('assign', 'set_escalated')
    or note is null or char_length(note) not between 1 and 500
    or (p_action = 'assign' and p_escalated is not null)
    or (p_action = 'set_escalated' and (p_assignee is not null or p_escalated is null)) then
    raise invalid_parameter_value;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_command::text, 0));
  if not public.lock_support_operator_permissions('set_status') then raise insufficient_privilege; end if;
  if p_assignee is not null then
    perform 1 from public.platform_operator_grants g
      where g.user_id = p_assignee and g.status = 'active'
        and g.scope in ('support_read', 'support_reply', 'support_status')
      order by g.scope, g.id for share;
  end if;
  perform 1 from public.profiles where id in (actor, p_assignee) order by id for share;
  perform public.lock_support_ticket(p_ticket);
  if not (public.has_platform_scope('support_read') and public.has_platform_scope('support_status')) then
    raise insufficient_privilege;
  end if;

  select * into prior from public.support_ticket_triage_events where id = p_command;
  if found then
    if prior.ticket_id is distinct from p_ticket or prior.actor_id is distinct from actor
      or prior.version - 1 <> p_expected or prior.action <> p_action or prior.reason <> note
      or (p_action = 'assign' and prior.assigned_to is distinct from p_assignee)
      or (p_action = 'set_escalated' and prior.escalated is distinct from p_escalated) then
      raise exception 'Triage command conflict' using errcode = 'P0001';
    end if;
    return jsonb_build_object('triage', public.support_triage_projection(p_ticket), 'replayed', true);
  end if;

  select status into ticket_status from public.support_tickets where id = p_ticket;
  if not found then raise no_data_found; end if;
  if ticket_status = 'resolved' then raise exception 'Resolved ticket' using errcode = 'P0001'; end if;
  select * into current_state from public.support_ticket_triage where ticket_id = p_ticket;
  if coalesce(current_state.version, 0) <> p_expected or p_expected = 2147483647 then
    raise exception 'Triage revision conflict' using errcode = 'P0001';
  end if;
  if p_assignee is not null and not public.support_triage_eligible(p_assignee) then
    raise exception 'Support operator unavailable' using errcode = 'P0001';
  end if;
  next_assignee := case when p_action = 'assign' then p_assignee else current_state.assigned_to end;
  next_escalated := case when p_action = 'set_escalated' then p_escalated else coalesce(current_state.escalated, false) end;
  if next_assignee is not distinct from current_state.assigned_to and next_escalated = coalesce(current_state.escalated, false) then
    raise exception 'No triage change' using errcode = 'P0001';
  end if;

  perform public.consume_action('support_triage', 30);
  next_version := p_expected + 1;
  insert into public.support_ticket_triage (ticket_id, assigned_to, escalated, version)
    values (p_ticket, next_assignee, next_escalated, next_version)
    on conflict (ticket_id) do update
      set assigned_to = excluded.assigned_to, escalated = excluded.escalated, version = excluded.version;
  insert into public.support_ticket_triage_events (id, ticket_id, actor_id, version, action, reason, assigned_to, escalated)
    values (p_command, p_ticket, actor, next_version, p_action, note, next_assignee, next_escalated);
  perform public.platform_audit_write('support_triage_changed', 'support_ticket', p_ticket::text,
    jsonb_build_object('command_id', p_command, 'action', p_action, 'version', next_version));
  return jsonb_build_object('triage', public.support_triage_projection(p_ticket), 'replayed', false);
end;
$$;

revoke all on function public.support_triage_eligible(uuid), public.support_triage_projection(uuid),
  public.read_support_ticket_triage(uuid, integer), public.list_support_triage(text, uuid),
  public.mutate_support_triage(uuid, uuid, integer, text, text, uuid, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.read_support_ticket_triage(uuid, integer), public.list_support_triage(text, uuid),
  public.mutate_support_triage(uuid, uuid, integer, text, text, uuid, boolean)
  to authenticated;

commit;

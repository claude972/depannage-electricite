-- Private support workflow. No financial action, external delivery or SLA promise.
begin;
create table public.support_tickets (
 id uuid primary key default gen_random_uuid(), creator_id uuid not null references public.profiles(id),
 client_request_id uuid not null, intervention_id uuid references public.interventions(id),
 subject text not null check(char_length(subject) between 4 and 160),
 status text not null default 'open' check(status in ('open','in_progress','awaiting_user','resolved')),
 version integer not null default 1 check(version between 1 and 2147483647),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 last_message_at timestamptz not null default now(), unique(creator_id,client_request_id)
);
create index support_tickets_creator_page on public.support_tickets(creator_id,created_at desc,id desc);
create index support_tickets_admin_page on public.support_tickets(created_at desc,id desc);
create index support_tickets_intervention on public.support_tickets(intervention_id);
create table public.support_messages (
 id uuid primary key default gen_random_uuid(), ticket_id uuid not null references public.support_tickets(id),
 author_id uuid not null references public.profiles(id), author_kind text not null check(author_kind in ('user','admin')),
 version integer not null check(version between 1 and 2147483647), body text not null check(char_length(body) between 1 and 4000),
 created_at timestamptz not null default now(), unique(ticket_id,version)
);
create table public.support_events (
 id uuid primary key default gen_random_uuid(), ticket_id uuid not null references public.support_tickets(id),
 actor_id uuid not null references public.profiles(id),
 kind text not null check(kind in ('ticket_created','replied','status_changed')),
 from_status text check(from_status in ('open','in_progress','awaiting_user','resolved')),
 to_status text not null check(to_status in ('open','in_progress','awaiting_user','resolved')),
 version integer not null check(version between 1 and 2147483647), message_id uuid references public.support_messages(id),
 created_at timestamptz not null default now(), unique(ticket_id,version)
);
alter table public.support_tickets enable row level security;
alter table public.support_messages enable row level security;
alter table public.support_events enable row level security;
revoke all on public.support_tickets,public.support_messages,public.support_events from public,anon,authenticated;
grant select on public.support_tickets,public.support_messages,public.support_events to authenticated;
grant all on public.support_tickets,public.support_messages,public.support_events to service_role;

create function public.can_access_support_ticket(p_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.support_tickets t where t.id=p_id and
  (public.is_admin() or (t.creator_id=auth.uid() and (t.intervention_id is null or public.can_access_intervention(t.intervention_id)))));
$$;
revoke execute on function public.can_access_support_ticket(uuid) from public,anon,authenticated;
grant execute on function public.can_access_support_ticket(uuid) to authenticated;
create policy support_tickets_private_read on public.support_tickets for select to authenticated using(public.can_access_support_ticket(id));
create policy support_messages_private_read on public.support_messages for select to authenticated using(public.can_access_support_ticket(ticket_id));
create policy support_events_private_read on public.support_events for select to authenticated using(public.can_access_support_ticket(ticket_id));

create function public.lock_support_ticket(p_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare linked uuid;
begin
 if not public.can_access_support_ticket(p_id) then raise insufficient_privilege; end if;
 select intervention_id into linked from public.support_tickets where id=p_id;
 if linked is not null then
  perform public.lock_intervention_organization(linked);
  perform 1 from public.interventions where id=linked for update;
 end if;
 perform 1 from public.support_tickets where id=p_id for update;
 -- Membership/site changes serialize on the organization before this second check.
 if not public.can_access_support_ticket(p_id) then raise insufficient_privilege; end if;
end; $$;
revoke execute on function public.lock_support_ticket(uuid) from public,anon,authenticated;

create function public.create_support_ticket(p_request_id uuid,p_subject text,p_body text,p_intervention_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor public.profiles; ticket public.support_tickets; message public.support_messages;
 title text; content text;
begin
 if auth.uid() is null then raise insufficient_privilege; end if;
 title=regexp_replace(p_subject,'^[[:space:]]+|[[:space:]]+$','','g');
 content=regexp_replace(p_body,'^[[:space:]]+|[[:space:]]+$','','g');
 if p_request_id is null or title is null or content is null or char_length(title) not between 4 and 160 or char_length(content) not between 10 and 4000 then raise invalid_parameter_value; end if;
 if p_intervention_id is not null then
  perform public.lock_intervention_organization(p_intervention_id);
  perform 1 from public.interventions where id=p_intervention_id for update;
  if not public.can_access_intervention(p_intervention_id) then raise insufficient_privilege; end if;
 end if;
 -- Serialize this creator's idempotency keys. NO KEY UPDATE remains compatible with
 -- message/event FK KEY SHARE locks, avoiding a profile -> ticket / ticket -> FK cycle.
 select * into actor from public.profiles where id=auth.uid() for no key update;
 if not found then raise insufficient_privilege; end if;
 select * into ticket from public.support_tickets where creator_id=auth.uid() and client_request_id=p_request_id for update;
 if found then
  if ticket.subject is distinct from title or ticket.intervention_id is distinct from p_intervention_id then raise exception 'Request key content conflict' using errcode='P0001'; end if;
  select * into message from public.support_messages where ticket_id=ticket.id and version=1;
  if not found or message.body is distinct from content then raise exception 'Request key content conflict' using errcode='P0001'; end if;
  if not public.can_access_support_ticket(ticket.id) then raise insufficient_privilege; end if;
  return jsonb_build_object('ticket',to_jsonb(ticket)-'client_request_id','initial_message',to_jsonb(message),'replayed',true);
 end if;
 perform public.consume_action('support_create',5);
 insert into public.support_tickets(creator_id,client_request_id,intervention_id,subject) values(auth.uid(),p_request_id,p_intervention_id,title) returning * into ticket;
 insert into public.support_messages(ticket_id,author_id,author_kind,version,body)
 values(ticket.id,auth.uid(),case when actor.role='admin' then 'admin' else 'user' end,1,content) returning * into message;
 insert into public.support_events(ticket_id,actor_id,kind,to_status,version,message_id) values(ticket.id,auth.uid(),'ticket_created','open',1,message.id);
 return jsonb_build_object('ticket',to_jsonb(ticket)-'client_request_id','initial_message',to_jsonb(message),'replayed',false);
end; $$;

create function public.mutate_support_ticket(p_id uuid,p_action text,p_expected_version integer,p_body text default null,p_status text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare ticket public.support_tickets; message public.support_messages; event public.support_events;
 operator boolean; content text; previous_status text; next_status text;
begin
 if auth.uid() is null then raise insufficient_privilege; end if;
 perform public.lock_support_ticket(p_id);
 select * into ticket from public.support_tickets where id=p_id for update;
 operator=public.is_admin();
 if not operator and ticket.creator_id is distinct from auth.uid() then raise insufficient_privilege; end if;
 if p_expected_version is null or p_expected_version<1 then raise invalid_parameter_value; end if;
 if ticket.version<>p_expected_version or ticket.version=2147483647 then raise exception 'Support ticket revision changed' using errcode='P0001'; end if;
 previous_status=ticket.status; next_status=ticket.status;
 if p_action='reply' then
  if p_status is not null then raise invalid_parameter_value; end if;
  content=regexp_replace(p_body,'^[[:space:]]+|[[:space:]]+$','','g');
  if content is null or char_length(content) not between 1 and 4000 then raise invalid_parameter_value; end if;
  if operator and ticket.status='resolved' then raise exception 'Explicitly reopen before replying' using errcode='P0001'; end if;
  if not operator and ticket.status in ('awaiting_user','resolved') then next_status='open'; end if;
 elsif p_action='set_status' then
  if not operator then raise insufficient_privilege; end if;
  if p_body is not null or p_status is null or p_status not in ('open','in_progress','awaiting_user','resolved') then raise invalid_parameter_value; end if;
  if not ((ticket.status='open' and p_status in ('in_progress','awaiting_user','resolved'))
   or (ticket.status='in_progress' and p_status in ('awaiting_user','resolved'))
   or (ticket.status='awaiting_user' and p_status in ('in_progress','resolved'))
   or (ticket.status='resolved' and p_status='in_progress')) then raise exception 'Invalid support transition' using errcode='P0001'; end if;
  next_status=p_status;
 else raise invalid_parameter_value;
 end if;
 perform public.consume_action('support_update',30);
 update public.support_tickets set status=next_status,version=version+1,updated_at=now(),last_message_at=case when p_action='reply' then now() else last_message_at end where id=p_id returning * into ticket;
 if p_action='reply' then
  insert into public.support_messages(ticket_id,author_id,author_kind,version,body) values(p_id,auth.uid(),case when operator then 'admin' else 'user' end,ticket.version,content) returning * into message;
 end if;
 insert into public.support_events(ticket_id,actor_id,kind,from_status,to_status,version,message_id)
 values(p_id,auth.uid(),case when p_action='reply' then 'replied' else 'status_changed' end,previous_status,next_status,ticket.version,message.id) returning * into event;
 return jsonb_build_object('ticket',to_jsonb(ticket)-'client_request_id','message',case when p_action='reply' then to_jsonb(message) else null end,'event',to_jsonb(event));
end; $$;
revoke execute on function public.create_support_ticket(uuid,text,text,uuid),public.mutate_support_ticket(uuid,text,integer,text,text) from public,anon,authenticated;
grant execute on function public.create_support_ticket(uuid,text,text,uuid),public.mutate_support_ticket(uuid,text,integer,text,text) to authenticated;
-- Capability advertises the installed DB workflow only; deployment of its HTTP/UI
-- clients remains a separate release/verification step.
alter function public.admin_overview() rename to admin_overview_before_support;
revoke execute on function public.admin_overview_before_support() from public,anon,authenticated;
create function public.admin_overview() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not public.is_admin() then raise insufficient_privilege; end if;
 return jsonb_set(public.admin_overview_before_support(),'{capabilities,support_tickets}','true'::jsonb,false);
end; $$;
revoke execute on function public.admin_overview() from public,anon,authenticated;
grant execute on function public.admin_overview() to authenticated;

commit;

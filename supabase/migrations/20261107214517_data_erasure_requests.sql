begin;
create schema data_request_private;
revoke all on schema data_request_private from public,anon,authenticated,service_role;
create table data_request_private.requests(
 id uuid primary key default gen_random_uuid(),account_id uuid not null references public.profiles(id),
 request_id uuid not null,ticket_id uuid not null unique references public.support_tickets(id),
 state text not null default 'requested' check(state in('requested','in_review','needs_information','approved','rejected')),
 execution_state text not null default 'not_started' check(execution_state='not_started'),
 version integer not null default 1 check(version between 1 and 2147483647),
 created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),unique(account_id,request_id)
);
create index data_erasure_account_page on data_request_private.requests(account_id,id);
create table data_request_private.events(
 id uuid primary key default gen_random_uuid(),request_id uuid not null references data_request_private.requests(id),
 actor_id uuid not null references public.profiles(id),command_id uuid not null,expected_version integer not null,
 from_state text,to_state text not null,reason text check(char_length(reason)between 1 and 1000),
 version integer not null,created_at timestamptz not null default clock_timestamp(),unique(actor_id,command_id),unique(request_id,version)
);
alter table data_request_private.requests enable row level security;
alter table data_request_private.events enable row level security;
revoke all on all tables in schema data_request_private from public,anon,authenticated,service_role;
create function data_request_private.projection(p_row data_request_private.requests)returns jsonb language sql stable set search_path=''as $$
 select to_jsonb(p_row)-'request_id';
$$;
create function public.create_data_erasure_request(p_request_id uuid)returns jsonb language plpgsql security definer set search_path=''as $$
declare r data_request_private.requests;t public.support_tickets;receipt jsonb;replayed boolean=false;
begin
 if auth.uid()is null then raise insufficient_privilege;end if;
 if p_request_id is null then raise invalid_parameter_value;end if;
 perform 1 from public.profiles where id=auth.uid()for no key update;if not found then raise insufficient_privilege;end if;
 select *into r from data_request_private.requests where account_id=auth.uid()and request_id=p_request_id;
 if found then replayed=true;
 else
  -- Reuse the exact durable support command, never search a translated title.
  receipt=public.create_support_ticket(p_request_id,'Demande d’effacement de données personnelles','Je demande l’examen de l’effacement des données personnelles associées à mon compte.',null);
  select *into t from public.support_tickets where id=(receipt->'ticket'->>'id')::uuid and creator_id=auth.uid()and intervention_id is null;
  if not found then raise insufficient_privilege;end if;
  insert into data_request_private.requests(account_id,request_id,ticket_id)values(auth.uid(),p_request_id,t.id)returning *into r;
  insert into data_request_private.events(request_id,actor_id,command_id,expected_version,to_state,version)values(r.id,auth.uid(),p_request_id,0,'requested',1);
 end if;
 select *into t from public.support_tickets where id=r.ticket_id and creator_id=auth.uid();if not found then raise insufficient_privilege;end if;
 return jsonb_build_object('request',data_request_private.projection(r),'ticket_id',t.id,'status',t.status,'replayed',replayed);
end;$$;
create function public.list_data_erasure_requests(p_all boolean default false,p_after uuid default null,p_limit integer default 25)returns jsonb language plpgsql security definer set search_path=''as $$
declare rows jsonb;next_id uuid;
begin
 if auth.uid()is null then raise insufficient_privilege;end if;
 if p_all is null or p_limit is null or p_limit not between 1 and 100 then raise invalid_parameter_value;end if;
 if p_all and not public.has_platform_scope('support_read')then raise insufficient_privilege;end if;
 select coalesce(jsonb_agg(data_request_private.projection(x)order by x.id),'[]'::jsonb)into rows from
 (select r.*from data_request_private.requests r join public.support_tickets t on t.id=r.ticket_id and t.creator_id=r.account_id
 where(p_all or r.account_id=auth.uid())and(p_after is null or r.id>p_after)order by r.id limit p_limit+1)x;
 if jsonb_array_length(rows)>p_limit then next_id=(rows->(p_limit-1)->>'id')::uuid;rows=rows-p_limit;end if;
 return jsonb_build_object('rows',rows,'next_cursor',next_id);
end;$$;
create function public.get_data_erasure_review(p_id uuid)returns jsonb language plpgsql security definer set search_path=''as $$
declare r data_request_private.requests;history jsonb;
begin
 if auth.uid()is null or not public.has_platform_scope('support_read')then raise insufficient_privilege;end if;
 select *into r from data_request_private.requests where id=p_id;if not found then raise no_data_found;end if;
 if not public.can_access_support_ticket(r.ticket_id)then raise insufficient_privilege;end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'actor_id',e.actor_id,'from_state',e.from_state,'to_state',e.to_state,'reason',e.reason,'version',e.version,'created_at',e.created_at)order by e.version),'[]'::jsonb)into history from data_request_private.events e where e.request_id=r.id;
 return jsonb_build_object('request',data_request_private.projection(r),'history',history,'can_decide',public.has_platform_scope('support_status'));
end;$$;
create function public.decide_data_erasure_request(p_id uuid,p_command uuid,p_expected_version integer,p_state text,p_reason text)returns jsonb language plpgsql security definer set search_path=''as $$
declare r data_request_private.requests;prior data_request_private.events;reason text;ticket uuid;
begin
 if auth.uid()is null or not public.lock_support_operator_permissions('set_status')then raise insufficient_privilege;end if;
 reason=btrim(p_reason);
 if p_id is null or p_command is null or p_expected_version is null or p_expected_version<1 or p_state is null or p_state not in('in_review','needs_information','approved','rejected')or reason is null or char_length(reason)not between 1 and 1000 then raise invalid_parameter_value;end if;
 select ticket_id into ticket from data_request_private.requests where id=p_id;if not found then raise no_data_found;end if;
 perform public.lock_support_ticket(ticket);
 select *into r from data_request_private.requests where id=p_id for update;
 -- Current support authority, never merely a platform operator role.
 if not public.has_platform_scope('support_read')or not public.has_platform_scope('support_status')then raise insufficient_privilege;end if;
 select *into prior from data_request_private.events where actor_id=auth.uid()and command_id=p_command;
 if found then
  if prior.request_id<>p_id or prior.expected_version<>p_expected_version or prior.to_state<>p_state or prior.reason is distinct from reason then raise exception 'Decision command conflict'using errcode='P0001';end if;
  return jsonb_build_object('request',data_request_private.projection(r),'replayed',true);
 end if;
 if r.version<>p_expected_version or r.version>=2147483647 or r.version>=100 or r.state in('approved','rejected')or r.state=p_state then raise exception 'Request revision or transition changed'using errcode='P0001';end if;
 perform public.consume_action('data_erasure_decision',30);
 insert into data_request_private.events(request_id,actor_id,command_id,expected_version,from_state,to_state,reason,version)values(r.id,auth.uid(),p_command,p_expected_version,r.state,p_state,reason,r.version+1);
 update data_request_private.requests set state=p_state,version=version+1,updated_at=clock_timestamp()where id=r.id returning *into r;
 -- No ticket closure, erasure, Auth/storage deletion or execution claim occurs here.
 return jsonb_build_object('request',data_request_private.projection(r),'replayed',false);
end;$$;
revoke all on all functions in schema data_request_private from public,anon,authenticated,service_role;
revoke all on function public.create_data_erasure_request(uuid),public.list_data_erasure_requests(boolean,uuid,integer),public.get_data_erasure_review(uuid),public.decide_data_erasure_request(uuid,uuid,integer,text,text)from public,anon,authenticated,service_role;
grant execute on function public.create_data_erasure_request(uuid),public.list_data_erasure_requests(boolean,uuid,integer),public.get_data_erasure_review(uuid),public.decide_data_erasure_request(uuid,uuid,integer,text,text)to authenticated;
commit;

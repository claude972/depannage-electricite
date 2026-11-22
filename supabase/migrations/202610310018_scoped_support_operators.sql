-- ADV-SCOPED-SUPPORT-BACKEND-005: functional support grants, never a profile admin role.
-- Additive upgrade: preserves 011 workflow, 014 immutable grant history and 016 recipient privacy.
begin;
alter table public.platform_operator_grants drop constraint platform_operator_grants_scope_check;
alter table public.platform_operator_grants add constraint platform_operator_grants_scope_check
 check(scope in ('finance_read','finance_write','reviews_moderate','audit_read','support_read','support_reply','support_status'));
alter table public.support_messages drop constraint support_messages_author_kind_check;
alter table public.support_messages add constraint support_messages_author_kind_check check(author_kind in ('user','admin','operator'));
create or replace function public.platform_grant_scope(p_user_id uuid,p_scope text,p_note text default '') returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
declare target public.profiles; row public.platform_operator_grants; note text;
begin
 if not public.is_admin() then raise insufficient_privilege; end if;
 note=coalesce(regexp_replace(p_note,'^[[:space:]]+|[[:space:]]+$','','g'),'');
 if p_user_id is null or p_scope is null or p_scope not in ('finance_read','finance_write','reviews_moderate','audit_read','support_read','support_reply','support_status') or char_length(note)>500 then raise invalid_parameter_value; end if;
 perform public.consume_action('platform_operators',30);
 select * into target from public.profiles where id=p_user_id for no key update;
 if not found then raise no_data_found; end if;
 if target.role='admin' then raise exception 'Super admins hold every scope implicitly' using errcode='P0001'; end if;
 select * into row from public.platform_operator_grants where user_id=p_user_id and scope=p_scope and status='active';
 if found then return jsonb_build_object('grant',to_jsonb(row),'replayed',true); end if;
 insert into public.platform_operator_grants(user_id,scope,note,granted_by) values(p_user_id,p_scope,note,auth.uid()) returning * into row;
 perform public.platform_audit_write('operator_scope_granted','operator',p_user_id::text,jsonb_build_object('scope',p_scope,'grant_id',row.id,'note',note));
 return jsonb_build_object('grant',to_jsonb(row),'replayed',false);
end; $$;

create function public.support_operator_permissions() returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object(
  'can_read_all',public.has_platform_scope('support_read'),
  'can_reply_all',public.has_platform_scope('support_read') and public.has_platform_scope('support_reply'),
  'can_set_status_all',public.has_platform_scope('support_read') and public.has_platform_scope('support_status'));
$$;
revoke execute on function public.support_operator_permissions() from public,anon,authenticated;
grant execute on function public.support_operator_permissions() to authenticated;

create or replace function public.can_access_support_ticket(p_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.support_tickets t where t.id=p_id and
  (public.has_platform_scope('support_read') or
   (t.creator_id=auth.uid() and (t.intervention_id is null or public.can_access_intervention(t.intervention_id)))));
$$;
revoke execute on function public.can_access_support_ticket(uuid) from public,anon,authenticated;
grant execute on function public.can_access_support_ticket(uuid) to authenticated;

-- A revoker locks the same grant row FOR UPDATE (014). FOR SHARE prevents revoke from
-- committing between this decision and the support write. Rows are acquired in a stable order.
-- No profile lock is added: concurrent super-admin demotion is outside this new guarantee.
create function public.lock_support_operator_permissions(p_action text) returns boolean language plpgsql security definer set search_path='' as $$
declare required_scope text; held record; held_count integer=0;
begin
 if auth.uid() is null then raise insufficient_privilege; end if;
 if p_action is null or p_action not in ('reply','set_status') then raise invalid_parameter_value; end if;
 if public.is_admin() then return true; end if;
 required_scope=case when p_action='reply' then 'support_reply' else 'support_status' end;
 for held in select g.id,g.scope from public.platform_operator_grants g
  where g.user_id=auth.uid() and g.status='active' and g.scope in ('support_read',required_scope)
  order by g.scope,g.id for share of g
 loop
  held_count=held_count+1;
 end loop;
 return held_count=2 and public.has_platform_scope('support_read') and public.has_platform_scope(required_scope);
end; $$;
revoke execute on function public.lock_support_operator_permissions(text) from public,anon,authenticated;

create or replace function public.mutate_support_ticket(p_id uuid,p_action text,p_expected_version integer,p_body text default null,p_status text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare ticket public.support_tickets; message public.support_messages; event public.support_events;
 operator boolean; content text; previous_status text; next_status text;
begin
 if auth.uid() is null then raise insufficient_privilege; end if;
 if p_action is null or p_action not in ('reply','set_status') then raise invalid_parameter_value; end if;
 -- Grant rows are locked before organization -> intervention -> ticket.
 operator=public.lock_support_operator_permissions(p_action);
 perform public.lock_support_ticket(p_id);
 select * into ticket from public.support_tickets where id=p_id for update;
 -- Recheck the locked authority after waiting for ticket/site locks.
 if operator and not public.is_admin() then
  if not public.has_platform_scope('support_read') or not public.has_platform_scope(case when p_action='reply' then 'support_reply' else 'support_status' end) then raise insufficient_privilege; end if;
 end if;
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
  insert into public.support_messages(ticket_id,author_id,author_kind,version,body) values(p_id,auth.uid(),case when public.is_admin() then 'admin' when operator then 'operator' else 'user' end,ticket.version,content) returning * into message;
 end if;
 insert into public.support_events(ticket_id,actor_id,kind,from_status,to_status,version,message_id)
 values(p_id,auth.uid(),case when p_action='reply' then 'replied' else 'status_changed' end,previous_status,next_status,ticket.version,message.id) returning * into event;
 return jsonb_build_object('ticket',to_jsonb(ticket)-'client_request_id','message',case when p_action='reply' then to_jsonb(message) else null end,'event',to_jsonb(event));
end; $$;
revoke execute on function public.mutate_support_ticket(uuid,text,integer,text,text) from public,anon,authenticated;
grant execute on function public.mutate_support_ticket(uuid,text,integer,text,text) to authenticated;

create or replace function public.notify_support_reply() returns trigger language plpgsql security definer set search_path='' as $$
declare ticket public.support_tickets;
begin
 if new.author_kind not in ('admin','operator') then return new; end if;
 select * into ticket from public.support_tickets where id=new.ticket_id;
 perform public.notify(ticket.creator_id,'support_replied','Réponse de l’assistance','L’assistance a répondu à votre demande « '||left(ticket.subject,80)||' ».','support:'||new.id,null,null,null,new.author_id,jsonb_build_object('ticket_id',ticket.id),ticket.id);
 return new;
end; $$;
revoke execute on function public.notify_support_reply() from public,anon,authenticated;

-- Emit explicit status commands from their authoritative event, not from a user's auto-reopen.
drop trigger support_status_notifications on public.support_tickets;
drop function public.notify_support_status();
create function public.notify_support_status_event() returns trigger language plpgsql security definer set search_path='' as $$
declare ticket public.support_tickets;
begin
 if new.kind<>'status_changed' or new.actor_id is distinct from auth.uid() then return new; end if;
 if not (public.has_platform_scope('support_read') and public.has_platform_scope('support_status')) then return new; end if;
 select * into ticket from public.support_tickets where id=new.ticket_id;
 perform public.notify(ticket.creator_id,'support_status_changed','Demande d’assistance mise à jour','Votre demande « '||left(ticket.subject,80)||' » est maintenant : '||
  case new.to_status when 'open' then 'ouverte' when 'in_progress' then 'en cours de traitement' when 'awaiting_user' then 'en attente de votre réponse' else 'résolue' end||'.',
  'support:'||ticket.id||':'||new.to_status||':'||new.version,null,null,null,new.actor_id,jsonb_build_object('ticket_id',ticket.id,'status',new.to_status),ticket.id);
 return new;
end; $$;
revoke execute on function public.notify_support_status_event() from public,anon,authenticated;
create trigger support_status_event_notifications after insert on public.support_events for each row execute function public.notify_support_status_event();
commit;

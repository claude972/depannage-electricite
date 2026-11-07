-- Audited support reply. Existing dossier/message SELECT RLS stays authoritative.
create function public.admin_send_message(p_id uuid,p_intervention_id uuid,p_body text)
returns public.messages language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); result public.messages; content text:=regexp_replace(p_body,'^[[:space:]]+|[[:space:]]+$','','g');
begin
 if actor is null or not public.is_admin() then raise insufficient_privilege; end if;
 if p_id is null or p_intervention_id is null or content is null or char_length(content) not between 1 and 4000
 then raise exception 'Invalid message' using errcode='22023';end if;
 -- Serialize retries, including a colliding UUID submitted for another dossier.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_id::text,0));
 perform 1 from public.profiles where id=actor and role='admin' for share;
 if not found then raise insufficient_privilege;end if;
 perform 1 from public.interventions where id=p_intervention_id for update;
 if not found then raise no_data_found;end if;
 if not exists(select 1 from public.interventions where id=p_intervention_id and artisan_id is not null and status<>'cancelled') then
  raise exception 'Conversation unavailable' using errcode='P0001';end if;
 select * into result from public.messages where id=p_id;
 if found then
   if result.author_id=actor and result.intervention_id=p_intervention_id and result.body=content
    and exists(select 1 from public.audit_log where actor_id=actor and intervention_id=p_intervention_id and action='admin_message:'||p_id::text)
   then return result;end if;
   raise exception 'Message reference already used' using errcode='P0001';
 end if;
 perform public.consume_action('admin_send_message',30);
 insert into public.messages(id,intervention_id,author_id,body)values(p_id,p_intervention_id,actor,content)returning * into result;
 insert into public.audit_log(actor_id,intervention_id,action)values(actor,p_intervention_id,'admin_message:'||p_id::text);
 return result;
end;$$;
revoke execute on function public.admin_send_message(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.admin_send_message(uuid,uuid,text) to authenticated;

-- Older callers cannot bypass the administrator audit by using the shared command.
create or replace function public.send_message(p_intervention_id uuid,p_body text)
returns public.messages language plpgsql security definer set search_path='' as $$
begin
 if public.is_admin() then
   return public.admin_send_message(gen_random_uuid(),p_intervention_id,p_body);
 end if;
 perform public.lock_intervention_organization(p_intervention_id);
 return public.send_message_before_site_access(p_intervention_id,p_body);
end;$$;

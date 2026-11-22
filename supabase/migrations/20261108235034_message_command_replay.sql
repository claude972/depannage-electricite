begin;

create or replace function public.send_message(p_intervention_id uuid, p_body text, p_command_id uuid)
returns public.messages
language plpgsql security definer set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  dossier public.interventions;
  result public.messages;
  content text := regexp_replace(p_body, '^[[:space:]]+|[[:space:]]+$', '', 'g');
begin
  if actor is null then raise insufficient_privilege; end if;
  if public.is_admin() then
    return public.admin_send_message(p_command_id, p_intervention_id, p_body);
  end if;
  if p_command_id is null or p_intervention_id is null
    or content is null or char_length(content) not between 1 and 4000 then
    raise invalid_parameter_value;
  end if;

  -- Same UUID and lock order as the existing photo command, preventing text/photo collisions.
  perform pg_advisory_xact_lock(hashtextextended(p_command_id::text, 0));
  perform public.lock_intervention_organization(p_intervention_id);
  select * into dossier from public.interventions where id = p_intervention_id for update;
  if not found or not (public.owns_intervention(p_intervention_id) or dossier.artisan_id is not distinct from actor)
    then raise insufficient_privilege; end if;
  if dossier.artisan_id is null or dossier.status = 'cancelled' then
    raise exception 'Conversation unavailable' using errcode = 'P0001';
  end if;

  select * into result from public.messages where id = p_command_id;
  if found then
    if result.intervention_id = p_intervention_id and result.author_id = actor
      and result.attachment_id is null and result.body = content then return result; end if;
    raise exception 'Message reference already used' using errcode = 'P0001';
  end if;

  perform public.consume_action('send_message', 30);
  insert into public.messages (id, intervention_id, author_id, body)
    values (p_command_id, p_intervention_id, actor, content)
    returning * into result;
  return result;
end;
$$;

revoke all on function public.send_message(uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.send_message(uuid, text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.send_message(uuid, text, uuid) to authenticated;

commit;

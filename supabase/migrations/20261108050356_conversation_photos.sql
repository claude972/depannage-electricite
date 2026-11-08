begin;

alter table public.messages
  add column attachment_id uuid references public.documents(id) on delete restrict,
  drop constraint messages_body_check,
  add constraint messages_body_or_attachment_check
    check (char_length(body) <= 4000 and (char_length(body) > 0 or attachment_id is not null));

create index messages_attachment on public.messages (attachment_id)
  where attachment_id is not null;

create function public.send_message_with_photo(p_id uuid, p_intervention_id uuid, p_document_id uuid, p_body text)
returns public.messages
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  dossier public.interventions;
  result public.messages;
  content text := regexp_replace(p_body, '^[[:space:]]+|[[:space:]]+$', '', 'g');
begin
  if actor is null or public.is_admin() then raise insufficient_privilege; end if;
  if p_id is null or p_intervention_id is null or p_document_id is null
    or content is null or char_length(content) > 2000 then
    raise invalid_parameter_value;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_id::text, 0));
  perform public.lock_intervention_organization(p_intervention_id);
  select * into dossier from public.interventions where id = p_intervention_id for update;
  if not found or not (public.owns_intervention(p_intervention_id) or dossier.artisan_id is not distinct from actor) then
    raise no_data_found;
  end if;
  if dossier.artisan_id is null or dossier.status = 'cancelled' then
    raise exception 'Conversation unavailable' using errcode = 'P0001';
  end if;

  perform 1 from public.documents
    where id = p_document_id and intervention_id = p_intervention_id and owner_id = actor
      and mime_type in ('image/jpeg', 'image/png', 'image/webp')
    for key share;
  if not found then raise no_data_found; end if;

  select * into result from public.messages where id = p_id;
  if found then
    if result.intervention_id = p_intervention_id and result.author_id = actor
      and result.attachment_id = p_document_id and result.body = content then
      return result;
    end if;
    raise exception 'Message reference already used' using errcode = 'P0001';
  end if;

  perform public.consume_action('send_message', 30);
  insert into public.messages (id, intervention_id, author_id, body, attachment_id)
    values (p_id, p_intervention_id, actor, content, p_document_id)
    returning * into result;
  return result;
end;
$$;

revoke all on function public.send_message_with_photo(uuid, uuid, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.send_message_with_photo(uuid, uuid, uuid, text)
  to authenticated;

commit;

begin;

create or replace function public.site_document_upload_command(
  p_site uuid, p_command_id uuid, p_name text, p_mime text, p_kind text,
  p_replaces uuid, p_content_sha256 text, p_finalize boolean
)
returns public.site_documents
language plpgsql security definer set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  target public.sites;
  result public.site_documents;
  prior jsonb;
  object_path text := 'sites/' || p_site::text || '/' || actor::text || '/' || p_command_id::text;
  payload bytea := sha256(convert_to(
    jsonb_build_array(p_name, p_mime, p_kind, p_replaces, p_content_sha256)::text, 'UTF8'
  ));
begin
  if actor is null then raise insufficient_privilege; end if;
  if p_site is null or p_command_id is null or p_finalize is null
    or p_content_sha256 is null or p_content_sha256 !~ '^[a-f0-9]{64}$' then
    raise invalid_parameter_value;
  end if;
  perform public.lock_site_access(p_site);
  select * into target from public.sites where id = p_site for share;
  if not found or not public.can_manage_site(p_site) then raise insufficient_privilege; end if;
  if target.archived_at is not null then
    raise exception 'Archived site is read only' using errcode = 'P0001';
  end if;

  prior := command_replay_private.read_locked('site_document', p_command_id, p_site, payload);
  if prior is not null then return jsonb_populate_record(null::public.site_documents, prior); end if;
  if not p_finalize then return null; end if;

  if p_replaces is null then
    result := public.finalize_site_document_upload(p_site, p_command_id, object_path, p_name, p_mime, p_kind);
  else
    result := public.replace_site_document_upload(p_site, p_command_id, object_path, p_name, p_mime, p_kind, p_replaces);
  end if;
  insert into command_replay_private.receipts (scope, command_id, actor_id, target_id, fingerprint, result)
    values ('site_document', p_command_id, actor, p_site, payload, to_jsonb(result));
  return result;
end;
$$;
revoke all on function public.site_document_upload_command(uuid, uuid, text, text, text, uuid, text, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.site_document_upload_command(uuid, uuid, text, text, text, uuid, text, boolean)
  to authenticated;

commit;

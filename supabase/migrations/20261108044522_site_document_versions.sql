begin;

alter table public.site_documents
  add column version integer not null default 1 check (version > 0),
  add column revision integer not null default 1 check (revision > 0),
  add column replaces_id uuid unique,
  add column replaced_at timestamptz,
  add column archived_at timestamptz,
  add constraint site_document_site_and_id unique (site_id, id),
  add constraint site_document_same_site_previous foreign key (site_id, replaces_id)
    references public.site_documents (site_id, id),
  add constraint site_document_version_lineage
    check ((version = 1) = (replaces_id is null) and replaces_id is distinct from id),
  add constraint site_document_archive_or_replace
    check (archived_at is null or replaced_at is null);

create index site_documents_current_page on public.site_documents (site_id, created_at desc, id desc)
  where replaced_at is null and archived_at is null;

create function public.replace_site_document_upload(
  p_site uuid, p_id uuid, p_path text, p_name text, p_mime text, p_kind text, p_replaces uuid
)
returns public.site_documents
language plpgsql
security definer
set search_path = ''
as $$
declare
  previous public.site_documents;
  result public.site_documents;
begin
  if p_replaces is null or p_replaces = p_id then
    raise invalid_parameter_value;
  end if;

  -- The existing finalizer takes the site access lock and checks the current right.
  -- A conflict below rolls back the new metadata together with this operation.
  result := public.finalize_site_document_upload(p_site, p_id, p_path, p_name, p_mime, p_kind);
  select * into previous from public.site_documents
    where site_id = p_site and id = p_replaces for update;
  if not found then
    raise no_data_found;
  end if;
  if previous.archived_at is not null or previous.replaced_at is not null
    or previous.kind <> p_kind or previous.version >= 2147483647 or previous.revision >= 2147483647 then
    raise exception 'Document version conflict' using errcode = 'P0001';
  end if;

  update public.site_documents
    set replaced_at = clock_timestamp(), revision = previous.revision + 1
    where id = previous.id;
  update public.site_documents
    set version = previous.version + 1, replaces_id = previous.id
    where id = result.id returning * into result;
  insert into public.audit_log (actor_id, action)
    values (auth.uid(), 'site_document_replaced:' || previous.id::text);
  return result;
end;
$$;
revoke all on function public.replace_site_document_upload(uuid, uuid, text, text, text, text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.replace_site_document_upload(uuid, uuid, text, text, text, text, uuid) to authenticated;

create function public.set_site_document_archive(
  p_site uuid, p_id uuid, p_archive boolean, p_expected_revision integer
)
returns public.site_documents
language plpgsql
security definer
set search_path = ''
as $$
declare
  site public.sites;
  result public.site_documents;
  already_in_state boolean;
begin
  if auth.uid() is null then
    raise insufficient_privilege;
  end if;
  if p_site is null or p_id is null or p_archive is null
    or p_expected_revision is null or p_expected_revision not between 1 and 2147483646 then
    raise invalid_parameter_value;
  end if;

  perform public.lock_site_access(p_site);
  select * into site from public.sites where id = p_site for share;
  if not found or not public.can_manage_site(p_site) then
    raise insufficient_privilege;
  end if;
  if site.archived_at is not null then
    raise exception 'Archived site is read only' using errcode = 'P0001';
  end if;

  select * into result from public.site_documents
    where site_id = p_site and id = p_id for update;
  if not found then
    raise no_data_found;
  end if;
  if result.replaced_at is not null then
    raise exception 'Replaced document is read only' using errcode = 'P0001';
  end if;

  already_in_state := (result.archived_at is not null) = p_archive;
  if already_in_state and result.revision between p_expected_revision and p_expected_revision + 1 then
    return result;
  end if;
  if result.revision <> p_expected_revision then
    raise exception 'Document revision conflict' using errcode = 'P0001';
  end if;

  perform public.consume_action('site_document_archive', 30);
  update public.site_documents
    set archived_at = case when p_archive then clock_timestamp() else null end,
        revision = result.revision + 1
    where id = p_id returning * into result;
  insert into public.audit_log (actor_id, action)
    values (auth.uid(), (case when p_archive then 'site_document_archived:' else 'site_document_restored:' end) || p_id::text);
  return result;
end;
$$;
revoke all on function public.set_site_document_archive(uuid, uuid, boolean, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.set_site_document_archive(uuid, uuid, boolean, integer) to authenticated;

commit;

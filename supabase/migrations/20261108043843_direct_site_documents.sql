begin;

create table public.site_documents (
  id uuid primary key,
  site_id uuid not null references public.sites(id),
  owner_id uuid not null references public.profiles(id),
  name text not null check (char_length(btrim(name)) between 1 and 160),
  mime_type text not null check (mime_type in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')),
  kind text not null check (kind in ('plan', 'maintenance', 'compliance', 'other')),
  path text not null unique,
  created_at timestamptz not null default clock_timestamp(),
  check (path = 'sites/' || site_id::text || '/' || owner_id::text || '/' || id::text)
);
create index site_documents_page on public.site_documents (site_id, created_at desc, id desc);
alter table public.site_documents enable row level security;
revoke all on public.site_documents from public, anon, authenticated, service_role;
grant select on public.site_documents to authenticated, service_role;
create policy site_documents_read on public.site_documents for select to authenticated
  using (public.can_access_site(site_id));
create policy site_document_objects_read on storage.objects for select to authenticated
  using (
    bucket_id = 'intervention-documents' and exists (
      select 1 from public.site_documents as document
      where document.path = storage.objects.name and public.can_access_site(document.site_id)
    )
  );

create function public.finalize_site_document_upload(
  p_site uuid, p_id uuid, p_path text, p_name text, p_mime text, p_kind text
)
returns public.site_documents
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  target public.sites;
  result public.site_documents;
begin
  if actor is null or p_site is null or p_id is null
    or p_path is distinct from 'sites/' || p_site::text || '/' || actor::text || '/' || p_id::text then
    raise insufficient_privilege;
  end if;
  if p_name is null or char_length(p_name) not between 1 and 160 or btrim(p_name) = ''
    or p_mime is null or p_mime not in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')
    or p_kind is null or p_kind not in ('plan', 'maintenance', 'compliance', 'other') then
    raise invalid_parameter_value;
  end if;

  perform public.lock_site_access(p_site);
  select * into target from public.sites where id = p_site for share;
  if not found or not public.can_manage_site(p_site) then
    raise insufficient_privilege;
  end if;
  if target.archived_at is not null then
    raise exception 'Archived site is read only' using errcode = 'P0001';
  end if;

  if not exists (
    select 1 from storage.objects
    where bucket_id = 'intervention-documents' and name = p_path
  ) then
    raise no_data_found;
  end if;

  insert into public.site_documents(id, site_id, owner_id, name, mime_type, kind, path)
  values (p_id, p_site, actor, p_name, p_mime, p_kind, p_path)
  returning * into result;
  return result;
end;
$$;
revoke all on function public.finalize_site_document_upload(uuid, uuid, text, text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.finalize_site_document_upload(uuid, uuid, text, text, text, text) to authenticated;

commit;

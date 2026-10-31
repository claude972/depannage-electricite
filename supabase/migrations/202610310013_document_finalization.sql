-- NATIVE-DOCUMENT-GATEWAY-001: atomic document finalization for server-mediated uploads.
-- Additive only: no policy, helper, table, bucket or grant from 001-012 is changed.
-- The caller (gateway) has already written the object at <uid>/<id> with a server key;
-- this command re-checks the right to attach it under organisation -> dossier locks,
-- proves the object really exists at the owner path, then inserts the metadata.
begin;
create function public.finalize_document_upload(p_id uuid,p_path text,p_name text,p_mime text,p_intervention_id uuid default null)
returns public.documents language plpgsql security definer set search_path='' as $$
declare job public.interventions; result public.documents;
begin
 if auth.uid() is null or p_id is null or p_path is null then raise insufficient_privilege; end if;
 -- Only the caller's own owner path; nobody can claim another user's object.
 if p_path<>auth.uid()::text||'/'||p_id::text then raise insufficient_privilege; end if;
 if p_name is null or char_length(p_name) not between 1 and 160 or char_length(trim(p_name))<1 then raise invalid_parameter_value; end if;
 if p_mime is null or p_mime not in ('image/jpeg','image/png','image/webp','application/pdf') then raise invalid_parameter_value; end if;
 if p_intervention_id is not null then
  -- Lock order shared with 009/012: organisation first, then the dossier (shared lock:
  -- serializes with reassignment, scope and membership writers, not with other uploads).
  perform public.lock_intervention_organization(p_intervention_id);
  select * into job from public.interventions where id=p_intervention_id for share;
  if not found then raise insufficient_privilege; end if;
  if not coalesce(public.owns_intervention(p_intervention_id) or public.is_admin() or job.artisan_id=auth.uid(),false) then raise insufficient_privilege; end if;
 end if;
 -- The object must really exist in the private bucket at the owner path.
 if not exists(select 1 from storage.objects o where o.bucket_id='intervention-documents' and o.name=p_path) then raise no_data_found; end if;
 insert into public.documents(id,intervention_id,owner_id,name,path,mime_type)
  values(p_id,p_intervention_id,auth.uid(),p_name,p_path,p_mime) returning * into result;
 return result;
end; $$;
revoke execute on function public.finalize_document_upload(uuid,text,text,text,uuid) from public,anon,authenticated;
grant execute on function public.finalize_document_upload(uuid,text,text,text,uuid) to authenticated;
commit;

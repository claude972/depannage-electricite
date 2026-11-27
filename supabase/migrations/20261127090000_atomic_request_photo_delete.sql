-- CLI-02 / R-SRV-16 — deleting a request photo is atomic with mission acceptance.
--
-- The DELETE route checked the dossier (« requested », no artisan) with the service role, then
-- deleted the document row in a later statement: an acceptance committed in between was not
-- seen and the assigned artisan lost a photo of the dossier (reproduced on 27 November 2026,
-- tests/sql-request-photo-delete-review.mjs, section 1).
--
-- delete_request_photo takes the same locks as intervention_action('accept_mission'), in the same
-- order (organization of the site, then the dossier row), checks owner, role, photo type and the
-- open state under that lock, then withdraws the offer consent (cascade) and deletes the row in
-- one transaction, with its audit entry. The storage object is removed by the route afterwards
-- from the returned path; a failed file removal is reported as before, never a kept row.
-- Errors: 42501 not the owner client / not a request photo / unknown; P0001 the request is no
-- longer open; 23503 the photo is referenced by a message or a report (left to the route: 409).

create function public.delete_request_photo(p_document_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  doc public.documents;
  job public.interventions;
begin
  if actor is null or p_document_id is null then raise insufficient_privilege; end if;
  if not exists(select 1 from public.profiles where id = actor and role = 'client') then raise insufficient_privilege; end if;
  select * into doc from public.documents where id = p_document_id;
  if not found or doc.owner_id is distinct from actor or doc.intervention_id is null
     or doc.mime_type not in ('image/jpeg','image/png','image/webp') then
    raise insufficient_privilege;
  end if;
  -- Same lock order as the acceptance: organization, then dossier.
  perform public.lock_intervention_organization(doc.intervention_id);
  select * into job from public.interventions where id = doc.intervention_id for update;
  if not found or job.client_id is distinct from actor then raise insufficient_privilege; end if;
  if job.status <> 'requested' or job.artisan_id is not null then
    raise exception 'Offer no longer open' using errcode = 'P0001';
  end if;
  perform public.consume_action('operations', 30);
  -- Re-read under the dossier lock: the row must still be this owner's photo of this dossier.
  delete from public.documents
   where id = p_document_id and owner_id = actor and intervention_id = job.id
   returning * into doc;
  if not found then raise insufficient_privilege; end if;
  insert into public.audit_log(actor_id, intervention_id, action) values (actor, job.id, 'request_photo_deleted');
  return jsonb_build_object('deleted', true, 'id', doc.id, 'path', doc.path);
end;
$$;
revoke all on function public.delete_request_photo(uuid) from public, anon, authenticated, service_role;
grant execute on function public.delete_request_photo(uuid) to authenticated;

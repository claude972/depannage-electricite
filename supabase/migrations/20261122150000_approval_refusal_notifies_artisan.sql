-- ENT-12 — the artisan is told when the client organisation refuses the quote internally.
--
-- An internal refusal (simple approval or advanced workflow) leaves the quote « sent »: until now only
-- the requester was notified and the artisan kept waiting for a decision that would never come
-- (qualification of 22 November 2026).
--
-- Two triggers notify the author of the quote, once per refusal:
--  - approvals: status becomes « rejected »
--  - advanced_approval_workflows: state becomes « rejected » (a request for information is internal
--    and is not announced)
-- An internal approval is not announced either: the artisan is told by the client's acceptance.
--
-- The existing kind approval_decided is reused (no constraint, preference or client change). The
-- notification is attached to the dossier only, never to the site, and carries neither the internal
-- note nor the names of the deciders. payload.subject = « quote_not_approved » lets the notification
-- centre label it for the artisan (the kind label alone speaks of an internal decision). The quote and the dossier are not modified. In-app only.

create function public.notify_artisan_quote_not_approved(p_quote_id uuid,p_dedupe text) returns void language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
declare q public.quotes; ref text;
begin
 select * into q from public.quotes where id=p_quote_id;
 if not found then return; end if;
 ref=public.intervention_reference(q.intervention_id);
 perform public.notify(q.artisan_id,'approval_decided','Devis non approuvé par le client','L’organisation cliente n’a pas approuvé le devis du dossier '||ref||'.',
  p_dedupe,q.intervention_id,null,null,auth.uid(),jsonb_build_object('subject','quote_not_approved','reference',ref,'quote_id',q.id));
end; $$;
revoke execute on function public.notify_artisan_quote_not_approved(uuid,text) from public,anon,authenticated,service_role;

create function public.notify_artisan_approval_rejected() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.status='rejected' and new.status is distinct from old.status then
  perform public.notify_artisan_quote_not_approved(new.quote_id,'approval:'||new.id||':rejected:artisan');
 end if;
 return new;
end; $$;
revoke execute on function public.notify_artisan_approval_rejected() from public,anon,authenticated,service_role;
create trigger approval_refusal_artisan_notification after update of status on public.approvals
 for each row execute function public.notify_artisan_approval_rejected();

create function public.notify_artisan_advanced_approval_rejected() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.state='rejected' and new.state is distinct from old.state then
  perform public.notify_artisan_quote_not_approved(new.quote_id,'advanced_approval:'||new.quote_id||':rejected:'||new.version||':artisan');
 end if;
 return new;
end; $$;
revoke execute on function public.notify_artisan_advanced_approval_rejected() from public,anon,authenticated,service_role;
create trigger advanced_approval_refusal_artisan_notification after update of state on public.advanced_approval_workflows
 for each row execute function public.notify_artisan_advanced_approval_rejected();

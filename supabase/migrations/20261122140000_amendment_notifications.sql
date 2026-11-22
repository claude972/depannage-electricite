-- CLI-07 — in-app notification when a quote amendment is proposed and when it is decided.
--
-- Until now an amendment produced no notification: the client discovered it by opening the dossier
-- and the artisan learnt the decision the same way (qualification of 22 November 2026).
--
-- A trigger on quote_amendments covers every writer of that table:
--  - proposal  -> the client of the dossier (kind quote_received, « Avenant proposé »)
--  - accepted  -> the artisan who proposed it (kind quote_accepted, « Avenant accepté »)
--  - rejected  -> the artisan who proposed it (kind quote_rejected, « Avenant refusé »)
-- A withdrawal by the author is not a decision of the client and notifies nobody.
--
-- Existing notification kinds are reused on purpose: the kind constraint, the preference list and
-- the clients (web, iOS, Android) stay unchanged, and a member who muted quote notifications is
-- not notified. notify() already skips the actor, a missing profile and a muted kind, and dedupes
-- on (recipient, key). The text carries the dossier reference only: no amount, no private content.
-- In-app only: nothing is sent to an external channel by this migration.

create function public.notify_quote_amendment() returns trigger language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
declare job public.interventions; ref text; payload jsonb;
begin
 if tg_op='UPDATE' and new.status is not distinct from old.status then return new; end if;
 if tg_op='INSERT' and new.status<>'proposed' then return new; end if;
 if tg_op='UPDATE' and new.status not in ('accepted','rejected') then return new; end if;
 select * into job from public.interventions where id=new.intervention_id;
 if not found then return new; end if;
 ref=public.intervention_reference(job.id);
 payload=jsonb_build_object('reference',ref,'amendment_id',new.id,'amendment_version',new.version);
 if tg_op='INSERT' then
  perform public.notify(job.client_id,'quote_received','Avenant proposé','Un avenant au devis du dossier '||ref||' attend votre décision.',
   'amendment:'||new.id||':proposed',job.id,null,null,auth.uid(),payload);
 elsif new.status='accepted' then
  perform public.notify(new.artisan_id,'quote_accepted','Avenant accepté','L’avenant n° '||new.version||' du dossier '||ref||' a été accepté.',
   'amendment:'||new.id||':accepted',job.id,null,null,auth.uid(),payload);
 else
  perform public.notify(new.artisan_id,'quote_rejected','Avenant refusé','L’avenant n° '||new.version||' du dossier '||ref||' a été refusé.',
   'amendment:'||new.id||':rejected',job.id,null,null,auth.uid(),payload);
 end if;
 return new;
end; $$;
revoke execute on function public.notify_quote_amendment() from public,anon,authenticated,service_role;

create trigger quote_amendment_notifications after insert or update of status on public.quote_amendments
 for each row execute function public.notify_quote_amendment();

-- ADM-02 — a definitive refusal of an artisan application is enforced by the database.
--
-- Finding of the independent review of 22 November 2026: the refusal exists only as the latest
-- application decision kept in the artisan's decision log (notification payload « definitive »), and
-- it was checked by the web route alone. submit_artisan_application() is granted to authenticated:
-- a refused artisan could call it directly with their own session and put the dossier back to
-- « submitted »; the route check also failed open when the log could not be read.
--
-- The command now reads the same decision log itself. The latest application decision wins, so a
-- reopening by the administration (a later decision without « definitive ») lifts the refusal exactly
-- as in the route. The log is not writable by members (no insert/update policy or grant on
-- notifications), so the artisan cannot lift it. Same wrapper pattern as the suspension guard (008).
-- No row is written or changed by this migration.

alter function public.submit_artisan_application() rename to submit_artisan_application_before_refusal_guard;
revoke execute on function public.submit_artisan_application_before_refusal_guard() from public,anon,authenticated;

create function public.artisan_application_refused(p_user_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select coalesce((select (n.payload->>'definitive')='true' from public.notifications n
  where n.recipient_id=p_user_id and n.kind in ('account_approved','account_suspended') and n.payload->>'application_decision' is not null
  order by n.created_at desc,n.id desc limit 1),false);
$$;
revoke execute on function public.artisan_application_refused(uuid) from public,anon,authenticated;

create function public.submit_artisan_application() returns public.artisan_profiles language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise insufficient_privilege; end if;
 if public.artisan_application_refused(auth.uid()) then raise exception 'Application refused by the operator' using errcode='P0001'; end if;
 return public.submit_artisan_application_before_refusal_guard();
end; $$;
revoke execute on function public.submit_artisan_application() from public,anon;
grant execute on function public.submit_artisan_application() to authenticated;

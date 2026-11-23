-- ADM-02 — the reason and the definitive mark of an application decision are written by the
-- database, in the transaction of the decision.
--
-- Follow-up of the diff review of 22 November 2026 (R-SRV-19). The decision log entry (reason,
-- « definitive ») was written by the web route AFTER decide_artisan_application had committed. When
-- that second write failed, the decision stood without its reason and a definitive refusal was not
-- recorded at all: the refusal guard of 20261122170000 then had nothing to read.
--
-- record_artisan_application_decision runs the existing replay-safe decision command and writes the
-- log entry in the same transaction, with the same shape as the route wrote it (kind, title, body,
-- payload, dedupe key application-decision:<command id>): both succeed or neither does. A replay of
-- the same command writes nothing twice. The rules the route enforced are enforced here as well:
-- administrator only, reason of 10 to 500 characters, mandatory for a negative decision, « definitive »
-- only with a request for changes. The existing four-argument command is unchanged and stays granted.
-- No row is written or changed by this migration.

create function public.record_artisan_application_decision(
 p_user_id uuid, p_action text, p_expected_version integer, p_command_id uuid, p_reason text default null, p_definitive boolean default false
) returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
declare reason text=nullif(btrim(coalesce(p_reason,'')),''); definitive boolean=coalesce(p_definitive,false); recorded boolean=false;
begin
 if not public.is_admin() then raise insufficient_privilege; end if;
 if p_user_id is null or p_command_id is null or p_expected_version is null or p_action is null or p_action not in ('approve','request_changes','suspend','reinstate') then raise invalid_parameter_value; end if;
 if reason is not null and char_length(reason) not between 10 and 500 then raise invalid_parameter_value; end if;
 if p_action in ('request_changes','suspend') and reason is null then raise exception 'A reason is required for a negative decision' using errcode='22023'; end if;
 if definitive and p_action<>'request_changes' then raise exception 'Only a request for changes can be definitive' using errcode='22023'; end if;
 perform public.decide_artisan_application(p_user_id,p_action,p_expected_version,p_command_id);
 if reason is not null then
  insert into public.notifications(recipient_id,kind,title,body,actor_id,payload,dedupe_key)
  values(p_user_id,case when p_action in ('approve','reinstate') then 'account_approved' else 'account_suspended' end,
   case when definitive then 'Candidature refusée' when p_action='approve' then 'Candidature approuvée' when p_action='request_changes' then 'Compléments demandés sur votre candidature'
        when p_action='suspend' then 'Compte professionnel suspendu' else 'Compte professionnel réactivé' end,
   left('Motif communiqué par l’exploitant : '||reason,600),auth.uid(),
   jsonb_build_object('application_decision',p_action,'reason',reason,'application_version',p_expected_version)||case when definitive then jsonb_build_object('definitive',true) else '{}'::jsonb end,
   'application-decision:'||p_command_id)
  on conflict(recipient_id,dedupe_key) do nothing;
  recorded=true;
 end if;
 return jsonb_build_object('success',true,'reason_recorded',recorded);
end; $$;
revoke all on function public.record_artisan_application_decision(uuid,text,integer,uuid,text,boolean) from public,anon,authenticated,service_role;
grant execute on function public.record_artisan_application_decision(uuid,text,integer,uuid,text,boolean) to authenticated;

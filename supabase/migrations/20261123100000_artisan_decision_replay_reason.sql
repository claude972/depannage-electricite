-- ADM-02 — a replayed application decision never reports a reason it did not record (R-SRV-21).
--
-- Review of PR 13: the replay fingerprint of decide_artisan_application covers only the action and
-- the expected version. A replay of the same command with another reason or another « definitive »
-- answered reason_recorded = true while the log kept the first entry; and a replay of a command whose
-- first run wrote no log entry (decision without reason, or the former two-step path) could insert a
-- fresh entry dated now — a late « definitive » could then become the latest decision.
--
-- record_artisan_application_decision now:
--  - detects a replay from the command receipt BEFORE running the decision;
--  - on a replay, compares the existing log entry with the request: same reason and same mark ⇒
--    reason_recorded = true; different ⇒ refused (« Command replayed with a different reason »);
--    no entry ⇒ nothing is inserted, reason_recorded = false;
--  - refuses a command id whose log key already belongs to another entry (e.g. a reopening).
-- A first run behaves exactly as before. Same signature, grants restated. No row written by this
-- migration.

create or replace function public.record_artisan_application_decision(
 p_user_id uuid, p_action text, p_expected_version integer, p_command_id uuid, p_reason text default null, p_definitive boolean default false
) returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
declare reason text=nullif(btrim(coalesce(p_reason,'')),''); definitive boolean=coalesce(p_definitive,false); recorded boolean=false;
 replay boolean; dedupe text='application-decision:'||p_command_id; prior public.notifications;
begin
 if not public.is_admin() then raise insufficient_privilege; end if;
 if p_user_id is null or p_command_id is null or p_expected_version is null or p_action is null or p_action not in ('approve','request_changes','suspend','reinstate') then raise invalid_parameter_value; end if;
 if reason is not null and char_length(reason) not between 10 and 500 then raise invalid_parameter_value; end if;
 if p_action in ('request_changes','suspend') and reason is null then raise exception 'A reason is required for a negative decision' using errcode='22023'; end if;
 if definitive and p_action<>'request_changes' then raise exception 'Only a request for changes can be definitive' using errcode='22023'; end if;
 -- Same lock as the replay helper, taken first so the receipt read below cannot race a first run.
 perform pg_advisory_xact_lock(hashtextextended('command-replay:artisan_decision:'||p_command_id,0));
 replay=exists(select 1 from command_replay_private.receipts where scope='artisan_decision' and command_id=p_command_id);
 -- Runs the decision, or validates the replay identity (same admin, target, action and version).
 perform public.decide_artisan_application(p_user_id,p_action,p_expected_version,p_command_id);
 select * into prior from public.notifications where recipient_id=p_user_id and dedupe_key=dedupe;
 if found then
  if prior.payload->>'application_decision' is distinct from p_action or (prior.payload->>'reason') is distinct from reason
     or coalesce((prior.payload->>'definitive')='true',false)<>definitive or coalesce((prior.payload->>'reopened')='true',false) then
   raise exception 'Command replayed with a different reason' using errcode='P0001';
  end if;
  return jsonb_build_object('success',true,'reason_recorded',true);
 end if;
 if replay then
  -- A decision replayed without its entry stays without it: no late, re-dated entry.
  if reason is not null then raise exception 'Command replayed with a different reason' using errcode='P0001'; end if;
  return jsonb_build_object('success',true,'reason_recorded',false);
 end if;
 if reason is not null then
  insert into public.notifications(recipient_id,kind,title,body,actor_id,payload,dedupe_key)
  values(p_user_id,case when p_action in ('approve','reinstate') then 'account_approved' else 'account_suspended' end,
   case when definitive then 'Candidature refusée' when p_action='approve' then 'Candidature approuvée' when p_action='request_changes' then 'Compléments demandés sur votre candidature'
        when p_action='suspend' then 'Compte professionnel suspendu' else 'Compte professionnel réactivé' end,
   left('Motif communiqué par l’exploitant : '||reason,600),auth.uid(),
   jsonb_build_object('application_decision',p_action,'reason',reason,'application_version',p_expected_version)||case when definitive then jsonb_build_object('definitive',true) else '{}'::jsonb end,
   dedupe);
  recorded=true;
 end if;
 return jsonb_build_object('success',true,'reason_recorded',recorded);
end; $$;
revoke all on function public.record_artisan_application_decision(uuid,text,integer,uuid,text,boolean) from public,anon,authenticated,service_role;
grant execute on function public.record_artisan_application_decision(uuid,text,integer,uuid,text,boolean) to authenticated;

-- QA-GW-EXPIRED-REVOKE-003 §2 (contract v4 ac4eadf) — root batch for `supabase db query --file`.
-- Rendered by `--suite revoke-prepare` into the private out dir with the cohort UUIDs substituted
-- (double-brace placeholders are validated UUIDs / the run tag). ONE execution per run, reviewed by root.
-- Every measurement INSERT runs under the root role (temp table owned by root, no GRANT); the
-- `set local role authenticated … reset role` section contains only the actor proof and the RPC.
begin;
set local statement_timeout = '8s';
set local lock_timeout = '2s';
create temp table qa_rv(k text primary key, v jsonb);
insert into qa_rv values ('t_begin', to_jsonb(clock_timestamp())), ('batch_pid', to_jsonb(pg_backend_pid())),
  ('run', to_jsonb('{{RUN}}'::text)), ('project', to_jsonb('{{PROJECT}}'::text)),
  ('org_id', to_jsonb('{{ORG}}'::text)), ('site_id', to_jsonb('{{SITE}}'::text)), ('dossier_id', to_jsonb('{{DOSSIER}}'::text)),
  ('owner_id', to_jsonb('{{OWNER}}'::text)), ('manager_id', to_jsonb('{{MANAGER}}'::text));
-- Guard: every identifier belongs to the cohort of this run; no other qa-gw writer; otherwise raise (nothing committed).
do $$
declare n integer;
begin
 if not exists (select 1 from auth.users where id = '{{OWNER}}'::uuid and email = 'qa-gw-rv-{{RUN}}-owner@qa.invalid') then raise exception 'garde : propriétaire QA hors cohorte'; end if;
 if not exists (select 1 from auth.users where id = '{{MANAGER}}'::uuid and email = 'qa-gw-rv-{{RUN}}-manager@qa.invalid') then raise exception 'garde : gestionnaire QA hors cohorte'; end if;
 if not exists (select 1 from public.organizations where id = '{{ORG}}'::uuid and owner_id = '{{OWNER}}'::uuid) then raise exception 'garde : organisation QA / propriétaire'; end if;
 if not exists (select 1 from public.sites where id = '{{SITE}}'::uuid and organization_id = '{{ORG}}'::uuid) then raise exception 'garde : site QA / organisation'; end if;
 if not exists (select 1 from public.interventions where id = '{{DOSSIER}}'::uuid and site_id = '{{SITE}}'::uuid and client_id = '{{OWNER}}'::uuid) then raise exception 'garde : dossier QA / site / propriétaire'; end if;
 if not exists (select 1 from public.organization_members where organization_id = '{{ORG}}'::uuid and user_id = '{{MANAGER}}'::uuid and role = 'manager') then raise exception 'garde : membre gestionnaire QA'; end if;
 if exists (select 1 from public.profiles where id in ('{{OWNER}}'::uuid, '{{MANAGER}}'::uuid) and role = 'admin') then raise exception 'garde : compte admin dans la cohorte'; end if;
 if '{{MANAGER}}'::uuid = '{{OWNER}}'::uuid then raise exception 'garde : gestionnaire = propriétaire'; end if;
 if exists (select 1 from public.interventions where id = '{{DOSSIER}}'::uuid and artisan_id = '{{MANAGER}}'::uuid) then raise exception 'garde : gestionnaire = artisan attribué'; end if;
 if not exists (select 1 from public.organization_member_site_scopes where organization_id = '{{ORG}}'::uuid and user_id = '{{MANAGER}}'::uuid and scope = 'selected') then raise exception 'garde : portée selected attendue'; end if;
 select count(*) into n from public.organization_member_site_grants where organization_id = '{{ORG}}'::uuid and user_id = '{{MANAGER}}'::uuid;
 if n <> 1 or not exists (select 1 from public.organization_member_site_grants where organization_id = '{{ORG}}'::uuid and user_id = '{{MANAGER}}'::uuid and site_id = '{{SITE}}'::uuid and can_write) then raise exception 'garde : un seul grant can_write sur le site QA attendu'; end if;
 select count(*) into n from auth.users where email like 'qa-gw-%' and email not like 'qa-gw-rv-{{RUN}}-%';
 if n > 0 then raise exception 'garde : % autre(s) compte(s) qa-gw présent(s) (autre rédacteur ou bail d''expiration en attente)', n; end if;
end $$;
-- Ordering lock on ONE QA organisation (the same lock finalize_document_upload takes first); t_lock AFTER acquisition.
select 1 from public.organizations o where o.id = '{{ORG}}'::uuid for update of o;
insert into qa_rv values ('t_lock', to_jsonb(clock_timestamp()));
-- Window: <= 3 s. Never lengthened.
select pg_sleep(3);
-- Claims of the QA owner, set under the root role (transaction-local); measurement under root.
select set_config('request.jwt.claim.sub', '{{OWNER}}', true),
       set_config('request.jwt.claims', '{"sub":"{{OWNER}}","role":"authenticated","aud":"authenticated"}', true);
insert into qa_rv values ('t_before_revoke', to_jsonb(clock_timestamp()));
-- Under authenticated: actor proof (raise = batch aborted, no revocation attempted), then the real RPC only.
set local role authenticated;
do $$
begin
 if current_setting('role', true) is distinct from 'authenticated' then raise exception 'acteur RPC non prouvé : role=%', current_setting('role', true); end if;
 if auth.uid() is distinct from '{{OWNER}}'::uuid then raise exception 'acteur RPC non prouvé : auth.uid()=%', auth.uid(); end if;
 perform set_config('qa.actor_role', current_setting('role', true), true), set_config('qa.actor_uid', auth.uid()::text, true);
end $$;
select public.set_organization_member_site_access('{{ORG}}'::uuid, '{{MANAGER}}'::uuid, 'selected', '[]'::jsonb);
reset role;
insert into qa_rv values ('actor_role', to_jsonb(current_setting('qa.actor_role', true))), ('actor_uid', to_jsonb(current_setting('qa.actor_uid', true))),
  ('t_revoked', to_jsonb(clock_timestamp())), ('rpc_ok', 'true'::jsonb);
commit;
-- After commit: authoritative readback of the revocation, then the upper bound of the commit time.
insert into qa_rv select 'readback', jsonb_build_object(
  'scope', (select scope from public.organization_member_site_scopes where organization_id = '{{ORG}}'::uuid and user_id = '{{MANAGER}}'::uuid),
  'grants', (select count(*) from public.organization_member_site_grants where organization_id = '{{ORG}}'::uuid and user_id = '{{MANAGER}}'::uuid));
insert into qa_rv values ('t_after_commit', to_jsonb(clock_timestamp()));
-- THE single structured final row (copy it verbatim into the file given to --batch-result).
select jsonb_object_agg(k, v) as result from qa_rv;

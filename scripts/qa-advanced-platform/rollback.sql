-- QA-ADV-ROLLBACK-001 — recette SQL réelle des RPC/RLS 014 (plateforme/finance), 015 (documents de
-- devis) et 017 (B2B opérations de site) dans UNE transaction annulée. Contrat :
-- docs/CLAUDE_ADV_ROLLBACK_CONTRACT.md. Exécution pilote : supabase db query --file <ce fichier>
-- (rôle postgres du projet dédié, après 014–017). Aucun COMMIT, aucune fixture permanente, aucun
-- trigger désactivé, aucun compte réel, aucun e-mail, aucun fournisseur de paiement appelé :
-- les événements fournisseur sont simulés (evt_qa_*/cs_qa_*) et annulés avec le reste.
-- Toute assertion échouée lève QA001 et abandonne la transaction : jamais de succès silencieux.
-- Dernière instruction : ROLLBACK, inconditionnel.
begin;
set local statement_timeout = '180s';
set local lock_timeout = '5s';
set local idle_in_transaction_session_timeout = '600s';

-- ---------------------------------------------------------------------------------------------
-- 0. Préconditions : schéma 014–017 présent, rôles disponibles. Refus explicite avant toute écriture.
-- ---------------------------------------------------------------------------------------------
do $$
begin
 if to_regclass('public.platform_operator_grants') is null or to_regprocedure('public.platform_access()') is null
  or to_regprocedure('public.platform_issue_credit_note(uuid,uuid,integer,text)') is null then
  raise exception 'QA-ADV-ROLLBACK: migration 014 absente (platform_operator_grants / platform_access)' using errcode='QA001';
 end if;
 if to_regclass('public.quote_documents') is null or to_regprocedure('public.generate_quote_document(uuid,uuid)') is null then
  raise exception 'QA-ADV-ROLLBACK: migration 015 absente (quote_documents)' using errcode='QA001';
 end if;
 if to_regclass('public.artisan_planning_entries') is null then
  raise exception 'QA-ADV-ROLLBACK: migration 016 absente (artisan_planning_entries)' using errcode='QA001';
 end if;
 if to_regclass('public.site_sla_cases') is null or to_regprocedure('public.site_operations_snapshot(uuid)') is null then
  raise exception 'QA-ADV-ROLLBACK: migration 017 absente (site_sla_cases / site_operations_snapshot)' using errcode='QA001';
 end if;
 if to_regclass('auth.users') is null or to_regprocedure('auth.uid()') is null then
  raise exception 'QA-ADV-ROLLBACK: schéma auth absent' using errcode='QA001';
 end if;
 if not (pg_has_role(current_user,'authenticated','member') and pg_has_role(current_user,'service_role','member')) then
  raise exception 'QA-ADV-ROLLBACK: le rôle % ne peut pas endosser authenticated/service_role', current_user using errcode='QA001';
 end if;
 if not has_table_privilege(current_user,'auth.users','insert') then
  raise exception 'QA-ADV-ROLLBACK: insertion dans auth.users impossible pour %', current_user using errcode='QA001';
 end if;
end $$;

-- ---------------------------------------------------------------------------------------------
-- 1. Helpers temporaires (pg_temp uniquement, détruits avec la session ; jamais dans public).
-- ---------------------------------------------------------------------------------------------
create temp table qa_ctx(key text primary key, val text);
create temp table qa_report(seq integer generated always as identity primary key, line text not null);
create function pg_temp.qa_set(k text, v text) returns void language sql as $$
 insert into qa_ctx(key,val) values(k,v) on conflict(key) do update set val=excluded.val $$;
create function pg_temp.qa_get(k text) returns text language sql stable as $$ select val from qa_ctx where key=k $$;
create function pg_temp.qa_id(k text) returns uuid language sql stable as $$ select val::uuid from qa_ctx where key=k $$;
create function pg_temp.qa_note(p text) returns void language plpgsql as $$
begin insert into qa_report(line) values(left(p,300)); raise notice 'QA-ADV-ROLLBACK | %', left(p,300); end $$;
create function pg_temp.qa_fail(p text) returns void language plpgsql as $$
begin raise exception 'QA-ADV-ROLLBACK FAIL: %', left(p,400) using errcode='QA001'; end $$;
create function pg_temp.qa_check(ok boolean, label text) returns void language plpgsql as $$
begin if ok is distinct from true then perform pg_temp.qa_fail(label); end if; perform pg_temp.qa_note('PASS '||label); end $$;
-- Identité locale d'un acteur : rôle PostgreSQL + claims JWT lues par auth.uid() (les deux formes).
create function pg_temp.qa_as(p_uid uuid, p_role text default 'authenticated') returns void language plpgsql as $$
begin
 perform set_config('request.jwt.claim.sub', coalesce(p_uid::text,''), true);
 perform set_config('request.jwt.claims', case when p_uid is null then '' else json_build_object('sub',p_uid,'role',p_role,'aud','authenticated')::text end, true);
 execute format('set local role %I', p_role);
end $$;
create function pg_temp.qa_root() returns void language plpgsql as $$
begin execute 'reset role'; perform set_config('request.jwt.claim.sub','',true); perform set_config('request.jwt.claims','',true); end $$;
-- Succès attendu : p_sql doit produire une colonne « v » (une ligne) ; résultat en jsonb.
create function pg_temp.qa_call(p_uid uuid, p_role text, p_sql text) returns jsonb language plpgsql as $$
declare v jsonb;
begin
 perform pg_temp.qa_as(p_uid,p_role);
 execute format('select to_jsonb(q.v) from (%s) q', p_sql) into v;
 execute 'reset role';
 perform pg_temp.qa_root();
 return v;
end $$;
-- Écriture attendue (DML sans résultat).
create function pg_temp.qa_exec(p_uid uuid, p_role text, p_sql text) returns void language plpgsql as $$
begin
 perform pg_temp.qa_as(p_uid,p_role);
 execute p_sql;
 execute 'reset role';
 perform pg_temp.qa_root();
end $$;
-- Compteurs de débit (action_limits) des SEULS acteurs QA remis à zéro entre sections : lignes
-- synthétiques annulées par le rollback ; le plafond lui-même est testé explicitement (critère 11).
create function pg_temp.qa_reset_limits() returns void language sql as $$
 delete from public.action_limits where actor_id in (select val::uuid from qa_ctx where key in
  ('client','other','manager','viewer','delegate','otherOwner','artisan','otherArtisan','admin','finRead','finWrite','moderator','auditor')) $$;
-- Refus attendu avec SQLSTATE exact ; tout autre code (ou un succès) est un échec QA001.
create function pg_temp.qa_refused(p_uid uuid, p_role text, p_sql text, p_code text, p_label text) returns void language plpgsql as $$
declare v_state text; v_msg text;
begin
 begin
  perform pg_temp.qa_as(p_uid,p_role);
  execute p_sql;
  execute 'reset role';
 exception when others then
  get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
  if v_state = 'QA001' then raise; end if;
  perform pg_temp.qa_root();
  if v_state <> p_code then perform pg_temp.qa_fail(format('%s — code %s (%s) au lieu de %s', p_label, v_state, left(v_msg,90), p_code)); end if;
  perform pg_temp.qa_note(format('PASS refus %s (%s)', p_label, v_state));
  return;
 end;
 perform pg_temp.qa_root();
 perform pg_temp.qa_fail(p_label||' — succès inattendu');
end $$;

-- ---------------------------------------------------------------------------------------------
-- 2. Cohorte synthétique (gen_random_uuid, étiquette de run, e-mails example.invalid).
-- ---------------------------------------------------------------------------------------------
do $$
declare run text := left(md5(random()::text||clock_timestamp()::text),8); r record; v_id uuid; n integer;
 admins_before integer;
begin
 perform pg_temp.qa_set('run', run);
 select count(*) into admins_before from public.profiles where role='admin';
 perform pg_temp.qa_set('admins_before', admins_before::text);
 for r in select * from (values
  ('client','client'),('other','client'),('manager','manager'),('viewer','manager'),('delegate','manager'),('otherOwner','manager'),
  ('artisan','artisan'),('otherArtisan','artisan'),('admin','client'),('finRead','client'),('finWrite','client'),('moderator','client'),('auditor','client')) t(k,role) loop
  v_id := gen_random_uuid();
  insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
  values(v_id,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',format('qa-rb-%s-%s@example.invalid',run,lower(r.k)),
   'qa-rb-unusable-'||md5(v_id::text),now(),'{"provider":"email","providers":["email"]}'::jsonb,
   jsonb_build_object('role',r.role,'full_name',format('QA %s %s',r.k,run)),now(),now());
  perform pg_temp.qa_set(r.k, v_id::text);
 end loop;
 select count(*) into n from public.profiles p where p.id in (select val::uuid from qa_ctx where key not in ('run','admins_before'));
 perform pg_temp.qa_check(n=13, 'cohorte : 13 comptes auth.users créés et 13 profils dérivés par le trigger');
 -- Super admin TEMPORAIRE : promotion directe du seul profil QA « admin » (annulée par le rollback).
 update public.profiles set role='admin' where id=pg_temp.qa_id('admin');
 perform pg_temp.qa_check((select role from public.profiles where id=pg_temp.qa_id('admin'))='admin', 'super admin temporaire QA promu (profil QA uniquement)');
 perform pg_temp.qa_note(format('run %s ; admins avant recette : %s', run, admins_before));
end $$;

-- Artisans QA approuvés par le super admin temporaire (SIRET synthétiques dérivés du run).
do $$
declare a text; k text; siret text; i integer := 0;
begin
 foreach k in array array['artisan','otherArtisan'] loop
  i := i+1;
  siret := lpad(((('x'||left(md5(pg_temp.qa_get('run')||k),12))::bit(48)::bigint) % 10000000000000)::text, 14, '7');
  perform pg_temp.qa_set(k||'_siret', siret);
  perform pg_temp.qa_call(pg_temp.qa_id(k),'authenticated',format($q$select public.save_artisan_profile('Entreprise QA %s',%L,'EI',0,'12 rue du Test QA',array['97200'],array['panel']) v$q$, i, siret));
  perform pg_temp.qa_call(pg_temp.qa_id(k),'authenticated','select public.submit_artisan_application() v');
  perform pg_temp.qa_exec(pg_temp.qa_id('admin'),'authenticated',format('select public.approve_artisan(%L,true)', pg_temp.qa_id(k)));
  perform pg_temp.qa_call(pg_temp.qa_id(k),'authenticated','select public.set_artisan_availability(true) v');
 end loop;
 perform pg_temp.qa_check((select count(*) from public.profiles where id in (pg_temp.qa_id('artisan'),pg_temp.qa_id('otherArtisan')) and artisan_approved)=2, 'artisans QA approuvés par le super admin temporaire');
end $$;

-- ---------------------------------------------------------------------------------------------
-- 3. 014 — scopes opérateur explicites, audit, révocation, garde du dernier super admin, paramètres.
-- ---------------------------------------------------------------------------------------------
do $$
declare v jsonb; g uuid; cohort uuid[]; n integer; k text;
begin
 perform pg_temp.qa_reset_limits();
 select array_agg(val::uuid) into cohort from qa_ctx where key not in ('run','admins_before') and key not like '%_siret';
 v := pg_temp.qa_call(pg_temp.qa_id('finRead'),'authenticated','select public.platform_access() v');
 perform pg_temp.qa_check((v->>'super_admin')::boolean=false and v->'scopes'='[]'::jsonb, '014 platform_access sans scope : super_admin=false, scopes=[]');
 foreach k in array array['client','manager','artisan','finRead'] loop
  perform pg_temp.qa_refused(pg_temp.qa_id(k),'authenticated',format('select public.platform_grant_scope(%L,%L,%L)',pg_temp.qa_id('finWrite'),'finance_write',''),'42501','014 grant par '||k||' (sans rôle admin)');
 end loop;
 perform pg_temp.qa_refused(pg_temp.qa_id('admin'),'authenticated',format('select public.platform_grant_scope(%L,%L,%L)',pg_temp.qa_id('admin'),'finance_read',''),'P0001','014 grant à un super admin (scopes implicites)');
 perform pg_temp.qa_refused(pg_temp.qa_id('admin'),'authenticated',format('select public.platform_grant_scope(%L,%L,%L)',pg_temp.qa_id('finRead'),'support',''),'22023','014 scope inconnu');
 v := pg_temp.qa_call(pg_temp.qa_id('admin'),'authenticated',format('select public.platform_grant_scope(%L,%L,%L) v',pg_temp.qa_id('finRead'),'finance_read','lecture finance QA'));
 perform pg_temp.qa_check((v->>'replayed')::boolean=false and v->'grant'->>'status'='active', '014 grant finance_read à finRead');
 g := (v->'grant'->>'id')::uuid; perform pg_temp.qa_set('grant_finRead', g::text);
 v := pg_temp.qa_call(pg_temp.qa_id('admin'),'authenticated',format('select public.platform_grant_scope(%L,%L,%L) v',pg_temp.qa_id('finRead'),'finance_read','rejeu'));
 perform pg_temp.qa_check((v->>'replayed')::boolean=true, '014 rejeu d’un grant actif → replayed=true');
 perform pg_temp.qa_call(pg_temp.qa_id('admin'),'authenticated',format('select public.platform_grant_scope(%L,%L,%L) v',pg_temp.qa_id('finWrite'),'finance_read',''));
 perform pg_temp.qa_call(pg_temp.qa_id('admin'),'authenticated',format('select public.platform_grant_scope(%L,%L,%L) v',pg_temp.qa_id('finWrite'),'finance_write',''));
 perform pg_temp.qa_call(pg_temp.qa_id('admin'),'authenticated',format('select public.platform_grant_scope(%L,%L,%L) v',pg_temp.qa_id('moderator'),'reviews_moderate',''));
 perform pg_temp.qa_call(pg_temp.qa_id('admin'),'authenticated',format('select public.platform_grant_scope(%L,%L,%L) v',pg_temp.qa_id('auditor'),'audit_read',''));
 v := pg_temp.qa_call(pg_temp.qa_id('finWrite'),'authenticated','select public.platform_access() v');
 perform pg_temp.qa_check(v->'scopes'='["finance_read","finance_write"]'::jsonb and (v->>'super_admin')::boolean=false, '014 platform_access finWrite : deux scopes, pas super admin');
 perform pg_temp.qa_check((pg_temp.qa_call(pg_temp.qa_id('finRead'),'authenticated',$q$select public.has_platform_scope('finance_read') v$q$))::text='true', '014 has_platform_scope finance_read (finRead)');
 perform pg_temp.qa_check((pg_temp.qa_call(pg_temp.qa_id('finRead'),'authenticated',$q$select public.has_platform_scope('finance_write') v$q$))::text='false', '014 has_platform_scope finance_write refusé à finRead');
 perform pg_temp.qa_check((pg_temp.qa_call(pg_temp.qa_id('admin'),'authenticated',$q$select public.has_platform_scope('finance_write') v$q$))::text='true', '014 super admin : scope implicite');
 perform pg_temp.qa_check((pg_temp.qa_call(pg_temp.qa_id('finRead'),'authenticated',format('select count(*) v from public.platform_operator_grants where user_id = any(%L::uuid[])',cohort)))::text='1', '014 RLS grants : finRead ne lit que le sien');
 perform pg_temp.qa_check((pg_temp.qa_call(pg_temp.qa_id('client'),'authenticated','select count(*) v from public.platform_operator_grants'))::text='0', '014 RLS grants : client ne lit rien');
 perform pg_temp.qa_check((pg_temp.qa_call(pg_temp.qa_id('admin'),'authenticated',format('select count(*) v from public.platform_operator_grants where user_id = any(%L::uuid[])',cohort)))::text='5', '014 RLS grants : super admin lit les 5 grants QA');
 perform pg_temp.qa_refused(pg_temp.qa_id('finRead'),'authenticated',format('delete from public.platform_operator_grants where id=%L',g),'42501','014 delete grant par opérateur');
 perform pg_temp.qa_refused(pg_temp.qa_id('admin'),'authenticated',format($q$update public.platform_operator_grants set scope='finance_write' where id=%L$q$,g),'42501','014 update grant par super admin');
 perform pg_temp.qa_refused(null,'service_role',format($q$update public.platform_operator_grants set scope='finance_write' where id=%L$q$,g),'P0001','014 update grant par service_role (historique immuable)');
 perform pg_temp.qa_refused(null,'service_role',format('delete from public.platform_operator_grants where id=%L',g),'42501','014 delete grant par service_role');
 -- Audit : audit_read seulement, immuable.
 perform pg_temp.qa_check((pg_temp.qa_call(pg_temp.qa_id('auditor'),'authenticated',format('select count(*) v from public.platform_audit where actor_id = any(%L::uuid[])',cohort)))::int=5, '014 audit : 5 entrées QA lisibles par audit_read');
 perform pg_temp.qa_check((pg_temp.qa_call(pg_temp.qa_id('finRead'),'authenticated','select count(*) v from public.platform_audit'))::int=0, '014 audit : invisible sans audit_read');
 perform pg_temp.qa_check((pg_temp.qa_call(pg_temp.qa_id('client'),'authenticated','select count(*) v from public.platform_audit'))::int=0, '014 audit : invisible au client');
 foreach k in array array['auditor','admin'] loop
  perform pg_temp.qa_refused(pg_temp.qa_id(k),'authenticated',format($q$update public.platform_audit set action='x' where actor_id=%L$q$,pg_temp.qa_id('admin')),'42501','014 audit update par '||k);
  perform pg_temp.qa_refused(pg_temp.qa_id(k),'authenticated',format('delete from public.platform_audit where actor_id=%L',pg_temp.qa_id('admin')),'42501','014 audit delete par '||k);
 end loop;
 perform pg_temp.qa_refused(null,'service_role',format($q$update public.platform_audit set action='tamper' where actor_id=%L$q$,pg_temp.qa_id('admin')),'42501','014 audit update par service_role');
 begin
  update public.platform_audit set action='tamper' where actor_id=pg_temp.qa_id('admin');
  perform pg_temp.qa_fail('014 audit : update racine d’une ligne QA accepté');
 exception when sqlstate 'P0001' then perform pg_temp.qa_note('PASS refus 014 audit update racine (ligne QA) (P0001)'); end;
 begin
  delete from public.platform_audit where actor_id=pg_temp.qa_id('admin');
  perform pg_temp.qa_fail('014 audit : delete racine d’une ligne QA accepté');
 exception when sqlstate 'P0001' then perform pg_temp.qa_note('PASS refus 014 audit delete racine (ligne QA) (P0001)'); end;
 -- Révocation immédiate, historique conservé.
 v := pg_temp.qa_call(pg_temp.qa_id('admin'),'authenticated',format('select public.platform_revoke_scope(%L,%L) v',g,'fin de mission QA'));
 perform pg_temp.qa_check(v->'grant'->>'status'='revoked' and v->'grant'->>'revoked_by'=pg_temp.qa_id('admin')::text, '014 révocation du grant finRead');
 perform pg_temp.qa_check(((pg_temp.qa_call(pg_temp.qa_id('admin'),'authenticated',format('select public.platform_revoke_scope(%L,%L) v',g,'')))->>'replayed')::boolean=true, '014 rejeu de révocation → replayed=true');
 perform pg_temp.qa_check((pg_temp.qa_call(pg_temp.qa_id('finRead'),'authenticated',$q$select public.has_platform_scope('finance_read') v$q$))::text='false', '014 scope fermé immédiatement');
 perform pg_temp.qa_check((pg_temp.qa_call(pg_temp.qa_id('finRead'),'authenticated',format('select count(*) v from public.platform_operator_grants where user_id=%L',pg_temp.qa_id('finRead'))))::int=1, '014 historique du grant révoqué conservé');
 perform pg_temp.qa_refused(pg_temp.qa_id('finRead'),'authenticated','select public.platform_finance_report()','42501','014 rapport finance après révocation');
 perform pg_temp.qa_refused(pg_temp.qa_id('finRead'),'authenticated',format('select public.platform_revoke_scope(%L,%L)',g,''),'42501','014 révocation par un opérateur');
 -- Garde du dernier super admin (jamais contournée) : auto-modification refusée ; démotion directe du profil QA.
 perform pg_temp.qa_refused(pg_temp.qa_id('admin'),'authenticated',format($q$select public.platform_set_super_admin(%L,false,'client','')$q$,pg_temp.qa_id('admin')),'P0001','014 super admin ne change pas son propre statut');
 perform pg_temp.qa_refused(pg_temp.qa_id('admin'),'authenticated',format($q$select public.platform_set_super_admin(%L,true,'client','')$q$,pg_temp.qa_id('artisan')),'P0001','014 un artisan ne devient pas super admin');
 perform pg_temp.qa_refused(pg_temp.qa_id('finWrite'),'authenticated',format($q$select public.platform_set_super_admin(%L,true,'client','')$q$,pg_temp.qa_id('finRead')),'42501','014 set_super_admin par un opérateur');
 select count(*) into n from public.profiles where role='admin';
 if n = 1 then
  begin
   update public.profiles set role='client' where id=pg_temp.qa_id('admin');
   perform pg_temp.qa_fail('014 démotion directe du dernier super admin acceptée');
  exception when sqlstate 'P0001' then perform pg_temp.qa_note('PASS refus 014 démotion directe du dernier super admin (profil QA, seul admin) (P0001)'); end;
  begin
   delete from auth.users where id=pg_temp.qa_id('admin');
   perform pg_temp.qa_fail('014 suppression auth du dernier super admin acceptée');
  exception when sqlstate 'P0001' then perform pg_temp.qa_note('PASS refus 014 suppression auth.users du dernier super admin (cascade) (P0001)'); end;
 else
  update public.profiles set role='client' where id=pg_temp.qa_id('admin');
  perform pg_temp.qa_check((select role from public.profiles where id=pg_temp.qa_id('admin'))='client', format('014 démotion du super admin QA acceptée (%s autres admins présents, aucun touché)', n-1));
  update public.profiles set role='admin' where id=pg_temp.qa_id('admin');
 end if;
 perform pg_temp.qa_check((select role from public.profiles where id=pg_temp.qa_id('admin'))='admin', '014 super admin temporaire toujours en place pour la suite');
 -- Paramètres plateforme : lus s'ils existent, créés seulement s'ils manquent ; refus sans modification.
 foreach k in array array['finWrite','client'] loop
  perform pg_temp.qa_refused(pg_temp.qa_id(k),'authenticated',$q$select public.platform_set_setting('commission_bps','{"bps":1500}'::jsonb,null)$q$,'42501','014 paramètre par '||k);
 end loop;
 perform pg_temp.qa_refused(pg_temp.qa_id('admin'),'authenticated',$q$select public.platform_set_setting('commission_bps','{"bps":10001}'::jsonb,null)$q$,'22023','014 commission_bps hors bornes');
 perform pg_temp.qa_refused(pg_temp.qa_id('admin'),'authenticated',$q$select public.platform_set_setting('commission_bps','{"bps":15,"extra":1}'::jsonb,null)$q$,'22023','014 commission_bps clé inattendue');
 perform pg_temp.qa_refused(pg_temp.qa_id('admin'),'authenticated',$q$select public.platform_set_setting('other','{}'::jsonb,null)$q$,'22023','014 paramètre inconnu');
 perform pg_temp.qa_refused(pg_temp.qa_id('admin'),'authenticated',$q$select public.platform_set_setting('invoice_issuer','{"legal_name":"Plateforme QA","siret":"123","address":"1 rue du Test","vat_number":null,"commission_vat_rate":null}'::jsonb,null)$q$,'22023','014 émetteur SIRET invalide');
 if (select key from public.platform_commission_setting()) is null then
  v := pg_temp.qa_call(pg_temp.qa_id('admin'),'authenticated',$q$select public.platform_set_setting('commission_bps','{"bps":1000}'::jsonb,null) v$q$);
  perform pg_temp.qa_check((v->'setting'->>'version')::int=1, '014 commission_bps absent : créé à 1000 bps (version 1, annulé au rollback)');
  perform pg_temp.qa_refused(pg_temp.qa_id('admin'),'authenticated',$q$select public.platform_set_setting('commission_bps','{"bps":1000}'::jsonb,null)$q$,'P0001','014 réécriture sans version attendue');
  perform pg_temp.qa_set('commission_origin','QA');
 else
  perform pg_temp.qa_note(format('014 commission_bps existant lu (%s bps, version %s) : non modifié', (select value->>'bps' from public.platform_commission_setting()), (select version from public.platform_commission_setting())));
  perform pg_temp.qa_refused(pg_temp.qa_id('admin'),'authenticated',format($q$select public.platform_set_setting('commission_bps',%L::jsonb,%s)$q$, (select value::text from public.platform_commission_setting()), (select version+1 from public.platform_commission_setting())),'P0001','014 version obsolète sur le paramètre existant (non modifié)');
  perform pg_temp.qa_set('commission_origin','réel');
 end if;
 perform pg_temp.qa_set('bps', (select value->>'bps' from public.platform_commission_setting()));
 perform pg_temp.qa_set('bps_version', (select version::text from public.platform_commission_setting()));
 perform pg_temp.qa_check((pg_temp.qa_call(pg_temp.qa_id('finRead'),'authenticated','select count(*) v from public.platform_settings'))::int=0, '014 paramètres invisibles sans finance_read');
 perform pg_temp.qa_check((pg_temp.qa_call(pg_temp.qa_id('finWrite'),'authenticated','select count(*) v from public.platform_settings'))::int>=1, '014 paramètres visibles avec finance_read');
end $$;

-- ---------------------------------------------------------------------------------------------
-- 4. Flux métier réels jusqu'au paiement réglé (paiements QA simulés : aucun fournisseur appelé).
-- ---------------------------------------------------------------------------------------------
do $$
declare run text := pg_temp.qa_get('run'); v jsonb; job uuid; quote uuid; total integer; pay uuid; n integer := 0; k text; lines text; report jsonb;
begin
 perform pg_temp.qa_reset_limits();
 report := pg_temp.qa_call(pg_temp.qa_id('finWrite'),'authenticated','select public.platform_finance_report() v');
 perform pg_temp.qa_set('missing_before', report->'ledger'->>'missing_settlement');
 perform pg_temp.qa_set('paid_count_before', report->'payments'->>'paid_count');
 perform pg_temp.qa_set('paid_cents_before', report->'payments'->>'paid_cents');
 perform pg_temp.qa_note(format('état réel avant paiements QA : %s paiement(s) réglé(s), %s non rapproché(s) (lecture seule)', report->'payments'->>'paid_count', report->'ledger'->>'missing_settlement'));
 foreach k in array array['A','C','D'] loop
  n := n+1;
  lines := case when k='A' then '[{"label":"Remplacement disjoncteur","quantity":1,"unit_price_cents":15000},{"label":"Main d’œuvre","quantity":2,"unit_price_cents":5000}]'
                else '[{"label":"Fourniture","quantity":1,"unit_price_cents":83}]' end;
  v := pg_temp.qa_call(pg_temp.qa_id('client'),'authenticated',$q$select to_jsonb(r) v from public.create_intervention('panel','QA rollback : panne du tableau principal.','12 rue du Test QA','97200','Fort-de-France','scheduled',null) r$q$);
  job := (v->>'id')::uuid; perform pg_temp.qa_set('job'||k, job::text);
  perform pg_temp.qa_exec(pg_temp.qa_id('artisan'),'authenticated',format($q$select public.intervention_action(%L,'accept_mission')$q$,job));
  perform pg_temp.qa_exec(pg_temp.qa_id('artisan'),'authenticated',format($q$select public.intervention_action(%L,'send_quote',%L::jsonb,20)$q$,job,lines));
  select id,total_cents into quote,total from public.quotes where intervention_id=job and status='sent';
  perform pg_temp.qa_set('quote'||k, quote::text); perform pg_temp.qa_set('total'||k, total::text);
  perform pg_temp.qa_exec(pg_temp.qa_id('client'),'authenticated',format($q$select public.intervention_action(%L,'accept_quote',null,20,%L)$q$,job,quote));
  perform pg_temp.qa_exec(pg_temp.qa_id('artisan'),'authenticated',format($q$select public.intervention_action(%L,'start')$q$,job));
  perform pg_temp.qa_exec(pg_temp.qa_id('artisan'),'authenticated',format($q$select public.intervention_action(%L,'complete')$q$,job));
  perform pg_temp.qa_exec(null,'service_role',format($q$insert into public.payments(quote_id,session_id,total_cents,currency,status) values(%L,%L,%s,'eur','pending')$q$,quote,'cs_qa_'||run||'_'||n,total));
  v := pg_temp.qa_call(null,'service_role',format($q$select public.confirm_stripe_payment(%L,'checkout.session.completed',%L,%L,%s,'eur') v$q$,'evt_qa_'||run||'_'||n,'cs_qa_'||run||'_'||n,quote,total));
  perform pg_temp.qa_check(v::text='true', format('flux réel dossier %s : devis %s ct accepté, démarré, terminé, paiement QA %s réglé (événement fournisseur SIMULÉ)', k, total, 'cs_qa_'||run||'_'||n));
  select id into pay from public.payments where quote_id=quote and status='paid' and total_cents=total;
  perform pg_temp.qa_check(pay is not null, 'paiement QA '||k||' marqué paid au montant du devis');
  perform pg_temp.qa_set('pay'||k, pay::text); perform pg_temp.qa_set('session'||k, 'cs_qa_'||run||'_'||n);
 end loop;
 perform pg_temp.qa_check(pg_temp.qa_get('totalA')='30000' and pg_temp.qa_get('totalC')='100' and (select tax_cents from public.quotes where id=pg_temp.qa_id('quoteC'))=17, 'montants calculés par la base : A=30000 ct ; C=100 ct dont TVA 17');
 report := pg_temp.qa_call(pg_temp.qa_id('finWrite'),'authenticated','select public.platform_finance_report() v');
 perform pg_temp.qa_check((report->'payments'->>'paid_count')::int = pg_temp.qa_get('paid_count_before')::int + 3 and (report->'payments'->>'paid_cents')::bigint = pg_temp.qa_get('paid_cents_before')::bigint + 30200, '014 rapport finance en delta : +3 paiements, +30200 ct');
end $$;

-- ---------------------------------------------------------------------------------------------
-- 5. 014 — ledger idempotent, commission estimée vs retenue, immuabilité, rapport.
-- ---------------------------------------------------------------------------------------------
do $$
declare v jsonb; bps integer := pg_temp.qa_get('bps')::int; fee integer; missing integer := pg_temp.qa_get('missing_before')::int; lim integer; payA uuid := pg_temp.qa_id('payA'); n integer; k text;
begin
 perform pg_temp.qa_reset_limits();
 perform pg_temp.qa_refused(pg_temp.qa_id('finRead'),'authenticated','select public.platform_reconcile(100)','42501','014 rapprochement sans finance_write');
 perform pg_temp.qa_refused(pg_temp.qa_id('client'),'authenticated','select public.platform_reconcile(100)','42501','014 rapprochement par un client');
 perform pg_temp.qa_refused(pg_temp.qa_id('finWrite'),'authenticated','select public.platform_reconcile(0)','22023','014 rapprochement limite invalide');
 lim := missing + 3;
 if lim > 500 then perform pg_temp.qa_fail(format('environnement non rapprochable : %s paiements réels non rapprochés (+3 QA) dépassent la limite 500 ; critère ledger non testé', missing)); end if;
 v := pg_temp.qa_call(pg_temp.qa_id('finWrite'),'authenticated',format('select public.platform_reconcile(%s) v',lim));
 perform pg_temp.qa_check((v->>'settled_added')::int >= 3 and (v->>'remaining_unsettled')::int = 0 and (v->>'commission_bps')::int = bps, format('014 rapprochement (limite %s) : +%s réglés dont 3 QA, 0 restant, taux %s bps version %s', lim, v->>'settled_added', bps, v->>'setting_version'));
 fee := round(30000::numeric*bps/10000);
 perform pg_temp.qa_check((select count(*) from public.platform_ledger_entries where payment_id=payA and entry_kind='payment_settled' and amount_cents=30000 and direction='credit' and external_event_id=pg_temp.qa_get('sessionA'))=1, '014 ledger : payment_settled QA A (30000, session QA)');
 if fee > 0 then
  perform pg_temp.qa_check((select count(*) from public.platform_ledger_entries where payment_id=payA and entry_kind='commission_estimated' and amount_cents=fee and direction='debit' and (basis->>'bps')::int=bps and basis->>'rate_source'='platform_setting')=1, format('014 ledger : commission_estimated QA A = %s ct (basis taux persistant)', fee));
 else
  perform pg_temp.qa_note('014 taux de commission 0 bps : aucune commission estimée attendue');
 end if;
 select count(*) into n from public.platform_ledger_entries where payment_id in (pg_temp.qa_id('payA'),pg_temp.qa_id('payC'),pg_temp.qa_id('payD'));
 v := pg_temp.qa_call(pg_temp.qa_id('finWrite'),'authenticated',format('select public.platform_reconcile(%s) v',lim));
 perform pg_temp.qa_check((select count(*) from public.platform_ledger_entries where payment_id in (pg_temp.qa_id('payA'),pg_temp.qa_id('payC'),pg_temp.qa_id('payD')))=n, '014 rapprochement rejoué : aucune entrée ajoutée pour les paiements QA (idempotent)');
 perform pg_temp.qa_check((pg_temp.qa_call(pg_temp.qa_id('finRead'),'authenticated','select count(*) v from public.platform_ledger_entries'))::int=0, '014 ledger invisible sans scope actif');
 perform pg_temp.qa_check((pg_temp.qa_call(pg_temp.qa_id('finWrite'),'authenticated',format('select count(*) v from public.platform_ledger_entries where payment_id=%L',payA)))::int>=1, '014 ledger lisible par finance_write');
 foreach k in array array['finWrite','admin'] loop
  perform pg_temp.qa_refused(pg_temp.qa_id(k),'authenticated',format('update public.platform_ledger_entries set amount_cents=1 where payment_id=%L',payA),'42501','014 ledger update par '||k);
  perform pg_temp.qa_refused(pg_temp.qa_id(k),'authenticated',format('delete from public.platform_ledger_entries where payment_id=%L',payA),'42501','014 ledger delete par '||k);
 end loop;
 perform pg_temp.qa_refused(null,'service_role',format('update public.platform_ledger_entries set amount_cents=1 where payment_id=%L',payA),'42501','014 ledger update par service_role');
 begin
  update public.platform_ledger_entries set amount_cents=1 where payment_id=payA;
  perform pg_temp.qa_fail('014 ledger : update racine accepté');
 exception when sqlstate 'P0001' then perform pg_temp.qa_note('PASS refus 014 ledger update racine (entrée QA) (P0001)'); end;
 -- Commission retenue : service seulement, résultat fournisseur vérifié (SIMULÉ ici).
 fee := greatest(fee,1); perform pg_temp.qa_set('withheldA', fee::text);
 perform pg_temp.qa_refused(pg_temp.qa_id('finWrite'),'authenticated',format($q$select public.platform_record_commission_withheld(%L,%L,'application_fee.created',%L,'fee_qa_1','succeeded',%s,'eur')$q$,payA,'evt_qa_fee_'||pg_temp.qa_get('run'),pg_temp.qa_get('sessionA'),fee),'42501','014 commission retenue par un opérateur');
 perform pg_temp.qa_refused(pg_temp.qa_id('admin'),'authenticated',format($q$select public.platform_record_commission_withheld(%L,%L,'application_fee.created',%L,'fee_qa_1','succeeded',%s,'eur')$q$,payA,'evt_qa_fee_'||pg_temp.qa_get('run'),pg_temp.qa_get('sessionA'),fee),'42501','014 commission retenue par un super admin');
 perform pg_temp.qa_refused(null,'service_role',format($q$select public.platform_record_commission_withheld(%L,%L,'application_fee.created',%L,'fee_qa_1','pending',%s,'eur')$q$,payA,'evt_qa_fee_'||pg_temp.qa_get('run'),pg_temp.qa_get('sessionA'),fee),'P0001','014 commission retenue statut fournisseur non succeeded');
 perform pg_temp.qa_refused(null,'service_role',format($q$select public.platform_record_commission_withheld(%L,%L,'application_fee.created','cs_qa_wrong','fee_qa_1','succeeded',%s,'eur')$q$,payA,'evt_qa_fee_'||pg_temp.qa_get('run'),fee),'P0001','014 commission retenue session incohérente');
 perform pg_temp.qa_refused(null,'service_role',format($q$select public.platform_record_commission_withheld(%L,%L,'application_fee.created',%L,'fee_qa_1','succeeded',30001,'eur')$q$,payA,'evt_qa_fee_'||pg_temp.qa_get('run'),pg_temp.qa_get('sessionA')),'P0001','014 commission retenue supérieure au paiement');
 perform pg_temp.qa_refused(null,'service_role',format($q$select public.platform_record_commission_withheld(%L,%L,'application_fee.created',%L,'fee_qa_1','succeeded',%s,'usd')$q$,payA,'evt_qa_fee_'||pg_temp.qa_get('run'),pg_temp.qa_get('sessionA'),fee),'22023','014 commission retenue devise non eur');
 perform pg_temp.qa_check((select count(*) from public.stripe_events where id='evt_qa_fee_'||pg_temp.qa_get('run'))=0, '014 aucun événement enregistré par les tentatives refusées');
 v := pg_temp.qa_call(null,'service_role',format($q$select public.platform_record_commission_withheld(%L,%L,'application_fee.created',%L,'fee_qa_1','succeeded',%s,'eur') v$q$,payA,'evt_qa_fee_'||pg_temp.qa_get('run'),pg_temp.qa_get('sessionA'),fee));
 perform pg_temp.qa_check(v::text='true', format('014 commission retenue QA A enregistrée (%s ct, événement simulé)', fee));
 v := pg_temp.qa_call(null,'service_role',format($q$select public.platform_record_commission_withheld(%L,%L,'application_fee.created',%L,'fee_qa_1','succeeded',%s,'eur') v$q$,payA,'evt_qa_fee_'||pg_temp.qa_get('run'),pg_temp.qa_get('sessionA'),fee));
 perform pg_temp.qa_check(v::text='false', '014 commission retenue rejouée → false (une seule fois)');
 perform pg_temp.qa_refused(null,'service_role',format($q$select public.platform_record_commission_withheld(%L,%L,'application_fee.created',%L,'fee_qa_1','succeeded',%s,'eur')$q$,payA,'evt_qa_fee2_'||pg_temp.qa_get('run'),pg_temp.qa_get('sessionA'),fee),'P0001','014 seconde commission retenue sur le même paiement');
end $$;

-- ---------------------------------------------------------------------------------------------
-- 6. 014 — remboursements plafonnés/idempotents/versionnés, règlement service vérifié, litiges.
-- ---------------------------------------------------------------------------------------------
do $$
declare run text := pg_temp.qa_get('run'); payA uuid := pg_temp.qa_id('payA'); payC uuid := pg_temp.qa_id('payC'); sess text := pg_temp.qa_get('sessionA');
 r1 uuid := gen_random_uuid(); r2 uuid := gen_random_uuid(); r3 uuid := gen_random_uuid(); r4 uuid := gen_random_uuid(); r5 uuid := gen_random_uuid(); r6 uuid := gen_random_uuid(); d1 uuid := gen_random_uuid();
 v jsonb; rr uuid; second uuid; third uuid; foreign_req uuid; dispute uuid;
 execution_id uuid := gen_random_uuid();
 charge_id text := 'ch_qa_'||run;
 intent_id text := 'pi_qa_'||run;
 refund_event text := 'evt_qa_rf_'||run;
 refund_id text := 're_qa_1';
 operator_id uuid := pg_temp.qa_id('finWrite');
 test_policy jsonb := '{"version":"qa-rollback-v1","reverse_transfer":true,"refund_application_fee":false,"livemode":false}';
begin
 perform pg_temp.qa_reset_limits();
 perform pg_temp.qa_refused(pg_temp.qa_id('finRead'),'authenticated',format($q$select public.platform_request_refund(%L,%L,5000,'Prestation partiellement non réalisée (QA).')$q$,r1,payA),'42501','014 remboursement demandé sans finance_write');
 perform pg_temp.qa_refused(pg_temp.qa_id('client'),'authenticated',format($q$select public.platform_request_refund(%L,%L,5000,'Prestation partiellement non réalisée (QA).')$q$,r1,payA),'42501','014 remboursement demandé par un client');
 v := pg_temp.qa_call(pg_temp.qa_id('finWrite'),'authenticated',format($q$select public.platform_request_refund(%L,%L,5000,'Prestation partiellement non réalisée (QA).') v$q$,r1,payA));
 perform pg_temp.qa_check(v->'request'->>'status'='requested' and (v->>'replayed')::boolean=false, '014 demande de remboursement 5000 ct créée');
 rr := (v->'request'->>'id')::uuid;
 perform pg_temp.qa_check(((pg_temp.qa_call(pg_temp.qa_id('finWrite'),'authenticated',format($q$select public.platform_request_refund(%L,%L,5000,'Prestation partiellement non réalisée (QA).') v$q$,r1,payA)))->>'replayed')::boolean=true, '014 demande rejouée (même request_id, même contenu) → replayed');
 perform pg_temp.qa_refused(pg_temp.qa_id('finWrite'),'authenticated',format($q$select public.platform_request_refund(%L,%L,6000,'Prestation partiellement non réalisée (QA).')$q$,r1,payA),'P0001','014 même request_id, contenu différent');
 perform pg_temp.qa_refused(pg_temp.qa_id('finWrite'),'authenticated',format($q$select public.platform_request_refund(%L,%L,25001,'Dépassement du montant réglé (QA).')$q$,r2,payA),'P0001','014 remboursement au-delà du montant réglé');
 perform pg_temp.qa_refused(pg_temp.qa_id('finWrite'),'authenticated',format($q$select public.platform_request_refund(%L,%L,0,'Montant nul refusé ici (QA).')$q$,r2,payA),'22023','014 remboursement montant nul');
 v := pg_temp.qa_call(pg_temp.qa_id('finWrite'),'authenticated',format($q$select public.platform_request_refund(%L,%L,25000,'Solde complémentaire demandé (QA).') v$q$,r3,payA));
 second := (v->'request'->>'id')::uuid;
 perform pg_temp.qa_check((v->'request'->>'amount_cents')::int=25000, '014 seconde demande jusqu’au plafond (25000)');
 perform pg_temp.qa_refused(pg_temp.qa_id('finWrite'),'authenticated',format($q$select public.platform_request_refund(%L,%L,1,'Au-delà du total réglé (QA).')$q$,r4,payA),'P0001','014 plafond cumulé atteint');
 perform pg_temp.qa_refused(pg_temp.qa_id('finWrite'),'authenticated',format($q$select public.platform_decide_refund(%L,'approve',2,'')$q$,rr),'P0001','014 décision avec version obsolète');
 perform pg_temp.qa_refused(pg_temp.qa_id('finWrite'),'authenticated',format($q$select public.platform_decide_refund(%L,'reject',1,'court')$q$,rr),'22023','014 rejet avec note trop courte');
 perform pg_temp.qa_refused(pg_temp.qa_id('finRead'),'authenticated',format($q$select public.platform_decide_refund(%L,'approve',1,'')$q$,rr),'42501','014 décision sans finance_write');
 v := pg_temp.qa_call(pg_temp.qa_id('finWrite'),'authenticated',format($q$select public.platform_decide_refund(%L,'approve',1,'') v$q$,rr));
 perform pg_temp.qa_check(v->'request'->>'status'='approved' and (v->'request'->>'version')::int=2, '014 approbation versionnée (v2)');
 perform pg_temp.qa_refused(pg_temp.qa_id('finWrite'),'authenticated',format($q$select public.platform_decide_refund(%L,'approve',2,'')$q$,rr),'P0001','014 seconde approbation');
 perform pg_temp.qa_refused(pg_temp.qa_id('finWrite'),'authenticated',format($q$select public.platform_decide_refund(%L,'reject',2,'Rejet après approbation interdit')$q$,rr),'P0001','014 rejet après approbation');
 perform pg_temp.qa_check((select count(*) from public.platform_ledger_entries where payment_id=payA and entry_kind='refund_settled')=0, '014 « approuvé » n’est jamais « réglé » (aucune entrée ledger)');
 v := pg_temp.qa_call(pg_temp.qa_id('finWrite'),'authenticated',format($q$select public.platform_decide_refund(%L,'cancel',1,'Demande retirée (QA).') v$q$,second));
 perform pg_temp.qa_check(v->'request'->>'status'='cancelled', '014 annulation libère le montant');
 v := pg_temp.qa_call(pg_temp.qa_id('finWrite'),'authenticated',format($q$select public.platform_request_refund(%L,%L,25000,'Le montant redevient disponible après annulation (QA).') v$q$,r5,payA));
 third := (v->'request'->>'id')::uuid;
 perform pg_temp.qa_check(v->'request'->>'status'='requested', '014 nouvelle demande acceptée après annulation');
 -- Keep the service-only boundary and test the durable execution path with synthetic evidence.
 perform pg_temp.qa_refused(operator_id,'authenticated',format(
  'select public.platform_settle_refund(%L,%L,%L,%L,%L,%L,5000,%L)',
  rr,refund_event,'refund.updated',sess,refund_id,'succeeded','eur'),'42501','014 règlement de remboursement par un opérateur');
 perform pg_temp.qa_refused(pg_temp.qa_id('admin'),'authenticated',format(
  'select public.platform_settle_refund(%L,%L,%L,%L,%L,%L,5000,%L)',
  rr,refund_event,'refund.updated',sess,refund_id,'succeeded','eur'),'42501','014 règlement de remboursement par un super admin');
 perform pg_temp.qa_refused(null,'service_role',format(
  'select public.platform_settle_refund(%L,%L,%L,%L,%L,%L,5000,%L)',
  rr,refund_event,'refund.updated',sess,refund_id,'succeeded','eur'),'P0001','014 règlement sans exécution qualifiée');
 perform pg_temp.qa_refused(operator_id,'authenticated',format(
  'select public.begin_refund_execution(%L,%L,1)',third,gen_random_uuid()),'P0001','014 exécution d’une demande non approuvée');
 v := pg_temp.qa_call(operator_id,'authenticated',format(
  'select public.begin_refund_execution(%L,%L,2) v',rr,execution_id));
 perform pg_temp.qa_check(v #>> '{}' = execution_id::text, '014 identifiant durable préparé');
 perform pg_temp.qa_exec(null,'service_role',format(
  'select public.qualify_refund_execution(%L,%L,%L,%L,%L)',execution_id,operator_id,test_policy,charge_id,intent_id));
 perform pg_temp.qa_exec(operator_id,'authenticated',format(
  'select public.authorize_refund_execution(%L)',execution_id));
 perform pg_temp.qa_exec(null,'service_role',format(
  'select public.bind_refund_execution(%L,%L,%L,%L)',execution_id,operator_id,refund_id,'submitted'));
 perform pg_temp.qa_check((select status from public.platform_refund_requests where id=rr)='approved',
  '014 émission soumise sans confirmation bancaire');
 perform pg_temp.qa_refused(null,'service_role',format(
  'select public.apply_refund_execution_event(%L,%L,%L,%L,%L,%L,4999,%L,%L,false)',
  execution_id,refund_event,'refund.updated',refund_id,charge_id,intent_id,'eur','succeeded'),'P0001','014 règlement montant incohérent');
 perform pg_temp.qa_refused(null,'service_role',format(
  'select public.platform_settle_refund(%L,%L,%L,%L,%L,%L,5000,%L)',
  rr,refund_event,'refund.updated','cs_qa_wrong',refund_id,'succeeded','eur'),'P0001','014 règlement session incohérente');
 perform pg_temp.qa_check((select count(*) from public.stripe_events where id=refund_event)=0,
  '014 aucun événement enregistré par les règlements refusés');
 v := pg_temp.qa_call(null,'service_role',format(
  'select public.apply_refund_execution_event(%L,%L,%L,%L,%L,%L,5000,%L,%L,false) v',
  execution_id,'evt_qa_pending_'||run,'refund.updated',refund_id,charge_id,intent_id,'eur','pending'));
 perform pg_temp.qa_check(v->>'state'='pending' and (select status from public.platform_refund_requests where id=rr)='approved',
  '014 événement pending sans règlement');
 v := pg_temp.qa_call(null,'service_role',format(
  'select public.apply_refund_execution_event(%L,%L,%L,%L,%L,%L,5000,%L,%L,false) v',
  execution_id,refund_event,'refund.updated',refund_id,charge_id,intent_id,'eur','succeeded'));
 perform pg_temp.qa_check(v->>'state'='succeeded' and v->>'replayed'='false',
  '014 remboursement réglé par le service (événement simulé)');
 v := pg_temp.qa_call(null,'service_role',format(
  'select public.apply_refund_execution_event(%L,%L,%L,%L,%L,%L,5000,%L,%L,false) v',
  execution_id,refund_event,'refund.updated',refund_id,charge_id,intent_id,'eur','succeeded'));
 perform pg_temp.qa_check(v->>'state'='succeeded' and v->>'replayed'='true', '014 règlement rejoué sans double effet');
 perform pg_temp.qa_check((select status||'/'||settled_event_id||'/'||provider_reference from public.platform_refund_requests where id=rr)='settled/evt_qa_rf_'||run||'/re_qa_1', '014 demande settled avec événement et référence fournisseur');
 perform pg_temp.qa_check((select amount_cents from public.platform_ledger_entries where payment_id=payA and entry_kind='refund_settled')=5000, '014 ledger refund_settled 5000');
 perform pg_temp.qa_refused(pg_temp.qa_id('finWrite'),'authenticated',format('delete from public.platform_refund_requests where id=%L',rr),'42501','014 delete demande de remboursement');
 -- Litiges.
 perform pg_temp.qa_refused(pg_temp.qa_id('finRead'),'authenticated',format($q$select public.platform_open_dispute(%L,%L,'client','Contestation QA','Le client conteste une partie de la prestation.')$q$,d1,payA),'42501','014 litige ouvert sans finance_write');
 v := pg_temp.qa_call(pg_temp.qa_id('finWrite'),'authenticated',format($q$select public.platform_open_dispute(%L,%L,'client','Contestation QA','Le client conteste une partie de la prestation.') v$q$,d1,payA));
 dispute := (v->'dispute'->>'id')::uuid;
 perform pg_temp.qa_check(v->'dispute'->>'status'='open' and v->'dispute'->>'intervention_id'=pg_temp.qa_get('jobA'), '014 litige ouvert, lié au dossier du paiement');
 perform pg_temp.qa_check(((pg_temp.qa_call(pg_temp.qa_id('finWrite'),'authenticated',format($q$select public.platform_open_dispute(%L,%L,'client','Contestation QA','Le client conteste une partie de la prestation.') v$q$,d1,payA)))->>'replayed')::boolean=true, '014 litige rejoué → replayed');
 perform pg_temp.qa_refused(pg_temp.qa_id('finWrite'),'authenticated',format($q$select public.platform_open_dispute(%L,%L,'artisan','Contestation QA','Le client conteste une partie de la prestation.')$q$,d1,payA),'P0001','014 litige même request_id contenu différent');
 perform pg_temp.qa_refused(pg_temp.qa_id('finWrite'),'authenticated',format($q$select public.platform_decide_dispute(%L,'resolve',1,'Résolu sans examen','no_refund',null)$q$,dispute),'P0001','014 résolution directe sans examen');
 v := pg_temp.qa_call(pg_temp.qa_id('finWrite'),'authenticated',format($q$select public.platform_decide_dispute(%L,'review',1,'',null,null) v$q$,dispute));
 perform pg_temp.qa_check(v->'dispute'->>'status'='under_review', '014 litige en examen');
 perform pg_temp.qa_refused(pg_temp.qa_id('finWrite'),'authenticated',format($q$select public.platform_decide_dispute(%L,'resolve',2,'Note suffisante ici','refund_requested',null)$q$,dispute),'22023','014 résolution refund_requested sans demande');
 v := pg_temp.qa_call(pg_temp.qa_id('finWrite'),'authenticated',format($q$select public.platform_request_refund(%L,%L,10,'Demande sur un autre paiement (QA).') v$q$,r6,payC));
 foreign_req := (v->'request'->>'id')::uuid;
 perform pg_temp.qa_refused(pg_temp.qa_id('finWrite'),'authenticated',format($q$select public.platform_decide_dispute(%L,'resolve',2,'Note suffisante ici','refund_requested',%L)$q$,dispute,foreign_req),'P0001','014 demande de remboursement d’un autre paiement');
 v := pg_temp.qa_call(pg_temp.qa_id('finWrite'),'authenticated',format($q$select public.platform_decide_dispute(%L,'resolve',2,'Remboursement partiel demandé (QA).','refund_requested',%L) v$q$,dispute,third));
 perform pg_temp.qa_check(v->'dispute'->>'status'='resolved' and v->'dispute'->>'refund_request_id'=third::text, '014 litige résolu lié à la demande du même paiement');
 perform pg_temp.qa_refused(pg_temp.qa_id('finWrite'),'authenticated',format($q$select public.platform_decide_dispute(%L,'close',3,'',null,null)$q$,dispute),'P0001','014 clôture après résolution');
 v := pg_temp.qa_call(pg_temp.qa_id('finWrite'),'authenticated','select public.platform_finance_report() v');
 perform pg_temp.qa_check((v->'refund_requests'->'settled'->>'count')::int>=1 and (v->'refund_requests'->'cancelled'->>'count')::int>=1, '014 rapport finance : remboursements settled/cancelled comptés');
end $$;

-- ---------------------------------------------------------------------------------------------
-- 7. 014 — factures : readiness explicite, émission, avoirs plafonnés en cumul TTC/TVA, immuabilité.
-- ---------------------------------------------------------------------------------------------
do $$
declare payA uuid := pg_temp.qa_id('payA'); payC uuid := pg_temp.qa_id('payC'); payD uuid := pg_temp.qa_id('payD'); client uuid := pg_temp.qa_id('client');
 v jsonb; ready jsonb; inv uuid; cinv uuid; smallInv uuid; tinyInv uuid; yr text := extract(year from now())::text; withheld integer := pg_temp.qa_get('withheldA')::int;
 i1 uuid := gen_random_uuid(); i2 uuid := gen_random_uuid(); i3 uuid := gen_random_uuid(); i4 uuid := gen_random_uuid(); i5 uuid := gen_random_uuid();
 c1 uuid := gen_random_uuid(); c2 uuid := gen_random_uuid(); c3 uuid := gen_random_uuid(); c4 uuid := gen_random_uuid(); c5 uuid := gen_random_uuid(); c6 uuid := gen_random_uuid(); c7 uuid := gen_random_uuid();
 k integer; amt integer; taxsum integer := 0; issuer jsonb; vat numeric; tax_total integer := 0; note jsonb;
begin
 perform pg_temp.qa_reset_limits();
 perform pg_temp.qa_refused(client,'authenticated',format($q$select public.platform_invoice_readiness('service',%L)$q$,payA),'42501','014 readiness par un client');
 ready := pg_temp.qa_call(pg_temp.qa_id('finWrite'),'authenticated',format($q$select public.platform_invoice_readiness('service',%L) v$q$,payA));
 perform pg_temp.qa_check((ready->>'ready')::boolean=false and ready->'missing' ? 'billing_contact', '014 readiness service : données manquantes explicites (billing_contact)');
 perform pg_temp.qa_refused(pg_temp.qa_id('finWrite'),'authenticated',format($q$select public.platform_issue_invoice(%L,'service',%L)$q$,i1,payA),'P0001','014 émission tant que non prête');
 perform pg_temp.qa_refused(pg_temp.qa_id('finRead'),'authenticated',format($q$select public.platform_set_billing_contact('profile',%L,'Client QA','4 rue des Tests, 97200 Fort-de-France',null,null,null)$q$,client),'42501','014 contact de facturation sans finance_write');
 perform pg_temp.qa_refused(pg_temp.qa_id('finWrite'),'authenticated',format($q$select public.platform_set_billing_contact('profile',%L,'Client QA','4 rue des Tests, 97200 Fort-de-France','12',null,null)$q$,client),'22023','014 contact de facturation SIRET invalide');
 v := pg_temp.qa_call(pg_temp.qa_id('finWrite'),'authenticated',format($q$select public.platform_set_billing_contact('profile',%L,'Client QA','4 rue des Tests, 97200 Fort-de-France',null,null,null) v$q$,client));
 perform pg_temp.qa_check((v->'billing_contact'->>'version')::int=1, '014 contact de facturation du client QA (v1)');
 perform pg_temp.qa_refused(pg_temp.qa_id('finWrite'),'authenticated',format($q$select public.platform_set_billing_contact('profile',%L,'Client QA 2','4 rue des Tests, 97200 Fort-de-France',null,null,null)$q$,client),'P0001','014 réécriture du contact sans version');
 ready := pg_temp.qa_call(pg_temp.qa_id('finWrite'),'authenticated',format($q$select public.platform_invoice_readiness('service',%L) v$q$,payA));
 perform pg_temp.qa_check((ready->>'ready')::boolean=true and ready->'preview'->'recipient'->>'name'='Client QA' and (ready->'preview'->>'total_cents')::int=30000 and (ready->'preview'->>'tax_cents')::int=5000 and ready->'preview'->'issuer'->>'siret'=pg_temp.qa_get('artisan_siret'), '014 readiness service prête : destinataire, émetteur artisan QA, 30000/5000');
 update public.artisan_profiles set siret='' where user_id=pg_temp.qa_id('artisan');
 ready := pg_temp.qa_call(pg_temp.qa_id('finWrite'),'authenticated',format($q$select public.platform_invoice_readiness('service',%L) v$q$,payA));
 perform pg_temp.qa_check(ready->'missing'='["artisan_siret"]'::jsonb, '014 readiness : SIRET artisan manquant nommé');
 perform pg_temp.qa_refused(pg_temp.qa_id('finWrite'),'authenticated',format($q$select public.platform_issue_invoice(%L,'service',%L)$q$,i1,payA),'P0001','014 émission sans SIRET artisan');
 update public.artisan_profiles set siret=pg_temp.qa_get('artisan_siret') where user_id=pg_temp.qa_id('artisan');
 perform pg_temp.qa_refused(pg_temp.qa_id('finRead'),'authenticated',format($q$select public.platform_issue_invoice(%L,'service',%L)$q$,i1,payA),'42501','014 émission sans finance_write');
 v := pg_temp.qa_call(pg_temp.qa_id('finWrite'),'authenticated',format($q$select public.platform_issue_invoice(%L,'service',%L) v$q$,i1,payA));
 inv := (v->'invoice'->>'id')::uuid;
 perform pg_temp.qa_check(v->'invoice'->>'number'='F'||yr||'-000001' and v->'invoice'->>'issuer_key'='artisan:'||pg_temp.qa_id('artisan')::text and (v->'invoice'->>'total_cents')::int=30000, '014 facture de prestation F'||yr||'-000001 (compteur de l’émetteur QA)');
 perform pg_temp.qa_check(((pg_temp.qa_call(pg_temp.qa_id('finWrite'),'authenticated',format($q$select public.platform_issue_invoice(%L,'service',%L) v$q$,i1,payA)))->>'replayed')::boolean=true, '014 émission rejouée → replayed');
 perform pg_temp.qa_refused(pg_temp.qa_id('finWrite'),'authenticated',format($q$select public.platform_issue_invoice(%L,'service',%L)$q$,i1,payC),'P0001','014 même request_id autre paiement');
 perform pg_temp.qa_refused(pg_temp.qa_id('finWrite'),'authenticated',format($q$select public.platform_issue_invoice(%L,'service',%L)$q$,i2,payA),'P0001','014 seconde facture pour le même paiement');
 -- Facture de commission : émetteur plateforme lu s'il existe, créé sinon (QA) ; commission retenue requise.
 ready := pg_temp.qa_call(pg_temp.qa_id('finWrite'),'authenticated',format($q$select public.platform_invoice_readiness('platform_commission',%L) v$q$,payA));
 select value into issuer from public.platform_settings where key='invoice_issuer';
 if issuer is null then
  perform pg_temp.qa_check(ready->'missing' ? 'platform_issuer', '014 readiness commission : émetteur plateforme manquant nommé');
  perform pg_temp.qa_call(pg_temp.qa_id('admin'),'authenticated',$q$select public.platform_set_setting('invoice_issuer','{"legal_name":"Plateforme QA","siret":"98765432109876","address":"1 rue de la Plateforme, 97200 Fort-de-France","vat_number":"FR12345678901","commission_vat_rate":20}'::jsonb,null) v$q$);
  perform pg_temp.qa_note('014 émetteur plateforme absent : créé (QA, TVA 20, annulé au rollback)');
  vat := 20;
 else
  vat := (issuer->>'commission_vat_rate')::numeric;
  perform pg_temp.qa_note(format('014 émetteur plateforme existant lu (TVA commission %s) : non modifié', coalesce(vat::text,'absente')));
 end if;
 ready := pg_temp.qa_call(pg_temp.qa_id('finWrite'),'authenticated',format($q$select public.platform_invoice_readiness('platform_commission',%L) v$q$,payC));
 perform pg_temp.qa_check(ready->'missing' ? 'commission_not_confirmed', '014 readiness commission sans retenue confirmée : commission_not_confirmed');
 perform pg_temp.qa_refused(pg_temp.qa_id('finWrite'),'authenticated',format($q$select public.platform_issue_invoice(%L,'platform_commission',%L)$q$,i3,payC),'P0001','014 facture de commission sans retenue');
 ready := pg_temp.qa_call(pg_temp.qa_id('finWrite'),'authenticated',format($q$select public.platform_invoice_readiness('platform_commission',%L) v$q$,payA));
 if vat is null then
  perform pg_temp.qa_check(ready->'missing' ? 'platform_commission_vat_rate', '014 readiness commission : TVA commission absente du paramètre réel (facture de commission non émise, rapporté)');
 else
  perform pg_temp.qa_check((ready->>'ready')::boolean=true and (ready->'preview'->>'total_cents')::int=withheld and (ready->'preview'->>'subtotal_cents')::int+(ready->'preview'->>'tax_cents')::int=withheld, format('014 readiness commission prête : TTC = retenue %s ct, HT+TVA cohérents', withheld));
  v := pg_temp.qa_call(pg_temp.qa_id('finWrite'),'authenticated',format($q$select public.platform_issue_invoice(%L,'platform_commission',%L) v$q$,i4,payA));
  cinv := (v->'invoice'->>'id')::uuid;
  perform pg_temp.qa_check(v->'invoice'->>'issuer_key'='platform' and (v->'invoice'->>'total_cents')::int=withheld and v->'invoice'->>'number' ~ ('^F'||yr||'-[0-9]{6}$'), '014 facture de commission émise (émetteur plateforme, TVA extraite)');
 end if;
 -- Avoirs sur la facture A (30000 / TVA 5000).
 perform pg_temp.qa_refused(pg_temp.qa_id('finWrite'),'authenticated',format($q$select public.platform_issue_credit_note(%L,%L,30001,'Avoir supérieur à la facture (QA).')$q$,c1,inv),'P0001','014 avoir supérieur à la facture');
 v := pg_temp.qa_call(pg_temp.qa_id('finWrite'),'authenticated',format($q$select public.platform_issue_credit_note(%L,%L,12000,'Remise commerciale après litige (QA).') v$q$,c1,inv));
 perform pg_temp.qa_check(v->'invoice'->>'kind'='credit_note' and v->'invoice'->>'number'='A'||yr||'-000001' and (v->'invoice'->>'tax_cents')::int=2000 and (v->'invoice'->>'subtotal_cents')::int=10000, '014 avoir 12000 : A'||yr||'-000001, TVA 2000');
 perform pg_temp.qa_check(((pg_temp.qa_call(pg_temp.qa_id('finWrite'),'authenticated',format($q$select public.platform_issue_credit_note(%L,%L,12000,'Remise commerciale après litige (QA).') v$q$,c1,inv)))->>'replayed')::boolean=true, '014 avoir rejoué → replayed');
 perform pg_temp.qa_refused(pg_temp.qa_id('finWrite'),'authenticated',format($q$select public.platform_issue_credit_note(%L,%L,12001,'Remise commerciale après litige (QA).')$q$,c1,inv),'P0001','014 avoir même request_id montant différent');
 perform pg_temp.qa_refused(pg_temp.qa_id('finWrite'),'authenticated',format($q$select public.platform_issue_credit_note(%L,%L,18001,'Dépasse le solde restant (QA).')$q$,c2,inv),'P0001','014 avoir au-delà du solde restant');
 perform pg_temp.qa_refused(pg_temp.qa_id('finWrite'),'authenticated',format($q$select public.platform_issue_credit_note(%L,%L,100,'Avoir sur un avoir (QA).')$q$,c3,(v->'invoice'->>'id')::uuid),'P0001','014 avoir sur un avoir');
 perform pg_temp.qa_call(pg_temp.qa_id('finWrite'),'authenticated',format($q$select public.platform_issue_credit_note(%L,%L,18000,'Solde intégral annulé (QA).') v$q$,c4,inv));
 perform pg_temp.qa_check((select sum(total_cents) from public.platform_invoices where related_invoice_id=inv)=30000, '014 avoirs cumulés = total de la facture');
 -- Avoirs fractionnés sur C (100 ct / TVA 17) : 33+33+34 créditent exactement 17 de TVA.
 v := pg_temp.qa_call(pg_temp.qa_id('finWrite'),'authenticated',format($q$select public.platform_issue_invoice(%L,'service',%L) v$q$,i5,payC));
 smallInv := (v->'invoice'->>'id')::uuid;
 perform pg_temp.qa_check((v->'invoice'->>'total_cents')::int=100 and (v->'invoice'->>'tax_cents')::int=17, '014 facture C : 100 ct dont TVA 17');
 foreach amt in array array[33,33,34] loop
  note := (pg_temp.qa_call(pg_temp.qa_id('finWrite'),'authenticated',format($q$select public.platform_issue_credit_note(%L,%L,%s,'Avoir fractionné de contrôle (QA).') v$q$,gen_random_uuid(),smallInv,amt)))->'invoice';
  perform pg_temp.qa_check((note->>'total_cents')::int=amt and (note->>'tax_cents')::int+(note->>'subtotal_cents')::int=amt and (note->>'tax_cents')::int between 0 and 6, format('014 avoir fractionné %s ct : TVA %s', amt, note->>'tax_cents'));
  taxsum := taxsum + (note->>'tax_cents')::int;
 end loop;
 perform pg_temp.qa_check(taxsum=17, '014 TVA cumulée des avoirs fractionnés = 17 exactement (jamais 18)');
 perform pg_temp.qa_refused(pg_temp.qa_id('finWrite'),'authenticated',format($q$select public.platform_issue_credit_note(%L,%L,1,'Facture entièrement créditée (QA).')$q$,c5,smallInv),'P0001','014 facture entièrement créditée');
 -- Plafond TVA sur D : cinq avoirs de 1 ct puis le solde ; TVA créditée totale = 17, jamais négative.
 v := pg_temp.qa_call(pg_temp.qa_id('finWrite'),'authenticated',format($q$select public.platform_issue_invoice(%L,'service',%L) v$q$,gen_random_uuid(),payD));
 tinyInv := (v->'invoice'->>'id')::uuid;
 for k in 1..5 loop
  note := (pg_temp.qa_call(pg_temp.qa_id('finWrite'),'authenticated',format($q$select public.platform_issue_credit_note(%L,%L,1,'Avoir unitaire de contrôle (QA).') v$q$,gen_random_uuid(),tinyInv)))->'invoice';
  perform pg_temp.qa_check((note->>'tax_cents')::int between 0 and 1 and (note->>'subtotal_cents')::int>=0, format('014 avoir unitaire %s : TVA %s, HT %s', k, note->>'tax_cents', note->>'subtotal_cents'));
  tax_total := tax_total + (note->>'tax_cents')::int;
 end loop;
 note := (pg_temp.qa_call(pg_temp.qa_id('finWrite'),'authenticated',format($q$select public.platform_issue_credit_note(%L,%L,95,'Solde du contrôle (QA).') v$q$,gen_random_uuid(),tinyInv)))->'invoice';
 tax_total := tax_total + (note->>'tax_cents')::int;
 perform pg_temp.qa_check(tax_total=17 and (note->>'subtotal_cents')::int+(note->>'tax_cents')::int=95 and (select sum(tax_cents) from public.platform_invoices where related_invoice_id=tinyInv)=17, '014 TVA créditée cumulée sur D = 17, solde HT+TVA = 95');
 perform pg_temp.qa_refused(pg_temp.qa_id('finWrite'),'authenticated',format('update public.platform_invoices set total_cents=1 where id=%L',inv),'42501','014 facture update par opérateur');
 perform pg_temp.qa_refused(pg_temp.qa_id('admin'),'authenticated',format('delete from public.platform_invoices where id=%L',inv),'42501','014 facture delete par super admin');
 begin
  update public.platform_invoices set total_cents=1 where id=inv;
  perform pg_temp.qa_fail('014 facture : update racine accepté');
 exception when sqlstate 'P0001' then perform pg_temp.qa_note('PASS refus 014 facture update racine (ligne QA) (P0001)'); end;
 perform pg_temp.qa_check((pg_temp.qa_call(pg_temp.qa_id('finRead'),'authenticated','select count(*) v from public.platform_invoices'))::int=0, '014 factures invisibles sans scope actif');
end $$;

-- ---------------------------------------------------------------------------------------------
-- 8. 014 — modération d'avis (scope dédié), contestation, performance ; plafond atomique.
-- ---------------------------------------------------------------------------------------------
do $$
declare v jsonb; review uuid; contest uuid; k text; q1 uuid := gen_random_uuid(); q2 uuid := gen_random_uuid(); artisan uuid := pg_temp.qa_id('artisan'); jobA uuid := pg_temp.qa_id('jobA');
 perf text := $q$select public.artisan_performance(now()-interval '1 day',now()+interval '1 day',now()-interval '3 day',now()-interval '1 day') v$q$;
begin
 perform pg_temp.qa_reset_limits();
 v := pg_temp.qa_call(pg_temp.qa_id('client'),'authenticated',format($q$select to_jsonb(r) v from public.submit_review(%L,5,'Intervention rapide et propre (QA).') r$q$,jobA));
 review := (v->>'id')::uuid;
 perform pg_temp.qa_check(review is not null, '014 avis client déposé sur le dossier QA A');
 foreach k in array array['client','artisan','finWrite','auditor'] loop
  perform pg_temp.qa_refused(pg_temp.qa_id(k),'authenticated',format($q$select public.platform_moderate_review(%L,'hide','Contenu inapproprié QA',null)$q$,review),'42501','014 modération par '||k);
 end loop;
 perform pg_temp.qa_refused(pg_temp.qa_id('moderator'),'authenticated',format($q$select public.platform_moderate_review(%L,'restore','',null)$q$,review),'P0001','014 rétablir un avis visible');
 perform pg_temp.qa_refused(pg_temp.qa_id('moderator'),'authenticated',format($q$select public.platform_moderate_review(%L,'hide','court',null)$q$,review),'22023','014 masquage avec note trop courte');
 perform pg_temp.qa_check((pg_temp.qa_call(pg_temp.qa_id('finWrite'),'authenticated',format('select count(*) v from public.reviews where id=%L',review)))::int=0, '014 avis invisible à l’opérateur finance');
 perform pg_temp.qa_check((pg_temp.qa_call(pg_temp.qa_id('moderator'),'authenticated',format('select count(*) v from public.reviews where id=%L',review)))::int=1, '014 avis lisible par le modérateur');
 foreach k in array array['otherArtisan','other'] loop
  perform pg_temp.qa_refused(pg_temp.qa_id(k),'authenticated',format($q$select public.platform_contest_review(%L,%L,'Cet avis ne concerne pas ma prestation (QA).')$q$,q1,review),'42501','014 contestation par '||k);
 end loop;
 v := pg_temp.qa_call(artisan,'authenticated',format($q$select public.platform_contest_review(%L,%L,'Le client a refusé une partie des travaux (QA).') v$q$,q1,review));
 contest := (v->'contestation'->>'id')::uuid;
 perform pg_temp.qa_check(v->'contestation'->>'status'='open', '014 contestation ouverte par l’artisan concerné');
 perform pg_temp.qa_check(((pg_temp.qa_call(artisan,'authenticated',format($q$select public.platform_contest_review(%L,%L,'Le client a refusé une partie des travaux (QA).') v$q$,q1,review)))->>'replayed')::boolean=true, '014 contestation rejouée → replayed');
 perform pg_temp.qa_refused(artisan,'authenticated',format($q$select public.platform_contest_review(%L,%L,'Seconde contestation ouverte refusée (QA).')$q$,q2,review),'23505','014 seconde contestation ouverte');
 perform pg_temp.qa_check(((pg_temp.qa_call(artisan,'authenticated',perf))->'rating'->>'count')::int=1, '014 performance artisan : 1 avis visible');
 foreach k in array array['artisan','client'] loop
  perform pg_temp.qa_refused(pg_temp.qa_id(k),'authenticated',format($q$select public.platform_decide_contestation(%L,'upheld','Contestation fondée (QA).',1)$q$,contest),'42501','014 décision de contestation par '||k);
 end loop;
 v := pg_temp.qa_call(pg_temp.qa_id('moderator'),'authenticated',format($q$select public.platform_decide_contestation(%L,'upheld','Contestation fondée après vérification (QA).',1) v$q$,contest));
 perform pg_temp.qa_check(v->'contestation'->>'status'='upheld' and v->'moderation'->>'state'='hidden', '014 contestation retenue → avis masqué');
 perform pg_temp.qa_refused(pg_temp.qa_id('moderator'),'authenticated',format($q$select public.platform_decide_contestation(%L,'dismissed','Déjà tranchée (QA).',2)$q$,contest),'P0001','014 seconde décision de contestation');
 perform pg_temp.qa_check((pg_temp.qa_call(artisan,'authenticated',format('select count(*) v from public.reviews where id=%L',review)))::int=0, '014 avis masqué invisible à l’artisan');
 perform pg_temp.qa_check((pg_temp.qa_call(pg_temp.qa_id('client'),'authenticated',format('select count(*) v from public.reviews where id=%L',review)))::int=1, '014 avis masqué toujours visible à son auteur');
 perform pg_temp.qa_check(((pg_temp.qa_call(artisan,'authenticated',perf))->'rating'->>'count')::int=0, '014 performance artisan : avis masqué retiré');
 perform pg_temp.qa_refused(pg_temp.qa_id('moderator'),'authenticated',format($q$select public.platform_moderate_review(%L,'hide','Déjà masqué : refus attendu (QA).',1)$q$,review),'P0001','014 masquer un avis déjà masqué');
 v := pg_temp.qa_call(pg_temp.qa_id('moderator'),'authenticated',format($q$select public.platform_moderate_review(%L,'restore','Rétabli après nouvel examen (QA).',1) v$q$,review));
 perform pg_temp.qa_check(v->'moderation'->>'state'='visible' and (v->'moderation'->>'version')::int=2, '014 avis rétabli (version 2)');
 perform pg_temp.qa_check((select count(*) from public.reviews where id=review)=1, '014 aucun avis supprimé');
 perform pg_temp.qa_refused(pg_temp.qa_id('moderator'),'authenticated',format('delete from public.reviews where id=%L',review),'42501','014 delete avis par modérateur');
 -- Plafond atomique : compteur saturé (ligne QA) → 53300.
 insert into public.action_limits(actor_id,action,window_start,count) values(pg_temp.qa_id('finWrite'),'platform_reconcile',date_trunc('minute',now()),10)
 on conflict(actor_id,action,window_start) do update set count=10;
 perform pg_temp.qa_refused(pg_temp.qa_id('finWrite'),'authenticated','select public.platform_reconcile(100)','53300','014 rapprochement sous plafond saturé');
end $$;

-- ---------------------------------------------------------------------------------------------
-- 9. 015 — validité, documents, avenants, accès après réaffectation ; 016/001 RLS documents.
-- ---------------------------------------------------------------------------------------------
do $$
declare v jsonb; job uuid; quote uuid; guarded uuid; gq uuid; moved uuid; mq uuid; doc uuid; k text; future text; today text; amend uuid; av3 uuid; mdoc uuid; artisan uuid := pg_temp.qa_id('artisan'); client uuid := pg_temp.qa_id('client');
 lines text := '[{"label":"Déplacement","quantity":1,"unit_price_cents":8000},{"label":"Main-d’œuvre","quantity":2,"unit_price_cents":6000}]';
begin
 perform pg_temp.qa_reset_limits();
 select (now() at time zone 'UTC')::date::text, ((now() at time zone 'UTC')::date+10)::text into today, future;
 -- Dossier 1 : devis envoyé.
 v := pg_temp.qa_call(client,'authenticated',$q$select to_jsonb(r) v from public.create_intervention('panel','QA rollback : déclenchements du tableau.','12 rue du Test QA','97200','Fort-de-France','scheduled',null) r$q$);
 job := (v->>'id')::uuid;
 perform pg_temp.qa_exec(artisan,'authenticated',format($q$select public.intervention_action(%L,'accept_mission')$q$,job));
 perform pg_temp.qa_exec(artisan,'authenticated',format($q$select public.intervention_action(%L,'send_quote',%L::jsonb,20)$q$,job,lines));
 select id into quote from public.quotes where intervention_id=job and status='sent';
 foreach k in array array['otherArtisan','client','manager','admin'] loop
  perform pg_temp.qa_refused(pg_temp.qa_id(k),'authenticated',format('select public.set_quote_terms(%L,null)',quote),'42501','015 validité fixée par '||k);
 end loop;
 perform pg_temp.qa_refused(artisan,'authenticated',format('select public.set_quote_terms(%L,%L::date)',quote,((now() at time zone 'UTC')::date-1)::text),'22023','015 validité dans le passé');
 perform pg_temp.qa_check((pg_temp.qa_call(artisan,'authenticated',format('select public.set_quote_terms(%L,null) v',quote)))->>'validity'='unspecified', '015 validité non précisée explicite');
 v := pg_temp.qa_call(artisan,'authenticated',format('select public.set_quote_terms(%L,%L::date) v',quote,future));
 perform pg_temp.qa_check(v->>'validity'='valid' and v->>'valid_until'=future, '015 validité future posée par l’artisan attribué');
 v := pg_temp.qa_call(client,'authenticated',format('select public.quote_documents_overview(%L) v',job));
 perform pg_temp.qa_check(jsonb_array_length(v->'quotes')=1 and v->'quotes'->0->'permissions'='{"can_set_terms":false,"can_generate":true,"can_propose":false}'::jsonb and (v->'viewer'->>'can_manage')::boolean=true, '015 overview client : permissions exactes');
 perform pg_temp.qa_refused(pg_temp.qa_id('other'),'authenticated',format('select public.quote_documents_overview(%L)',job),'42501','015 overview par un autre client');
 perform pg_temp.qa_refused(pg_temp.qa_id('otherArtisan'),'authenticated',format('select public.quote_documents_overview(%L)',job),'42501','015 overview par un autre artisan');
 perform pg_temp.qa_check((pg_temp.qa_call(pg_temp.qa_id('other'),'authenticated',format('select count(*) v from public.quote_terms where quote_id=%L',quote)))::int=0, '015 RLS quote_terms : tiers ne lit rien');
 perform pg_temp.qa_refused(client,'authenticated',format('update public.quote_terms set valid_until=null where quote_id=%L',quote),'42501','015 écriture directe quote_terms');
 -- Documents : émetteur incomplet, idempotence, révision, téléchargement privé.
 update public.artisan_profiles set company_name='' where user_id=artisan;
 perform pg_temp.qa_refused(client,'authenticated',format('select public.generate_quote_document(%L,null)',quote),'QD001','015 génération avec émetteur incomplet');
 update public.artisan_profiles set company_name='Entreprise QA 1' where user_id=artisan;
 v := pg_temp.qa_call(client,'authenticated',format('select public.generate_quote_document(%L,null) v',quote));
 doc := (v->'document'->>'id')::uuid;
 perform pg_temp.qa_check((v->>'created')::boolean=true and (v->'document'->>'revision')::int=1 and v->'document'->>'kind'='quote', '015 document de devis généré (révision 1)');
 v := pg_temp.qa_call(artisan,'authenticated',format('select public.generate_quote_document(%L,null) v',quote));
 perform pg_temp.qa_check((v->>'created')::boolean=false and v->'document'->>'id'=doc::text, '015 génération idempotente par snapshot');
 perform pg_temp.qa_refused(pg_temp.qa_id('other'),'authenticated',format('select public.generate_quote_document(%L,null)',quote),'42501','015 génération par un tiers');
 perform pg_temp.qa_check((select snapshot->'quote'->>'status' from public.quote_documents where id=doc)='sent' and (select snapshot_sha256 ~ '^[a-f0-9]{64}$' from public.quote_documents where id=doc), '015 snapshot figé (statut sent, empreinte sha256)');
 perform pg_temp.qa_check((pg_temp.qa_call(client,'authenticated',format('select public.record_quote_document_download(%L) v',doc)))->'document'->>'id'=doc::text, '015 téléchargement audité par le demandeur');
 perform pg_temp.qa_refused(pg_temp.qa_id('other'),'authenticated',format('select public.record_quote_document_download(%L)',doc),'P0002','015 téléchargement par un tiers');
 perform pg_temp.qa_check((pg_temp.qa_call(pg_temp.qa_id('other'),'authenticated',format('select count(*) v from public.quote_documents where id=%L',doc)))::int=0, '015 RLS quote_documents : tiers ne lit rien');
 perform pg_temp.qa_exec(client,'authenticated',format($q$select public.intervention_action(%L,'accept_quote',null,20,%L)$q$,job,quote));
 v := pg_temp.qa_call(client,'authenticated',format('select public.generate_quote_document(%L,null) v',quote));
 perform pg_temp.qa_check((v->>'created')::boolean=true and (v->'document'->>'revision')::int=2, '015 nouvelle révision après acceptation');
 -- Devis explicitement expiré non acceptable ; sans validité jamais expiré.
 v := pg_temp.qa_call(client,'authenticated',$q$select to_jsonb(r) v from public.create_intervention('panel','QA rollback : devis à validité courte.','12 rue du Test QA','97200','Fort-de-France','scheduled',null) r$q$);
 guarded := (v->>'id')::uuid;
 perform pg_temp.qa_exec(artisan,'authenticated',format($q$select public.intervention_action(%L,'accept_mission')$q$,guarded));
 perform pg_temp.qa_exec(artisan,'authenticated',format($q$select public.intervention_action(%L,'send_quote',%L::jsonb,20)$q$,guarded,lines));
 select id into gq from public.quotes where intervention_id=guarded and status='sent';
 perform pg_temp.qa_call(artisan,'authenticated',format('select public.set_quote_terms(%L,%L::date) v',gq,today));
 update public.quote_terms set valid_until=(now() at time zone 'UTC')::date-1 where quote_id=gq;
 perform pg_temp.qa_check((pg_temp.qa_call(client,'authenticated',format('select public.quote_documents_overview(%L) v',guarded)))->'quotes'->0->'terms'->>'validity'='expired', '015 validité expirée (date simulée par le rôle racine, pas l’horloge)');
 perform pg_temp.qa_refused(client,'authenticated',format($q$select public.intervention_action(%L,'accept_quote',null,20,%L)$q$,guarded,gq),'P0001','015 acceptation d’un devis expiré');
 perform pg_temp.qa_check((select status from public.quotes where id=gq)='sent', '015 statut du devis expiré inchangé');
 update public.quote_terms set valid_until=null where quote_id=gq;
 perform pg_temp.qa_exec(client,'authenticated',format($q$select public.intervention_action(%L,'accept_quote',null,20,%L)$q$,guarded,gq));
 perform pg_temp.qa_check((select status from public.quotes where id=gq)='accepted', '015 devis sans validité accepté');
 perform pg_temp.qa_refused(artisan,'authenticated',format('select public.set_quote_terms(%L,%L::date)',gq,future),'P0001','015 validité figée après décision');
 -- Avenants sur le devis accepté (job).
 foreach k in array array['otherArtisan','client','manager','admin'] loop
  perform pg_temp.qa_refused(pg_temp.qa_id(k),'authenticated',format($q$select public.propose_quote_amendment(%L,%L::jsonb,20,'Travaux supplémentaires constatés sur place',null)$q$,quote,lines),'42501','015 avenant proposé par '||k);
 end loop;
 perform pg_temp.qa_refused(artisan,'authenticated',format($q$select public.propose_quote_amendment(%L,'[]'::jsonb,20,'Motif',null)$q$,quote),'22023','015 avenant sans ligne');
 perform pg_temp.qa_refused(artisan,'authenticated',format($q$select public.propose_quote_amendment(%L,%L::jsonb,7,'Motif',null)$q$,quote,lines),'22023','015 avenant taux invalide');
 perform pg_temp.qa_refused(artisan,'authenticated',format($q$select public.propose_quote_amendment(%L,%L::jsonb,20,'',null)$q$,quote,lines),'22023','015 avenant sans motif');
 v := pg_temp.qa_call(artisan,'authenticated',format($q$select public.propose_quote_amendment(%L,'[{"label":"Disjoncteur supplémentaire","quantity":2,"unit_price_cents":6000}]'::jsonb,20,'Travaux supplémentaires constatés sur place',null) v$q$,quote));
 amend := (v->>'id')::uuid;
 perform pg_temp.qa_check((v->>'version')::int=1 and v->>'status'='proposed' and (v->>'total_cents')::int=14400 and (v->>'tax_cents')::int=2400, '015 avenant v1 calculé par la base (14400 TTC)');
 perform pg_temp.qa_refused(artisan,'authenticated',format($q$select public.propose_quote_amendment(%L,%L::jsonb,20,'Second avenant simultané',null)$q$,quote,lines),'P0001','015 une seule proposition à la fois');
 foreach k in array array['artisan','other','otherArtisan','admin'] loop
  perform pg_temp.qa_refused(pg_temp.qa_id(k),'authenticated',format($q$select public.decide_quote_amendment(%L,'accepted','')$q$,amend),'42501','015 décision d’avenant par '||k);
 end loop;
 perform pg_temp.qa_refused(client,'authenticated',format($q$select public.decide_quote_amendment(%L,'maybe','')$q$,amend),'22023','015 décision inconnue');
 v := pg_temp.qa_call(client,'authenticated',format($q$select public.decide_quote_amendment(%L,'rejected','Trop cher pour ce poste') v$q$,amend));
 perform pg_temp.qa_check(v->>'status'='rejected', '015 avenant v1 rejeté par le demandeur');
 perform pg_temp.qa_refused(client,'authenticated',format($q$select public.decide_quote_amendment(%L,'accepted','')$q$,amend),'P0001','015 décision sur avenant déjà tranché');
 v := pg_temp.qa_call(artisan,'authenticated',format($q$select public.propose_quote_amendment(%L,%L::jsonb,20,'Travaux supplémentaires constatés sur place',null) v$q$,quote,lines));
 perform pg_temp.qa_refused(client,'authenticated',format('select public.withdraw_quote_amendment(%L)',(v->>'id')::uuid),'42501','015 retrait par le demandeur');
 perform pg_temp.qa_check((pg_temp.qa_call(artisan,'authenticated',format('select public.withdraw_quote_amendment(%L) v',(v->>'id')::uuid)))->>'status'='withdrawn', '015 avenant v2 retiré par l’auteur');
 v := pg_temp.qa_call(artisan,'authenticated',format($q$select public.propose_quote_amendment(%L,%L::jsonb,20,'Reprise du tableau',%L::date) v$q$,quote,lines,future));
 av3 := (v->>'id')::uuid;
 v := pg_temp.qa_call(client,'authenticated',format($q$select public.decide_quote_amendment(%L,'accepted','') v$q$,av3));
 perform pg_temp.qa_check(v->>'status'='accepted' and (select total_cents from public.quotes where id=quote)=24000, '015 avenant v3 accepté ; devis d’origine intact (24000)');
 v := pg_temp.qa_call(artisan,'authenticated',format('select public.generate_quote_document(%L,%L) v',quote,av3));
 perform pg_temp.qa_check(v->'document'->>'kind'='amendment' and (select (snapshot->'amendment'->>'cumulative_total_cents')::int from public.quote_documents where id=(v->'document'->>'id')::uuid)=48000, '015 document d’avenant (cumul 48000)');
 perform pg_temp.qa_check((select array_agg(action order by id) from public.audit_log where intervention_id=job and action like 'amendment_%')='{amendment_proposed,amendment_rejected,amendment_proposed,amendment_withdrawn,amendment_proposed,amendment_accepted}'::text[], '015 journal des avenants complet');
 -- Réaffectation par le super admin temporaire + RLS documents (001/003).
 v := pg_temp.qa_call(client,'authenticated',$q$select to_jsonb(r) v from public.create_intervention('panel','QA rollback : dossier réaffecté.','12 rue du Test QA','97200','Fort-de-France','scheduled',null) r$q$);
 moved := (v->>'id')::uuid;
 perform pg_temp.qa_exec(artisan,'authenticated',format($q$select public.intervention_action(%L,'accept_mission')$q$,moved));
 perform pg_temp.qa_exec(artisan,'authenticated',format($q$select public.intervention_action(%L,'send_quote',%L::jsonb,20)$q$,moved,lines));
 select id into mq from public.quotes where intervention_id=moved and status='sent';
 v := pg_temp.qa_call(artisan,'authenticated',format('select public.generate_quote_document(%L,null) v',mq));
 mdoc := (v->'document'->>'id')::uuid;
 insert into public.documents(intervention_id,owner_id,name,path,mime_type) values(moved,client,'QA photo.jpg',client::text||'/'||gen_random_uuid()::text,'image/jpeg');
 perform pg_temp.qa_check((pg_temp.qa_call(client,'authenticated',format('select count(*) v from public.documents where intervention_id=%L',moved)))::int=1 and (pg_temp.qa_call(artisan,'authenticated',format('select count(*) v from public.documents where intervention_id=%L',moved)))::int=1 and (pg_temp.qa_call(pg_temp.qa_id('other'),'authenticated',format('select count(*) v from public.documents where intervention_id=%L',moved)))::int=0, '001/003 RLS documents : demandeur et artisan attribué lisent, autre client non');
 perform pg_temp.qa_exec(pg_temp.qa_id('admin'),'authenticated',format($q$select public.reassign_intervention(%L,%L,'Réaffectation QA')$q$,moved,pg_temp.qa_id('otherArtisan')));
 perform pg_temp.qa_refused(artisan,'authenticated',format('select public.set_quote_terms(%L,%L::date)',mq,future),'42501','015 ancien artisan : validité');
 perform pg_temp.qa_refused(artisan,'authenticated',format('select public.quote_documents_overview(%L)',moved),'42501','015 ancien artisan : overview');
 perform pg_temp.qa_refused(artisan,'authenticated',format('select public.generate_quote_document(%L,null)',mq),'42501','015 ancien artisan : génération');
 perform pg_temp.qa_refused(artisan,'authenticated',format('select public.record_quote_document_download(%L)',mdoc),'P0002','015 ancien artisan : téléchargement');
 perform pg_temp.qa_check((pg_temp.qa_call(artisan,'authenticated',format('select count(*) v from public.quote_documents where quote_id=%L',mq)))::int=0, '015 RLS : ancien artisan ne lit plus les documents de devis');
 perform pg_temp.qa_check((pg_temp.qa_call(artisan,'authenticated',format('select count(*) v from public.documents where intervention_id=%L',moved)))::int=0 and (pg_temp.qa_call(pg_temp.qa_id('otherArtisan'),'authenticated',format('select count(*) v from public.documents where intervention_id=%L',moved)))::int=1, '001/003 RLS documents après réaffectation : ancien artisan 0, nouvel artisan 1');
 perform pg_temp.qa_refused(pg_temp.qa_id('otherArtisan'),'authenticated',format('select public.generate_quote_document(%L,null)',mq),'42501','015 nouvel artisan n’est pas l’émetteur');
 perform pg_temp.qa_check(((pg_temp.qa_call(client,'authenticated',format('select public.generate_quote_document(%L,null) v',mq)))->>'created')::boolean=true, '015 le demandeur garde la génération');
 perform pg_temp.qa_set('job015', job::text);
end $$;

-- ---------------------------------------------------------------------------------------------
-- 10. 015 B2B — site, seuil d'approbation, viewer, membre retiré ; 017 — opérations de site.
-- ---------------------------------------------------------------------------------------------
do $$
declare v jsonb; org uuid; siteA uuid; siteB uuid; otherOrg uuid; otherSite uuid; manager uuid := pg_temp.qa_id('manager'); viewer uuid := pg_temp.qa_id('viewer'); delegate uuid := pg_temp.qa_id('delegate');
 artisan uuid := pg_temp.qa_id('artisan'); b2b uuid; bq uuid; bdoc uuid; over uuid; k text;
begin
 perform pg_temp.qa_reset_limits();
 v := pg_temp.qa_call(manager,'authenticated',$q$select to_jsonb(r) v from public.create_site('Siège QA','office','1 avenue du Test QA',100000,null) r$q$);
 siteA := (v->>'id')::uuid; org := (v->>'organization_id')::uuid;
 perform pg_temp.qa_set('org',org::text); perform pg_temp.qa_set('siteA',siteA::text);
 v := pg_temp.qa_call(manager,'authenticated',format($q$select to_jsonb(r) v from public.create_site('Annexe QA','erp','2 avenue du Test QA',50000,%L) r$q$,org));
 siteB := (v->>'id')::uuid; perform pg_temp.qa_set('siteB',siteB::text);
 v := pg_temp.qa_call(pg_temp.qa_id('otherOwner'),'authenticated',$q$select to_jsonb(r) v from public.create_site('Autre organisation QA','erp','9 rue Ailleurs QA',10000,null) r$q$);
 otherOrg := (v->>'organization_id')::uuid; otherSite := (v->>'id')::uuid;
 perform pg_temp.qa_set('otherOrg',otherOrg::text); perform pg_temp.qa_set('otherSite',otherSite::text);
 insert into public.organization_members(organization_id,user_id,role) values(org,viewer,'viewer'),(org,delegate,'manager');
 perform pg_temp.qa_exec(manager,'authenticated',format($q$select public.set_organization_member_site_access(%L,%L,'selected',%L::jsonb)$q$,org,delegate,jsonb_build_array(jsonb_build_object('site_id',siteA,'can_write',true))::text));
 perform pg_temp.qa_check((select count(*) from public.organization_members where organization_id=org)=3, '015/017 organisation QA : propriétaire, viewer, délégué (grant écriture site A)');
 perform pg_temp.qa_exec(manager,'authenticated',format($q$select public.set_approval_rule(%L,20000,'owner',true)$q$,siteA));
 v := pg_temp.qa_call(manager,'authenticated',format($q$select to_jsonb(r) v from public.create_intervention('panel','QA rollback : dossier de site.','1 avenue du Test QA','97200','Fort-de-France','scheduled',%L) r$q$,siteA));
 b2b := (v->>'id')::uuid; perform pg_temp.qa_set('b2b',b2b::text);
 perform pg_temp.qa_exec(artisan,'authenticated',format($q$select public.intervention_action(%L,'accept_mission')$q$,b2b));
 perform pg_temp.qa_exec(artisan,'authenticated',format($q$select public.intervention_action(%L,'send_quote','[{"label":"Diagnostic","quantity":1,"unit_price_cents":10000}]'::jsonb,20)$q$,b2b));
 select id into bq from public.quotes where intervention_id=b2b and status='sent';
 perform pg_temp.qa_exec(manager,'authenticated',format($q$select public.intervention_action(%L,'accept_quote',null,20,%L)$q$,b2b,bq));
 v := pg_temp.qa_call(manager,'authenticated',format('select public.generate_quote_document(%L,null) v',bq));
 bdoc := (v->'document'->>'id')::uuid;
 perform pg_temp.qa_check((select snapshot->'recipient'->'site'->>'name' from public.quote_documents where id=bdoc)='Siège QA', '015 document B2B : destinataire = site');
 v := pg_temp.qa_call(viewer,'authenticated',format('select public.quote_documents_overview(%L) v',b2b));
 perform pg_temp.qa_check((v->'viewer'->>'can_manage')::boolean=false and (v->'quotes'->0->'permissions'->>'can_generate')::boolean=false, '015 viewer : overview en lecture, pas de génération');
 perform pg_temp.qa_refused(viewer,'authenticated',format('select public.generate_quote_document(%L,null)',bq),'42501','015 viewer : génération');
 perform pg_temp.qa_check((pg_temp.qa_call(viewer,'authenticated',format('select public.record_quote_document_download(%L) v',bdoc)))->'document'->>'id'=bdoc::text, '015 viewer : téléchargement autorisé');
 v := pg_temp.qa_call(artisan,'authenticated',format($q$select public.propose_quote_amendment(%L,'[{"label":"Câblage","quantity":1,"unit_price_cents":7000}]'::jsonb,20,'Travaux supplémentaires constatés sur place',null) v$q$,bq));
 over := (v->>'id')::uuid;
 perform pg_temp.qa_refused(viewer,'authenticated',format($q$select public.decide_quote_amendment(%L,'accepted','')$q$,over),'42501','015 viewer : décision d’avenant');
 perform pg_temp.qa_refused(manager,'authenticated',format($q$select public.decide_quote_amendment(%L,'accepted','')$q$,over),'P0001','015 seuil d’approbation du site bloque l’acceptation');
 perform pg_temp.qa_check((select status from public.quote_amendments where id=over)='proposed', '015 avenant au-delà du seuil reste proposé');
 perform pg_temp.qa_check((pg_temp.qa_call(manager,'authenticated',format($q$select public.decide_quote_amendment(%L,'rejected','Au-delà du seuil') v$q$,over)))->>'status'='rejected', '015 avenant rejeté explicitement');
 delete from public.organization_members where organization_id=org and user_id=viewer;
 perform pg_temp.qa_refused(viewer,'authenticated',format('select public.quote_documents_overview(%L)',b2b),'42501','015 membre retiré : overview');
 perform pg_temp.qa_refused(viewer,'authenticated',format('select public.record_quote_document_download(%L)',bdoc),'P0002','015 membre retiré : téléchargement');
 perform pg_temp.qa_check((pg_temp.qa_call(viewer,'authenticated',format('select count(*) v from public.quote_documents where quote_id=%L',bq)))::int=0, '015 RLS : membre retiré ne lit plus');
 insert into public.organization_members(organization_id,user_id,role) values(org,viewer,'viewer');
end $$;

do $$
declare v jsonb; org uuid := pg_temp.qa_id('org'); siteA uuid := pg_temp.qa_id('siteA'); siteB uuid := pg_temp.qa_id('siteB'); otherOrg uuid := pg_temp.qa_id('otherOrg'); otherSite uuid := pg_temp.qa_id('otherSite');
 manager uuid := pg_temp.qa_id('manager'); viewer uuid := pg_temp.qa_id('viewer'); delegate uuid := pg_temp.qa_id('delegate'); otherOwner uuid := pg_temp.qa_id('otherOwner'); k text; eq uuid; plan uuid; fy uuid; fy2 uuid; line uuid; g1 uuid; g2 uuid; cal uuid; otherCal uuid; pol uuid; kase uuid; chk uuid; y integer := extract(year from now())::int;
 eqp text := '{"name":"QA tableau général","category":"panel","criticality":"high","location":"Local technique","reference":"QA-REF-1","installed_on":null,"status":"in_service","notes":"Donnée synthétique QA"}';
 refusals text[][] ;
 vis jsonb; snap jsonb; consumption jsonb;
begin
 perform pg_temp.qa_reset_limits();
 -- Équipement : versions, charge utile stricte, historique.
 v := pg_temp.qa_call(delegate,'authenticated',format('select public.save_site_equipment(%L,%L::jsonb) v',siteA,eqp));
 eq := (v->>'id')::uuid;
 perform pg_temp.qa_check((v->>'version')::int=1 and v->>'site_id'=siteA::text and v->>'created_by'=delegate::text, '017 équipement créé par le délégué (v1)');
 v := pg_temp.qa_call(delegate,'authenticated',format('select public.save_site_equipment(%L,%L::jsonb,%L,1) v',siteA,jsonb_set(eqp::jsonb,'{status}','"degraded"')::text,eq));
 perform pg_temp.qa_check((v->>'version')::int=2 and v->>'status'='degraded', '017 équipement mis à jour (v2)');
 perform pg_temp.qa_refused(delegate,'authenticated',format('select public.save_site_equipment(%L,%L::jsonb,%L,1)',siteA,eqp,eq),'P0001','017 version obsolète');
 perform pg_temp.qa_refused(delegate,'authenticated',format('select public.save_site_equipment(%L,%L::jsonb,%L)',siteA,eqp,eq),'P0001','017 mise à jour sans version attendue');
 perform pg_temp.qa_refused(delegate,'authenticated',format('select public.save_site_equipment(%L,%L::jsonb)',siteA,(eqp::jsonb||'{"extra":1}'::jsonb)::text),'22023','017 clé inattendue');
 perform pg_temp.qa_refused(delegate,'authenticated',format('select public.save_site_equipment(%L,%L::jsonb)',siteA,jsonb_set(eqp::jsonb,'{category}','"nuclear"')::text),'22023','017 catégorie invalide');
 perform pg_temp.qa_refused(delegate,'authenticated',format('select public.save_site_equipment(%L,%L::jsonb)',siteA,jsonb_set(eqp::jsonb,'{name}','""')::text),'22023','017 nom vide');
 perform pg_temp.qa_check((pg_temp.qa_call(delegate,'authenticated',format($q$select count(*) v from public.site_operations_events where entity='equipment' and entity_id=%L$q$,eq)))::int=2, '017 historique : 2 événements avec snapshot');
 -- Matrice de refus d'écriture.
 perform pg_temp.qa_refused(viewer,'authenticated',format('select public.save_site_equipment(%L,%L::jsonb)',siteA,eqp),'42501','017 viewer écrit');
 perform pg_temp.qa_refused(delegate,'authenticated',format('select public.save_site_equipment(%L,%L::jsonb)',siteB,eqp),'42501','017 délégué sur un site non accordé');
 perform pg_temp.qa_refused(pg_temp.qa_id('other'),'authenticated',format('select public.save_site_equipment(%L,%L::jsonb)',siteA,eqp),'42501','017 hors organisation');
 perform pg_temp.qa_refused(otherOwner,'authenticated',format('select public.save_site_equipment(%L,%L::jsonb)',siteA,eqp),'42501','017 propriétaire d’une autre organisation');
 perform pg_temp.qa_refused(pg_temp.qa_id('admin'),'authenticated',format('select public.save_site_equipment(%L,%L::jsonb)',siteA,eqp),'42501','017 super admin écrit sur un site');
 perform pg_temp.qa_refused(pg_temp.qa_id('artisan'),'authenticated',format('select public.save_site_equipment(%L,%L::jsonb)',siteA,eqp),'42501','017 artisan écrit sur un site');
 perform pg_temp.qa_refused(manager,'authenticated',format('select public.save_site_equipment(%L,%L::jsonb)',otherSite,eqp),'42501','017 propriétaire sur le site d’une autre organisation');
 perform pg_temp.qa_refused(delegate,'authenticated',format('select public.save_site_equipment(%L,%L::jsonb)',gen_random_uuid(),eqp),'42501','017 site inconnu');
 perform pg_temp.qa_check((pg_temp.qa_call(manager,'authenticated',format('select count(*) v from public.site_equipment where site_id=%L',siteA)))::int=1 and (pg_temp.qa_call(viewer,'authenticated',format('select count(*) v from public.site_equipment where site_id=%L',siteA)))::int=1 and (pg_temp.qa_call(pg_temp.qa_id('other'),'authenticated',format('select count(*) v from public.site_equipment where site_id=%L',siteA)))::int=0 and (pg_temp.qa_call(otherOwner,'authenticated',format('select count(*) v from public.site_equipment where site_id=%L',siteA)))::int=0 and (pg_temp.qa_call(pg_temp.qa_id('artisan'),'authenticated',format('select count(*) v from public.site_equipment where site_id=%L',siteA)))::int=0, '017 RLS équipement : membres lisent, étrangers/artisan non');
 perform pg_temp.qa_refused(delegate,'authenticated',format($q$insert into public.site_equipment(site_id,name,category,criticality,status,created_by) values(%L,'x','panel','low','in_service',%L)$q$,siteA,delegate),'42501','017 insertion directe');
 perform pg_temp.qa_refused(manager,'authenticated',format($q$update public.site_equipment set name='direct' where id=%L$q$,eq),'42501','017 update direct');
 perform pg_temp.qa_refused(delegate,'authenticated',format($q$select public.so_log(%L,%L,'equipment',%L,'created',1,'{}'::jsonb)$q$,org,siteA,eq),'42501','017 helper privé so_log');
 perform pg_temp.qa_refused(delegate,'authenticated',format('select public.so_lock_organization(%L)',org),'42501','017 helper privé so_lock_organization');
 -- Révocation immédiate.
 perform pg_temp.qa_exec(manager,'authenticated',format($q$select public.set_organization_member_site_access(%L,%L,'selected',%L::jsonb)$q$,org,delegate,jsonb_build_array(jsonb_build_object('site_id',siteA,'can_write',false))::text));
 perform pg_temp.qa_refused(delegate,'authenticated',format('select public.save_site_equipment(%L,%L::jsonb)',siteA,eqp),'42501','017 grant abaissé en lecture');
 perform pg_temp.qa_check((pg_temp.qa_call(delegate,'authenticated',format('select count(*) v from public.site_equipment where site_id=%L',siteA)))::int=1, '017 grant lecture : lit encore');
 perform pg_temp.qa_exec(manager,'authenticated',format($q$select public.set_organization_member_site_access(%L,%L,'selected','[]'::jsonb)$q$,org,delegate));
 perform pg_temp.qa_check((pg_temp.qa_call(delegate,'authenticated',format('select count(*) v from public.site_equipment where site_id=%L',siteA)))::int=0 and (pg_temp.qa_call(delegate,'authenticated',format('select count(*) v from public.site_operations_events where site_id=%L',siteA)))::int=0, '017 grant retiré : lectures à zéro');
 perform pg_temp.qa_refused(delegate,'authenticated',format('select public.site_operations_snapshot(%L)',siteA),'42501','017 grant retiré : snapshot');
 perform pg_temp.qa_exec(manager,'authenticated',format($q$select public.set_organization_member_site_access(%L,%L,'selected',%L::jsonb)$q$,org,delegate,jsonb_build_array(jsonb_build_object('site_id',siteA,'can_write',true))::text));
 -- Plan de maintenance et visite.
 v := pg_temp.qa_call(delegate,'authenticated',format('select public.save_maintenance_plan(%L,%L::jsonb) v',siteA,jsonb_build_object('equipment_id',eq,'title','QA visite annuelle','frequency_kind','months','frequency_value',12,'next_due_on',(y+1)||'-01-15','last_done_on',null,'status','active','notes','')::text));
 plan := (v->>'id')::uuid;
 perform pg_temp.qa_check((v->>'frequency_value')::int=12, '017 plan de maintenance créé');
 perform pg_temp.qa_refused(delegate,'authenticated',format('select public.save_maintenance_plan(%L,%L::jsonb)',siteA,jsonb_build_object('equipment_id',eq,'title','QA','frequency_kind','none','frequency_value',12,'next_due_on',null,'last_done_on',null,'status','active','notes','')::text),'22023','017 fréquence incohérente');
 v := pg_temp.qa_call(delegate,'authenticated',format($q$select public.record_maintenance_visit(%L,%L::date,'QA visite réalisée') v$q$,plan,y||'-10-10'));
 perform pg_temp.qa_check(v->'plan'->>'next_due_on'=(y+1)||'-10-10' and (v->'plan'->>'version')::int=2, '017 visite : prochaine échéance calculée depuis la configuration');
 perform pg_temp.qa_refused(viewer,'authenticated',format($q$select public.record_maintenance_visit(%L,%L::date,'x')$q$,plan,y||'-10-10'),'42501','017 visite par un viewer');
 perform pg_temp.qa_refused(delegate,'authenticated',format($q$select public.record_maintenance_visit(%L,%L::date,'x',%L)$q$,plan,y||'-10-10',pg_temp.qa_id('jobA')),'42501','017 visite liée à un dossier d’un autre site');
 -- Exercice fiscal, lignes budgétaires, consommation.
 v := pg_temp.qa_call(manager,'authenticated',format('select public.save_fiscal_year(%L,%L::jsonb) v',org,jsonb_build_object('label','QA exercice '||y,'starts_on',y||'-01-01','ends_on',y||'-12-31','status','open')::text));
 fy := (v->>'id')::uuid;
 perform pg_temp.qa_refused(manager,'authenticated',format('select public.save_fiscal_year(%L,%L::jsonb)',org,jsonb_build_object('label','QA chevauchement','starts_on',y||'-12-01','ends_on',(y+1)||'-11-30','status','open')::text),'P0001','017 exercices qui se chevauchent');
 perform pg_temp.qa_refused(manager,'authenticated',format('select public.save_fiscal_year(%L,%L::jsonb)',org,jsonb_build_object('label','QA trop long','starts_on',(y+1)||'-01-01','ends_on',(y+3)||'-12-31','status','open')::text),'22023','017 exercice trop long');
 v := pg_temp.qa_call(manager,'authenticated',format('select public.save_fiscal_year(%L,%L::jsonb) v',org,jsonb_build_object('label','QA exercice '||(y+1),'starts_on',(y+1)||'-01-01','ends_on',(y+1)||'-12-31','status','open')::text));
 fy2 := (v->>'id')::uuid;
 foreach k in array array['delegate','viewer','otherOwner','admin'] loop
  perform pg_temp.qa_refused(pg_temp.qa_id(k),'authenticated',format('select public.save_fiscal_year(%L,%L::jsonb)',org,jsonb_build_object('label','QA','starts_on',(y+2)||'-01-01','ends_on',(y+2)||'-12-31','status','open')::text),'42501','017 exercice fiscal par '||k);
 end loop;
 perform pg_temp.qa_check((pg_temp.qa_call(delegate,'authenticated',format('select count(*) v from public.organization_fiscal_years where organization_id=%L',org)))::int=2 and (pg_temp.qa_call(otherOwner,'authenticated',format('select count(*) v from public.organization_fiscal_years where organization_id=%L',org)))::int=0, '017 RLS exercices : membre lit, autre organisation non');
 v := pg_temp.qa_call(delegate,'authenticated',format($q$select public.save_budget_line(%L,%L,'maintenance',250000,'QA') v$q$,siteA,fy));
 line := (v->>'id')::uuid;
 v := pg_temp.qa_call(delegate,'authenticated',format($q$select public.save_budget_line(%L,%L,'maintenance',300000,'QA',1) v$q$,siteA,fy));
 perform pg_temp.qa_check(v->>'id'=line::text and (v->>'version')::int=2 and (v->>'amount_cents')::int=300000, '017 ligne budgétaire upsert versionnée');
 perform pg_temp.qa_refused(delegate,'authenticated',format($q$select public.save_budget_line(%L,%L,'maintenance',1,'QA')$q$,siteA,fy),'P0001','017 ligne existante sans version');
 perform pg_temp.qa_refused(delegate,'authenticated',format($q$select public.save_budget_line(%L,%L,'bonus',1,'QA')$q$,siteA,fy),'22023','017 catégorie budgétaire invalide');
 -- Grilles contractuelles.
 v := pg_temp.qa_call(manager,'authenticated',format('select public.save_contract_grid(%L,%L::jsonb) v',org,'{"label":"QA grille","contract_id":null,"effective_from":"'||y||'-01-01","lines":[{"label":"Déplacement","unit":"visit","amount_cents":4500,"note":""},{"label":"Main d’œuvre","unit":"hour","amount_cents":6000,"note":"QA"}]}'));
 g1 := (v->>'id')::uuid;
 perform pg_temp.qa_check(v->>'status'='draft' and (v->>'version_number')::int=1, '017 grille brouillon v1');
 perform pg_temp.qa_refused(manager,'authenticated',format('select public.save_contract_grid(%L,%L::jsonb)',org,'{"label":"QA","contract_id":null,"effective_from":"'||y||'-01-01","lines":[{"label":"x","unit":"hour","amount_cents":-1,"note":""}]}'),'22023','017 grille montant négatif');
 v := pg_temp.qa_call(manager,'authenticated',format('select public.publish_contract_grid(%L,%s) v',g1,(v->>'version')::int));
 perform pg_temp.qa_check(v->>'status'='published' and v->>'published_at' is not null, '017 grille publiée');
 perform pg_temp.qa_refused(manager,'authenticated',format('select public.publish_contract_grid(%L,%s)',g1,(v->>'version')::int),'P0001','017 republier une grille publiée');
 v := pg_temp.qa_call(manager,'authenticated',format('select public.save_contract_grid(%L,%L::jsonb) v',org,'{"label":"QA grille v2","contract_id":null,"effective_from":"'||(y+1)||'-01-01","from_grid_id":"'||g1||'","lines":[{"label":"Déplacement","unit":"visit","amount_cents":4700,"note":""}]}'));
 g2 := (v->>'id')::uuid;
 perform pg_temp.qa_check((v->>'version_number')::int=2 and v->>'status'='draft', '017 nouvelle version de lignée (brouillon)');
 perform pg_temp.qa_call(manager,'authenticated',format('select public.publish_contract_grid(%L,%s) v',g2,(v->>'version')::int));
 perform pg_temp.qa_check((select status from public.organization_contract_grids where id=g1)='superseded', '017 ancienne grille remplacée');
 perform pg_temp.qa_refused(delegate,'authenticated',format('select public.save_contract_grid(%L,%L::jsonb)',org,'{"label":"QA","contract_id":null,"effective_from":"'||y||'-01-01","lines":[{"label":"x","unit":"hour","amount_cents":1,"note":""}]}'),'42501','017 grille par un délégué');
 perform pg_temp.qa_refused(otherOwner,'authenticated',format('select public.publish_contract_grid(%L,1)',g2),'42501','017 publication par une autre organisation');
 perform pg_temp.qa_check((pg_temp.qa_call(delegate,'authenticated',format('select count(*) v from public.organization_contract_grids where organization_id=%L',org)))::int=0 and (pg_temp.qa_call(manager,'authenticated',format('select count(*) v from public.organization_contract_grids where organization_id=%L',org)))::int=2, '017 RLS grilles : membre selected ne lit pas les montants, propriétaire oui');
 -- SLA : calendrier, politique, cas, pause/reprise.
 v := pg_temp.qa_call(manager,'authenticated',format('select public.save_sla_calendar(%L,%L::jsonb) v',org,'{"name":"QA jours ouvrés","timezone":"Europe/Paris","windows":[{"weekday":1,"start":"08:00","end":"12:00"},{"weekday":1,"start":"13:00","end":"17:00"}],"closed_dates":["'||y||'-12-25"]}'));
 cal := (v->>'id')::uuid;
 perform pg_temp.qa_refused(manager,'authenticated',format('select public.save_sla_calendar(%L,%L::jsonb)',org,'{"name":"QA","timezone":"Europe/Paris","windows":[{"weekday":8,"start":"08:00","end":"12:00"}],"closed_dates":[]}'),'22023','017 calendrier jour invalide');
 perform pg_temp.qa_refused(manager,'authenticated',format('select public.save_sla_calendar(%L,%L::jsonb)',org,'{"name":"QA","timezone":"Europe/Paris","windows":[{"weekday":1,"start":"12:00","end":"08:00"}],"closed_dates":[]}'),'22023','017 calendrier fenêtre inversée');
 perform pg_temp.qa_refused(delegate,'authenticated',format('select public.save_sla_calendar(%L,%L::jsonb)',org,'{"name":"QA","timezone":"Europe/Paris","windows":[],"closed_dates":[]}'),'42501','017 calendrier par un délégué');
 v := pg_temp.qa_call(otherOwner,'authenticated',format('select public.save_sla_calendar(%L,%L::jsonb) v',otherOrg,'{"name":"QA autre","timezone":"UTC","windows":[],"closed_dates":[]}'));
 otherCal := (v->>'id')::uuid;
 v := pg_temp.qa_call(delegate,'authenticated',format('select public.save_sla_policy(%L,%L::jsonb) v',siteA,jsonb_build_object('name','QA urgences','calendar_id',cal,'urgency','urgent','response_target_minutes',120,'resolution_target_minutes',null,'status','active')::text));
 pol := (v->>'id')::uuid;
 perform pg_temp.qa_check(v->'resolution_target_minutes'='null'::jsonb, '017 politique SLA sans cible inventée');
 perform pg_temp.qa_refused(delegate,'authenticated',format('select public.save_sla_policy(%L,%L::jsonb)',siteA,jsonb_build_object('name','QA','calendar_id',otherCal,'urgency','urgent','response_target_minutes',120,'resolution_target_minutes',null,'status','active')::text),'42501','017 calendrier d’une autre organisation');
 perform pg_temp.qa_refused(delegate,'authenticated',format('select public.save_sla_policy(%L,%L::jsonb)',siteA,jsonb_build_object('name','QA','calendar_id',cal,'urgency','urgent','response_target_minutes',0,'resolution_target_minutes',null,'status','active')::text),'22023','017 cible SLA nulle');
 v := pg_temp.qa_call(delegate,'authenticated',format('select public.save_sla_case(%L,%L::jsonb) v',siteA,jsonb_build_object('policy_id',pol,'intervention_id',pg_temp.qa_id('b2b'),'reference','QA-001','opened_at',y||'-10-05T07:30:00Z','responded_at',null,'resolved_at',null,'notes','')::text));
 kase := (v->>'id')::uuid;
 perform pg_temp.qa_refused(delegate,'authenticated',format('select public.save_sla_case(%L,%L::jsonb)',siteA,jsonb_build_object('policy_id',pol,'intervention_id',null,'reference','QA-002','opened_at',y||'-10-05T07:30:00Z','responded_at',y||'-10-05T07:00:00Z','resolved_at',null,'notes','')::text),'22023','017 chronologie SLA incohérente');
 perform pg_temp.qa_refused(delegate,'authenticated',format('select public.save_sla_case(%L,%L::jsonb)',siteA,jsonb_build_object('policy_id',pol,'intervention_id',pg_temp.qa_id('jobA'),'reference','QA-003','opened_at',y||'-10-05T07:30:00Z','responded_at',null,'resolved_at',null,'notes','')::text),'42501','017 cas SLA lié à un dossier hors site');
 v := pg_temp.qa_call(delegate,'authenticated',format($q$select public.pause_sla_case(%L,%L::timestamptz,'QA attente pièce',1) v$q$,kase,y||'-10-05T09:00:00Z'));
 perform pg_temp.qa_check((v->'case'->>'version')::int=2 and v->'pause'->'ended_at'='null'::jsonb, '017 pause SLA ouverte (v2)');
 perform pg_temp.qa_refused(delegate,'authenticated',format($q$select public.pause_sla_case(%L,%L::timestamptz,'x',2)$q$,kase,y||'-10-05T10:00:00Z'),'P0001','017 seconde pause ouverte');
 perform pg_temp.qa_refused(viewer,'authenticated',format($q$select public.resume_sla_case(%L,%L::timestamptz,2)$q$,kase,y||'-10-05T10:00:00Z'),'42501','017 reprise par un viewer');
 perform pg_temp.qa_refused(delegate,'authenticated',format($q$select public.resume_sla_case(%L,%L::timestamptz,2)$q$,kase,y||'-10-05T08:00:00Z'),'22023','017 reprise avant la pause');
 v := pg_temp.qa_call(delegate,'authenticated',format($q$select public.resume_sla_case(%L,%L::timestamptz,2) v$q$,kase,y||'-10-05T10:00:00Z'));
 perform pg_temp.qa_check((v->'case'->>'version')::int=3, '017 reprise SLA (v3)');
 v := pg_temp.qa_call(delegate,'authenticated',format('select public.save_sla_case(%L,%L::jsonb,%L,3) v',siteA,jsonb_build_object('policy_id',pol,'intervention_id',pg_temp.qa_id('b2b'),'reference','QA-001','opened_at',y||'-10-05T07:30:00Z','responded_at',y||'-10-05T11:00:00Z','resolved_at',y||'-10-06T11:00:00Z','notes','')::text,kase));
 perform pg_temp.qa_check((v->>'version')::int=4, '017 cas SLA résolu (v4)');
 perform pg_temp.qa_refused(delegate,'authenticated',format($q$select public.pause_sla_case(%L,%L::timestamptz,'x',4)$q$,kase,y||'-10-07T10:00:00Z'),'P0001','017 pause sur un cas résolu');
 perform pg_temp.qa_check((pg_temp.qa_call(viewer,'authenticated',format('select count(*) v from public.site_sla_pauses where case_id=%L',kase)))::int=1 and (pg_temp.qa_call(otherOwner,'authenticated',format('select count(*) v from public.site_sla_pauses where case_id=%L',kase)))::int=0, '017 RLS pauses : viewer lit, autre organisation non');
 -- Checklist ERP déclarative.
 v := pg_temp.qa_call(delegate,'authenticated',format('select public.save_erp_checklist(%L,%L::jsonb) v',siteA,'{"title":"QA contrôle éclairage de sécurité","description":"Liste déclarative QA","performed_on":"'||y||'-10-01","performed_by_label":"QA responsable","status":"completed","items":[{"key":"bloc-1","label":"Blocs autonomes testés","state":"ok","note":"","reserve_resolved_on":null},{"key":"bloc-2","label":"Pictogramme manquant","state":"reserve","note":"QA réserve","reserve_resolved_on":null}]}'));
 chk := (v->>'id')::uuid;
 perform pg_temp.qa_check(v->>'nature'='declarative' and jsonb_array_length(v->'items')=2, '017 checklist déclarative créée');
 perform pg_temp.qa_refused(delegate,'authenticated',format('select public.save_erp_checklist(%L,%L::jsonb)',siteA,'{"title":"QA","description":"","performed_on":"'||y||'-10-01","performed_by_label":"QA","status":"completed","items":[{"key":"dup","label":"a","state":"ok","note":""},{"key":"dup","label":"b","state":"ok","note":""}]}'),'22023','017 clés de checklist dupliquées');
 perform pg_temp.qa_refused(delegate,'authenticated',format('select public.save_erp_checklist(%L,%L::jsonb)',siteA,'{"title":"QA","description":"","performed_on":"'||y||'-10-01","performed_by_label":"QA","status":"completed","nature":"certified","items":[]}'),'22023','017 nature certifiée refusée');
 begin
  update public.site_erp_checklists set nature='certified' where id=chk;
  perform pg_temp.qa_fail('017 nature certifiée acceptée par le rôle racine');
 exception when sqlstate '23514' then perform pg_temp.qa_note('PASS refus 017 nature certifiée même pour le rôle racine (23514)'); end;
 -- Snapshot RLS et faits de complétude.
 snap := pg_temp.qa_call(delegate,'authenticated',format('select public.site_operations_snapshot(%L) v',siteA));
 select x into consumption from jsonb_array_elements(snap->'budget_consumption') x where x->>'fiscal_year_id'=fy::text;
 perform pg_temp.qa_check(snap->'site'->>'id'=siteA::text and jsonb_array_length(snap->'equipment')=1 and jsonb_array_length(snap->'fiscal_years')=2 and (consumption->>'accepted_cents')::int=12000 and (consumption->>'interventions')::int=1 and snap->'contract_grids'='null'::jsonb and (snap->'limits'->>'contract_grids_readable')::boolean=false and (snap->'limits'->>'can_write_site')::boolean=true and (snap->'limits'->>'can_write_organization')::boolean=false and jsonb_array_length(snap->'sla_cases')=1 and (snap->'sla_cases'->0->>'pauses_total')::int=1 and jsonb_array_length(snap->'erp_checklists')=1, '017 snapshot délégué : consommation du devis B2B (12000 TTC) dans l’exercice, grilles non lisibles signalées, drapeaux d’écriture');
 snap := pg_temp.qa_call(manager,'authenticated',format('select public.site_operations_snapshot(%L) v',siteA));
 perform pg_temp.qa_check(jsonb_array_length(snap->'contract_grids')=2 and (snap->'limits'->>'can_write_organization')::boolean=true, '017 snapshot propriétaire : grilles lisibles, écriture organisation');
 snap := pg_temp.qa_call(pg_temp.qa_id('admin'),'authenticated',format('select public.site_operations_snapshot(%L) v',siteA));
 perform pg_temp.qa_check((snap->'limits'->>'can_write_site')::boolean=false and jsonb_array_length(snap->'contract_grids')=2, '017 snapshot super admin : lecture sans écriture');
 foreach k in array array['other','otherOwner','artisan'] loop
  perform pg_temp.qa_refused(pg_temp.qa_id(k),'authenticated',format('select public.site_operations_snapshot(%L)',siteA),'42501','017 snapshot par '||k);
 end loop;
 perform pg_temp.qa_refused(null,'anon',format('select public.site_operations_snapshot(%L)',siteA),'42501','017 snapshot anonyme');
end $$;

-- ---------------------------------------------------------------------------------------------
-- 11. Clôture : lignes QA par table (toutes annulées ci-dessous), rapport, ROLLBACK.
-- ---------------------------------------------------------------------------------------------
do $$
declare cohort uuid[]; n_users integer; n_profiles integer; n_jobs integer; n_quotes integer; n_pay integer; n_inv integer; n_ledger integer; n_grants integer; n_audit integer; n_qdocs integer; n_site integer; n_events integer; n_notes integer;
begin
 perform pg_temp.qa_reset_limits();
 select array_agg(val::uuid) into cohort from qa_ctx where key in ('client','other','manager','viewer','delegate','otherOwner','artisan','otherArtisan','admin','finRead','finWrite','moderator','auditor');
 select count(*) into n_users from auth.users where id=any(cohort);
 select count(*) into n_profiles from public.profiles where id=any(cohort);
 select count(*) into n_jobs from public.interventions where client_id=any(cohort);
 select count(*) into n_quotes from public.quotes q join public.interventions i on i.id=q.intervention_id where i.client_id=any(cohort);
 select count(*) into n_pay from public.payments p join public.quotes q on q.id=p.quote_id join public.interventions i on i.id=q.intervention_id where i.client_id=any(cohort);
 select count(*) into n_inv from public.platform_invoices where issued_by=any(cohort);
 select count(*) into n_ledger from public.platform_ledger_entries l join public.payments p on p.id=l.payment_id join public.quotes q on q.id=p.quote_id join public.interventions i on i.id=q.intervention_id where i.client_id=any(cohort);
 select count(*) into n_grants from public.platform_operator_grants where user_id=any(cohort);
 select count(*) into n_audit from public.platform_audit where actor_id=any(cohort);
 select count(*) into n_qdocs from public.quote_documents d join public.interventions i on i.id=d.intervention_id where i.client_id=any(cohort);
 select count(*) into n_site from public.sites where organization_id in (select id from public.organizations where owner_id=any(cohort));
 select count(*) into n_events from public.site_operations_events where actor_id=any(cohort);
 select count(*) into n_notes from qa_report;
 perform pg_temp.qa_note(format('lignes QA avant ROLLBACK — auth.users %s, profiles %s, interventions %s, quotes %s, payments %s, platform_invoices %s, ledger %s, grants %s, audit %s, quote_documents %s, sites %s, site_operations_events %s', n_users,n_profiles,n_jobs,n_quotes,n_pay,n_inv,n_ledger,n_grants,n_audit,n_qdocs,n_site,n_events));
 perform pg_temp.qa_note(format('RÉSUMÉ run %s : %s notes, aucun fournisseur de paiement appelé (événements simulés), commission_bps %s (%s), toutes les écritures sont annulées par le ROLLBACK qui suit', pg_temp.qa_get('run'), n_notes+1, pg_temp.qa_get('bps'), pg_temp.qa_get('commission_origin')));
end $$;
select seq, line from qa_report order by seq;
rollback;

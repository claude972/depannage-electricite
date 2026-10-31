-- WEB-TRACKING-RETENTION-006: bounded physical GPS expiry, not a new business transition.
begin;
do $$begin
 if to_regclass('public.intervention_tracking') is null or to_regprocedure('public.purge_expired_tracking_points()') is null then
  raise exception 'Tracking retention requires migration019' using errcode='P0001';
 end if;
end $$;
create index if not exists tracking_point_expiry_idx on public.intervention_tracking ((least(sampled_at,received_at)),intervention_id) where latitude is not null;
create or replace function public.purge_expired_tracking_points() returns integer language plpgsql security definer set search_path='' as $$
declare cutoff timestamptz=clock_timestamp()-interval '60 seconds'; n integer;
begin
 with expired as materialized (
  select t.intervention_id from public.intervention_tracking t
  where t.latitude is not null and least(t.sampled_at,t.received_at)<cutoff
  order by least(t.sampled_at,t.received_at),t.intervention_id
  limit 1000 for update of t skip locked
 )
 update public.intervention_tracking t set latitude=null,longitude=null,accuracy_m=null,sampled_at=null,received_at=null
 from expired e where t.intervention_id=e.intervention_id;
 get diagnostics n=row_count; return n;
end; $$;
revoke execute on function public.purge_expired_tracking_points() from public,anon,authenticated;
grant execute on function public.purge_expired_tracking_points() to service_role;

-- BEGIN PG_CRON INSTALL: tests substitute only this native-extension installation, explicitly.
do $$begin
 if current_user<>'postgres' then raise exception 'Tracking retention must be installed as postgres' using errcode='42501'; end if;
 if not exists(select 1 from pg_catalog.pg_available_extensions where name='pg_cron') then
  raise exception 'pg_cron is unavailable; tracking scheduler was not installed' using errcode='P0001';
 end if;
end $$;
create extension if not exists pg_cron with schema pg_catalog;
-- Official module setup: management schema usage for postgres only.
grant usage on schema cron to postgres;
do $$begin
 if not exists(select 1 from pg_catalog.pg_extension e join pg_catalog.pg_namespace n on n.oid=e.extnamespace where e.extname='pg_cron' and n.nspname='pg_catalog') then
  raise exception 'Unexpected pg_cron installation schema' using errcode='P0001';
 end if;
end $$;
-- END PG_CRON INSTALL

-- No table DML or global grants: use only the official scheduling API and owner-visible reads.
do $$begin
 if to_regclass('cron.job') is null or to_regprocedure('cron.schedule(text,text,text)') is null then
  raise exception 'pg_cron named jobs are unavailable' using errcode='P0001';
 end if;
 if not has_schema_privilege(current_user,'cron','USAGE') or not has_table_privilege(current_user,'cron.job','SELECT')
  or not has_function_privilege(current_user,'cron.schedule(text,text,text)','EXECUTE') then
  raise exception 'Insufficient cron owner read/schedule privileges' using errcode='42501';
 end if;
 if has_schema_privilege('anon','cron','USAGE') or has_schema_privilege('authenticated','cron','USAGE') then
  raise exception 'Unexpected client access to cron; refusing to change foreign ACLs' using errcode='42501';
 end if;
end $$;
-- Do not overwrite a named job: schedule(name,...) itself is an upsert in pg_cron.
-- Cooperative installer lock only: RLS stays active and other owners have separate named keys.
-- Administrators bypassing this protocol must not concurrently schedule our owner/name namespace.
do $$
declare name_ constant text='depannage_tracking_retention_v1'; command_ constant text='select public.purge_expired_tracking_points();'; n integer; job_ record;
begin
 if not pg_try_advisory_xact_lock(hashtext('depannage.tracking.retention'),hashtext(current_database()||':'||current_user||':'||name_)) then
  raise exception 'Tracking cron installer is already active' using errcode='55P03';
 end if;
 select count(*) into n from cron.job where jobname=name_ and username=current_user;
 if n=0 then
  perform cron.schedule(name_,'* * * * *',command_);
 elsif n<>1 then
  raise exception 'Tracking cron name collision' using errcode='P0001';
 end if;
 select * into job_ from cron.job where jobname=name_ and username=current_user;
 if not found or job_.schedule is distinct from '* * * * *' or job_.command is distinct from command_
  or job_.database is distinct from current_database() or job_.username is distinct from current_user
  or job_.active is distinct from true or job_.nodename is distinct from 'localhost'
  or job_.nodeport is distinct from inet_server_port() then
  raise exception 'Tracking cron collision or incompatible owner/target; no job was changed' using errcode='P0001';
 end if;
end $$;
commit;

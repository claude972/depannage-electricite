-- Independent of the tracking-retention job: reuse the installed application scheduler only.
-- Minute polling is technical cadence, not a promised lead time or delivery SLA.
begin;
do $$
declare name_ constant text='depannage_appointment_reminders_v1';command_ constant text='select public.emit_due_appointment_reminders(100);';job_ record;n integer;
begin
 if current_user<>'postgres' or to_regclass('cron.job')is null or to_regprocedure('cron.schedule(text,text,text)')is null then
  raise exception 'Appointment reminders require the application pg_cron scheduler and postgres installer'using errcode='P0001';end if;
 if has_schema_privilege('anon','cron','USAGE')or has_schema_privilege('authenticated','cron','USAGE')then raise insufficient_privilege;end if;
 if not pg_try_advisory_xact_lock(hashtextextended('scheduler:appointment-reminders:'||current_database()||':'||current_user,0))then raise lock_not_available;end if;
 select count(*)into n from cron.job where jobname=name_ and username=current_user;
 if n=0 then perform cron.schedule(name_,'* * * * *',command_);elsif n<>1 then raise exception 'Appointment reminder scheduler collision'using errcode='P0001';end if;
 select *into job_ from cron.job where jobname=name_ and username=current_user;
 if not found or job_.command is distinct from command_ or job_.schedule is distinct from '* * * * *'or job_.database is distinct from current_database()or job_.active is distinct from true or job_.nodename is distinct from 'localhost'or job_.nodeport is distinct from inet_server_port()then raise exception 'Incompatible appointment reminder scheduler target'using errcode='P0001';end if;
end;$$;
commit;

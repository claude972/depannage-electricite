begin;
create function public.admin_dashboard_snapshot()returns jsonb language plpgsql stable security invoker set search_path=''as $$
begin
 if not public.is_admin()then raise insufficient_privilege;end if;
 return(with active as(
  select id,artisan_id,category,city,urgency,status,created_at from public.interventions
  where status not in('paid','cancelled') order by created_at desc,id limit 6
 ),pending as(
  select p.id,p.full_name,a.company_name,a.application_status,p.created_at as account_created_at
  from public.profiles p join public.artisan_profiles a on a.user_id=p.id
  where p.role='artisan'and a.application_status='submitted'order by p.created_at desc,p.id limit 6
 )select jsonb_build_object(
  'counts',jsonb_build_object('interventions',(select count(*)from public.interventions),
    'active_interventions',(select count(*)from public.interventions where status not in('paid','cancelled')),
    'pending_applications',(select count(*)from public.artisan_profiles where application_status='submitted')),
  'active',coalesce((select jsonb_agg(to_jsonb(a)order by a.created_at desc,a.id)from active a),'[]'::jsonb),
  'pending',coalesce((select jsonb_agg(to_jsonb(p)order by p.account_created_at desc,p.id)from pending p),'[]'::jsonb),
  'limit',6,'captured_at',statement_timestamp()));
end;$$;
revoke all on function public.admin_dashboard_snapshot()from public,anon,authenticated,service_role;
grant execute on function public.admin_dashboard_snapshot()to authenticated;
commit;

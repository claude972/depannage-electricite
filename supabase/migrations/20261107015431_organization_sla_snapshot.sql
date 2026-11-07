-- ENT-11: bounded, single-statement-snapshot SLA facts under the caller's existing RLS.
begin;
create function public.organization_sla_snapshot(p_organization_id uuid,p_after_site_id uuid default null)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare org public.organizations;site_record record;sites_json jsonb='[]';cases_json jsonb;policies_json jsonb;
 calendars_json jsonb;site_count bigint;remaining_count bigint;calendar_count bigint;whole boolean;
begin
 if auth.uid() is null then raise insufficient_privilege;end if;
 if p_organization_id is null then raise invalid_parameter_value;end if;
 select * into org from public.organizations where id=p_organization_id;if not found then raise no_data_found;end if;
 whole=public.can_access_organization_wide(p_organization_id);
 -- These counts are RLS filtered. Never disclose the number of inaccessible sites.
 select count(*)into site_count from public.sites where organization_id=p_organization_id;
 select count(*)into remaining_count from public.sites where organization_id=p_organization_id and(p_after_site_id is null or id>p_after_site_id);
 for site_record in select id,name,organization_id from public.sites where organization_id=p_organization_id and(p_after_site_id is null or id>p_after_site_id) order by id limit 20 loop
  select coalesce(jsonb_agg(to_jsonb(k)order by k.opened_at desc,k.id desc),'[]')into cases_json from(
   select c.id,c.site_id,c.policy_id,c.opened_at,c.responded_at,c.resolved_at,
    (select count(*)from public.site_sla_pauses z where z.case_id=c.id)pauses_total,
    (select coalesce(jsonb_agg(to_jsonb(z)order by z.started_at,z.id),'[]')from(
     select id,case_id,site_id,started_at,ended_at from public.site_sla_pauses where case_id=c.id and site_id=site_record.id order by started_at,id limit 20)z)pauses
   from public.site_sla_cases c where c.site_id=site_record.id order by c.opened_at desc,c.id desc limit 100)k;
  select coalesce(jsonb_agg(to_jsonb(p)order by p.id),'[]')into policies_json from(
   select id,site_id,calendar_id,response_target_minutes,resolution_target_minutes,status from public.site_sla_policies
   where site_id=site_record.id and id in(select (x->>'policy_id')::uuid from jsonb_array_elements(cases_json)x)order by id limit 100)p;
  sites_json=sites_json||jsonb_build_array(jsonb_build_object('id',site_record.id,'name',site_record.name,'organization_id',site_record.organization_id,
   'cases_total',(select count(*)from public.site_sla_cases where site_id=site_record.id),'cases',cases_json,'policies',policies_json));
 end loop;
 select count(*)into calendar_count from public.organization_sla_calendars where organization_id=p_organization_id and id in(
  select (p->>'calendar_id')::uuid from jsonb_array_elements(sites_json)page_site cross join lateral jsonb_array_elements(page_site->'policies')p where p->>'calendar_id' is not null);
 select coalesce(jsonb_agg(to_jsonb(c)order by c.id),'[]')into calendars_json from(
  select id,organization_id,timezone,windows,closed_dates from public.organization_sla_calendars where organization_id=p_organization_id and id in(
   select (p->>'calendar_id')::uuid from jsonb_array_elements(sites_json)page_site cross join lateral jsonb_array_elements(page_site->'policies')p where p->>'calendar_id' is not null)order by id limit 100)c;
 return jsonb_build_object('organization_id',org.id,'captured_at',statement_timestamp(),'organization_wide',whole,
  'visible_sites_total',site_count,'remaining_sites_total',remaining_count,'sites',sites_json,'calendars_total',calendar_count,'calendars',calendars_json);
end;$$;
revoke all on function public.organization_sla_snapshot(uuid,uuid)from public,anon,authenticated,service_role;
grant execute on function public.organization_sla_snapshot(uuid,uuid)to authenticated;
commit;

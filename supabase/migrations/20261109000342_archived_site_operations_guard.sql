begin;

create or replace function public.lock_writable_site_for_operations(p_site_id uuid)
returns void language plpgsql security invoker set search_path = ''
as $$
begin
  perform public.lock_site_access(p_site_id);
  perform 1 from public.sites where id = p_site_id and archived_at is null for share;
  if not found then raise exception 'Archived site is read only' using errcode = 'P0001'; end if;
end;
$$;
revoke all on function public.lock_writable_site_for_operations(uuid)
  from public, anon, authenticated, service_role;

create or replace function public.save_site_equipment(p_site_id uuid,p_payload jsonb,p_id uuid default null,p_expected_version integer default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare org uuid; rec public.site_equipment;
begin
 perform public.lock_writable_site_for_operations(p_site_id); org=public.so_site_organization(p_site_id);
 perform public.so_keys(p_payload,array['name','category','criticality','location','reference','installed_on','status','notes']);
 perform public.consume_action('site_operations',60);
 if p_id is null then
  insert into public.site_equipment(site_id,name,category,criticality,location,reference,installed_on,status,notes,created_by)
  values(p_site_id,public.so_text(p_payload,'name',1,160),public.so_enum(p_payload,'category',array['panel','lighting','emergency_lighting','fire_safety','hvac','generator','ups','other'],true),
   public.so_enum(p_payload,'criticality',array['low','medium','high','critical'],true),public.so_text(p_payload,'location',0,160),public.so_text(p_payload,'reference',0,160),
   public.so_date(p_payload,'installed_on',false),public.so_enum(p_payload,'status',array['in_service','degraded','out_of_service','retired'],true),public.so_text(p_payload,'notes',0,4000),auth.uid())
  returning * into rec;
  perform public.so_log(org,p_site_id,'equipment',rec.id,'created',rec.version,to_jsonb(rec));
 else
  select * into rec from public.site_equipment where id=p_id and site_id=p_site_id for update;
  if not found then raise no_data_found; end if;
  perform public.so_version(rec.version,p_expected_version);
  update public.site_equipment set name=public.so_text(p_payload,'name',1,160),category=public.so_enum(p_payload,'category',array['panel','lighting','emergency_lighting','fire_safety','hvac','generator','ups','other'],true),
   criticality=public.so_enum(p_payload,'criticality',array['low','medium','high','critical'],true),location=public.so_text(p_payload,'location',0,160),reference=public.so_text(p_payload,'reference',0,160),
   installed_on=public.so_date(p_payload,'installed_on',false),status=public.so_enum(p_payload,'status',array['in_service','degraded','out_of_service','retired'],true),notes=public.so_text(p_payload,'notes',0,4000),
   version=version+1,updated_at=now() where id=p_id returning * into rec;
  perform public.so_log(org,p_site_id,'equipment',rec.id,'updated',rec.version,to_jsonb(rec));
 end if;
 return to_jsonb(rec);
end; $$;

create or replace function public.record_maintenance_visit(p_plan_id uuid,p_done_on date,p_summary text,p_intervention_id uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare org uuid; plan public.site_maintenance_plans; visit public.site_maintenance_visits; due date;
begin
 select site_id into org from public.site_maintenance_plans where id=p_plan_id;
 -- Site lock before any check: unknown plan and foreign plan answer the same refusal.
 perform public.lock_writable_site_for_operations(org);
 select * into plan from public.site_maintenance_plans where id=p_plan_id for update;
 if not found then raise no_data_found; end if;
 org=public.so_site_organization(plan.site_id);
 if p_done_on is null or p_summary is null or char_length(p_summary)>4000 then raise invalid_parameter_value; end if;
 if p_intervention_id is not null and not exists(select 1 from public.interventions where id=p_intervention_id and site_id=plan.site_id) then raise insufficient_privilege; end if;
 perform public.consume_action('site_operations',60);
 insert into public.site_maintenance_visits(plan_id,site_id,done_on,intervention_id,summary,created_by) values(p_plan_id,plan.site_id,p_done_on,p_intervention_id,trim(p_summary),auth.uid()) returning * into visit;
 -- Next due date only from a configured frequency; otherwise it stays as entered (possibly null).
 due=case plan.frequency_kind when 'days' then p_done_on+plan.frequency_value when 'weeks' then p_done_on+plan.frequency_value*7 when 'months' then (p_done_on+(plan.frequency_value||' months')::interval)::date else plan.next_due_on end;
 update public.site_maintenance_plans set last_done_on=greatest(coalesce(last_done_on,p_done_on),p_done_on),next_due_on=due,version=version+1,updated_at=now() where id=p_plan_id returning * into plan;
 perform public.so_log(org,plan.site_id,'maintenance_visit',visit.id,'recorded',plan.version,jsonb_build_object('visit',to_jsonb(visit),'plan',to_jsonb(plan)));
 return jsonb_build_object('visit',to_jsonb(visit),'plan',to_jsonb(plan));
end; $$;

commit;

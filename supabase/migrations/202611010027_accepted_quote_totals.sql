-- Read-only accepted amounts under the caller's JWT and existing table RLS.
begin;
create function public.accepted_quote_totals(p_quote_ids uuid[]) returns table(quote_id uuid,accepted_total_cents bigint)
language plpgsql stable security invoker set search_path='' as $$
begin
 if auth.uid() is null then raise insufficient_privilege; end if;
 if p_quote_ids is null or cardinality(p_quote_ids)>200 or coalesce(array_ndims(p_quote_ids),1)<>1
  or exists(select 1 from unnest(p_quote_ids) x where x is null)
  or (select count(distinct x) from unnest(p_quote_ids) x)<>cardinality(p_quote_ids) then raise invalid_parameter_value; end if;
 return query select q.id,q.total_cents::bigint+coalesce(sum(a.total_cents),0)::bigint
 from public.quotes q left join public.quote_amendments a on a.base_quote_id=q.id and a.intervention_id=q.intervention_id and a.artisan_id=q.artisan_id and a.status='accepted'
 where q.id=any(p_quote_ids) and q.status='accepted' group by q.id
 having q.total_cents::bigint+coalesce(sum(a.total_cents),0) between 1 and 9007199254740991;
end; $$;
revoke all on function public.accepted_quote_totals(uuid[]) from public,anon,authenticated;
grant execute on function public.accepted_quote_totals(uuid[]) to authenticated;

create or replace function public.site_operations_snapshot(p_site_id uuid) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare org uuid; site_row public.sites; grids_readable boolean;
begin
 if p_site_id is null or not public.can_access_site(p_site_id) then raise insufficient_privilege; end if;
 select * into site_row from public.sites where id=p_site_id;
 if not found then raise insufficient_privilege; end if;
 org=site_row.organization_id;
 grids_readable=public.can_access_organization_wide(org) or public.is_admin();
 return jsonb_build_object(
  'site',jsonb_build_object('id',site_row.id,'organization_id',org,'name',site_row.name,'type',site_row.type,'budget_cents',site_row.budget_cents),
  'equipment',(select coalesce(jsonb_agg(to_jsonb(e) order by e.updated_at desc,e.id desc),'[]'::jsonb) from (select * from public.site_equipment where site_id=p_site_id order by updated_at desc,id desc limit 300) e),
  'maintenance_plans',(select coalesce(jsonb_agg(to_jsonb(m)||jsonb_build_object('visits',(select coalesce(jsonb_agg(to_jsonb(v) order by v.done_on desc,v.id desc),'[]'::jsonb) from (select * from public.site_maintenance_visits where plan_id=m.id order by done_on desc,id desc limit 20) v),'visits_total',(select count(*) from public.site_maintenance_visits where plan_id=m.id)) order by m.updated_at desc,m.id desc),'[]'::jsonb) from (select * from public.site_maintenance_plans where site_id=p_site_id order by updated_at desc,id desc limit 300) m),
  'fiscal_years',(select coalesce(jsonb_agg(to_jsonb(f) order by f.starts_on desc),'[]'::jsonb) from (select * from public.organization_fiscal_years where organization_id=org order by starts_on desc limit 50) f),
  'budget_lines',(select coalesce(jsonb_agg(to_jsonb(b) order by b.fiscal_year_id,b.category),'[]'::jsonb) from (select * from public.site_budget_lines where site_id=p_site_id order by fiscal_year_id,category limit 300) b),
  'budget_consumption',(select coalesce(jsonb_agg(x order by x->>'fiscal_year_id'),'[]'::jsonb) from (
    select jsonb_build_object('fiscal_year_id',fy.id,'accepted_cents',coalesce(sum(q.total_cents::bigint+(select coalesce(sum(a.total_cents),0) from public.quote_amendments a where a.base_quote_id=q.id and a.intervention_id=i.id and a.artisan_id=q.artisan_id and a.status='accepted')),0),'paid_cents',coalesce(sum((select coalesce(sum(p.total_cents),0) from public.payments p where p.quote_id=q.id and p.status='paid')),0),'interventions',count(distinct i.id)) x
    from public.organization_fiscal_years fy
    left join (public.interventions i join public.quotes q on q.intervention_id=i.id and q.status='accepted') on i.site_id=p_site_id and q.accepted_at is not null and (q.accepted_at at time zone 'UTC')::date between fy.starts_on and fy.ends_on
    where fy.organization_id=org group by fy.id) s),
  'contract_grids',case when grids_readable then (select coalesce(jsonb_agg(to_jsonb(g) order by g.lineage_id,g.version_number desc),'[]'::jsonb) from (select * from public.organization_contract_grids where organization_id=org order by updated_at desc limit 100) g) else null end,
  'sla_calendars',(select coalesce(jsonb_agg(to_jsonb(c) order by c.name,c.id),'[]'::jsonb) from (select * from public.organization_sla_calendars where organization_id=org order by name,id limit 50) c),
  'sla_policies',(select coalesce(jsonb_agg(to_jsonb(p) order by p.updated_at desc,p.id desc),'[]'::jsonb) from (select * from public.site_sla_policies where site_id=p_site_id order by updated_at desc,id desc limit 100) p),
  -- Pauses feed the SLA computation: every pause of a case is returned (no limit) with its total,
  -- so the computation can refuse to measure if the two ever disagree.
  'sla_cases',(select coalesce(jsonb_agg(to_jsonb(k)||jsonb_build_object('pauses',(select coalesce(jsonb_agg(to_jsonb(z) order by z.started_at,z.id),'[]'::jsonb) from public.site_sla_pauses z where z.case_id=k.id),'pauses_total',(select count(*) from public.site_sla_pauses where case_id=k.id)) order by k.opened_at desc,k.id desc),'[]'::jsonb) from (select * from public.site_sla_cases where site_id=p_site_id order by opened_at desc,id desc limit 300) k),
  'erp_checklists',(select coalesce(jsonb_agg(to_jsonb(l) order by l.updated_at desc,l.id desc),'[]'::jsonb) from (select * from public.site_erp_checklists where site_id=p_site_id order by updated_at desc,id desc limit 100) l),
  'events',(select coalesce(jsonb_agg(to_jsonb(ev) order by ev.id desc),'[]'::jsonb) from (select id,site_id,actor_id,entity,entity_id,action,version,created_at from public.site_operations_events where (site_id=p_site_id or (site_id is null and organization_id=org)) order by id desc limit 100) ev),
  'limits',jsonb_build_object(
   'equipment_limited',(select count(*)>300 from public.site_equipment where site_id=p_site_id),
   'maintenance_plans_limited',(select count(*)>300 from public.site_maintenance_plans where site_id=p_site_id),
   'fiscal_years_limited',(select count(*)>50 from public.organization_fiscal_years where organization_id=org),
   'budget_lines_limited',(select count(*)>300 from public.site_budget_lines where site_id=p_site_id),
   'contract_grids_limited',grids_readable and (select count(*)>100 from public.organization_contract_grids where organization_id=org),
   'contract_grids_readable',grids_readable,
   'sla_calendars_limited',(select count(*)>50 from public.organization_sla_calendars where organization_id=org),
   'sla_policies_limited',(select count(*)>100 from public.site_sla_policies where site_id=p_site_id),
   'sla_cases_limited',(select count(*)>300 from public.site_sla_cases where site_id=p_site_id),
   'erp_checklists_limited',(select count(*)>100 from public.site_erp_checklists where site_id=p_site_id),
   'events_limited',(select count(*)>100 from public.site_operations_events where site_id=p_site_id or (site_id is null and organization_id=org)),
   'can_write_site',public.can_manage_site(p_site_id),
   'can_write_organization',public.can_access_organization_wide(org,true)));
end; $$;

commit;

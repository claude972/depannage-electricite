-- Read-only consolidation of declared readings, never physical site telemetry.
begin;
create function public.organization_energy_consolidation(p_organization_id uuid,p_site_ids uuid[],p_from date,p_to date,p_previous_from date default null,p_previous_to date default null)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare result jsonb; meter_count integer;
begin
 if auth.uid() is null then raise insufficient_privilege;end if;
 if p_site_ids is null or cardinality(p_site_ids) not between 1 and 50
 or array_position(p_site_ids,null) is not null or cardinality(p_site_ids)<>(select count(distinct id)from unnest(p_site_ids)id)
 or p_from is null or p_to is null or not isfinite(p_from)or not isfinite(p_to)or p_to-p_from not between 0 and 365
 or (p_previous_from is null)<>(p_previous_to is null)
 or (p_previous_from is not null and(not isfinite(p_previous_from)or not isfinite(p_previous_to)or p_previous_to-p_previous_from not between 0 and 365))then raise invalid_parameter_value;end if;
 -- All requested sites must be authorized: never silently aggregate a smaller scope.
 if not exists(select 1 from public.organization_members where organization_id=p_organization_id and user_id=auth.uid())
 or (select count(*)from public.sites where id=any(p_site_ids)and organization_id=p_organization_id and public.can_access_site(id))<>cardinality(p_site_ids)then raise no_data_found;end if;
 select count(*)into meter_count from(select site_id,lower(btrim(meter_label))from public.site_energy_periods where site_id=any(p_site_ids)and archived_at is null group by 1,2)m;
 if meter_count>500 then raise exception 'Select fewer sites: more than 500 declared meters'using errcode='22023';end if;
 with windows as(select 'current'::text label,p_from first_day,p_to last_day union all select 'previous',p_previous_from,p_previous_to where p_previous_from is not null),
 meters as(select site_id,lower(btrim(meter_label)) meter from public.site_energy_periods where site_id=any(p_site_ids)and archived_at is null group by 1,2),
 stats as(select m.site_id,m.meter,w.label,w.first_day,w.last_day,
 count(e.id)filter(where e.period_start>=w.first_day and e.period_end<=w.last_day)::int record_count,
 count(e.id)filter(where e.period_start<w.first_day or e.period_end>w.last_day)::int crossing_count,
 count(e.id)filter(where e.period_start>=w.first_day and e.period_end<=w.last_day and e.cost_cents is null)::int missing_cost_count,
 sum(e.consumption_wh)filter(where e.period_start>=w.first_day and e.period_end<=w.last_day)::text consumption_wh,
 sum(e.cost_cents)filter(where e.period_start>=w.first_day and e.period_end<=w.last_day)::text cost_cents,
 coalesce(range_agg(daterange(e.period_start,e.period_end,'[]'))filter(where e.id is not null)=datemultirange(daterange(w.first_day,w.last_day,'[]'))
 and sum(e.period_end-e.period_start+1)=w.last_day-w.first_day+1,false) coverage_complete
 from meters m cross join windows w left join public.site_energy_periods e on e.site_id=m.site_id and lower(btrim(e.meter_label))=m.meter and e.archived_at is null and e.period_start<=w.last_day and e.period_end>=w.first_day
 group by m.site_id,m.meter,w.label,w.first_day,w.last_day),
 rows as(select site_id,meter,jsonb_object_agg(label,jsonb_build_object('record_count',record_count,'crossing_count',crossing_count,'missing_cost_count',missing_cost_count,'consumption_wh',consumption_wh,'cost_cents',case when missing_cost_count=0 then cost_cents else null end,'coverage_complete',coverage_complete)) periods from stats group by site_id,meter)
 select jsonb_build_object('organization_id',p_organization_id,'site_ids',to_jsonb(p_site_ids),'meters',coalesce((select jsonb_agg(jsonb_build_object('site_id',site_id,'meter_label',meter,'current',periods->'current','previous',periods->'previous')order by site_id,meter)from rows),'[]'::jsonb))into result;
 return result;
end;$$;
revoke all on function public.organization_energy_consolidation(uuid,uuid[],date,date,date,date)from public,anon,authenticated,service_role;
grant execute on function public.organization_energy_consolidation(uuid,uuid[],date,date,date,date)to authenticated;
commit;

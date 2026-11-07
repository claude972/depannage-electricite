begin;
create function public.enterprise_professional_overview(p_organization uuid,p_site uuid default null)
returns jsonb language plpgsql stable security invoker set search_path=''as $$
declare actor uuid=auth.uid();today date=(statement_timestamp()at time zone'America/Martinique')::date;result jsonb;
begin
 if actor is null or not exists(select 1 from public.profiles where id=actor and role='manager')then raise insufficient_privilege;end if;
 if p_organization is null then raise invalid_parameter_value;end if;
 if not exists(select 1 from public.organization_members where organization_id=p_organization and user_id=actor)
 or(p_site is not null and not exists(select 1 from public.sites where id=p_site and organization_id=p_organization))then raise no_data_found;end if;
 with visible_sites as materialized(select s.id,s.budget_cents from public.sites s where s.organization_id=p_organization and(p_site is null or s.id=p_site)),
 accepted as materialized(
  select q.id,q.total_cents::numeric+coalesce((select sum(a.total_cents)::numeric from public.quote_amendments a
   where a.base_quote_id=q.id and a.intervention_id=q.intervention_id and a.artisan_id=q.artisan_id and a.status='accepted'),0)total
  from public.quotes q join public.interventions i on i.id=q.intervention_id join visible_sites s on s.id=i.site_id where q.status='accepted'
 )
 select jsonb_build_object('organization_id',p_organization,'site_id',p_site,
  'counts',jsonb_build_object(
   'approvals_pending',(select count(*)from public.approvals a join visible_sites s on s.id=a.site_id where a.status='pending'),
   'deadlines30',(select count(*)from public.compliance_records c join visible_sites s on s.id=c.site_id where c.status<>'completed'and c.due_on between today and today+30)),
  'amounts',jsonb_build_object('accepted_commitment_cents',(select coalesce(sum(total),0)from accepted),
    'reference_budget_cents',(select coalesce(sum(budget_cents::numeric),0)from visible_sites),'currency','eur'),
  'window',jsonb_build_object('from',today,'to',today+30,'time_zone','America/Martinique'),'captured_at',statement_timestamp())into result;
 if(result#>>'{amounts,accepted_commitment_cents}')::numeric not between 0 and 9007199254740991
 or(result#>>'{amounts,reference_budget_cents}')::numeric not between 0 and 9007199254740991 then raise exception 'Aggregate unavailable'using errcode='P0003';end if;
 return result;
end;$$;
revoke all on function public.enterprise_professional_overview(uuid,uuid)from public,anon,authenticated,service_role;
grant execute on function public.enterprise_professional_overview(uuid,uuid)to authenticated;
commit;

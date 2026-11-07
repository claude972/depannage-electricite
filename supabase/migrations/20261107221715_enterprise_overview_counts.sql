begin;
create function public.enterprise_overview_counts(p_organization uuid,p_site uuid default null)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare actor uuid:=auth.uid();
begin
 if actor is null or not exists(select 1 from public.profiles where id=actor and role='manager')then raise insufficient_privilege;end if;
 if p_organization is null then raise invalid_parameter_value;end if;
 if not exists(select 1 from public.organization_members where organization_id=p_organization and user_id=actor)
 or(p_site is not null and not exists(select 1 from public.sites where id=p_site and organization_id=p_organization))then raise no_data_found;end if;
 -- Same current scope as enterprise_intervention_search, without its page limit.
 -- Both aggregates share one statement snapshot and both table RLS policies.
 return(select jsonb_build_object('organization_id',p_organization,'site_id',p_site,
  'counts',jsonb_build_object('open',count(*),'urgent',count(*)filter(where i.urgency='urgent')),
  'captured_at',statement_timestamp())
  from public.sites s join public.interventions i on i.site_id=s.id
  where s.organization_id=p_organization and(p_site is null or s.id=p_site)
   and i.status in('requested','assigned','quoted','accepted','in_progress'));
end;$$;
revoke all on function public.enterprise_overview_counts(uuid,uuid)from public,anon,authenticated,service_role;
grant execute on function public.enterprise_overview_counts(uuid,uuid)to authenticated;
commit;

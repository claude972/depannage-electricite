begin;
create or replace function public.create_intervention_before_site_access(p_category text,p_description text,p_address text,p_postal_code text,p_city text,p_urgency text,p_site_id uuid default null)
returns public.interventions language plpgsql security definer set search_path=''as $$
declare r jsonb;
begin
 -- Preserve the original authorization-before-category-validation contract.
 if not exists(select 1 from public.profiles where id=auth.uid()and role in('client','manager','admin'))then raise insufficient_privilege;end if;
 if p_site_id is not null and not exists(select 1 from public.sites where id=p_site_id and public.is_org_member(organization_id,true))then raise insufficient_privilege;end if;
 r=indicative_price_private.current_range(p_category);
 return indicative_price_private.create_reserved_intervention(p_category,p_description,p_address,p_postal_code,p_city,p_urgency,p_site_id,(r->>'version')::integer,(r->>'min_cents')::integer,(r->>'max_cents')::integer);
end;$$;
commit;

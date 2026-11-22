-- Customer invoice readers. The operator register's RLS and grants stay unchanged.
begin;
create function public.customer_invoice_authorized(p_id uuid)returns boolean
language plpgsql stable security definer set search_path='' as $$
declare actor uuid=auth.uid();i public.platform_invoices;
begin
 if actor is null or not exists(select 1 from public.profiles where id=actor)then return false;end if;
 select * into i from public.platform_invoices where id=p_id;if not found then return false;end if;
 if i.basis='platform_commission' then return i.issuer_key='platform' and coalesce(i.recipient->>'profile_id'=actor::text,false);end if;
 if i.basis<>'service' then return false;end if;
 if i.issuer_key='artisan:'||actor::text and i.issuer->>'profile_id'=actor::text then return true;end if;
 if i.recipient->>'subject_kind'='profile' and i.recipient->>'subject_id'=actor::text then return true;end if;
 return coalesce(i.recipient->>'subject_kind'='organization' and exists(
  select 1 from public.interventions j join public.sites s on s.id=j.site_id
  where j.id=i.intervention_id and s.organization_id::text=i.recipient->>'subject_id'
   and public.can_access_site(s.id) and public.is_org_member(s.organization_id)),false);
end;$$;
revoke all on function public.customer_invoice_authorized(uuid)from public,anon,authenticated,service_role;

create function public.customer_invoice_page(p_organization_id uuid default null,p_site_id uuid default null,p_intervention_id uuid default null,
 p_kind text default null,p_basis text default null,p_limit integer default 25,p_after_at timestamptz default null,p_after_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid())then raise insufficient_privilege;end if;
 if p_limit is null or p_limit not between 1 and 50 or(p_kind is not null and p_kind not in('invoice','credit_note'))
 or(p_basis is not null and p_basis not in('service','platform_commission'))or((p_after_at is null)<>(p_after_id is null))then raise invalid_parameter_value;end if;
 if p_organization_id is not null and not public.is_org_member(p_organization_id)then raise no_data_found;end if;
 if p_site_id is not null and not public.can_access_site(p_site_id)then raise no_data_found;end if;
 if p_site_id is not null and p_organization_id is not null and not exists(select 1 from public.sites where id=p_site_id and organization_id=p_organization_id)then raise no_data_found;end if;
 if p_intervention_id is not null and not public.can_access_intervention(p_intervention_id) and not exists(select 1 from public.platform_invoices where intervention_id=p_intervention_id and public.customer_invoice_authorized(id))then raise no_data_found;end if;
 -- Only qualified invoice IDs enter the filter stage; internal register metadata
 -- and unrelated case data are never returned by these customer endpoints.
 with authorized as materialized(
  select i.id,i.intervention_id,i.kind,i.basis,i.issued_at from public.platform_invoices i where public.customer_invoice_authorized(i.id)
 ),filtered as materialized(
  select a.*from authorized a where(p_kind is null or a.kind=p_kind)and(p_basis is null or a.basis=p_basis)
  and(p_intervention_id is null or a.intervention_id=p_intervention_id)
  and(p_site_id is null or exists(select 1 from public.interventions j where j.id=a.intervention_id and j.site_id=p_site_id))
  and(p_organization_id is null or exists(select 1 from public.interventions j join public.sites s on s.id=j.site_id where j.id=a.intervention_id and s.organization_id=p_organization_id))
 ),remaining as materialized(select *from filtered where p_after_at is null or(issued_at,id)<(p_after_at,p_after_id)),selected as(
  select i.*from public.platform_invoices i join(select id from remaining order by issued_at desc,id desc limit p_limit)p on p.id=i.id
 )select jsonb_build_object('captured_at',statement_timestamp(),'total',(select count(*)from filtered),'remaining',(select count(*)from remaining),
  'invoices',(select coalesce(jsonb_agg(to_jsonb(s)-array['request_id','issued_by','content_fingerprint'] order by s.issued_at desc,s.id desc),'[]')from selected s))into result;
 return result;
end;$$;
revoke all on function public.customer_invoice_page(uuid,uuid,uuid,text,text,integer,timestamptz,uuid)from public,anon,authenticated,service_role;
grant execute on function public.customer_invoice_page(uuid,uuid,uuid,text,text,integer,timestamptz,uuid)to authenticated;

create function public.customer_invoice_document(p_id uuid)returns jsonb language plpgsql stable security definer set search_path='' as $$
declare i public.platform_invoices;parent public.platform_invoices;notes jsonb;note_count bigint;
begin
 if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid())then raise insufficient_privilege;end if;
 if p_id is null or not public.customer_invoice_authorized(p_id)then raise no_data_found;end if;
 select *into i from public.platform_invoices where id=p_id;
 if i.kind='credit_note'then
  if not public.customer_invoice_authorized(i.related_invoice_id)then raise exception 'Invoice dependency unavailable'using errcode='P0003';end if;
  select *into parent from public.platform_invoices where id=i.related_invoice_id;
 end if;
 select count(*)into note_count from public.platform_invoices where related_invoice_id=p_id and kind='credit_note'and public.customer_invoice_authorized(id);
 select coalesce(jsonb_agg(to_jsonb(n)-array['request_id','issued_by','content_fingerprint'] order by n.issued_at,n.id),'[]')into notes from(
  select *from public.platform_invoices where related_invoice_id=p_id and kind='credit_note'and public.customer_invoice_authorized(id)order by issued_at,id limit 50)n;
 return jsonb_build_object('invoice',to_jsonb(i)-array['request_id','issued_by','content_fingerprint'],
  'related',case when parent.id is null then null else to_jsonb(parent)-array['request_id','issued_by','content_fingerprint']end,
  'credit_notes',notes,'credit_notes_total',note_count);
end;$$;
revoke all on function public.customer_invoice_document(uuid)from public,anon,authenticated,service_role;
grant execute on function public.customer_invoice_document(uuid)to authenticated;
commit;

-- Visible-site financial facts. No bank call, rate/TVA change, payment or refund execution.
begin;
drop function public.professional_report(uuid);
create function public.professional_report(p_site_id uuid default null,p_organization_id uuid default null)
returns table(site_id uuid,name text,type text,budget_cents integer,paid_cents bigint,committed_cents bigint,interventions bigint,
 accepted_cents bigint,active_accepted_cents bigint,declared_paid_cents bigint,unverified_paid_cents bigint,refunded_cents bigint,net_paid_cents bigint,financial_complete boolean)
language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid()is null or not exists(select 1 from public.profiles where id=auth.uid())then raise insufficient_privilege;end if;
 if p_site_id is not null and not public.can_access_site(p_site_id)then raise no_data_found;end if;
 if p_organization_id is not null and not(public.is_org_member(p_organization_id)or public.is_admin())then raise no_data_found;end if;
 if p_site_id is not null and p_organization_id is not null and not exists(select 1 from public.sites s where s.id=p_site_id and s.organization_id=p_organization_id)then raise no_data_found;end if;
 -- A malformed accepted amendment is unknown, never silently omitted as zero.
 if exists(select 1 from public.quote_amendments a join public.quotes q on q.id=a.base_quote_id join public.interventions j on j.id=q.intervention_id join public.sites s on s.id=j.site_id
  where public.can_access_site(s.id)and(p_site_id is null or s.id=p_site_id)and(p_organization_id is null or s.organization_id=p_organization_id)
   and q.status='accepted'and a.status='accepted'and(a.intervention_id<>j.id or a.artisan_id<>q.artisan_id or a.subtotal_cents::bigint+a.tax_cents<>a.total_cents))then raise exception 'Accepted amount unavailable'using errcode='P0003';end if;
 -- Refund requests/credit notes are not settlements. Only the exact immutable
 -- service-event ledger entry corroborating a settled request is authoritative.
 if exists(select 1 from public.platform_refund_requests r join public.payments p on p.id=r.payment_id join public.quotes q on q.id=p.quote_id join public.interventions j on j.id=q.intervention_id join public.sites s on s.id=j.site_id
  where public.can_access_site(s.id)and(p_site_id is null or s.id=p_site_id)and(p_organization_id is null or s.organization_id=p_organization_id)and r.status='settled'
   and(p.status<>'paid'or p.method<>'stripe'or p.paid_at is null or not exists(select 1 from public.platform_ledger_entries l join public.stripe_events e on e.id=l.external_event_id
    where l.entry_kind='refund_settled'and l.direction='debit'and l.payment_id=p.id and l.currency='eur'and l.amount_cents=r.amount_cents and l.external_event_id=r.settled_event_id
     and l.basis->>'refund_request_id'=r.id::text and l.basis->>'provider_reference'=r.provider_reference and l.basis->>'provider_status'='succeeded'and l.basis->>'session_id'=p.session_id)))then raise exception 'Refund facts unavailable'using errcode='P0003';end if;
 if exists(select 1 from public.payments p join public.quotes q on q.id=p.quote_id join public.interventions j on j.id=q.intervention_id join public.sites s on s.id=j.site_id
  where public.can_access_site(s.id)and(p_site_id is null or s.id=p_site_id)and(p_organization_id is null or s.organization_id=p_organization_id)
   and(select coalesce(sum(r.amount_cents),0)from public.platform_refund_requests r where r.payment_id=p.id and r.status='settled')>p.total_cents)then raise exception 'Refund totals inconsistent'using errcode='P0003';end if;
 return query with visible_sites as materialized(
  select s.*from public.sites s where public.can_access_site(s.id)and(p_site_id is null or s.id=p_site_id)and(p_organization_id is null or s.organization_id=p_organization_id)
 ),jobs as materialized(select j.*from public.interventions j join visible_sites s on s.id=j.site_id),
 amounts as(
  select q.intervention_id,sum(q.total_cents::bigint+(select coalesce(sum(a.total_cents),0)from public.quote_amendments a where a.base_quote_id=q.id and a.status='accepted'and a.intervention_id=q.intervention_id and a.artisan_id=q.artisan_id))::bigint accepted
  from public.quotes q join jobs j on j.id=q.intervention_id where q.status='accepted'group by q.intervention_id
 ),refunds as(select r.payment_id,sum(r.amount_cents)::bigint amount from public.platform_refund_requests r join public.payments p on p.id=r.payment_id join public.quotes q on q.id=p.quote_id join jobs j on j.id=q.intervention_id where r.status='settled'group by r.payment_id),
 receipts as(
  select q.intervention_id,
   coalesce(sum(p.total_cents)filter(where p.method='stripe'and p.paid_at is not null),0)::bigint bank,
   coalesce(sum(p.total_cents)filter(where p.method='on_site_declared'),0)::bigint declared,
   coalesce(sum(p.total_cents)filter(where p.method='stripe'and p.paid_at is null),0)::bigint unverified,
   coalesce(sum(r.amount),0)::bigint refunded
  from public.payments p join public.quotes q on q.id=p.quote_id join jobs j on j.id=q.intervention_id left join refunds r on r.payment_id=p.id where p.status='paid'group by q.intervention_id
 ),facts as(
  select j.id,j.site_id,coalesce(a.accepted,0)::bigint accepted,
   case when j.status<>'cancelled'then coalesce(a.accepted,0)else 0 end::bigint active,
   coalesce(r.bank,0)::bigint bank,coalesce(r.declared,0)::bigint declared,coalesce(r.unverified,0)::bigint unverified,coalesce(r.refunded,0)::bigint refunded
  from jobs j left join amounts a on a.intervention_id=j.id left join receipts r on r.intervention_id=j.id
 )select s.id,s.name,s.type,s.budget_cents,coalesce(sum(f.bank),0)::bigint,
  coalesce(sum(greatest(f.active-f.bank-f.declared,0)),0)::bigint,count(f.id)::bigint,
  coalesce(sum(f.accepted),0)::bigint,coalesce(sum(f.active),0)::bigint,coalesce(sum(f.declared),0)::bigint,
  coalesce(sum(f.unverified),0)::bigint,coalesce(sum(f.refunded),0)::bigint,coalesce(sum(f.bank-f.refunded),0)::bigint,coalesce(bool_and(f.unverified=0),true)
 from visible_sites s left join facts f on f.site_id=s.id group by s.id,s.name,s.type,s.budget_cents order by s.id;
end;$$;
revoke all on function public.professional_report(uuid,uuid)from public,anon,authenticated,service_role;
grant execute on function public.professional_report(uuid,uuid)to authenticated;
commit;

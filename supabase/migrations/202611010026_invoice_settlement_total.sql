-- Invoice the exact settled base plus accepted amendments; existing issuance/ACLs remain unchanged.
begin;
create or replace function public.platform_invoice_readiness(p_basis text,p_payment_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
#variable_conflict use_variable
declare pay public.payments; q public.quotes; job public.interventions; artisan public.artisan_profiles; artisan_account public.profiles; billing public.platform_billing_contacts;
 missing text[]='{}'; issuer jsonb; recipient jsonb; lines jsonb; subtotal integer; tax_rate numeric; tax integer; total integer; setting public.platform_settings; fee public.platform_ledger_entries; org uuid; issuer_key text; service_address text;
 amendment public.quote_amendments; snapshot jsonb; receipt public.on_site_receipts; settlement public.guest_settlements;
 sum_subtotal bigint; sum_tax bigint; sum_total bigint; line_total numeric=0; item jsonb; invalid boolean=false; mixed boolean=false;
begin
 if not public.has_platform_scope('finance_read') then raise insufficient_privilege; end if;
 if p_basis not in ('service','platform_commission') or p_payment_id is null then raise invalid_parameter_value; end if;
 select * into pay from public.payments where id=p_payment_id;
 if not found then raise no_data_found; end if;
 if pay.status<>'paid' then missing=array_append(missing,'payment_not_settled'); end if;
 select * into q from public.quotes where id=pay.quote_id;
 if q.status is distinct from 'accepted' then missing=array_append(missing,'quote_not_accepted'); end if;
 select * into job from public.interventions where id=q.intervention_id;
 select * into artisan from public.artisan_profiles where user_id=q.artisan_id;
 select * into artisan_account from public.profiles where id=q.artisan_id;
 if job.site_id is not null then select s.organization_id into org from public.sites s where s.id=job.site_id; end if;
 service_address=job.address||', '||job.postal_code||' '||job.city;
 if exists(select 1 from public.platform_invoices where payment_id=p_payment_id and basis=p_basis and kind='invoice') then missing=array_append(missing,'already_issued'); end if;
 if p_basis='service' then
  if artisan.user_id is null or char_length(trim(artisan.company_name))<1 then missing=array_append(missing,'artisan_company_name'); end if;
  if artisan.user_id is null or artisan.siret !~ '^[0-9]{14}$' then missing=array_append(missing,'artisan_siret'); end if;
  if artisan.user_id is null or char_length(trim(artisan.legal_status))<1 then missing=array_append(missing,'artisan_legal_status'); end if;
  if artisan.user_id is null or char_length(trim(artisan.address))<5 then missing=array_append(missing,'artisan_address'); end if;
  issuer=jsonb_build_object('legal_name',artisan.company_name,'siret',artisan.siret,'legal_status',artisan.legal_status,'address',artisan.address,'vat_number',null,'profile_id',q.artisan_id);
  issuer_key='artisan:'||q.artisan_id::text;
  -- Authoritative billing contact only: organization of the site when present, otherwise the requester profile.
  if org is not null then select * into billing from public.platform_billing_contacts where subject_kind='organization' and subject_id=org; end if;
  if billing.subject_id is null then select * into billing from public.platform_billing_contacts where subject_kind='profile' and subject_id=job.client_id; end if;
  if billing.subject_id is null then missing=array_append(missing,'billing_contact'); end if;
  recipient=case when billing.subject_id is null then null else jsonb_build_object('name',billing.legal_name,'address',billing.address,'siret',billing.siret,'vat_number',billing.vat_number,'subject_kind',billing.subject_kind,'subject_id',billing.subject_id,'billing_version',billing.version) end;
  -- Preserve original lines and amounts: accepted amendments are additive, never replacements.
  lines=q.lines; tax_rate=q.tax_rate; sum_subtotal=q.subtotal_cents; sum_tax=q.tax_cents; sum_total=q.total_cents;
  select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'version',m.version,'total_cents',m.total_cents) order by m.id),'[]'::jsonb)
   into snapshot from public.quote_amendments m where m.base_quote_id=q.id and m.status='accepted';
  for amendment in select * from public.quote_amendments m where m.base_quote_id=q.id and m.status='accepted' order by m.version,m.id loop
   invalid=invalid or amendment.intervention_id is distinct from job.id or amendment.artisan_id is distinct from q.artisan_id
    or amendment.subtotal_cents::bigint+amendment.tax_cents<>amendment.total_cents;
   mixed=mixed or amendment.tax_rate is distinct from q.tax_rate;
   lines=lines||amendment.lines;
   sum_subtotal=sum_subtotal+amendment.subtotal_cents; sum_tax=sum_tax+amendment.tax_cents; sum_total=sum_total+amendment.total_cents;
  end loop;
  if mixed then missing=array_append(missing,'invoice_mixed_tax_rates'); tax_rate=null; end if;
  if jsonb_typeof(lines) is distinct from 'array' then invalid=true;
  else
   if jsonb_array_length(lines)>30 then missing=array_append(missing,'invoice_lines_limit'); end if;
   -- Match the existing PDF representation without truncating, rounding or inventing a line.
   for item in select value from jsonb_array_elements(lines) loop
    if jsonb_typeof(item) is distinct from 'object' or jsonb_typeof(item->'label') is distinct from 'string'
     or char_length(trim(item->>'label')) not between 1 and 160
     or jsonb_typeof(item->'quantity') is distinct from 'number' or jsonb_typeof(item->'unit_price_cents') is distinct from 'number' then invalid=true;
    elsif (item->>'quantity')::numeric not between 1 and 1000 or (item->>'quantity')::numeric<>trunc((item->>'quantity')::numeric)
     or (item->>'unit_price_cents')::numeric not between 0 and 2147483647 or (item->>'unit_price_cents')::numeric<>trunc((item->>'unit_price_cents')::numeric) then invalid=true;
    else line_total=line_total+(item->>'quantity')::numeric*(item->>'unit_price_cents')::numeric; end if;
   end loop;
  end if;
  invalid=invalid or sum_subtotal is null or sum_tax is null or sum_total is null
   or sum_subtotal not between 0 and 2147483647 or sum_tax not between 0 and 2147483647 or sum_total not between 1 and 2147483647
   or sum_subtotal+sum_tax<>sum_total or line_total<>sum_subtotal;
  if invalid then missing=array_append(missing,'amendment_invalid');
  else subtotal=sum_subtotal::integer; tax=sum_tax::integer; total=sum_total::integer; end if;
  if not mixed and sum_tax is distinct from round(sum_subtotal*q.tax_rate/100) then missing=array_append(missing,'invoice_tax_rounding_mismatch'); end if;
  if sum_total is distinct from pay.total_cents::bigint then missing=array_append(missing,'payment_total_mismatch'); end if;
  -- Compare the frozen financial snapshot where the settlement flow supplies one.
  if pay.method='on_site_declared' then
   select * into receipt from public.on_site_receipts where intervention_id=job.id;
   if receipt.intervention_id is null or receipt.quote_id is distinct from q.id or receipt.actor_id is distinct from q.artisan_id
    or receipt.amount_cents is distinct from pay.total_cents or receipt.amendments is distinct from snapshot
    or pay.session_id is distinct from 'onsite:'||job.id::text then missing=array_append(missing,'amendment_snapshot_mismatch'); end if;
  else
   select * into settlement from public.guest_settlements where intervention_id=job.id;
   if settlement.id is not null then
    if settlement.status<>'paid' or settlement.quote_id is distinct from q.id or settlement.actor_id is distinct from job.client_id
     or settlement.artisan_id is distinct from q.artisan_id or settlement.amount_cents is distinct from pay.total_cents
     or settlement.session_id is distinct from pay.session_id or settlement.amendments is distinct from snapshot then missing=array_append(missing,'amendment_snapshot_mismatch'); end if;
   elsif exists(select 1 from public.phone_booking_requests b where b.intervention_id=job.id and b.method='card_hold') then
    missing=array_append(missing,'amendment_snapshot_mismatch');
   end if;
  end if;
 else
  select * into setting from public.platform_settings where key='invoice_issuer';
  if setting.key is null then missing=array_append(missing,'platform_issuer'); end if;
  if setting.key is null or setting.value->>'commission_vat_rate' is null then missing=array_append(missing,'platform_commission_vat_rate'); end if;
  -- Only a provider-confirmed withheld commission can be invoiced; the estimate never is.
  select * into fee from public.platform_ledger_entries where payment_id=p_payment_id and entry_kind='commission_withheld';
  if fee.id is null then missing=array_append(missing,'commission_not_confirmed'); end if;
  if artisan.user_id is null or char_length(trim(artisan.company_name))<1 or artisan.siret !~ '^[0-9]{14}$' or char_length(trim(artisan.address))<5 then missing=array_append(missing,'artisan_identity'); end if;
  issuer=case when setting.key is null then null else jsonb_build_object('legal_name',setting.value->>'legal_name','siret',setting.value->>'siret','legal_status',null,'address',setting.value->>'address','vat_number',setting.value->'vat_number') end;
  issuer_key='platform';
  recipient=jsonb_build_object('name',coalesce(nullif(artisan.company_name,''),artisan_account.full_name),'siret',artisan.siret,'address',artisan.address,'organization',null,'profile_id',q.artisan_id);
  -- The withheld amount is what was actually taken (tax included); VAT is extracted from within, never added on top.
  total=fee.amount_cents; tax_rate=(setting.value->>'commission_vat_rate')::numeric;
  tax=case when total is null or tax_rate is null then null else total-round(total/(1+tax_rate/100)) end; subtotal=total-tax;
  lines=jsonb_build_array(jsonb_build_object('label','Commission de mise en relation — devis '||upper(left(q.id::text,8)),'quantity',1,'unit_price_cents',subtotal));
 end if;
 return jsonb_build_object('ready',cardinality(missing)=0,'missing',to_jsonb(missing),'preview',jsonb_build_object('basis',p_basis,'issuer_key',issuer_key,'issuer',issuer,'recipient',recipient,'lines',lines,'subtotal_cents',subtotal,'tax_rate',tax_rate,'tax_cents',tax,'total_cents',total,'currency',pay.currency,'payment_id',pay.id,'quote_id',q.id,'intervention_id',job.id,'service_address',service_address,'ledger_entry_id',fee.id));
end; $$;
commit;

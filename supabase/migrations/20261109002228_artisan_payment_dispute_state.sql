begin;

-- Disclose only a state for the accepted quote of the currently assigned artisan.
-- The finance tables and their scope policies stay private.
create or replace function public.artisan_payment_dispute(p_quote_id uuid)
returns text language plpgsql stable security definer set search_path = '' as $$
declare
  dispute_state text;
begin
  if auth.uid() is null then raise insufficient_privilege; end if;
  select (
    select d.status from public.platform_disputes d
    where d.payment_id = payment.id and d.intervention_id = intervention.id
    order by (d.status in ('open', 'under_review')) desc, d.updated_at desc, d.id desc
    limit 1
  ) into dispute_state
  from public.quotes quote
  join public.interventions intervention on intervention.id = quote.intervention_id
  join public.profiles actor on actor.id = intervention.artisan_id and actor.role = 'artisan'
  left join public.payments payment on payment.quote_id = quote.id and payment.status = 'paid'
  where quote.id = p_quote_id and quote.status = 'accepted' and quote.artisan_id = actor.id
    and actor.id = auth.uid();
  if not found then raise no_data_found; end if;
  return coalesce(dispute_state, 'none');
end;
$$;
revoke all on function public.artisan_payment_dispute(uuid) from public, anon, authenticated, service_role;
grant execute on function public.artisan_payment_dispute(uuid) to authenticated;

commit;

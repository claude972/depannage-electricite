-- Read-only recovery after losing the tab draft. No contact/provider identifiers are exposed.
begin;
create or replace function public.guest_booking_pending() returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid=public.guest_booking_actor(); b public.phone_booking_requests; result jsonb=null; seen integer=0;
begin
 -- LIMIT 2 detects any broken uniqueness invariant; never return a silently truncated first row.
 for b in select * from public.phone_booking_requests where actor_id=actor and intervention_id is null and status<>'cancelled' order by created_at,request_id limit 2 loop
  seen=seen+1;
  if seen>1 or b.method<>'card_hold' or b.status not in ('prepared','checkout_open','authorized','cancelling') then
   raise exception 'Pending booking state unknown' using errcode='55000';
  end if;
  result=jsonb_build_object('request_id',b.request_id,'method',b.method,'status',b.status,'expected_max_cents',b.expected_max_cents,'created_at',b.created_at,
   'estimate',jsonb_build_object('version',b.indicative_price_version,'min_cents',b.expected_min_cents,'max_cents',b.expected_max_cents,'currency','eur'));
 end loop;
 return jsonb_build_object('pending',result);
end; $$;
revoke all on function public.guest_booking_pending() from public,anon,authenticated,service_role;
grant execute on function public.guest_booking_pending() to authenticated;
commit;

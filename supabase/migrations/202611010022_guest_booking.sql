-- Private booking coordination. Names/contact are never authentication factors or offer text.
begin;
create table public.phone_booking_requests (
 actor_id uuid not null references auth.users(id) on delete cascade,
 request_id uuid not null,
 payload jsonb not null check(jsonb_typeof(payload)='object'),
 contact jsonb not null check(jsonb_typeof(contact)='object'),
 method text not null check(method in ('on_site','card_hold')),
 expected_max_cents integer not null check(expected_max_cents>0),
 phone_verified boolean not null,
 status text not null default 'prepared' check(status in ('prepared','checkout_open','authorized','cancelling','confirmed','cancelled')),
 intervention_id uuid unique references public.interventions(id) on delete cascade,
 stripe_session_id text unique,
 stripe_payment_intent_id text unique,
 provider_state text,
 authorized_amount_cents integer,
 authorized_currency text,
 authorization_checked_at timestamptz,
 release_checked_at timestamptz,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 primary key(actor_id,request_id),
 check((status='confirmed')=(intervention_id is not null)),
 check(method='card_hold' or (stripe_session_id is null and stripe_payment_intent_id is null))
);
alter table public.phone_booking_requests enable row level security;
revoke all on public.phone_booking_requests from public,anon,authenticated;
grant select,insert,update,delete on public.phone_booking_requests to service_role;

-- Private identity check: a voluntarily connected confirmed email account remains supported.
-- A phone-only guest must prove the exact normalized contact phone, never merely provide a name.
create function public.guest_booking_actor(p_phone text default null) returns uuid language plpgsql security definer set search_path='' as $$
declare actor uuid=auth.uid();
begin
 if actor is null or not exists(select 1 from public.profiles p join auth.users u on u.id=p.id
  where p.id=actor and p.role='client' and (u.email_confirmed_at is not null or
   (u.phone_confirmed_at is not null and u.phone is not null and '+'||ltrim(u.phone,'+') ~ '^\+[1-9][0-9]{7,14}$'
    and (p_phone is null or '+'||ltrim(u.phone,'+')=p_phone)))) then raise insufficient_privilege; end if;
 return actor;
end; $$;
revoke all on function public.guest_booking_actor(text) from public,anon,authenticated,service_role;
create function public.guest_booking_view(b public.phone_booking_requests) returns jsonb language plpgsql security definer set search_path='' as $$
declare job public.interventions;
begin
 if b.intervention_id is not null then
  select * into job from public.interventions where id=b.intervention_id;
  if not found or job.client_id<>b.actor_id or not public.can_access_intervention(job.id) then raise insufficient_privilege; end if;
  return jsonb_build_object('status','confirmed','intervention',jsonb_build_object('id',job.id,'status',job.status,
   'estimate_min_cents',job.estimate_min_cents,'estimate_max_cents',job.estimate_max_cents),
   'payment',jsonb_build_object('method',b.method,'status',case when b.method='on_site' then 'due_on_site' else 'authorization_recorded' end,'checked_at',b.authorization_checked_at));
 end if;
 return jsonb_build_object('request_id',b.request_id,'status',b.status,'expected_max_cents',b.expected_max_cents,
  'payment',jsonb_build_object('method',b.method,'status',case when b.status='cancelled' then 'cancelled' else 'pending' end));
end; $$;
revoke all on function public.guest_booking_view(public.phone_booking_requests) from public,anon,authenticated,service_role;

create function public.prepare_phone_booking(p_request_id uuid,p_payload jsonb,p_contact jsonb,p_method text) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid; payload jsonb; contact jsonb; k text; max_cents integer; expected_category text; b public.phone_booking_requests; verified boolean;
begin
 actor=public.guest_booking_actor();
 if p_request_id is null or p_method is null or p_method not in ('on_site','card_hold') or jsonb_typeof(p_payload) is distinct from 'object' or jsonb_typeof(p_contact) is distinct from 'object' then raise invalid_parameter_value; end if;
 if not p_payload ?& array['service_slug','category','description','address','postal_code','city','urgency'] or
  p_payload-array['service_slug','category','description','address','postal_code','city','urgency']<>'{}'::jsonb or
  not p_contact ?& array['first_name','last_name','email','phone'] or p_contact-array['first_name','last_name','email','phone']<>'{}'::jsonb then raise invalid_parameter_value; end if;
 for k in select jsonb_object_keys(p_payload) loop if jsonb_typeof(p_payload->k)<>'string' then raise invalid_parameter_value; end if; end loop;
 for k in select jsonb_object_keys(p_contact) loop if jsonb_typeof(p_contact->k)<>'string' then raise invalid_parameter_value; end if; end loop;
 payload=jsonb_build_object('service_slug',trim(p_payload->>'service_slug'),'category',trim(p_payload->>'category'),
  'description',trim(p_payload->>'description'),'address',trim(p_payload->>'address'),'postal_code',trim(p_payload->>'postal_code'),
  'city',trim(p_payload->>'city'),'urgency',trim(p_payload->>'urgency'));
 contact=jsonb_build_object('first_name',trim(p_contact->>'first_name'),'last_name',trim(p_contact->>'last_name'),
  'email',lower(trim(p_contact->>'email')),'phone',p_contact->>'phone');
 expected_category=case payload->>'service_slug'
  when 'panne-tableau-electrique' then 'panel' when 'prise-qui-ne-fonctionne-plus' then 'socket'
  when 'disjoncteur-qui-saute' then 'panel' when 'coupure-de-courant-partielle' then 'outage'
  when 'prise-abimee-ou-qui-chauffe' then 'socket' when 'eclairage-qui-ne-sallume-plus' then 'lighting'
  when 'plusieurs-prises-sans-courant' then 'socket' when 'origine-de-la-panne-inconnue' then 'diagnostic' end;
 if expected_category is null or expected_category<>payload->>'category' or
  char_length(payload->>'description') not between 10 and 4000 or char_length(payload->>'address') not between 5 and 500 or
  payload->>'postal_code' !~ '^[0-9]{5}$' or char_length(payload->>'city') not between 2 and 120 or payload->>'urgency' not in ('urgent','scheduled') or
  char_length(contact->>'first_name') not between 1 and 60 or char_length(contact->>'last_name') not between 1 and 60 or
  char_length((contact->>'first_name')||' '||(contact->>'last_name'))>120 or char_length(contact->>'email')>254 or
  (contact->>'email'<>'' and contact->>'email' !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') or
  contact->>'phone' !~ '^\+[1-9][0-9]{7,14}$' then raise invalid_parameter_value; end if;
 actor=public.guest_booking_actor(contact->>'phone');
 perform pg_advisory_xact_lock(hashtextextended('phone-booking-actor:'||actor::text,0));
 perform pg_advisory_xact_lock(hashtextextended('phone-booking:'||actor::text||':'||p_request_id::text,0));
 select * into b from public.phone_booking_requests where actor_id=actor and request_id=p_request_id for update;
 if found then
  if b.payload is distinct from payload or b.contact is distinct from contact or b.method<>p_method then raise exception 'Booking nonce conflict' using errcode='P0001'; end if;
  return public.guest_booking_view(b);
 end if;
 if exists(select 1 from public.phone_booking_requests where actor_id=actor and request_id<>p_request_id and intervention_id is null and status<>'cancelled') then raise exception 'Previous booking attempt must be cancelled first' using errcode='P0001'; end if;
 max_cents=case expected_category when 'outage' then 25000 when 'panel' then 35000 when 'socket' then 18000 when 'lighting' then 20000 when 'diagnostic' then 28000 end;
 select phone_confirmed_at is not null and '+'||ltrim(phone,'+')=contact->>'phone' into verified from auth.users where id=actor;
 perform public.consume_action('prepare_phone_booking',10);
 insert into public.phone_booking_requests(actor_id,request_id,payload,contact,method,expected_max_cents,phone_verified)
 values(actor,p_request_id,payload,contact,p_method,max_cents,coalesce(verified,false)) returning * into b;
 return public.guest_booking_view(b);
end; $$;
revoke all on function public.prepare_phone_booking(uuid,jsonb,jsonb,text) from public,anon,authenticated,service_role;
grant execute on function public.prepare_phone_booking(uuid,jsonb,jsonb,text) to authenticated;

create function public.submit_phone_booking(p_request_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid=public.guest_booking_actor(); b public.phone_booking_requests; job public.interventions;
begin
 if p_request_id is null then raise invalid_parameter_value; end if;
 perform pg_advisory_xact_lock(hashtextextended('phone-booking:'||actor::text||':'||p_request_id::text,0));
 select * into b from public.phone_booking_requests where actor_id=actor and request_id=p_request_id for update;
 if not found then raise no_data_found; end if;
 perform public.guest_booking_actor(b.contact->>'phone');
 if b.status in ('cancelled','cancelling') then raise exception 'Booking cancelled' using errcode='P0001'; end if;
 if b.intervention_id is not null then return public.guest_booking_view(b); end if;
 if b.method='card_hold' and (b.status<>'authorized' or b.stripe_session_id is null or b.stripe_payment_intent_id is null or
  b.provider_state is distinct from 'requires_capture' or b.authorized_amount_cents is distinct from b.expected_max_cents or b.authorized_currency is distinct from 'eur' or
  b.authorization_checked_at is null or b.authorization_checked_at<clock_timestamp()-interval '30 seconds' or b.authorization_checked_at>clock_timestamp()) then raise insufficient_privilege; end if;
 job=public.create_intervention_once(b.request_id,b.payload->>'category',b.payload->>'description',b.payload->>'address',b.payload->>'postal_code',b.payload->>'city',b.payload->>'urgency',null);
 if job.client_id<>actor or job.status<>'requested' or job.artisan_id is not null or job.site_id is not null then raise exception 'Existing dossier cannot be rebound' using errcode='P0001'; end if;
 perform public.update_profile((b.contact->>'first_name')||' '||(b.contact->>'last_name'),b.contact->>'phone');
 update public.phone_booking_requests set intervention_id=job.id,status='confirmed',updated_at=now() where actor_id=actor and request_id=p_request_id returning * into b;
 return case when b.method='card_hold' then jsonb_set(public.guest_booking_view(b),'{payment,status}','"authorized"'::jsonb) else public.guest_booking_view(b) end;
end; $$;
revoke all on function public.submit_phone_booking(uuid) from public,anon,authenticated,service_role;
grant execute on function public.submit_phone_booking(uuid) to authenticated;

create function public.phone_booking_status(p_request_id uuid default null,p_intervention_id uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid=public.guest_booking_actor(); b public.phone_booking_requests;
begin
 if (p_request_id is null)=(p_intervention_id is null) then raise invalid_parameter_value; end if;
 select * into b from public.phone_booking_requests where actor_id=actor and (request_id=p_request_id or intervention_id=p_intervention_id);
 if not found then raise no_data_found; end if;
 return public.guest_booking_view(b);
end; $$;
revoke all on function public.phone_booking_status(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.phone_booking_status(uuid,uuid) to authenticated;

-- Only the server's independently retrieved Stripe evidence may update provider state.
-- No service-side function can create/assign/complete a dossier or capture a payment.
create function public.record_phone_booking_provider(p_actor uuid,p_request_id uuid,p_session_id text,p_intent_id text,p_action text,p_amount integer default null,p_currency text default null,p_state text default null) returns void language plpgsql security definer set search_path='' as $$
declare b public.phone_booking_requests;
begin
 if p_actor is null or p_request_id is null or p_session_id is null or p_session_id !~ '^cs_(test_|live_)?[A-Za-z0-9]{1,200}$' or
  (p_intent_id is not null and p_intent_id !~ '^pi_[A-Za-z0-9]{1,200}$') then raise invalid_parameter_value; end if;
 select * into b from public.phone_booking_requests where actor_id=p_actor and request_id=p_request_id for update;
 if not found then raise no_data_found; end if;
 if b.method<>'card_hold' or b.status='cancelled' then raise insufficient_privilege; end if;
 if b.stripe_session_id is not null and b.stripe_session_id<>p_session_id then raise exception 'Provider session conflict' using errcode='P0001'; end if;
 if b.stripe_payment_intent_id is not null and b.stripe_payment_intent_id is distinct from p_intent_id then raise exception 'Provider intent conflict' using errcode='P0001'; end if;
 if p_action='session' then
  if b.intervention_id is null then update public.phone_booking_requests set stripe_session_id=p_session_id,stripe_payment_intent_id=p_intent_id,status=case when status='cancelling' then 'cancelling' else 'checkout_open' end,updated_at=now() where actor_id=p_actor and request_id=p_request_id; end if;
 elsif p_action='authorize' then
  if b.status='cancelling' or b.stripe_session_id is distinct from p_session_id or p_intent_id is null or p_amount is distinct from b.expected_max_cents or p_currency is distinct from 'eur' or p_state is distinct from 'requires_capture' then raise insufficient_privilege; end if;
  update public.phone_booking_requests set stripe_payment_intent_id=p_intent_id,authorized_amount_cents=p_amount,authorized_currency=p_currency,provider_state=p_state,
   authorization_checked_at=clock_timestamp(),status=case when intervention_id is null then 'authorized' else 'confirmed' end,updated_at=now() where actor_id=p_actor and request_id=p_request_id;
 elsif p_action='release' then
  if b.status<>'cancelling' or b.intervention_id is not null or b.stripe_session_id is distinct from p_session_id or p_state is null or p_state not in ('canceled','expired') then raise insufficient_privilege; end if;
  update public.phone_booking_requests set stripe_payment_intent_id=p_intent_id,provider_state=p_state,release_checked_at=clock_timestamp(),updated_at=now() where actor_id=p_actor and request_id=p_request_id;
 else raise invalid_parameter_value;
 end if;
end; $$;
revoke all on function public.record_phone_booking_provider(uuid,uuid,text,text,text,integer,text,text) from public,anon,authenticated,service_role;
grant execute on function public.record_phone_booking_provider(uuid,uuid,text,text,text,integer,text,text) to service_role;

-- Durable cancellation intent precedes provider release: submission cannot race that release.
create function public.begin_phone_booking_cancel(p_request_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid=public.guest_booking_actor(); b public.phone_booking_requests;
begin
 perform pg_advisory_xact_lock(hashtextextended('phone-booking:'||actor::text||':'||p_request_id::text,0));
 select * into b from public.phone_booking_requests where actor_id=actor and request_id=p_request_id for update;
 if not found then raise no_data_found; end if;
 if b.intervention_id is not null then raise exception 'Dossier already created' using errcode='P0001'; end if;
 if b.status<>'cancelled' then
  update public.phone_booking_requests set status=case when method='on_site' then 'cancelled' else 'cancelling' end,updated_at=now() where actor_id=actor and request_id=p_request_id returning * into b;
 end if;
 return public.guest_booking_view(b);
end; $$;
revoke all on function public.begin_phone_booking_cancel(uuid) from public,anon,authenticated,service_role;
grant execute on function public.begin_phone_booking_cancel(uuid) to authenticated;

create function public.cancel_phone_booking(p_request_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid=public.guest_booking_actor(); b public.phone_booking_requests;
begin
 perform pg_advisory_xact_lock(hashtextextended('phone-booking:'||actor::text||':'||p_request_id::text,0));
 select * into b from public.phone_booking_requests where actor_id=actor and request_id=p_request_id for update;
 if not found then raise no_data_found; end if;
 if b.intervention_id is not null then raise exception 'Dossier already created' using errcode='P0001'; end if;
 if b.status='cancelled' then return public.guest_booking_view(b); end if;
 if b.method='card_hold' and (b.status<>'cancelling' or b.release_checked_at is null or b.release_checked_at<clock_timestamp()-interval '30 seconds' or b.release_checked_at>clock_timestamp() or b.provider_state not in ('canceled','expired')) then raise insufficient_privilege; end if;
 update public.phone_booking_requests set status='cancelled',updated_at=now() where actor_id=actor and request_id=p_request_id returning * into b;
 return public.guest_booking_view(b);
end; $$;
revoke all on function public.cancel_phone_booking(uuid) from public,anon,authenticated,service_role;
grant execute on function public.cancel_phone_booking(uuid) to authenticated;

-- Legacy Checkout must never debit a second payment for a dossier already backed by a card hold.
create function public.guard_phone_booking_checkout(p_quote_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare job uuid;
begin
 select i.id into job from public.quotes q join public.interventions i on i.id=q.intervention_id where q.id=p_quote_id and i.client_id=auth.uid();
 if not found then raise insufficient_privilege; end if;
 if exists(select 1 from public.phone_booking_requests where intervention_id=job and method='card_hold') then raise exception 'Existing card authorization requires its dedicated settlement' using errcode='P0001'; end if;
end; $$;
revoke all on function public.guard_phone_booking_checkout(uuid) from public,anon,authenticated,service_role;
grant execute on function public.guard_phone_booking_checkout(uuid) to authenticated;
commit;

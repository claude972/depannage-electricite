-- General requests from the signed-in client form use a category slug, not a catalogue service.
-- Keep the original identity, amount, atomicity, replay and grant contract.
begin;

create or replace function public.prepare_phone_booking(p_request_id uuid,p_payload jsonb,p_contact jsonb,p_method text) returns jsonb language plpgsql security definer set search_path='' as $$
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
  when 'plusieurs-prises-sans-courant' then 'socket' when 'origine-de-la-panne-inconnue' then 'diagnostic'
  when 'demande-outage' then 'outage' when 'demande-panel' then 'panel'
  when 'demande-socket' then 'socket' when 'demande-lighting' then 'lighting'
  when 'demande-diagnostic' then 'diagnostic' end;
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
 -- Share 021's lock: this booking may create a fresh parent, never rebind a legacy nonce.
 perform pg_advisory_xact_lock(hashtextextended('booking:'||actor::text||':'||p_request_id::text,0));
 if exists(select 1 from public.intervention_request_keys where actor_id=actor and request_id=p_request_id) then raise exception 'Request key already bound' using errcode='P0001'; end if;
 if exists(select 1 from public.phone_booking_requests where actor_id=actor and request_id<>p_request_id and intervention_id is null and status<>'cancelled') then raise exception 'Previous booking attempt must be cancelled first' using errcode='P0001'; end if;
 max_cents=case expected_category when 'outage' then 25000 when 'panel' then 35000 when 'socket' then 18000 when 'lighting' then 20000 when 'diagnostic' then 28000 end;
 select phone_confirmed_at is not null and '+'||ltrim(phone,'+')=contact->>'phone' into verified from auth.users where id=actor;
 perform public.consume_action('prepare_phone_booking',10);
 insert into public.phone_booking_requests(actor_id,request_id,payload,contact,method,expected_max_cents,phone_verified)
 values(actor,p_request_id,payload,contact,p_method,max_cents,coalesce(verified,false)) returning * into b;
 return public.guest_booking_view(b);
end; $$;

commit;

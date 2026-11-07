begin;
alter table public.interventions add column indicative_price_version integer references indicative_price_private.versions(version);
alter table public.phone_booking_requests add column indicative_price_version integer references indicative_price_private.versions(version),add column expected_min_cents integer;
-- Legacy reservation maximum is a durable authorization ceiling: never replace it.
update public.phone_booking_requests b set indicative_price_version=1,
 expected_min_cents=(v.ranges->(b.payload->>'category')->>'min_cents')::integer
 from indicative_price_private.versions v where v.version=1;
alter table public.phone_booking_requests alter column indicative_price_version set not null,alter column expected_min_cents set not null;
alter table public.phone_booking_requests add constraint reserved_estimate_range check(expected_min_cents>0 and expected_max_cents>=expected_min_cents);
create function indicative_price_private.current_range(p_category text)returns jsonb language plpgsql security definer set search_path=''as $$
declare c indicative_price_private.control;r jsonb;
begin
 select *into c from indicative_price_private.control where singleton for share;
 select ranges->p_category into r from indicative_price_private.versions where version=c.active_version;
 if r is null then raise invalid_parameter_value;end if;
 return r||jsonb_build_object('version',c.active_version);
end;$$;
create function indicative_price_private.create_reserved_intervention(p_category text,p_description text,p_address text,p_postal_code text,p_city text,p_urgency text,p_site_id uuid,p_price_version integer,p_min integer,p_max integer)
returns public.interventions language plpgsql security definer set search_path='' as $$
declare result public.interventions; lower_amount integer; upper_amount integer;
begin
 if not exists(select 1 from public.profiles where id=auth.uid() and role in ('client','manager','admin')) then raise insufficient_privilege; end if;
 if p_site_id is not null and not exists(select 1 from public.sites where id=p_site_id and public.is_org_member(organization_id,true)) then raise insufficient_privilege; end if;
 if p_price_version is null or p_min is null or p_max is null or p_min<1 or p_max<p_min
  or not exists(select 1 from indicative_price_private.versions where version=p_price_version and ranges?p_category)then raise invalid_parameter_value;end if;
 lower_amount=p_min;upper_amount=p_max;
 perform public.consume_action('create_intervention',5);
 insert into public.interventions(client_id,site_id,category,description,address,postal_code,city,urgency,estimate_min_cents,estimate_max_cents,indicative_price_version)
 values(auth.uid(),p_site_id,p_category,trim(p_description),trim(p_address),p_postal_code,trim(p_city),p_urgency,lower_amount,upper_amount,p_price_version) returning * into result;
 insert into public.audit_log(actor_id,intervention_id,action) values(auth.uid(),result.id,'created');
 return result;
end; $$;

-- Existing public site-locking wrapper and idempotency ledger are deliberately retained.
create or replace function public.create_intervention_before_site_access(p_category text,p_description text,p_address text,p_postal_code text,p_city text,p_urgency text,p_site_id uuid default null)
returns public.interventions language plpgsql security definer set search_path=''as $$
declare r jsonb;
begin
 r=indicative_price_private.current_range(p_category);
 return indicative_price_private.create_reserved_intervention(p_category,p_description,p_address,p_postal_code,p_city,p_urgency,p_site_id,(r->>'version')::integer,(r->>'min_cents')::integer,(r->>'max_cents')::integer);
end;$$;
create or replace function public.prepare_phone_booking(p_request_id uuid,p_payload jsonb,p_contact jsonb,p_method text) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid; payload jsonb; contact jsonb; k text; max_cents integer; expected_category text; b public.phone_booking_requests; verified boolean; reserved jsonb;
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
 reserved=indicative_price_private.current_range(expected_category);max_cents=(reserved->>'max_cents')::integer;
 select phone_confirmed_at is not null and '+'||ltrim(phone,'+')=contact->>'phone' into verified from auth.users where id=actor;
 perform public.consume_action('prepare_phone_booking',10);
 insert into public.phone_booking_requests(actor_id,request_id,payload,contact,method,expected_max_cents,phone_verified,expected_min_cents,indicative_price_version)
 values(actor,p_request_id,payload,contact,p_method,max_cents,coalesce(verified,false),(reserved->>'min_cents')::integer,(reserved->>'version')::integer) returning * into b;
 return public.guest_booking_view(b);
end; $$;

create or replace function public.submit_phone_booking(p_request_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
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
 -- Share 021's lock: this booking may create a fresh parent, never rebind a legacy nonce.
 perform pg_advisory_xact_lock(hashtextextended('booking:'||actor::text||':'||p_request_id::text,0));
 if exists(select 1 from public.intervention_request_keys where actor_id=actor and request_id=p_request_id) then raise exception 'Request key already bound' using errcode='P0001'; end if;
 job=indicative_price_private.create_reserved_intervention(b.payload->>'category',b.payload->>'description',b.payload->>'address',b.payload->>'postal_code',b.payload->>'city',b.payload->>'urgency',null,b.indicative_price_version,b.expected_min_cents,b.expected_max_cents);
 insert into public.intervention_request_keys(actor_id,request_id,payload,intervention_id)values(actor,b.request_id,b.payload-'service_slug'||jsonb_build_object('site_id',null),job.id);
 if job.client_id<>actor or job.status<>'requested' or job.artisan_id is not null or job.site_id is not null then raise exception 'Existing dossier cannot be rebound' using errcode='P0001'; end if;
 perform public.update_profile((b.contact->>'first_name')||' '||(b.contact->>'last_name'),b.contact->>'phone');
 update public.phone_booking_requests set intervention_id=job.id,status='confirmed',updated_at=now() where actor_id=actor and request_id=p_request_id returning * into b;
 return case when b.method='card_hold' then jsonb_set(public.guest_booking_view(b),'{payment,status}','"authorized"'::jsonb) else public.guest_booking_view(b) end;
end; $$;
create or replace function public.guest_booking_view(b public.phone_booking_requests) returns jsonb language plpgsql security definer set search_path='' as $$
declare job public.interventions;
begin
 if b.intervention_id is not null then
  select * into job from public.interventions where id=b.intervention_id;
  if not found or job.client_id<>b.actor_id or not public.can_access_intervention(job.id) then raise no_data_found; end if;
  return jsonb_build_object('status','confirmed','intervention',jsonb_build_object('id',job.id,'status',job.status,
   'estimate_min_cents',job.estimate_min_cents,'estimate_max_cents',job.estimate_max_cents),
   'payment',jsonb_build_object('method',b.method,'status',case when b.method='on_site' then 'due_on_site' else 'authorization_recorded' end,'checked_at',b.authorization_checked_at))||case when job.indicative_price_version is null then '{}'::jsonb else jsonb_build_object('estimate',jsonb_build_object('version',job.indicative_price_version,'min_cents',job.estimate_min_cents,'max_cents',job.estimate_max_cents,'currency','eur'))end;
 end if;
 return jsonb_build_object('request_id',b.request_id,'status',b.status,'expected_max_cents',b.expected_max_cents,'estimate',jsonb_build_object('version',b.indicative_price_version,'min_cents',b.expected_min_cents,'max_cents',b.expected_max_cents,'currency','eur'),
  'payment',jsonb_build_object('method',b.method,'status',case when b.status='cancelled' then 'cancelled' else 'pending' end));
end; $$;
create function indicative_price_private.guard_estimate()returns trigger language plpgsql set search_path=''as $$
begin
 if tg_table_name='phone_booking_requests'then
  if new.indicative_price_version is distinct from old.indicative_price_version or new.expected_min_cents is distinct from old.expected_min_cents or new.expected_max_cents is distinct from old.expected_max_cents or new.payload is distinct from old.payload then raise exception 'Reserved estimate is immutable'using errcode='P0001';end if;
 elsif old.indicative_price_version is not null and(new.indicative_price_version is distinct from old.indicative_price_version or new.estimate_min_cents is distinct from old.estimate_min_cents or new.estimate_max_cents is distinct from old.estimate_max_cents or new.category is distinct from old.category)then raise exception 'Initial estimate is immutable'using errcode='P0001';
 end if;return new;
end;$$;
create trigger reserved_estimate before update on public.phone_booking_requests for each row execute function indicative_price_private.guard_estimate();
create trigger initial_estimate before update on public.interventions for each row execute function indicative_price_private.guard_estimate();
revoke all on all functions in schema indicative_price_private from public,anon,authenticated,service_role;
commit;

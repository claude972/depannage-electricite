begin;
create function indicative_price_private.reviewed_range(p_category text,p_reviewed integer)returns jsonb language plpgsql security definer set search_path=''as $$
declare r jsonb;
begin
 if p_reviewed is not null and p_reviewed<1 then raise invalid_parameter_value;end if;
 r=indicative_price_private.current_range(p_category);
 if(p_reviewed is null and(r->>'version')::integer<>1)or(p_reviewed is not null and p_reviewed<>(r->>'version')::integer)then raise exception 'Estimate review required'using errcode='P0001';end if;
 return r;
end;$$;
create function public.create_intervention_reviewed(p_category text,p_description text,p_address text,p_postal_code text,p_city text,p_urgency text,p_site_id uuid,p_reviewed_estimate_version integer)
returns public.interventions language plpgsql security definer set search_path=''as $$
declare r jsonb;
begin
 if p_site_id is not null then perform public.lock_site_access(p_site_id);end if;
 if not exists(select 1 from public.profiles where id=auth.uid()and role in('client','manager','admin'))then raise insufficient_privilege;end if;
 if p_site_id is not null and not exists(select 1 from public.sites where id=p_site_id and public.is_org_member(organization_id,true))then raise insufficient_privilege;end if;
 r=indicative_price_private.reviewed_range(p_category,p_reviewed_estimate_version);
 return indicative_price_private.create_reserved_intervention(p_category,p_description,p_address,p_postal_code,p_city,p_urgency,p_site_id,(r->>'version')::integer,(r->>'min_cents')::integer,(r->>'max_cents')::integer);
end;$$;
create function public.create_intervention_once_reviewed(
 p_request_id uuid,p_category text,p_description text,p_address text,p_postal_code text,
 p_city text,p_urgency text,p_site_id uuid,p_reviewed_estimate_version integer
) returns public.interventions language plpgsql security definer set search_path='' as $$
declare
 actor uuid=auth.uid(); normalized jsonb; kept public.intervention_request_keys;
 result public.interventions;
begin
 if actor is null or not exists(select 1 from public.profiles where id=actor and role in ('client','manager','admin')) then
  raise insufficient_privilege;
 end if;
 if p_reviewed_estimate_version is not null and p_reviewed_estimate_version<1 then raise invalid_parameter_value;end if;
 if p_request_id is null then raise invalid_parameter_value; end if;
 -- The key lock is transaction-scoped. The primary key remains a second uniqueness guard.
 perform pg_advisory_xact_lock(hashtextextended('booking:'||actor::text||':'||p_request_id::text,0));
 -- Re-check current write access on EVERY call, including identical retries.
 if p_site_id is not null then perform public.lock_site_access(p_site_id); end if;
 normalized=jsonb_build_object('category',trim(p_category),'description',trim(p_description),
  'address',trim(p_address),'postal_code',trim(p_postal_code),'city',trim(p_city),
  'urgency',trim(p_urgency),'site_id',p_site_id);
 select * into kept from public.intervention_request_keys where actor_id=actor and request_id=p_request_id;
 if found then
  if kept.payload is distinct from normalized then
   raise exception 'Request key already used for another payload' using errcode='P0001';
  end if;
  -- Match the existing organization-before-dossier locking order. Return the current row,
  -- never an old serialized response whose permissions or business state may have changed.
  perform public.lock_intervention_organization(kept.intervention_id);
  select * into result from public.interventions where id=kept.intervention_id for share;
  if not found then raise no_data_found; end if;
  if not public.can_access_intervention(result.id) then raise insufficient_privilege; end if;
  if result.site_id is not null then
   perform public.lock_site_access(result.site_id);
  elsif result.client_id<>actor and not public.is_admin() then
   raise insufficient_privilege;
  end if;
  if p_reviewed_estimate_version is not null and p_reviewed_estimate_version<>coalesce(result.indicative_price_version,1)then raise exception 'Reserved estimate conflict'using errcode='P0001';end if;
  return result;
 end if;
 -- Only the first successful attempt consumes quota and emits the original creation audit.
 result=public.create_intervention_reviewed(trim(p_category),trim(p_description),trim(p_address),
  trim(p_postal_code),trim(p_city),trim(p_urgency),p_site_id,p_reviewed_estimate_version);
 insert into public.intervention_request_keys(actor_id,request_id,payload,intervention_id)
 values(actor,p_request_id,normalized,result.id);
 return result;
end; $$;
create function public.prepare_phone_booking_reviewed(p_request_id uuid,p_payload jsonb,p_contact jsonb,p_method text,p_reviewed_estimate_version integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid; payload jsonb; contact jsonb; k text; max_cents integer; expected_category text; b public.phone_booking_requests; verified boolean; reserved jsonb;
begin
 actor=public.guest_booking_actor();
 if p_reviewed_estimate_version is not null and p_reviewed_estimate_version<1 then raise invalid_parameter_value;end if;
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
  if p_reviewed_estimate_version is not null and p_reviewed_estimate_version<>b.indicative_price_version then raise exception 'Reserved estimate conflict'using errcode='P0001';end if;
  return public.guest_booking_view(b);
 end if;
 -- Share 021's lock: this booking may create a fresh parent, never rebind a legacy nonce.
 perform pg_advisory_xact_lock(hashtextextended('booking:'||actor::text||':'||p_request_id::text,0));
 if exists(select 1 from public.intervention_request_keys where actor_id=actor and request_id=p_request_id) then raise exception 'Request key already bound' using errcode='P0001'; end if;
 if exists(select 1 from public.phone_booking_requests where actor_id=actor and request_id<>p_request_id and intervention_id is null and status<>'cancelled') then raise exception 'Previous booking attempt must be cancelled first' using errcode='P0001'; end if;
 reserved=indicative_price_private.reviewed_range(expected_category,p_reviewed_estimate_version);max_cents=(reserved->>'max_cents')::integer;
 select phone_confirmed_at is not null and '+'||ltrim(phone,'+')=contact->>'phone' into verified from auth.users where id=actor;
 perform public.consume_action('prepare_phone_booking',10);
 insert into public.phone_booking_requests(actor_id,request_id,payload,contact,method,expected_max_cents,phone_verified,expected_min_cents,indicative_price_version)
 values(actor,p_request_id,payload,contact,p_method,max_cents,coalesce(verified,false),(reserved->>'min_cents')::integer,(reserved->>'version')::integer) returning * into b;
 return public.guest_booking_view(b);
end; $$;

create function public.create_on_site_booking_reviewed(p_request_id uuid,p_payload jsonb,p_contact jsonb,p_reviewed_estimate_version integer)returns jsonb language plpgsql security definer set search_path=''as $$
begin
 perform public.prepare_phone_booking_reviewed(p_request_id,p_payload,p_contact,'on_site',p_reviewed_estimate_version);
 return public.submit_phone_booking(p_request_id);
end;$$;

create or replace function public.create_intervention(p_category text,p_description text,p_address text,p_postal_code text,p_city text,p_urgency text,p_site_id uuid default null)returns public.interventions language plpgsql security definer set search_path=''as $$begin return public.create_intervention_reviewed(p_category,p_description,p_address,p_postal_code,p_city,p_urgency,p_site_id,null);end;$$;

create or replace function public.create_intervention_before_site_access(p_category text,p_description text,p_address text,p_postal_code text,p_city text,p_urgency text,p_site_id uuid default null)returns public.interventions language plpgsql security definer set search_path=''as $$begin return public.create_intervention_reviewed(p_category,p_description,p_address,p_postal_code,p_city,p_urgency,p_site_id,null);end;$$;

create or replace function public.create_intervention_once(p_request_id uuid,p_category text,p_description text,p_address text,p_postal_code text,p_city text,p_urgency text,p_site_id uuid default null)returns public.interventions language plpgsql security definer set search_path=''as $$begin return public.create_intervention_once_reviewed(p_request_id,p_category,p_description,p_address,p_postal_code,p_city,p_urgency,p_site_id,null);end;$$;

create or replace function public.prepare_phone_booking(p_request_id uuid,p_payload jsonb,p_contact jsonb,p_method text)returns jsonb language plpgsql security definer set search_path=''as $$begin return public.prepare_phone_booking_reviewed(p_request_id,p_payload,p_contact,p_method,null);end;$$;

create or replace function public.create_on_site_booking(p_request_id uuid,p_payload jsonb,p_contact jsonb)returns jsonb language plpgsql security definer set search_path=''as $$begin return public.create_on_site_booking_reviewed(p_request_id,p_payload,p_contact,null);end;$$;
revoke all on function indicative_price_private.reviewed_range(text,integer)from public,anon,authenticated,service_role;
revoke all on function public.create_intervention_reviewed(text,text,text,text,text,text,uuid,integer)from public,anon,authenticated,service_role;
grant execute on function public.create_intervention_reviewed(text,text,text,text,text,text,uuid,integer)to authenticated;
revoke all on function public.create_intervention_once_reviewed(uuid,text,text,text,text,text,text,uuid,integer)from public,anon,authenticated,service_role;
grant execute on function public.create_intervention_once_reviewed(uuid,text,text,text,text,text,text,uuid,integer)to authenticated;
revoke all on function public.prepare_phone_booking_reviewed(uuid,jsonb,jsonb,text,integer)from public,anon,authenticated,service_role;
grant execute on function public.prepare_phone_booking_reviewed(uuid,jsonb,jsonb,text,integer)to authenticated;
revoke all on function public.create_on_site_booking_reviewed(uuid,jsonb,jsonb,integer)from public,anon,authenticated,service_role;
grant execute on function public.create_on_site_booking_reviewed(uuid,jsonb,jsonb,integer)to authenticated;
commit;

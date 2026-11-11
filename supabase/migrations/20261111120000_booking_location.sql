-- Additive, optional booking location. Existing clients/RPCs and payment transitions stay intact.
begin;
create table public.booking_locations (
 actor_id uuid not null,
 request_id uuid not null,
 latitude double precision,
 longitude double precision,
 access_details text not null default '' check(char_length(access_details)<=1000),
 primary key(actor_id,request_id),
 foreign key(actor_id,request_id) references public.phone_booking_requests(actor_id,request_id) on delete cascade,
 check ((latitude is null and longitude is null) or
   (latitude is not null and longitude is not null and latitude between -90 and 90 and longitude between -180 and 180))
);
alter table public.booking_locations enable row level security;
revoke all on public.booking_locations from public,anon,authenticated;
grant select on public.booking_locations to authenticated;
grant all on public.booking_locations to service_role;
create policy booking_location_owner on public.booking_locations for select to authenticated using(actor_id=(select auth.uid()));

create function public.prepare_phone_booking_located(p_request_id uuid,p_payload jsonb,p_contact jsonb,p_method text,p_reviewed_estimate_version integer,p_location jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid; result jsonb; prior public.booking_locations; lat double precision; lon double precision; details text; existed boolean;
begin
 actor=public.guest_booking_actor();
 if jsonb_typeof(p_location) is distinct from 'object' or not p_location ?& array['latitude','longitude','access_details'] or
   p_location-array['latitude','longitude','access_details']<>'{}'::jsonb or
   jsonb_typeof(p_location->'access_details') is distinct from 'string' or char_length(p_location->>'access_details')>1000 then raise invalid_parameter_value; end if;
 if not ((jsonb_typeof(p_location->'latitude')='null' and jsonb_typeof(p_location->'longitude')='null') or
   (jsonb_typeof(p_location->'latitude')='number' and jsonb_typeof(p_location->'longitude')='number')) then raise invalid_parameter_value; end if;
 lat=(p_location->>'latitude')::double precision; lon=(p_location->>'longitude')::double precision; details=p_location->>'access_details';
 if lat not between -90 and 90 or lon not between -180 and 180 then raise invalid_parameter_value; end if;
 -- Same locks/order as the existing prepare function. A replay cannot silently replace a location.
 perform pg_advisory_xact_lock(hashtextextended('phone-booking-actor:'||actor::text,0));
 perform pg_advisory_xact_lock(hashtextextended('phone-booking:'||actor::text||':'||p_request_id::text,0));
 select exists(select 1 from public.phone_booking_requests where actor_id=actor and request_id=p_request_id) into existed;
 select * into prior from public.booking_locations where actor_id=actor and request_id=p_request_id;
 if existed and (not found or prior.latitude is distinct from lat or prior.longitude is distinct from lon or prior.access_details is distinct from details) then
  raise exception 'Booking location conflict' using errcode='P0001';
 end if;
 result=public.prepare_phone_booking_reviewed(p_request_id,p_payload,p_contact,p_method,p_reviewed_estimate_version);
 if not existed then insert into public.booking_locations(actor_id,request_id,latitude,longitude,access_details) values(actor,p_request_id,lat,lon,details); end if;
 return result;
end; $$;
create function public.create_on_site_booking_located(p_request_id uuid,p_payload jsonb,p_contact jsonb,p_reviewed_estimate_version integer,p_location jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform public.prepare_phone_booking_located(p_request_id,p_payload,p_contact,'on_site',p_reviewed_estimate_version,p_location);
 return public.submit_phone_booking(p_request_id);
end; $$;
revoke all on function public.prepare_phone_booking_located(uuid,jsonb,jsonb,text,integer,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.create_on_site_booking_located(uuid,jsonb,jsonb,integer,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.prepare_phone_booking_located(uuid,jsonb,jsonb,text,integer,jsonb) to authenticated;
grant execute on function public.create_on_site_booking_located(uuid,jsonb,jsonb,integer,jsonb) to authenticated;
commit;

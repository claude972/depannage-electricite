-- CLI-09: saved personal addresses, unrelated to Auth registration or verification.
begin;
create table public.client_addresses (
 id uuid primary key,user_id uuid not null references public.profiles(id) on delete cascade,
 label text not null check(char_length(btrim(label)) between 1 and 100 and label!~'[[:cntrl:]]'),
 first_name text not null check(char_length(btrim(first_name)) between 1 and 100 and first_name!~'[[:cntrl:]]'),
 last_name text not null check(char_length(btrim(last_name)) between 1 and 100 and last_name!~'[[:cntrl:]]'),
 address text not null check(char_length(btrim(address)) between 5 and 500 and address!~'[[:cntrl:]]'),
 postal_code text not null check(char_length(postal_code) between 2 and 20 and postal_code~'^[A-Z0-9][A-Z0-9 -]+$'),
 city text not null check(char_length(btrim(city)) between 1 and 160 and city!~'[[:cntrl:]]'),
 country_code text not null check(country_code~'^[A-Z]{2}$'),
 latitude double precision check(latitude between -90 and 90),longitude double precision check(longitude between -180 and 180),
 geo_source text check(geo_source in ('manual_pin','device_reported','geocoder_selected')),
 is_preferred boolean not null default false,version integer not null default 1 check(version>0),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),archived_at timestamptz,
 check((latitude is null and longitude is null and geo_source is null)or(latitude is not null and longitude is not null and geo_source is not null)),
 check(archived_at is null or not is_preferred)
);
create index client_addresses_active on public.client_addresses(user_id,id) where archived_at is null;
create unique index client_addresses_one_preferred on public.client_addresses(user_id) where is_preferred and archived_at is null;
alter table public.client_addresses enable row level security;
revoke all on public.client_addresses from public,anon,authenticated,service_role;
grant select on public.client_addresses to authenticated,service_role;
create policy client_addresses_self_read on public.client_addresses for select to authenticated using(user_id=(select auth.uid()));
create table public.client_address_events (
 command_id uuid primary key,user_id uuid not null references public.profiles(id) on delete cascade,
 address_id uuid not null references public.client_addresses(id) on delete cascade,
 action text not null check(action in ('save','archive')),fingerprint text not null check(char_length(fingerprint)=64),
 version integer not null check(version>0),created_at timestamptz not null default now()
);
alter table public.client_address_events enable row level security;
revoke all on public.client_address_events from public,anon,authenticated,service_role;
grant select on public.client_address_events to authenticated,service_role;
create policy client_address_events_self_read on public.client_address_events for select to authenticated using(user_id=(select auth.uid()));
create index client_address_events_user on public.client_address_events(user_id,created_at desc);
create function public.write_client_address(p_id uuid,p_command_id uuid,p_expected_version integer,p_action text,p_values jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid=auth.uid();r public.client_addresses;e public.client_address_events;fingerprint text;
 label_value text;first_value text;last_value text;address_value text;postal_value text;city_value text;country_value text;
 lat_value double precision;lon_value double precision;source_value text;preferred_value boolean;
begin
 if actor is null then raise insufficient_privilege;end if;
 if p_id is null or p_command_id is null or p_action is null or p_action not in ('save','archive')
 or(p_expected_version is not null and(p_expected_version<1 or p_expected_version>=2147483647))then raise invalid_parameter_value;end if;
 if p_action='save' then
  if p_values is null or jsonb_typeof(p_values)<>'object' then raise invalid_parameter_value;end if;
  if(select count(*)from jsonb_object_keys(p_values))<>11 or not(p_values?&array['label','first_name','last_name','address','postal_code','city','country_code','latitude','longitude','geo_source','is_preferred'])
  or exists(select 1 from unnest(array['label','first_name','last_name','address','postal_code','city','country_code'])k where jsonb_typeof(p_values->k)<>'string')
  or jsonb_typeof(p_values->'latitude')not in('number','null')or jsonb_typeof(p_values->'longitude')not in('number','null')
  or jsonb_typeof(p_values->'geo_source')not in('string','null')or jsonb_typeof(p_values->'is_preferred')<>'boolean'then raise invalid_parameter_value;end if;
  label_value=btrim(p_values->>'label');first_value=btrim(p_values->>'first_name');last_value=btrim(p_values->>'last_name');address_value=btrim(p_values->>'address');
  postal_value=btrim(p_values->>'postal_code');city_value=btrim(p_values->>'city');country_value=p_values->>'country_code';
  lat_value=(p_values->>'latitude')::double precision;lon_value=(p_values->>'longitude')::double precision;source_value=p_values->>'geo_source';preferred_value=(p_values->>'is_preferred')::boolean;
  if char_length(label_value)not between 1 and 100 or char_length(first_value)not between 1 and 100 or char_length(last_value)not between 1 and 100 or char_length(address_value)not between 5 and 500
  or char_length(postal_value)not between 2 and 20 or postal_value!~'^[A-Z0-9][A-Z0-9 -]+$' or char_length(city_value)not between 1 and 160 or country_value!~'^[A-Z]{2}$'
  or label_value~'[[:cntrl:]]'or first_value~'[[:cntrl:]]'or last_value~'[[:cntrl:]]'or address_value~'[[:cntrl:]]'or city_value~'[[:cntrl:]]'
  or(lat_value is not null and not(lat_value between -90 and 90))or(lon_value is not null and not(lon_value between -180 and 180))
  or(source_value is not null and source_value not in('manual_pin','device_reported','geocoder_selected'))
  or not((lat_value is null and lon_value is null and source_value is null)or(lat_value is not null and lon_value is not null and source_value is not null))then raise invalid_parameter_value;end if;
  p_values=jsonb_build_object('label',label_value,'first_name',first_value,'last_name',last_value,'address',address_value,'postal_code',postal_value,'city',city_value,'country_code',country_value,'latitude',lat_value,'longitude',lon_value,'geo_source',source_value,'is_preferred',preferred_value);
 elsif p_expected_version is null or p_values is not null then raise invalid_parameter_value;end if;
 fingerprint=encode(sha256(convert_to(jsonb_build_object('actor',actor,'id',p_id,'version',p_expected_version,'action',p_action,'values',p_values)::text,'UTF8')),'hex');
 -- Serialize all saved-address operations per existing account. No profile mutation.
 perform 1 from public.profiles where id=actor for update;if not found then raise insufficient_privilege;end if;
 select * into r from public.client_addresses where id=p_id and user_id=actor for update;
 select * into e from public.client_address_events where command_id=p_command_id;
 if found then
  if e.user_id<>actor or e.address_id<>p_id or e.action<>p_action or e.fingerprint<>fingerprint or r.id is null or r.version<>e.version then raise exception 'Address command changed'using errcode='P0001';end if;
  return to_jsonb(r);
 end if;
 if p_action='archive' then
  if r.id is null then raise no_data_found;end if;
  if r.archived_at is not null or r.version<>p_expected_version then raise exception 'Address changed'using errcode='P0001';end if;
  update public.client_addresses set archived_at=clock_timestamp(),is_preferred=false,version=version+1,updated_at=clock_timestamp()where id=p_id returning * into r;
 else
  if r.id is null then
   if p_expected_version is not null then raise no_data_found;end if;
   if(select count(*)from public.client_addresses where user_id=actor and archived_at is null)>=50 then raise exception 'Saved addresses limit reached'using errcode='P0001';end if;
   insert into public.client_addresses(id,user_id,label,first_name,last_name,address,postal_code,city,country_code,latitude,longitude,geo_source,is_preferred)
   values(p_id,actor,label_value,first_value,last_value,address_value,postal_value,city_value,country_value,lat_value,lon_value,source_value,preferred_value)returning * into r;
  else
   if r.archived_at is not null or p_expected_version is null or r.version<>p_expected_version then raise exception 'Address changed'using errcode='P0001';end if;
   update public.client_addresses set label=label_value,first_name=first_value,last_name=last_value,address=address_value,postal_code=postal_value,city=city_value,country_code=country_value,latitude=lat_value,longitude=lon_value,geo_source=source_value,is_preferred=preferred_value,version=version+1,updated_at=clock_timestamp()where id=p_id returning * into r;
  end if;
 end if;
 insert into public.client_address_events(command_id,user_id,address_id,action,fingerprint,version)values(p_command_id,actor,p_id,p_action,fingerprint,r.version);
 return to_jsonb(r);
end;$$;
revoke all on function public.write_client_address(uuid,uuid,integer,text,jsonb)from public,anon,authenticated,service_role;
grant execute on function public.write_client_address(uuid,uuid,integer,text,jsonb)to authenticated;
commit;

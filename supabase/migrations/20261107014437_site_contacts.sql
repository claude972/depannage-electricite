-- ENT-04: human-entered operational contacts. No Auth account or invitation is created.
begin;
create table public.site_contacts (
 id uuid primary key,
 site_id uuid not null references public.sites(id) on delete cascade,
 first_name text not null check(char_length(btrim(first_name)) between 1 and 100 and first_name!~'[[:cntrl:]]'),
 last_name text not null check(char_length(btrim(last_name)) between 1 and 100 and last_name!~'[[:cntrl:]]'),
 role_label text not null check(char_length(btrim(role_label)) between 1 and 160 and role_label!~'[[:cntrl:]]'),
 phone text check(phone ~ '^\+?[0-9][0-9 ().-]{5,30}$'),
 email text check(char_length(email)<=254 and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
 note text not null default '' check(char_length(note)<=2000),
 is_primary boolean not null default false,
 version integer not null default 1 check(version>0),
 created_by uuid not null references public.profiles(id), created_at timestamptz not null default now(),
 updated_by uuid not null references public.profiles(id), updated_at timestamptz not null default now(), archived_at timestamptz,
 check(phone is not null or email is not null), check(archived_at is null or not is_primary)
);
create index site_contacts_active on public.site_contacts(site_id,id) where archived_at is null;
create unique index site_contacts_one_primary on public.site_contacts(site_id) where is_primary and archived_at is null;
alter table public.site_contacts enable row level security;
revoke all on public.site_contacts from public,anon,authenticated,service_role;
grant select on public.site_contacts to authenticated,service_role;
create policy site_contacts_read on public.site_contacts for select to authenticated using(public.can_access_site(site_id));
-- An event also acts as the durable idempotency receipt. Only a SHA-256 command
-- fingerprint is kept: audit does not duplicate phone/email/notes.
create table public.site_contact_events (
 command_id uuid primary key,
 site_id uuid not null references public.sites(id) on delete cascade,
 contact_id uuid not null references public.site_contacts(id) on delete cascade,
 actor_id uuid not null references public.profiles(id),
 action text not null check(action in ('save','archive')),
 fingerprint text not null check(char_length(fingerprint)=64),
 version integer not null check(version>0), created_at timestamptz not null default now()
);
create index site_contact_events_site on public.site_contact_events(site_id,created_at desc);
alter table public.site_contact_events enable row level security;
revoke all on public.site_contact_events from public,anon,authenticated,service_role;
grant select on public.site_contact_events to authenticated,service_role;
create policy site_contact_events_read on public.site_contact_events for select to authenticated using(public.can_access_site(site_id));

create function public.write_site_contact(p_site_id uuid,p_id uuid,p_command_id uuid,p_expected_version integer,p_action text,p_values jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid=auth.uid(); r public.site_contacts; e public.site_contact_events; fingerprint text; org_before uuid; org_locked uuid;
 first_value text;last_value text;role_value text;phone_value text;email_value text;note_value text;primary_value boolean;
begin
 if actor is null or not public.can_manage_site(p_site_id) then raise insufficient_privilege;end if;
 if p_id is null or p_command_id is null or p_action is null or p_action not in ('save','archive')
 or (p_expected_version is not null and (p_expected_version<1 or p_expected_version>=2147483647)) then raise invalid_parameter_value;end if;
 if p_action='save' then
  if p_values is null or jsonb_typeof(p_values)<>'object' then raise invalid_parameter_value;end if;
  if (select count(*) from jsonb_object_keys(p_values))<>7 or not(p_values ?& array['first_name','last_name','role_label','phone','email','note','is_primary'])
  or jsonb_typeof(p_values->'first_name')<>'string' or jsonb_typeof(p_values->'last_name')<>'string'
  or jsonb_typeof(p_values->'role_label')<>'string' or jsonb_typeof(p_values->'phone') not in ('string','null')
  or jsonb_typeof(p_values->'email') not in ('string','null') or jsonb_typeof(p_values->'note')<>'string'
  or jsonb_typeof(p_values->'is_primary')<>'boolean' then raise invalid_parameter_value;end if;
  first_value=btrim(p_values->>'first_name');last_value=btrim(p_values->>'last_name');role_value=btrim(p_values->>'role_label');
  phone_value=btrim(p_values->>'phone');email_value=btrim(p_values->>'email');note_value=btrim(p_values->>'note');primary_value=(p_values->>'is_primary')::boolean;
  if char_length(first_value) not between 1 and 100 or char_length(last_value) not between 1 and 100 or char_length(role_value) not between 1 and 160
  or first_value~'[[:cntrl:]]' or last_value~'[[:cntrl:]]' or role_value~'[[:cntrl:]]'
  or (phone_value is not null and phone_value!~'^\+?[0-9][0-9 ().-]{5,30}$')
  or (email_value is not null and (char_length(email_value)>254 or email_value!~'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'))
  or (phone_value is null and email_value is null) or char_length(note_value)>2000 then raise invalid_parameter_value;end if;
  p_values=jsonb_build_object('first_name',first_value,'last_name',last_value,'role_label',role_value,'phone',phone_value,'email',email_value,'note',note_value,'is_primary',primary_value);
 elsif p_expected_version is null or p_values is not null then raise invalid_parameter_value;
 end if;
 fingerprint=encode(sha256(convert_to(jsonb_build_object('site',p_site_id,'id',p_id,'version',p_expected_version,'action',p_action,'values',p_values)::text,'UTF8')),'hex');
 -- Same locking order as membership/scope writers; no network call under lock.
 select organization_id into org_before from public.sites where id=p_site_id;
 perform public.lock_site_access(p_site_id);
 select organization_id into org_locked from public.sites where id=p_site_id for update;
 if org_locked is null or org_locked is distinct from org_before then raise serialization_failure;end if;
 if not public.can_manage_site(p_site_id) then raise insufficient_privilege;end if;
 select * into r from public.site_contacts where id=p_id and site_id=p_site_id for update;
 select * into e from public.site_contact_events where command_id=p_command_id;
 if found then
  if e.site_id<>p_site_id or e.contact_id<>p_id or e.actor_id<>actor or e.action<>p_action or e.fingerprint<>fingerprint
   or r.id is null or r.version<>e.version then raise exception 'Contact command changed' using errcode='P0001';end if;
  return to_jsonb(r);
 end if;
 if p_action='archive' then
  if r.id is null then raise no_data_found;end if;
  if r.archived_at is not null or r.version<>p_expected_version then raise exception 'Contact changed' using errcode='P0001';end if;
  update public.site_contacts set archived_at=clock_timestamp(),is_primary=false,version=version+1,updated_by=actor,updated_at=clock_timestamp() where id=p_id returning * into r;
 else
  if r.id is null then
   if p_expected_version is not null then raise no_data_found;end if;
   insert into public.site_contacts(id,site_id,first_name,last_name,role_label,phone,email,note,is_primary,created_by,updated_by)
   values(p_id,p_site_id,first_value,last_value,role_value,phone_value,email_value,note_value,primary_value,actor,actor) returning * into r;
  else
   if r.archived_at is not null or p_expected_version is null or r.version<>p_expected_version then raise exception 'Contact changed' using errcode='P0001';end if;
   update public.site_contacts set first_name=first_value,last_name=last_value,role_label=role_value,phone=phone_value,email=email_value,note=note_value,is_primary=primary_value,version=version+1,updated_by=actor,updated_at=clock_timestamp() where id=p_id returning * into r;
  end if;
 end if;
 insert into public.site_contact_events(command_id,site_id,contact_id,actor_id,action,fingerprint,version) values(p_command_id,p_site_id,p_id,actor,p_action,fingerprint,r.version);
 return to_jsonb(r);
end;$$;
revoke all on function public.write_site_contact(uuid,uuid,uuid,integer,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.write_site_contact(uuid,uuid,uuid,integer,text,jsonb) to authenticated;
commit;

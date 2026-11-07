-- Human documentary records only. No notification, legal quorum, accounting or funds collection.
begin;
create table public.site_coownership_records(
 id uuid primary key,site_id uuid not null references public.sites(id)on delete cascade,
 kind text not null check(kind in('meeting','fund_call')),data jsonb not null check(jsonb_typeof(data)='object'and char_length(data::text)<=60000),
 status text generated always as(data->>'status')stored not null,
 meeting_id uuid generated always as((data->>'meeting_id')::uuid)stored,
 version integer not null default 1 check(version>0),created_by uuid not null references public.profiles(id),created_at timestamptz not null default now(),
 updated_by uuid not null references public.profiles(id),updated_at timestamptz not null default now(),archived_at timestamptz,
 unique(id,site_id),foreign key(meeting_id,site_id)references public.site_coownership_records(id,site_id),
 check((kind='meeting'and status in('draft','scheduled','held','cancelled')and meeting_id is null)or(kind='fund_call'and status in('draft','issued','cancelled')))
);
create index coownership_page on public.site_coownership_records(site_id,kind,id)where archived_at is null;
create index coownership_dependencies on public.site_coownership_records(site_id,meeting_id)where archived_at is null;
create unique index coownership_call_reference on public.site_coownership_records(site_id,lower(btrim(data->>'reference')))where kind='fund_call'and archived_at is null;
alter table public.site_coownership_records enable row level security;
revoke all on public.site_coownership_records from public,anon,authenticated,service_role;grant select on public.site_coownership_records to authenticated,service_role;
create policy coownership_read on public.site_coownership_records for select to authenticated using(public.can_access_site(site_id));
create table public.site_coownership_events(
 command_id uuid primary key,site_id uuid not null references public.sites(id)on delete cascade,record_id uuid not null references public.site_coownership_records(id)on delete cascade,
 actor_id uuid not null references public.profiles(id),action text not null check(action in('save','archive')),fingerprint text not null check(char_length(fingerprint)=64),version integer not null check(version>0),created_at timestamptz not null default now()
);
alter table public.site_coownership_events enable row level security;
revoke all on public.site_coownership_events from public,anon,authenticated,service_role;grant select on public.site_coownership_events to authenticated,service_role;
create policy coownership_events_read on public.site_coownership_events for select to authenticated using(public.can_access_site(site_id));
create index coownership_events_site on public.site_coownership_events(site_id,created_at desc);
create function public.coownership_page(p_site_id uuid,p_kind text,p_after_id uuid default null)returns jsonb language plpgsql stable security invoker set search_path='' as $$
begin
 if auth.uid()is null then raise insufficient_privilege;end if;
 if not public.can_access_site(p_site_id)then raise no_data_found;end if;
 if not exists(select 1 from public.sites where id=p_site_id and type='syndic')or p_kind is null or p_kind not in('meeting','fund_call')then raise invalid_parameter_value;end if;
 return jsonb_build_object('total',(select count(*)from public.site_coownership_records where site_id=p_site_id and kind=p_kind and archived_at is null),
 'remaining',(select count(*)from public.site_coownership_records where site_id=p_site_id and kind=p_kind and archived_at is null and(p_after_id is null or id>p_after_id)),
 'can_write',public.can_manage_site(p_site_id),'records',(select coalesce(jsonb_agg((to_jsonb(r)-array['data','status','meeting_id'])||jsonb_build_object('values',r.data)order by r.id),'[]')from(select *from public.site_coownership_records where site_id=p_site_id and kind=p_kind and archived_at is null and(p_after_id is null or id>p_after_id)order by id limit 50)r));
end;$$;
revoke all on function public.coownership_page(uuid,text,uuid)from public,anon,authenticated,service_role;grant execute on function public.coownership_page(uuid,text,uuid)to authenticated;
create function public.write_coownership_record(p_site_id uuid,p_kind text,p_id uuid,p_command_id uuid,p_expected_version integer,p_action text,p_values jsonb)returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid=auth.uid();r public.site_coownership_records;e public.site_coownership_events;org_before uuid;org_locked uuid;site_kind text;
 d jsonb;decisions jsonb;new_status text;meeting uuid;starts timestamptz;ends timestamptz;due date;issued date;amount bigint;fingerprint text;
begin
 if actor is null or not public.can_manage_site(p_site_id)then raise insufficient_privilege;end if;
 if p_kind is null or p_kind not in('meeting','fund_call')or p_id is null or p_command_id is null or p_action is null or p_action not in('save','archive')or(p_expected_version is not null and(p_expected_version<1 or p_expected_version>=2147483647))then raise invalid_parameter_value;end if;
 if p_action='save'then
  if p_values is null or jsonb_typeof(p_values)<>'object'then raise invalid_parameter_value;end if;
  new_status=p_values->>'status';
  if p_kind='meeting'then
   if(select count(*)from jsonb_object_keys(p_values))<>8 or not(p_values?&array['title','starts_at','ends_at','location','agenda','minutes','decisions','status'])
   or exists(select 1 from unnest(array['title','location','agenda','minutes','status'])k where jsonb_typeof(p_values->k)<>'string')
   or jsonb_typeof(p_values->'starts_at')not in('string','null')or jsonb_typeof(p_values->'ends_at')not in('string','null')or jsonb_typeof(p_values->'decisions')<>'array'then raise invalid_parameter_value;end if;
   if char_length(btrim(p_values->>'title'))not between 1 and 200 or char_length(btrim(p_values->>'location'))>300 or char_length(btrim(p_values->>'agenda'))>6000 or char_length(btrim(p_values->>'minutes'))>12000 or new_status not in('draft','scheduled','held','cancelled')or jsonb_array_length(p_values->'decisions')>20
   or exists(select 1 from jsonb_array_elements(p_values->'decisions')v where jsonb_typeof(v)<>'string'or char_length(btrim(v#>>'{}'))not between 1 and 1000)
   or exists(select 1 from unnest(array['starts_at','ends_at'])k where p_values->>k is not null and(p_values->>k)!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T.*(Z|[+-][0-9]{2}:[0-9]{2})$')then raise invalid_parameter_value;end if;
   starts=(p_values->>'starts_at')::timestamptz;ends=(p_values->>'ends_at')::timestamptz;
   if(ends is not null and(starts is null or ends<starts))or(new_status in('scheduled','held')and(starts is null or btrim(p_values->>'location')=''))or(new_status='held'and(starts>clock_timestamp()or ends>clock_timestamp()))then raise invalid_parameter_value;end if;
   select coalesce(jsonb_agg(to_jsonb(btrim(v#>>'{}'))order by n),'[]')into decisions from jsonb_array_elements(p_values->'decisions')with ordinality a(v,n);
   d=jsonb_build_object('title',btrim(p_values->>'title'),'starts_at',to_char(starts at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'ends_at',to_char(ends at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'location',btrim(p_values->>'location'),'agenda',btrim(p_values->>'agenda'),'minutes',btrim(p_values->>'minutes'),'decisions',decisions,'status',new_status);
  else
   if(select count(*)from jsonb_object_keys(p_values))<>9 or not(p_values?&array['label','reference','due_on','amount_cents','document_reference','issued_on','note','meeting_id','status'])
   or exists(select 1 from unnest(array['label','reference','due_on','document_reference','note','status'])k where jsonb_typeof(p_values->k)<>'string')or jsonb_typeof(p_values->'amount_cents')<>'number'
   or jsonb_typeof(p_values->'issued_on')not in('string','null')or jsonb_typeof(p_values->'meeting_id')not in('string','null')then raise invalid_parameter_value;end if;
   if char_length(btrim(p_values->>'label'))not between 1 and 200 or char_length(btrim(p_values->>'reference'))not between 1 and 100 or char_length(btrim(p_values->>'document_reference'))not between 1 and 240 or char_length(btrim(p_values->>'note'))>4000 or(p_values->>'amount_cents')!~'^[0-9]+$'or(p_values->>'due_on')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$'or(p_values->>'issued_on'is not null and(p_values->>'issued_on')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$')or new_status not in('draft','issued','cancelled')then raise invalid_parameter_value;end if;
   amount=(p_values->>'amount_cents')::bigint;due=(p_values->>'due_on')::date;issued=(p_values->>'issued_on')::date;meeting=(p_values->>'meeting_id')::uuid;
   if amount not between 1 and 2147483647 or(issued is not null and due<issued)or(new_status='issued'and(issued is null or issued>(clock_timestamp()at time zone 'UTC')::date))then raise invalid_parameter_value;end if;
   d=jsonb_build_object('label',btrim(p_values->>'label'),'reference',btrim(p_values->>'reference'),'due_on',to_char(due,'YYYY-MM-DD'),'amount_cents',amount,'document_reference',btrim(p_values->>'document_reference'),'issued_on',to_char(issued,'YYYY-MM-DD'),'note',btrim(p_values->>'note'),'meeting_id',meeting,'status',new_status);
  end if;
 elsif p_expected_version is null or p_values is not null then raise invalid_parameter_value;end if;
 fingerprint=encode(sha256(convert_to(jsonb_build_object('site',p_site_id,'kind',p_kind,'id',p_id,'version',p_expected_version,'action',p_action,'values',d)::text,'UTF8')),'hex');
 select organization_id into org_before from public.sites where id=p_site_id;perform public.lock_site_access(p_site_id);
 select organization_id,type into org_locked,site_kind from public.sites where id=p_site_id for update;if org_locked is null or org_locked is distinct from org_before then raise serialization_failure;end if;
 if not public.can_manage_site(p_site_id)then raise insufficient_privilege;end if;if site_kind<>'syndic'then raise invalid_parameter_value;end if;
 select *into r from public.site_coownership_records where id=p_id and site_id=p_site_id and kind=p_kind for update;
 select *into e from public.site_coownership_events where command_id=p_command_id;
 if found then
  if e.site_id<>p_site_id or e.record_id<>p_id or e.actor_id<>actor or e.action<>p_action or e.fingerprint<>fingerprint or r.id is null or r.version<>e.version then raise exception 'Record command changed'using errcode='P0001';end if;
  return(to_jsonb(r)-array['data','status','meeting_id'])||jsonb_build_object('values',r.data);
 end if;
 if r.id is null and(p_action='archive'or p_expected_version is not null)then raise no_data_found;end if;
 if r.id is not null and(r.archived_at is not null or p_expected_version is null or r.version<>p_expected_version)then raise exception 'Record changed'using errcode='P0001';end if;
 if p_kind='meeting'and(p_action='archive'or(new_status='cancelled'and r.status is distinct from 'cancelled'))and exists(select 1 from public.site_coownership_records where meeting_id=p_id and site_id=p_site_id and archived_at is null)then raise exception 'Dependent active calls'using errcode='P0001';end if;
 if p_action='archive'then update public.site_coownership_records set archived_at=clock_timestamp(),version=version+1,updated_by=actor,updated_at=clock_timestamp()where id=p_id returning *into r;
 else
  if p_kind='fund_call'and meeting is not null and not exists(select 1 from public.site_coownership_records where id=meeting and site_id=p_site_id and kind='meeting'and archived_at is null and status<>'cancelled')then raise no_data_found;end if;
  if r.id is not null then
   if(p_kind='meeting'and((r.status in('held','cancelled')and new_status<>r.status)or(r.status='scheduled'and new_status='draft')))
   or(p_kind='fund_call'and((r.status='issued'and new_status='draft')or(r.status='cancelled'and new_status<>'cancelled')))
   then raise exception 'Invalid transition'using errcode='P0001';end if;
   if p_kind='fund_call'and r.status in('issued','cancelled')and(d-array['note','status'])is distinct from(r.data-array['note','status'])then raise exception 'Issued notice fields frozen'using errcode='P0001';end if;
   update public.site_coownership_records set data=d,version=version+1,updated_by=actor,updated_at=clock_timestamp()where id=p_id returning *into r;
  else
   if(select count(*)from public.site_coownership_records where site_id=p_site_id and kind=p_kind and archived_at is null)>=500 then raise exception 'Document quota reached'using errcode='P0001';end if;
   insert into public.site_coownership_records(id,site_id,kind,data,created_by,updated_by)values(p_id,p_site_id,p_kind,d,actor,actor)returning *into r;
  end if;
 end if;
 insert into public.site_coownership_events(command_id,site_id,record_id,actor_id,action,fingerprint,version)values(p_command_id,p_site_id,p_id,actor,p_action,fingerprint,r.version);
 return(to_jsonb(r)-array['data','status','meeting_id'])||jsonb_build_object('values',r.data);
end;$$;
revoke all on function public.write_coownership_record(uuid,text,uuid,uuid,integer,text,jsonb)from public,anon,authenticated,service_role;
grant execute on function public.write_coownership_record(uuid,text,uuid,uuid,integer,text,jsonb)to authenticated;
commit;

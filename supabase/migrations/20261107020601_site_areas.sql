-- Site hierarchy only: no equipment/job remapping, regulatory claim or ownership allocation.
begin;
create table public.site_areas (
 id uuid primary key,site_id uuid not null references public.sites(id)on delete cascade,
 parent_id uuid,label text not null check(char_length(btrim(label))between 1 and 160 and label!~'[[:cntrl:]]'),
 kind text not null check(kind in('floor','zone','common_area')),
 reference text not null default ''check(char_length(btrim(reference))<=80 and reference!~'[[:cntrl:]]'),
 note text not null default ''check(char_length(note)<=2000),version integer not null default 1 check(version>0),
 created_by uuid not null references public.profiles(id),created_at timestamptz not null default now(),
 updated_by uuid not null references public.profiles(id),updated_at timestamptz not null default now(),archived_at timestamptz,
 unique(id,site_id),foreign key(parent_id,site_id)references public.site_areas(id,site_id),check(parent_id is distinct from id)
);
create index site_areas_active_page on public.site_areas(site_id,id)where archived_at is null;
create index site_areas_active_children on public.site_areas(site_id,parent_id,id)where archived_at is null;
create unique index site_areas_sibling_label on public.site_areas(site_id,parent_id,lower(btrim(label)))nulls not distinct where archived_at is null;
create unique index site_areas_reference on public.site_areas(site_id,lower(btrim(reference)))where archived_at is null and btrim(reference)<>'';
alter table public.site_areas enable row level security;
revoke all on public.site_areas from public,anon,authenticated,service_role;grant select on public.site_areas to authenticated,service_role;
create policy site_areas_read on public.site_areas for select to authenticated using(public.can_access_site(site_id));
create table public.site_area_events (
 command_id uuid primary key,site_id uuid not null references public.sites(id)on delete cascade,
 area_id uuid not null references public.site_areas(id)on delete cascade,actor_id uuid not null references public.profiles(id),
 action text not null check(action in('save','archive')),fingerprint text not null check(char_length(fingerprint)=64),
 version integer not null check(version>0),depth integer not null check(depth between 1 and 4),created_at timestamptz not null default now()
);
create index site_area_events_site on public.site_area_events(site_id,created_at desc);
alter table public.site_area_events enable row level security;
revoke all on public.site_area_events from public,anon,authenticated,service_role;grant select on public.site_area_events to authenticated,service_role;
create policy site_area_events_read on public.site_area_events for select to authenticated using(public.can_access_site(site_id));

-- Invoker inherits table RLS. The loop is capped independently of data validity.
create function public.site_area_depth(p_site_id uuid,p_id uuid)returns integer
language plpgsql stable security invoker set search_path='' as $$
declare current_id uuid=p_id;r public.site_areas;path uuid[]='{}';depth_value integer=0;active_node boolean;
begin
 if auth.uid() is null or not public.can_access_site(p_site_id)then raise insufficient_privilege;end if;
 loop
  if current_id is null then return depth_value;end if;
  if current_id=any(path)or depth_value>=4 then return null;end if;
  select *into r from public.site_areas where id=current_id and site_id=p_site_id;if not found then return null;end if;
  if depth_value=0 then active_node=r.archived_at is null;end if;
  if active_node and r.archived_at is not null then return null;end if;
  path=array_append(path,current_id);depth_value=depth_value+1;current_id=r.parent_id;
 end loop;
end;$$;
revoke all on function public.site_area_depth(uuid,uuid)from public,anon,authenticated,service_role;
grant execute on function public.site_area_depth(uuid,uuid)to authenticated;

create function public.site_area_page(p_site_id uuid,p_after_id uuid default null)returns jsonb
language plpgsql stable security invoker set search_path='' as $$
begin
 if auth.uid() is null then raise insufficient_privilege;end if;
 if p_site_id is null or not public.can_access_site(p_site_id)then raise no_data_found;end if;
 return jsonb_build_object('total',(select count(*)from public.site_areas where site_id=p_site_id and archived_at is null),
  'remaining',(select count(*)from public.site_areas where site_id=p_site_id and archived_at is null and(p_after_id is null or id>p_after_id)),
  'can_write',public.can_manage_site(p_site_id),
  'records',(select coalesce(jsonb_agg(to_jsonb(r)||jsonb_build_object('depth',public.site_area_depth(p_site_id,r.id))order by r.id),'[]')from(
   select *from public.site_areas where site_id=p_site_id and archived_at is null and(p_after_id is null or id>p_after_id)order by id limit 100)r));
end;$$;
revoke all on function public.site_area_page(uuid,uuid)from public,anon,authenticated,service_role;
grant execute on function public.site_area_page(uuid,uuid)to authenticated;

create function public.write_site_area(p_site_id uuid,p_id uuid,p_command_id uuid,p_expected_version integer,p_action text,p_values jsonb)returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid=auth.uid();r public.site_areas;e public.site_area_events;fingerprint text;org_before uuid;org_locked uuid;
 label_value text;kind_value text;reference_value text;note_value text;parent_value uuid;
 parent_depth integer=0;tree_height integer;has_cycle boolean;parent_in_tree boolean;result_depth integer;
begin
 if actor is null or not public.can_manage_site(p_site_id)then raise insufficient_privilege;end if;
 if p_id is null or p_command_id is null or p_action is null or p_action not in('save','archive')or(p_expected_version is not null and(p_expected_version<1 or p_expected_version>=2147483647))then raise invalid_parameter_value;end if;
 if p_action='save'then
  if p_values is null or jsonb_typeof(p_values)<>'object'then raise invalid_parameter_value;end if;
  if(select count(*)from jsonb_object_keys(p_values))<>5 or not(p_values?&array['label','kind','reference','note','parent_id'])
  or exists(select 1 from unnest(array['label','kind','reference','note'])k where jsonb_typeof(p_values->k)<>'string')or jsonb_typeof(p_values->'parent_id')not in('string','null')then raise invalid_parameter_value;end if;
  label_value=btrim(p_values->>'label');kind_value=p_values->>'kind';reference_value=btrim(p_values->>'reference');note_value=btrim(p_values->>'note');parent_value=(p_values->>'parent_id')::uuid;
  if char_length(label_value)not between 1 and 160 or kind_value not in('floor','zone','common_area')or char_length(reference_value)>80 or char_length(note_value)>2000 or label_value~'[[:cntrl:]]'or reference_value~'[[:cntrl:]]'then raise invalid_parameter_value;end if;
  p_values=jsonb_build_object('label',label_value,'kind',kind_value,'reference',reference_value,'note',note_value,'parent_id',parent_value);
 elsif p_expected_version is null or p_values is not null then raise invalid_parameter_value;end if;
 fingerprint=encode(sha256(convert_to(jsonb_build_object('site',p_site_id,'id',p_id,'version',p_expected_version,'action',p_action,'values',p_values)::text,'UTF8')),'hex');
 select organization_id into org_before from public.sites where id=p_site_id;perform public.lock_site_access(p_site_id);
 select organization_id into org_locked from public.sites where id=p_site_id for update;
 if org_locked is null or org_locked is distinct from org_before then raise serialization_failure;end if;
 if not public.can_manage_site(p_site_id)then raise insufficient_privilege;end if;
 select *into r from public.site_areas where id=p_id and site_id=p_site_id for update;
 select *into e from public.site_area_events where command_id=p_command_id;
 if found then
  result_depth=public.site_area_depth(p_site_id,p_id);
  if e.site_id<>p_site_id or e.area_id<>p_id or e.actor_id<>actor or e.action<>p_action or e.fingerprint<>fingerprint or r.id is null or r.version<>e.version or result_depth is distinct from e.depth then raise exception 'Area command changed'using errcode='P0001';end if;
  return to_jsonb(r)||jsonb_build_object('depth',result_depth);
 end if;
 if p_action='archive'then
  if r.id is null then raise no_data_found;end if;
  if r.archived_at is not null or r.version<>p_expected_version then raise exception 'Area changed'using errcode='P0001';end if;
  if exists(select 1 from public.site_areas where site_id=p_site_id and parent_id=p_id and archived_at is null)then raise exception 'Archive active children first'using errcode='P0001';end if;
  update public.site_areas set archived_at=clock_timestamp(),version=version+1,updated_by=actor,updated_at=clock_timestamp()where id=p_id returning *into r;
 else
  if r.id is null and p_expected_version is not null then raise no_data_found;end if;
  if r.id is not null and(r.archived_at is not null or p_expected_version is null or r.version<>p_expected_version)then raise exception 'Area changed'using errcode='P0001';end if;
  if parent_value=p_id then raise exception 'Area cycle'using errcode='P0001';end if;
  if parent_value is not null then
   if not exists(select 1 from public.site_areas where id=parent_value and site_id=p_site_id and archived_at is null)then raise no_data_found;end if;
   parent_depth=public.site_area_depth(p_site_id,parent_value);if parent_depth is null then raise exception 'Parent path unavailable'using errcode='P0001';end if;
  end if;
  with recursive descendants as(
   select id,1 h,array[id]path,false cycle from public.site_areas where id=p_id and site_id=p_site_id and archived_at is null
   union all select c.id,d.h+1,d.path||c.id,c.id=any(d.path)from public.site_areas c join descendants d on c.parent_id=d.id
   where c.site_id=p_site_id and c.archived_at is null and not d.cycle and d.h<=4
  )select coalesce(max(h),1),coalesce(bool_or(cycle),false),coalesce(bool_or(id=parent_value),false)into tree_height,has_cycle,parent_in_tree from descendants;
  if has_cycle or parent_in_tree or parent_depth+tree_height>4 then raise exception 'Area cycle or maximum depth exceeded'using errcode='P0001';end if;
  if r.id is null then
   if(select count(*)from public.site_areas where site_id=p_site_id and archived_at is null)>=1000 then raise exception 'Area quota reached'using errcode='P0001';end if;
   insert into public.site_areas(id,site_id,parent_id,label,kind,reference,note,created_by,updated_by)values(p_id,p_site_id,parent_value,label_value,kind_value,reference_value,note_value,actor,actor)returning *into r;
  else
   update public.site_areas set parent_id=parent_value,label=label_value,kind=kind_value,reference=reference_value,note=note_value,version=version+1,updated_by=actor,updated_at=clock_timestamp()where id=p_id returning *into r;
  end if;
 end if;
 result_depth=public.site_area_depth(p_site_id,p_id);if result_depth is null then raise exception 'Area path unavailable'using errcode='P0003';end if;
 insert into public.site_area_events(command_id,site_id,area_id,actor_id,action,fingerprint,version,depth)values(p_command_id,p_site_id,p_id,actor,p_action,fingerprint,r.version,result_depth);
 return to_jsonb(r)||jsonb_build_object('depth',result_depth);
end;$$;
revoke all on function public.write_site_area(uuid,uuid,uuid,integer,text,jsonb)from public,anon,authenticated,service_role;
grant execute on function public.write_site_area(uuid,uuid,uuid,integer,text,jsonb)to authenticated;
commit;

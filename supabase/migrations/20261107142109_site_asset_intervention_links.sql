-- Explicit, versioned links only. Existing interventions are not backfilled or reclassified.
begin;
alter table public.interventions add constraint intervention_asset_site_key unique(id,site_id);
alter table public.site_equipment add constraint equipment_asset_site_key unique(id,site_id);
create table public.site_asset_intervention_links (
 id uuid primary key default gen_random_uuid(), site_id uuid not null references public.sites(id),
 intervention_id uuid not null, equipment_id uuid, area_id uuid,
 active boolean not null default true, version integer not null default 1 check(version>0),
 created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(),
 detached_at timestamptz,
 foreign key(intervention_id,site_id)references public.interventions(id,site_id),
 foreign key(equipment_id,site_id)references public.site_equipment(id,site_id),
 foreign key(area_id,site_id)references public.site_areas(id,site_id),
 check(num_nonnulls(equipment_id,area_id)=1),check(active=(detached_at is null)),
 unique nulls not distinct(intervention_id,equipment_id,area_id)
);
create index asset_links_equipment_page on public.site_asset_intervention_links(site_id,equipment_id,id)where equipment_id is not null;
create index asset_links_area_page on public.site_asset_intervention_links(site_id,area_id,id)where area_id is not null;
create index asset_links_job_page on public.site_asset_intervention_links(site_id,intervention_id,id);
create table public.site_asset_link_events (
 command_id uuid primary key, link_id uuid not null references public.site_asset_intervention_links(id),
 site_id uuid not null references public.sites(id),actor_id uuid not null references public.profiles(id),
 action text not null check(action in('link','unlink')),fingerprint text not null check(length(fingerprint)=64),
 result jsonb not null,created_at timestamptz not null default clock_timestamp()
);
alter table public.site_asset_intervention_links enable row level security;
alter table public.site_asset_link_events enable row level security;
-- No raw rows exposed: callers use narrow projections below, not audit actor IDs or arbitrary job data.
revoke all on public.site_asset_intervention_links,public.site_asset_link_events from public,anon,authenticated,service_role;
create function public.can_read_site_asset_links(p_site uuid)returns boolean language sql stable security definer set search_path=''as $$
 select auth.uid() is not null and public.can_access_site(p_site) and exists(
 select 1 from public.sites s join public.organization_members m on m.organization_id=s.organization_id where s.id=p_site and m.user_id=auth.uid());
$$;
revoke all on function public.can_read_site_asset_links(uuid)from public,anon,authenticated,service_role;
create function public.site_asset_link_projection(p_link public.site_asset_intervention_links)returns jsonb language sql stable security definer set search_path=''as $$
 select jsonb_build_object('id',p_link.id,'site_id',p_link.site_id,'intervention_id',p_link.intervention_id,
 'kind',case when p_link.equipment_id is not null then'equipment'else'area'end,'asset_id',coalesce(p_link.equipment_id,p_link.area_id),
 'active',p_link.active,'version',p_link.version,'created_at',p_link.created_at,'updated_at',p_link.updated_at,'detached_at',p_link.detached_at);
$$;
revoke all on function public.site_asset_link_projection(public.site_asset_intervention_links)from public,anon,authenticated,service_role;
create function public.write_site_asset_link(p_site_id uuid,p_intervention_id uuid,p_kind text,p_asset_id uuid,p_action text,p_command_id uuid,p_expected_version integer)returns jsonb
language plpgsql security definer set search_path=''as $$
declare actor uuid=auth.uid();org_before uuid;org_locked uuid;site_archived timestamptz;asset_archived boolean;
 r public.site_asset_intervention_links;e public.site_asset_link_events;fp text;result jsonb;
begin
 if actor is null or not public.can_read_site_asset_links(p_site_id)or not public.can_manage_site(p_site_id)then raise insufficient_privilege;end if;
 if p_intervention_id is null or p_asset_id is null or p_command_id is null or p_kind is null or p_kind not in('equipment','area')or p_action is null or p_action not in('link','unlink')or(p_expected_version is not null and p_expected_version not between 1 and 2147483646)or(p_action='unlink'and p_expected_version is null)then raise invalid_parameter_value;end if;
 fp=encode(sha256(convert_to(jsonb_build_object('site',p_site_id,'job',p_intervention_id,'kind',p_kind,'asset',p_asset_id,'action',p_action,'version',p_expected_version)::text,'UTF8')),'hex');
 select organization_id into org_before from public.sites where id=p_site_id;
 perform public.lock_site_access(p_site_id);
 select organization_id,archived_at into org_locked,site_archived from public.sites where id=p_site_id for update;
 if org_locked is null or org_locked is distinct from org_before then raise serialization_failure;end if;
 if not public.can_read_site_asset_links(p_site_id)or not public.can_manage_site(p_site_id)then raise insufficient_privilege;end if;
 select *into e from public.site_asset_link_events where command_id=p_command_id;
 if found then
  if e.actor_id<>actor or e.site_id<>p_site_id or e.fingerprint<>fp then raise exception 'Link command changed'using errcode='P0001';end if;
  return jsonb_build_object('record',e.result,'replayed',true);
 end if;
 if site_archived is not null then raise exception 'Archived site is read only'using errcode='P0001';end if;
 perform 1 from public.interventions where id=p_intervention_id and site_id=p_site_id for share;
 if not found then raise no_data_found;end if;
 if p_kind='equipment'then
  select status='retired' into asset_archived from public.site_equipment where id=p_asset_id and site_id=p_site_id for share;
 else
  select archived_at is not null into asset_archived from public.site_areas where id=p_asset_id and site_id=p_site_id for share;
 end if;
 if not found then raise no_data_found;end if;
 if p_action='link'and asset_archived then raise exception 'Archived asset cannot receive new links'using errcode='P0001';end if;
 select *into r from public.site_asset_intervention_links where intervention_id=p_intervention_id and site_id=p_site_id
 and(case when p_kind='equipment'then equipment_id=p_asset_id else area_id=p_asset_id end)for update;
 if r.id is null then
  if p_expected_version is not null or p_action='unlink'then raise no_data_found;end if;
  if(select count(*)from public.site_asset_intervention_links where intervention_id=p_intervention_id)>=100 then raise exception 'Link history quota reached'using errcode='P0001';end if;
 elsif p_expected_version is null or r.version<>p_expected_version or r.active=(p_action='link')then raise exception 'Link changed'using errcode='P0001';end if;
 if p_action='link'and(select count(*)from public.site_asset_intervention_links where intervention_id=p_intervention_id and active)>=50 then raise exception 'Active link quota reached'using errcode='P0001';end if;
 perform public.consume_action('site_asset_links',60);
 if r.id is null then
  insert into public.site_asset_intervention_links(site_id,intervention_id,equipment_id,area_id)
  values(p_site_id,p_intervention_id,case when p_kind='equipment'then p_asset_id end,case when p_kind='area'then p_asset_id end)returning *into r;
 else
  update public.site_asset_intervention_links set active=(p_action='link'),version=version+1,updated_at=clock_timestamp(),detached_at=case when p_action='unlink'then clock_timestamp()else null end where id=r.id returning *into r;
 end if;
 result=public.site_asset_link_projection(r);
 insert into public.site_asset_link_events(command_id,link_id,site_id,actor_id,action,fingerprint,result)values(p_command_id,r.id,p_site_id,actor,p_action,fp,result);
 return jsonb_build_object('record',result,'replayed',false);
end;$$;
revoke all on function public.write_site_asset_link(uuid,uuid,text,uuid,text,uuid,integer)from public,anon,authenticated,service_role;
grant execute on function public.write_site_asset_link(uuid,uuid,text,uuid,text,uuid,integer)to authenticated;

create function public.site_asset_link_page(p_site_id uuid,p_kind text default null,p_asset_id uuid default null,p_intervention_id uuid default null,p_after_id uuid default null)returns jsonb
language plpgsql stable security definer set search_path=''as $$
declare rows jsonb;site_archived boolean;
begin
 if auth.uid()is null then raise insufficient_privilege;end if;
 if not public.can_read_site_asset_links(p_site_id)then raise no_data_found;end if;
 if not((p_intervention_id is not null and p_kind is null and p_asset_id is null)or(p_intervention_id is null and p_kind in('equipment','area')and p_asset_id is not null))or(p_intervention_id is null and(p_kind is null or p_asset_id is null))then raise invalid_parameter_value;end if;
 if p_intervention_id is not null then
  if not exists(select 1 from public.interventions where id=p_intervention_id and site_id=p_site_id)then raise no_data_found;end if;
 elsif p_kind='equipment'then
  if not exists(select 1 from public.site_equipment where id=p_asset_id and site_id=p_site_id)then raise no_data_found;end if;
 else
  if not exists(select 1 from public.site_areas where id=p_asset_id and site_id=p_site_id)then raise no_data_found;end if;
 end if;
 select archived_at is not null into site_archived from public.sites where id=p_site_id;
 select coalesce(jsonb_agg(public.site_asset_link_projection(r)||jsonb_build_object(
 'intervention',jsonb_build_object('id',j.id,'category',j.category,'status',j.status,'created_at',j.created_at),
 'asset_archived',case when r.equipment_id is not null then eq.status='retired'else area.archived_at is not null end)order by r.id),'[]'::jsonb)into rows
 from(select *from public.site_asset_intervention_links l where l.site_id=p_site_id and(p_after_id is null or l.id>p_after_id)
 and((p_intervention_id is not null and l.intervention_id=p_intervention_id)or(p_kind='equipment'and l.equipment_id=p_asset_id)or(p_kind='area'and l.area_id=p_asset_id))order by l.id limit 51)r
 join public.interventions j on j.id=r.intervention_id and j.site_id=p_site_id
 left join public.site_equipment eq on eq.id=r.equipment_id left join public.site_areas area on area.id=r.area_id;
 return jsonb_build_object('records',rows,'can_write',public.can_manage_site(p_site_id)and not site_archived,'site_archived',site_archived);
end;$$;
revoke all on function public.site_asset_link_page(uuid,text,uuid,uuid,uuid)from public,anon,authenticated,service_role;
grant execute on function public.site_asset_link_page(uuid,text,uuid,uuid,uuid)to authenticated;
commit;

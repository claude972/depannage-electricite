begin;
create table public.provider_teams(id uuid primary key,owner_id uuid not null unique references public.profiles(id),name text not null check(char_length(btrim(name))between 1 and 160),version integer not null default 1 check(version>0),created_at timestamptz not null default clock_timestamp());
create table public.provider_team_members(team_id uuid not null references public.provider_teams(id),user_id uuid not null references public.profiles(id),role text not null check(role in('owner','coordinator','technician')),active boolean not null default true,version integer not null default 1 check(version>0),primary key(team_id,user_id));
create table public.provider_team_invitations(id uuid primary key,team_id uuid not null references public.provider_teams(id),email text not null check(char_length(email)between 3 and 254),role text not null check(role in('coordinator','technician')),expires_at timestamptz not null,status text not null default 'pending'check(status in('pending','accepted','declined','revoked')),accepted_by uuid references public.profiles(id),created_at timestamptz not null default clock_timestamp());
create unique index provider_team_pending_email on public.provider_team_invitations(team_id,email)where status='pending';
create index provider_team_invitation_email on public.provider_team_invitations(email,id)where status='pending';
create table public.provider_team_assignments(intervention_id uuid primary key references public.interventions(id),team_id uuid not null references public.provider_teams(id),technician_id uuid references public.profiles(id),state text not null check(state in('assigned','acknowledged','done','unassigned')),note text not null default ''check(char_length(note)<=2000),version integer not null default 1 check(version>0),updated_at timestamptz not null default clock_timestamp(),foreign key(team_id,technician_id)references public.provider_team_members(team_id,user_id),check((state='unassigned')=(technician_id is null)));
create table public.provider_team_commands(command_id uuid primary key,team_id uuid not null references public.provider_teams(id),actor_id uuid not null references public.profiles(id),action text not null,inputs jsonb not null,result jsonb not null,created_at timestamptz not null default clock_timestamp());
create table public.provider_team_assignment_events(intervention_id uuid not null,version integer not null,team_id uuid not null,actor_id uuid,record jsonb not null,created_at timestamptz not null default clock_timestamp(),primary key(intervention_id,version));
alter table public.provider_teams enable row level security;
alter table public.provider_team_members enable row level security;
alter table public.provider_team_invitations enable row level security;
alter table public.provider_team_assignments enable row level security;
alter table public.provider_team_commands enable row level security;
alter table public.provider_team_assignment_events enable row level security;
revoke all on public.provider_teams,public.provider_team_members,public.provider_team_invitations,public.provider_team_assignments,public.provider_team_commands,public.provider_team_assignment_events from public,anon,authenticated,service_role;
create function public.provider_assignment_audit()returns trigger language plpgsql security definer set search_path=''as $$begin
 insert into public.provider_team_assignment_events(intervention_id,version,team_id,actor_id,record)values(new.intervention_id,new.version,new.team_id,auth.uid(),to_jsonb(new));return new;end;$$;
revoke all on function public.provider_assignment_audit()from public,anon,authenticated,service_role;
create trigger provider_assignment_audit after insert or update on public.provider_team_assignments for each row execute function public.provider_assignment_audit();
create function public.provider_team_active(p_owner uuid)returns boolean language sql stable security definer set search_path=''as $$select exists(select 1 from public.profiles p join public.artisan_profiles a on a.user_id=p.id where p.id=p_owner and p.role='artisan'and p.artisan_approved and a.application_status='approved');$$;
revoke all on function public.provider_team_active(uuid)from public,anon,authenticated,service_role;
create function public.provider_team_role(p_team uuid)returns text language sql stable security definer set search_path=''as $$select role from public.provider_team_members where team_id=p_team and user_id=auth.uid()and active;$$;
revoke all on function public.provider_team_role(uuid)from public,anon,authenticated,service_role;

-- No alteration of profiles.role, intervention attribution, global read policies or financial commands.
create function public.write_provider_team(p_team_id uuid,p_command_id uuid,p_action text,p_values jsonb)returns jsonb language plpgsql security definer set search_path=''as $$
declare actor uuid=auth.uid();t public.provider_teams;member_role text;prior public.provider_team_commands;inv public.provider_team_invitations;a public.provider_team_assignments;j public.interventions;v integer;entity uuid;entity_version integer;state text;result jsonb;email_value text;target uuid;role_value text;expiry timestamptz;allowed text[];
begin
 if actor is null then raise insufficient_privilege;end if;
 if p_team_id is null or p_command_id is null or p_action is null or jsonb_typeof(p_values)is distinct from 'object'then raise invalid_parameter_value;end if;
 allowed=case p_action when 'create'then array['name']when 'rename'then array['name','expected_version']when 'invite'then array['invitation_id','email','role','expires_at','expected_version']when 'revoke_invitation'then array['invitation_id','expected_version']when 'remove_member'then array['user_id','expected_version']when 'set_role'then array['user_id','role','expected_version']when 'accept_invitation'then array['invitation_id']when 'decline_invitation'then array['invitation_id']when 'assign'then array['intervention_id','technician_id','expected_version']when 'unassign'then array['intervention_id','expected_version']when 'progress'then array['intervention_id','expected_version','state','note']else null end;
 if allowed is null or not(p_values?&allowed)or p_values-allowed<>'{}'::jsonb then raise invalid_parameter_value;end if;
 if p_values?'expected_version'then
  if p_action='assign'and p_values->'expected_version'='null'::jsonb then v=null;
  elsif jsonb_typeof(p_values->'expected_version')<>'number'or(p_values->>'expected_version')!~'^[0-9]+$'then raise invalid_parameter_value;
  else v=(p_values->>'expected_version')::integer;if v not between 1 and 2147483646 then raise invalid_parameter_value;end if;end if;
 end if;
 if p_action in('assign','unassign','progress')then
  entity=(p_values->>'intervention_id')::uuid;
  perform public.lock_intervention_organization(entity);
  select *into j from public.interventions where id=entity for update;
  if not found then raise no_data_found;end if;
 end if;
 if p_action='create'then
  perform pg_advisory_xact_lock(hashtextextended('provider-team-owner:'||actor::text,0));
  perform 1 from public.profiles where id=actor for share;perform 1 from public.artisan_profiles where user_id=actor for share;
  if not public.provider_team_active(actor)then raise insufficient_privilege;end if;
 else
  select *into t from public.provider_teams where id=p_team_id;
  if not found then raise no_data_found;end if;
  perform 1 from public.profiles where id=t.owner_id for share;perform 1 from public.artisan_profiles where user_id=t.owner_id for share;
 end if;
 if p_action in('accept_invitation','decline_invitation')then perform pg_advisory_xact_lock(hashtextextended('provider-team-join:'||actor::text,0));end if;
 select *into t from public.provider_teams where id=p_team_id for update;
 member_role=public.provider_team_role(p_team_id);
 if p_action='create'then
  if t.id is not null and t.owner_id<>actor then raise no_data_found;end if;
 elsif p_action in('accept_invitation','decline_invitation')then
  select lower(btrim(u.email))into email_value from auth.users u where u.id=actor and u.email_confirmed_at is not null for share;
  select *into inv from public.provider_team_invitations where id=(p_values->>'invitation_id')::uuid and team_id=p_team_id and provider_team_invitations.email=email_value for update;
  if not found then raise no_data_found;end if;
 elsif member_role is null then raise no_data_found;
 elsif p_action in('rename','invite','revoke_invitation','remove_member','set_role')and member_role<>'owner'then raise insufficient_privilege;
 elsif p_action in('assign','unassign')and member_role not in('owner','coordinator')then raise insufficient_privilege;
 elsif p_action='progress'and member_role<>'technician'then raise insufficient_privilege;
 end if;
 if p_action not in('remove_member','revoke_invitation','decline_invitation','create')and not public.provider_team_active(t.owner_id)then raise insufficient_privilege;end if;
 select *into prior from public.provider_team_commands where command_id=p_command_id;
 if found then
  if prior.actor_id<>actor or prior.team_id<>p_team_id or prior.action<>p_action or prior.inputs<>p_values then raise exception 'Team command changed'using errcode='P0001';end if;
  if p_action='accept_invitation'and member_role is null then raise insufficient_privilege;end if;
  if p_action in('assign','unassign','progress')and(j.artisan_id is distinct from t.owner_id or j.status in('requested','cancelled'))then raise insufficient_privilege;end if;
  if p_action='progress'and not exists(select 1 from public.provider_team_assignments where intervention_id=entity and team_id=p_team_id and technician_id=actor)then raise insufficient_privilege;end if;
  return prior.result||jsonb_build_object('replayed',true);
 end if;
 if p_action in('create','rename')then
  if jsonb_typeof(p_values->'name')<>'string'or char_length(btrim(p_values->>'name'))not between 1 and 160 then raise invalid_parameter_value;end if;
 end if;
 if p_action='create'then
  if t.id is not null or exists(select 1 from public.provider_teams where owner_id=actor)then raise exception 'Owner already has a team'using errcode='P0001';end if;
  insert into public.provider_teams(id,owner_id,name)values(p_team_id,actor,btrim(p_values->>'name'))returning *into t;
  insert into public.provider_team_members(team_id,user_id,role)values(t.id,actor,'owner');entity=t.id;entity_version=t.version;state='created';
 elsif p_action in('rename','invite','revoke_invitation','remove_member','set_role')then
  if t.version<>v then raise exception 'Team version changed'using errcode='P0001';end if;
  if p_action='rename'then update public.provider_teams set name=btrim(p_values->>'name')where id=t.id;entity=t.id;state='renamed';
  elsif p_action='invite'then
   entity=(p_values->>'invitation_id')::uuid;email_value=lower(btrim(p_values->>'email'));role_value=p_values->>'role';expiry=(p_values->>'expires_at')::timestamptz;
   if entity is null or email_value is null or char_length(email_value)>254 or email_value!~'^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'or role_value is null or role_value not in('coordinator','technician')or expiry is null or not isfinite(expiry)or expiry<=clock_timestamp()then raise invalid_parameter_value;end if;
   if(select count(*)from public.provider_team_invitations where team_id=t.id and status='pending'and expires_at>clock_timestamp())>=100 then raise exception 'Pending invitation limit reached'using errcode='P0001';end if;
   update public.provider_team_invitations set status='revoked'where team_id=t.id and provider_team_invitations.email=email_value and status='pending'and expires_at<=clock_timestamp();
   insert into public.provider_team_invitations(id,team_id,email,role,expires_at)values(entity,t.id,email_value,role_value,expiry);state='pending';
  elsif p_action='revoke_invitation'then
   entity=(p_values->>'invitation_id')::uuid;
   update public.provider_team_invitations set status='revoked'where id=entity and team_id=t.id and status='pending';if not found then raise exception 'Invitation is not pending'using errcode='P0001';end if;state='revoked';
  else
   entity=(p_values->>'user_id')::uuid;role_value=p_values->>'role';
   if entity is null or entity=t.owner_id then raise invalid_parameter_value;end if;
   if p_action='set_role'and(role_value is null or role_value not in('coordinator','technician'))then raise invalid_parameter_value;end if;
   update public.provider_team_members set active=p_action<>'remove_member',role=case when p_action='set_role'then role_value else role end,version=version+1 where team_id=t.id and user_id=entity and active returning version into entity_version;
   if not found then raise no_data_found;end if;
   -- Existing task history stays immutable; current assignments lose access immediately.
   update public.provider_team_assignments set technician_id=null,state='unassigned',note='',version=version+1,updated_at=clock_timestamp()where team_id=t.id and technician_id=entity and(p_action='remove_member'or role_value<>'technician');
   state=case when p_action='remove_member'then'inactive'else role_value end;
  end if;
  update public.provider_teams set version=version+1 where id=t.id returning *into t;
  if p_action='rename'then entity_version=t.version;end if;
 elsif p_action in('accept_invitation','decline_invitation')then
  if inv.status<>'pending'or inv.expires_at<=clock_timestamp()then raise exception 'Invitation unavailable'using errcode='P0001';end if;
  entity=inv.id;
  if p_action='accept_invitation'then
   if member_role is not null then raise exception 'Already a team member'using errcode='P0001';end if;
   if(select count(*)from public.provider_team_members where team_id=t.id and active)>=100 or(select count(*)from public.provider_team_members where user_id=actor and active)>=50 then raise exception 'Membership limit reached'using errcode='P0001';end if;
   insert into public.provider_team_members(team_id,user_id,role)values(t.id,actor,inv.role)on conflict(team_id,user_id)do update set role=excluded.role,active=true,version=provider_team_members.version+1 returning version into entity_version;
   update public.provider_team_invitations set status='accepted',accepted_by=actor where id=inv.id;state='accepted';
  else update public.provider_team_invitations set status='declined'where id=inv.id;state='declined';end if;
  update public.provider_teams set version=version+1 where id=t.id returning *into t;
 else
  if j.artisan_id is distinct from t.owner_id or j.status in('requested','cancelled')then raise insufficient_privilege;end if;
  select *into a from public.provider_team_assignments where intervention_id=entity for update;
  if((a.intervention_id is null or a.team_id<>t.id)and v is not null)or(a.intervention_id is not null and a.team_id=t.id and a.version is distinct from v)then raise exception 'Assignment version changed'using errcode='P0001';end if;
  if p_action='assign'then
   target=(p_values->>'technician_id')::uuid;
   if target is null or j.status not in('assigned','quoted','accepted','in_progress')or not exists(select 1 from public.provider_team_members where team_id=t.id and user_id=target and active and role='technician')then raise insufficient_privilege;end if;
   if a.team_id=t.id and a.technician_id=target then raise exception 'Technician already assigned'using errcode='P0001';end if;
   insert into public.provider_team_assignments(intervention_id,team_id,technician_id,state)values(entity,t.id,target,'assigned')on conflict(intervention_id)do update set team_id=excluded.team_id,technician_id=excluded.technician_id,state='assigned',note='',version=provider_team_assignments.version+1,updated_at=clock_timestamp()returning *into a;
  elsif p_action='unassign'then
   if a.team_id is distinct from t.id or a.technician_id is null then raise no_data_found;end if;
   update public.provider_team_assignments set technician_id=null,state='unassigned',note='',version=version+1,updated_at=clock_timestamp()where intervention_id=entity returning *into a;
  else
   state=p_values->>'state';
   if a.team_id is distinct from t.id or a.technician_id is distinct from actor then raise insufficient_privilege;end if;
   if jsonb_typeof(p_values->'note')<>'string'or char_length(p_values->>'note')>2000 or state is null or not((state='acknowledged'and a.state='assigned')or(state='done'and a.state='acknowledged'and j.status in('in_progress','completed')))then raise invalid_parameter_value;end if;
   update public.provider_team_assignments set state=p_values->>'state',note=btrim(p_values->>'note'),version=version+1,updated_at=clock_timestamp()where intervention_id=entity returning *into a;
  end if;
  entity_version=a.version;state=a.state;
 end if;
 perform public.consume_action('provider_team_commands',40);
 result=jsonb_build_object('team_id',t.id,'action',p_action,'team_version',t.version,'entity_id',entity,'entity_version',entity_version,'state',state,'replayed',false);
 insert into public.provider_team_commands(command_id,team_id,actor_id,action,inputs,result)values(p_command_id,t.id,actor,p_action,p_values,result);
 return result;
end;$$;
revoke all on function public.write_provider_team(uuid,uuid,text,jsonb)from public,anon,authenticated,service_role;
grant execute on function public.write_provider_team(uuid,uuid,text,jsonb)to authenticated;

create function public.provider_team_list(p_after uuid default null)returns jsonb language plpgsql stable security definer set search_path=''as $$
declare rows jsonb;
begin
 if auth.uid()is null then raise insufficient_privilege;end if;
 select coalesce(jsonb_agg(to_jsonb(x)order by x.id),'[]'::jsonb)into rows from(
 select t.id,t.name,t.owner_id,t.version,m.role,public.provider_team_active(t.owner_id)active from public.provider_teams t join public.provider_team_members m on m.team_id=t.id and m.user_id=auth.uid()and m.active where(p_after is null or t.id>p_after)order by t.id limit 51)x;
 return jsonb_build_object('records',case when jsonb_array_length(rows)>50 then rows-50 else rows end,'next_after',case when jsonb_array_length(rows)>50 then rows->49->>'id'else null end);
end;$$;
revoke all on function public.provider_team_list(uuid)from public,anon,authenticated,service_role;
grant execute on function public.provider_team_list(uuid)to authenticated;

create function public.provider_team_invitation_page(p_after uuid default null)returns jsonb language plpgsql stable security definer set search_path=''as $$
declare rows jsonb;email_value text;
begin
 if auth.uid()is null then raise insufficient_privilege;end if;
 select lower(btrim(email))into email_value from auth.users where id=auth.uid()and email_confirmed_at is not null;
 if email_value is null then raise insufficient_privilege;end if;
 select coalesce(jsonb_agg(to_jsonb(x)order by x.id),'[]'::jsonb)into rows from(
 select i.id,i.team_id,t.name team_name,i.role,i.expires_at,public.provider_team_active(t.owner_id)team_active from public.provider_team_invitations i join public.provider_teams t on t.id=i.team_id where i.email=email_value and i.status='pending'and i.expires_at>statement_timestamp()and(p_after is null or i.id>p_after)order by i.id limit 51)x;
 return jsonb_build_object('records',case when jsonb_array_length(rows)>50 then rows-50 else rows end,'next_after',case when jsonb_array_length(rows)>50 then rows->49->>'id'else null end);
end;$$;
revoke all on function public.provider_team_invitation_page(uuid)from public,anon,authenticated,service_role;
grant execute on function public.provider_team_invitation_page(uuid)to authenticated;

create function public.provider_team_page(p_team_id uuid,p_section text,p_after uuid default null)returns jsonb language plpgsql stable security definer set search_path=''as $$
declare t public.provider_teams;member_role text;rows jsonb;
begin
 if auth.uid()is null then raise insufficient_privilege;end if;
 member_role=public.provider_team_role(p_team_id);if member_role is null then raise no_data_found;end if;
 select *into t from public.provider_teams where id=p_team_id;
 if p_section='members'then
  select coalesce(jsonb_agg(to_jsonb(x)order by x.id),'[]'::jsonb)into rows from(
   select m.user_id id,p.full_name,m.role,m.active,m.version from public.provider_team_members m join public.profiles p on p.id=m.user_id where m.team_id=t.id and(member_role in('owner','coordinator')or m.user_id=auth.uid())and(p_after is null or m.user_id>p_after)order by m.user_id limit 51)x;
 elsif p_section='invitations'then
  if member_role<>'owner'then raise insufficient_privilege;end if;
  select coalesce(jsonb_agg(to_jsonb(x)order by x.id),'[]'::jsonb)into rows from(
   select id,email,role,status,expires_at,expires_at<=statement_timestamp()expired from public.provider_team_invitations where team_id=t.id and(p_after is null or id>p_after)order by id limit 51)x;
 elsif p_section='missions'then
  if not public.provider_team_active(t.owner_id)then raise insufficient_privilege;end if;
  select coalesce(jsonb_agg(to_jsonb(x)order by x.id),'[]'::jsonb)into rows from(
   select j.id,j.category,j.status,j.city,case when a.team_id=t.id then jsonb_build_object('version',a.version,'technician_id',a.technician_id,'state',a.state,'updated_at',a.updated_at)else null end assignment
   from public.interventions j left join public.provider_team_assignments a on a.intervention_id=j.id and a.team_id=t.id
   where j.artisan_id=t.owner_id and j.status not in('requested','cancelled')and(member_role in('owner','coordinator')or(a.technician_id=auth.uid()and a.state<>'unassigned'))and(p_after is null or j.id>p_after)order by j.id limit 51)x;
 else raise invalid_parameter_value;end if;
 return jsonb_build_object('team',jsonb_build_object('id',t.id,'name',t.name,'owner_id',t.owner_id,'version',t.version,'role',member_role,'active',public.provider_team_active(t.owner_id)),'section',p_section,
 'records',case when jsonb_array_length(rows)>50 then rows-50 else rows end,'next_after',case when jsonb_array_length(rows)>50 then rows->49->>'id'else null end);
end;$$;
revoke all on function public.provider_team_page(uuid,text,uuid)from public,anon,authenticated,service_role;
grant execute on function public.provider_team_page(uuid,text,uuid)to authenticated;

create function public.provider_team_mission(p_team_id uuid,p_intervention_id uuid)returns jsonb language plpgsql stable security definer set search_path=''as $$
declare t public.provider_teams;j public.interventions;a public.provider_team_assignments;member_role text;
begin
 if auth.uid()is null then raise insufficient_privilege;end if;
 member_role=public.provider_team_role(p_team_id);if member_role is null then raise no_data_found;end if;
 select *into t from public.provider_teams where id=p_team_id;
 if not public.provider_team_active(t.owner_id)then raise insufficient_privilege;end if;
 select *into j from public.interventions where id=p_intervention_id and artisan_id=t.owner_id and status not in('requested','cancelled');if not found then raise no_data_found;end if;
 select *into a from public.provider_team_assignments where intervention_id=j.id and team_id=t.id;
 if member_role='technician'and(a.technician_id is distinct from auth.uid()or a.state='unassigned')then raise no_data_found;end if;
 return jsonb_build_object('team_id',t.id,'intervention',jsonb_build_object('id',j.id,'category',j.category,'status',j.status,'description',j.description,'address',j.address,'postal_code',j.postal_code,'city',j.city),
 'appointment',(select jsonb_build_object('starts_at',starts_at,'ends_at',ends_at)from public.intervention_appointments where intervention_id=j.id),
 'assignment',case when a.intervention_id is not null then jsonb_build_object('version',a.version,'technician_id',a.technician_id,'state',a.state,'note',a.note,'updated_at',a.updated_at)else null end,
 'permissions',jsonb_build_object('can_assign',member_role in('owner','coordinator')and j.status in('assigned','quoted','accepted','in_progress'),'can_acknowledge',member_role='technician'and a.technician_id=auth.uid()and a.state='assigned','can_complete',member_role='technician'and a.technician_id=auth.uid()and a.state='acknowledged'and j.status in('in_progress','completed')));
end;$$;
revoke all on function public.provider_team_mission(uuid,uuid)from public,anon,authenticated,service_role;
grant execute on function public.provider_team_mission(uuid,uuid)to authenticated;
commit;

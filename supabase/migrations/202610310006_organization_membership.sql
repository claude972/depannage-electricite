-- Organization-level memberships and one-time, verified-email-bound invitations.
-- Auth schema is deliberately read only inside controlled functions:
-- https://supabase.com/docs/guides/auth/managing-user-data
-- Core SHA-256 (no extra crypto extension): https://www.postgresql.org/docs/17/functions-binarystring.html
begin;

create table public.organization_invitations (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 email text not null check(email=lower(trim(email)) and char_length(email) between 3 and 320 and email ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'),
 role text not null check(role in ('manager','viewer')),
 token_hash text not null unique check(token_hash ~ '^[0-9a-f]{64}$'),
 status text not null default 'pending' check(status in ('pending','accepted','revoked','expired')),
 created_by uuid not null references public.profiles(id), created_at timestamptz not null default now(),
 expires_at timestamptz not null, accepted_by uuid references public.profiles(id), accepted_at timestamptz, revoked_at timestamptz,
 check(expires_at>created_at)
);
create unique index organization_invitation_pending_email on public.organization_invitations(organization_id,email) where status='pending';
create index organization_invitation_history on public.organization_invitations(organization_id,created_at desc,id);
create table public.organization_membership_events (
 id bigint generated always as identity primary key,
 organization_id uuid not null references public.organizations(id) on delete cascade,
 actor_id uuid not null references public.profiles(id), action text not null,
 target_user_id uuid references public.profiles(id), invitation_id uuid references public.organization_invitations(id),
 previous_role text, next_role text, created_at timestamptz not null default now()
);
alter table public.organization_invitations enable row level security;
alter table public.organization_membership_events enable row level security;
revoke all on public.organization_invitations,public.organization_membership_events from public,anon,authenticated;
grant all on public.organization_invitations,public.organization_membership_events to service_role;
grant usage,select on sequence public.organization_membership_events_id_seq to service_role;
-- No SELECT grant for invitations: even the owner must use the redacted projection.
-- In particular, token hashes are not bearer secrets exposed through the Data API.

create function public.is_org_owner(p_organization_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.organizations o join public.organization_members m on m.organization_id=o.id
 where o.id=p_organization_id and o.owner_id=auth.uid() and m.user_id=auth.uid() and m.role='owner');
$$;
revoke execute on function public.is_org_owner(uuid) from public,anon,authenticated;
grant execute on function public.is_org_owner(uuid) to authenticated;

create function public.organization_member_overview(p_organization_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare org public.organizations; owner_access boolean; result jsonb; member_role text;
begin
 if not public.is_org_member(p_organization_id) and not public.is_admin() then raise insufficient_privilege; end if;
 select * into org from public.organizations where id=p_organization_id;
 if not found then raise no_data_found; end if;
 owner_access=public.is_org_owner(p_organization_id);
 select role into member_role from public.organization_members where organization_id=p_organization_id and user_id=auth.uid();
 select jsonb_build_object(
 'organization',jsonb_build_object('id',org.id,'name',org.name,'owner_id',org.owner_id,'created_at',org.created_at),
 'current_role',coalesce(member_role,case when public.is_admin() then 'platform_admin' end),
 'members',(select coalesce(jsonb_agg(x),'[]'::jsonb) from (select m.user_id,m.role,p.full_name from public.organization_members m join public.profiles p on p.id=m.user_id where m.organization_id=p_organization_id order by case m.role when 'owner' then 0 when 'manager' then 1 else 2 end,p.full_name,m.user_id limit 200) x),
 'invitations',case when owner_access then (select coalesce(jsonb_agg(x),'[]'::jsonb) from (select id,email,role,case when status='pending' and expires_at<=now() then 'expired' else status end as status,created_at,expires_at,accepted_at,revoked_at from public.organization_invitations where organization_id=p_organization_id order by created_at desc,id limit 100) x) else '[]'::jsonb end,
 'events',case when owner_access or public.is_admin() then (select coalesce(jsonb_agg(x),'[]'::jsonb) from (select id,actor_id,action,target_user_id,invitation_id,previous_role,next_role,created_at from public.organization_membership_events where organization_id=p_organization_id order by id desc limit 100) x) else '[]'::jsonb end,
 'limits',jsonb_build_object('members',200,'invitations',100,'events',100,'members_limited',(select count(*)>200 from public.organization_members where organization_id=p_organization_id),'invitations_limited',owner_access and (select count(*)>100 from public.organization_invitations where organization_id=p_organization_id),'events_limited',(owner_access or public.is_admin()) and (select count(*)>100 from public.organization_membership_events where organization_id=p_organization_id)),
 'permissions',jsonb_build_object('can_manage',owner_access,'site_scoped_roles',false,'automated_invitation_email',false)
 ) into result;
 return result;
end; $$;

create function public.create_organization_invitation(p_organization_id uuid,p_email text,p_role text,p_token_hash text,p_expires_in_days integer default 7) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result public.organization_invitations; normalized_email text;
begin
 perform 1 from public.organizations where id=p_organization_id for update;
 if not public.is_org_owner(p_organization_id) then raise insufficient_privilege; end if;
 normalized_email=lower(trim(p_email));
 if normalized_email is null or char_length(normalized_email) not between 3 and 320 or normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' or p_role is null or p_role not in ('manager','viewer') or p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' or p_expires_in_days is null or p_expires_in_days not between 1 and 14 then raise invalid_parameter_value; end if;
 if exists(select 1 from public.organization_members m join auth.users u on u.id=m.user_id where m.organization_id=p_organization_id and lower(trim(u.email))=normalized_email) then raise exception 'Already a member' using errcode='P0001'; end if;
 perform public.consume_action('organization_invitation',20);
 update public.organization_invitations set status=case when expires_at<=now() then 'expired' else 'revoked' end,revoked_at=case when expires_at>now() then now() else null end where organization_id=p_organization_id and email=normalized_email and status='pending';
 insert into public.organization_invitations(organization_id,email,role,token_hash,created_by,expires_at)
 values(p_organization_id,normalized_email,p_role,p_token_hash,auth.uid(),now()+make_interval(days=>p_expires_in_days)) returning * into result;
 insert into public.organization_membership_events(organization_id,actor_id,action,invitation_id,next_role) values(p_organization_id,auth.uid(),'invitation_created',result.id,p_role);
 return jsonb_build_object('id',result.id,'organization_id',result.organization_id,'email',result.email,'role',result.role,'status',result.status,'created_at',result.created_at,'expires_at',result.expires_at);
end; $$;

create function public.revoke_organization_invitation(p_organization_id uuid,p_invitation_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.organizations where id=p_organization_id for update;
 if not public.is_org_owner(p_organization_id) then raise insufficient_privilege; end if;
 perform public.consume_action('organization_invitation',20);
 update public.organization_invitations set status='revoked',revoked_at=now() where id=p_invitation_id and organization_id=p_organization_id and status='pending';
 if not found then raise exception 'Invitation unavailable' using errcode='P0001'; end if;
 insert into public.organization_membership_events(organization_id,actor_id,action,invitation_id) values(p_organization_id,auth.uid(),'invitation_revoked',p_invitation_id);
end; $$;

create function public.accept_organization_invitation(p_token text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare invitation public.organization_invitations; org public.organizations; email_value text; profile_role text;
begin
 if auth.uid() is null then raise insufficient_privilege; end if;
 if p_token is null or p_token !~ '^[0-9a-f]{64}$' then raise invalid_parameter_value; end if;
 -- This authoritative Auth value is never received as a browser/RPC parameter.
 select lower(trim(u.email)) into email_value from auth.users u where u.id=auth.uid() and u.email_confirmed_at is not null and u.email is not null;
 if email_value is null then raise insufficient_privilege; end if;
 select role into profile_role from public.profiles where id=auth.uid();
 if profile_role not in ('client','manager') or profile_role is null then raise insufficient_privilege; end if;
 select * into invitation from public.organization_invitations where token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex');
 if not found then raise exception 'Invitation unavailable' using errcode='P0001'; end if;
 -- Shared lock order for create/revoke/accept/transfer: organization, then invitation/member.
 select * into org from public.organizations where id=invitation.organization_id for update;
 select * into invitation from public.organization_invitations where id=invitation.id for update;
 if invitation.status<>'pending' or invitation.expires_at<=now() then raise exception 'Invitation unavailable' using errcode='P0001'; end if;
 if invitation.email is distinct from email_value then raise insufficient_privilege; end if;
 if exists(select 1 from public.organization_members where organization_id=org.id and user_id=auth.uid()) then raise exception 'Already a member' using errcode='P0001'; end if;
 perform public.consume_action('organization_accept',10);
 insert into public.organization_members(organization_id,user_id,role) values(org.id,auth.uid(),invitation.role);
 update public.organization_invitations set status='accepted',accepted_by=auth.uid(),accepted_at=now() where id=invitation.id;
 -- manager is a portal persona, not a grant to any organization or platform administration.
 if profile_role='client' then update public.profiles set role='manager' where id=auth.uid(); end if;
 insert into public.organization_membership_events(organization_id,actor_id,action,target_user_id,invitation_id,next_role) values(org.id,auth.uid(),'invitation_accepted',auth.uid(),invitation.id,invitation.role);
 return jsonb_build_object('organization',jsonb_build_object('id',org.id,'name',org.name,'owner_id',org.owner_id),'membership',jsonb_build_object('organization_id',org.id,'user_id',auth.uid(),'role',invitation.role));
end; $$;

create function public.change_organization_member_role(p_organization_id uuid,p_user_id uuid,p_role text) returns void
language plpgsql security definer set search_path='' as $$
declare old_role text;
begin
 perform 1 from public.organizations where id=p_organization_id for update;
 if not public.is_org_owner(p_organization_id) then raise insufficient_privilege; end if;
 if p_user_id is null or p_user_id=auth.uid() or p_role is null or p_role not in ('manager','viewer') then raise invalid_parameter_value; end if;
 select role into old_role from public.organization_members where organization_id=p_organization_id and user_id=p_user_id for update;
 if not found then raise no_data_found; end if;
 if old_role='owner' then raise insufficient_privilege; end if;
 perform public.consume_action('organization_member',30);
 update public.organization_members set role=p_role where organization_id=p_organization_id and user_id=p_user_id;
 insert into public.organization_membership_events(organization_id,actor_id,action,target_user_id,previous_role,next_role) values(p_organization_id,auth.uid(),'member_role_changed',p_user_id,old_role,p_role);
end; $$;

create function public.remove_organization_member(p_organization_id uuid,p_user_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare old_role text; recipient_email text;
begin
 perform 1 from public.organizations where id=p_organization_id for update;
 if not public.is_org_owner(p_organization_id) then raise insufficient_privilege; end if;
 if p_user_id is null or p_user_id=auth.uid() then raise invalid_parameter_value; end if;
 select role into old_role from public.organization_members where organization_id=p_organization_id and user_id=p_user_id for update;
 if not found then raise no_data_found; end if;
 if old_role='owner' then raise insufficient_privilege; end if;
 perform public.consume_action('organization_member',30);
 delete from public.organization_members where organization_id=p_organization_id and user_id=p_user_id;
 select lower(trim(email)) into recipient_email from auth.users where id=p_user_id;
 update public.organization_invitations set status='revoked',revoked_at=now() where organization_id=p_organization_id and email=recipient_email and status='pending';
 insert into public.organization_membership_events(organization_id,actor_id,action,target_user_id,previous_role) values(p_organization_id,auth.uid(),'member_removed',p_user_id,old_role);
end; $$;

create function public.transfer_organization_ownership(p_organization_id uuid,p_user_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare old_role text;
begin
 perform 1 from public.organizations where id=p_organization_id for update;
 if not public.is_org_owner(p_organization_id) then raise insufficient_privilege; end if;
 if p_user_id is null or p_user_id=auth.uid() then raise invalid_parameter_value; end if;
 select m.role into old_role from public.organization_members m join public.profiles p on p.id=m.user_id join auth.users u on u.id=p.id where m.organization_id=p_organization_id and m.user_id=p_user_id and p.role='manager' and u.email is not null and u.email_confirmed_at is not null for update of m;
 if not found or old_role not in ('manager','viewer') then raise insufficient_privilege; end if;
 perform public.consume_action('organization_member',30);
 update public.organization_members set role='manager' where organization_id=p_organization_id and user_id=auth.uid();
 update public.organization_members set role='owner' where organization_id=p_organization_id and user_id=p_user_id;
 update public.organizations set owner_id=p_user_id where id=p_organization_id;
 update public.organization_invitations set status='revoked',revoked_at=now() where organization_id=p_organization_id and status='pending';
 insert into public.organization_membership_events(organization_id,actor_id,action,target_user_id,previous_role,next_role) values(p_organization_id,auth.uid(),'ownership_transferred',p_user_id,old_role,'owner');
end; $$;

revoke execute on function public.organization_member_overview(uuid),public.create_organization_invitation(uuid,text,text,text,integer),public.revoke_organization_invitation(uuid,uuid),public.accept_organization_invitation(text),public.change_organization_member_role(uuid,uuid,text),public.remove_organization_member(uuid,uuid),public.transfer_organization_ownership(uuid,uuid) from public,anon,authenticated;
grant execute on function public.organization_member_overview(uuid),public.create_organization_invitation(uuid,text,text,text,integer),public.revoke_organization_invitation(uuid,uuid),public.accept_organization_invitation(text),public.change_organization_member_role(uuid,uuid,text),public.remove_organization_member(uuid,uuid),public.transfer_organization_ownership(uuid,uuid) to authenticated;
commit;

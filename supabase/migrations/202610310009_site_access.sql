-- Owner-controlled site access. Existing members retain ALL unless explicitly restricted.
begin;
create table public.organization_member_site_scopes (
 organization_id uuid not null, user_id uuid not null, scope text not null check(scope in ('all','selected')),
 primary key(organization_id,user_id),
 foreign key(organization_id,user_id) references public.organization_members(organization_id,user_id) on delete cascade
);
alter table public.sites add constraint sites_id_organization_unique unique(id,organization_id);
create table public.organization_member_site_grants (
 organization_id uuid not null,user_id uuid not null,site_id uuid not null,can_write boolean not null default false,
 primary key(organization_id,user_id,site_id),
 foreign key(organization_id,user_id) references public.organization_member_site_scopes(organization_id,user_id) on delete cascade,
 foreign key(site_id,organization_id) references public.sites(id,organization_id) on delete cascade
);
alter table public.organization_member_site_scopes enable row level security;
alter table public.organization_member_site_grants enable row level security;
revoke all on public.organization_member_site_scopes,public.organization_member_site_grants from public,anon,authenticated;
grant select on public.organization_member_site_scopes,public.organization_member_site_grants to authenticated;
grant all on public.organization_member_site_scopes,public.organization_member_site_grants to service_role;
create policy scopes_read on public.organization_member_site_scopes for select to authenticated using(user_id=auth.uid() or public.is_org_owner(organization_id) or public.is_admin());
create policy site_grants_read on public.organization_member_site_grants for select to authenticated using(user_id=auth.uid() or public.is_org_owner(organization_id) or public.is_admin());

create function public.can_access_site(p_site_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.sites s where s.id=p_site_id and (public.is_admin() or exists(
 select 1 from public.organization_members m left join public.organization_member_site_scopes sc using(organization_id,user_id)
 where m.organization_id=s.organization_id and m.user_id=auth.uid() and (public.is_org_owner(s.organization_id) or coalesce(sc.scope,'all')='all' or exists(
 select 1 from public.organization_member_site_grants g where g.organization_id=m.organization_id and g.user_id=m.user_id and g.site_id=s.id)))));
$$;
create function public.can_manage_site(p_site_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.sites s join public.organization_members m on m.organization_id=s.organization_id
 left join public.organization_member_site_scopes sc on sc.organization_id=m.organization_id and sc.user_id=m.user_id
 where s.id=p_site_id and m.user_id=auth.uid() and m.role in ('owner','manager') and
 (public.is_org_owner(s.organization_id) or coalesce(sc.scope,'all')='all' or exists(select 1 from public.organization_member_site_grants g where g.organization_id=m.organization_id and g.user_id=m.user_id and g.site_id=s.id and g.can_write)));
$$;
create function public.can_access_organization_wide(p_organization_id uuid,p_write boolean default false) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.organization_members m left join public.organization_member_site_scopes sc using(organization_id,user_id)
 where m.organization_id=p_organization_id and m.user_id=auth.uid() and (not p_write or m.role in ('owner','manager')) and (public.is_org_owner(p_organization_id) or coalesce(sc.scope,'all')='all'));
$$;
create or replace function public.can_access_intervention(target uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.interventions i where i.id=target and (public.is_admin() or i.artisan_id=auth.uid() or (i.site_id is null and i.client_id=auth.uid()) or public.can_access_site(i.site_id)));
$$;
create or replace function public.owns_intervention(target uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.interventions i where i.id=target and ((i.site_id is null and i.client_id=auth.uid()) or public.can_manage_site(i.site_id)));
$$;
drop policy sites_read on public.sites;
create policy sites_read on public.sites for select to authenticated using(public.can_access_site(id));
drop policy rules_read on public.approval_rules;
create policy rules_read on public.approval_rules for select to authenticated using(public.can_access_site(site_id));
drop policy approvals_read on public.approvals;
create policy approvals_read on public.approvals for select to authenticated using(public.can_access_site(site_id));
drop policy compliance_read on public.compliance_records;
create policy compliance_read on public.compliance_records for select to authenticated using(public.can_access_site(site_id));
drop policy contracts_read on public.contracts;
create policy contracts_read on public.contracts for select to authenticated using(public.can_access_organization_wide(organization_id) or public.is_admin());
drop policy professional_audit_read on public.professional_audit;
create policy professional_audit_read on public.professional_audit for select to authenticated using(public.can_access_organization_wide(organization_id) or public.is_admin());

-- Private validator: exact JSON schema, unique IDs, same-organization sites; viewers cannot receive write grants.
create function public.validate_site_grants(p_organization_id uuid,p_role text,p_scope text,p_grants jsonb) returns void language plpgsql security definer set search_path='' as $$
begin
 if p_scope is null or p_scope not in ('all','selected') or p_grants is null or jsonb_typeof(p_grants)<>'array' then raise invalid_parameter_value; end if;
 if jsonb_array_length(p_grants)>100 or (p_scope='all' and jsonb_array_length(p_grants)<>0) then raise invalid_parameter_value; end if;
 if exists(select 1 from jsonb_array_elements(p_grants) x where jsonb_typeof(x)<>'object' or x-array['site_id','can_write']<>'{}'::jsonb or jsonb_typeof(x->'site_id') is distinct from 'string' or jsonb_typeof(x->'can_write') is distinct from 'boolean' or (x->>'site_id') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$') then raise invalid_parameter_value; end if;
 if (select count(*)<>count(distinct (x->>'site_id')::uuid) from jsonb_array_elements(p_grants) x) then raise invalid_parameter_value; end if;
 if exists(select 1 from jsonb_array_elements(p_grants) x where not exists(select 1 from public.sites where id=(x->>'site_id')::uuid and organization_id=p_organization_id) or (p_role not in ('owner','manager') and (x->>'can_write')::boolean)) then raise insufficient_privilege; end if;
end; $$;
create function public.set_organization_member_site_access(p_organization_id uuid,p_user_id uuid,p_scope text,p_grants jsonb) returns void language plpgsql security definer set search_path='' as $$
declare member_role text;
begin
 perform 1 from public.organizations where id=p_organization_id for update;
 if not public.is_org_owner(p_organization_id) then raise insufficient_privilege; end if;
 if p_user_id is null or exists(select 1 from public.organizations where id=p_organization_id and owner_id=p_user_id) then raise insufficient_privilege; end if;
 select role into member_role from public.organization_members where organization_id=p_organization_id and user_id=p_user_id for update;
 if not found then raise no_data_found; end if;
 perform public.validate_site_grants(p_organization_id,member_role,p_scope,p_grants);
 perform public.consume_action('organization_site_access',30);
 insert into public.organization_member_site_scopes values(p_organization_id,p_user_id,p_scope) on conflict(organization_id,user_id) do update set scope=excluded.scope;
 delete from public.organization_member_site_grants where organization_id=p_organization_id and user_id=p_user_id;
 insert into public.organization_member_site_grants(organization_id,user_id,site_id,can_write) select p_organization_id,p_user_id,(x->>'site_id')::uuid,(x->>'can_write')::boolean from jsonb_array_elements(p_grants) x;
 insert into public.organization_membership_events(organization_id,actor_id,action,target_user_id) values(p_organization_id,auth.uid(),'member_site_access_changed',p_user_id);
end; $$;
create function public.organization_site_access_overview(p_organization_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not public.is_org_member(p_organization_id) and not public.is_admin() then raise insufficient_privilege; end if;
 return jsonb_build_object('organization_id',p_organization_id,'can_manage',public.is_org_owner(p_organization_id),'members',
 (select coalesce(jsonb_agg(jsonb_build_object('user_id',m.user_id,'role',m.role,'scope',case when o.owner_id=m.user_id then 'all' else coalesce(sc.scope,'all') end,'grants',case when o.owner_id=m.user_id or coalesce(sc.scope,'all')='all' then '[]'::jsonb else (select coalesce(jsonb_agg(jsonb_build_object('site_id',g.site_id,'can_write',g.can_write and m.role in ('owner','manager')) order by g.site_id),'[]'::jsonb) from public.organization_member_site_grants g where g.organization_id=m.organization_id and g.user_id=m.user_id) end) order by m.user_id),'[]'::jsonb)
 from public.organization_members m join public.organizations o on o.id=m.organization_id left join public.organization_member_site_scopes sc using(organization_id,user_id)
 where m.organization_id=p_organization_id and (m.user_id=auth.uid() or public.is_org_owner(p_organization_id) or public.is_admin())));
end; $$;

alter table public.organization_invitations add column site_scope text not null default 'all' check(site_scope in ('all','selected')), add column site_grants jsonb not null default '[]'::jsonb;
alter function public.create_organization_invitation(uuid,text,text,text,integer) rename to create_organization_invitation_before_site_access;
revoke execute on function public.create_organization_invitation_before_site_access(uuid,text,text,text,integer) from public,anon,authenticated;
create function public.create_organization_invitation(p_organization_id uuid,p_email text,p_role text,p_token_hash text,p_expires_in_days integer default 7,p_site_scope text default 'all',p_site_grants jsonb default '[]'::jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 perform 1 from public.organizations where id=p_organization_id for update;
 if not public.is_org_owner(p_organization_id) then raise insufficient_privilege; end if;
 perform public.validate_site_grants(p_organization_id,p_role,p_site_scope,p_site_grants);
 result=public.create_organization_invitation_before_site_access(p_organization_id,p_email,p_role,p_token_hash,p_expires_in_days);
 update public.organization_invitations set site_scope=p_site_scope,site_grants=p_site_grants where id=(result->>'id')::uuid;
 return result||jsonb_build_object('site_scope',p_site_scope,'site_grants',p_site_grants);
end; $$;
alter function public.accept_organization_invitation(text) rename to accept_organization_invitation_before_site_access;
revoke execute on function public.accept_organization_invitation_before_site_access(text) from public,anon,authenticated;
create function public.accept_organization_invitation(p_token text) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; invitation public.organization_invitations;
begin
 -- Existing function obtains organization -> invitation locks and validates Auth email/replay.
 result=public.accept_organization_invitation_before_site_access(p_token);
 select * into invitation from public.organization_invitations where token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex') and accepted_by=auth.uid() and status='accepted';
 perform public.validate_site_grants(invitation.organization_id,invitation.role,invitation.site_scope,invitation.site_grants);
 insert into public.organization_member_site_scopes values(invitation.organization_id,auth.uid(),invitation.site_scope);
 insert into public.organization_member_site_grants(organization_id,user_id,site_id,can_write) select invitation.organization_id,auth.uid(),(x->>'site_id')::uuid,(x->>'can_write')::boolean from jsonb_array_elements(invitation.site_grants) x;
 return result||jsonb_build_object('site_access',jsonb_build_object('scope',invitation.site_scope,'grants',invitation.site_grants));
end; $$;
-- Existing membership overview remains compatible and gains explicit scope metadata.
alter function public.organization_member_overview(uuid) rename to organization_member_overview_before_site_access;
revoke execute on function public.organization_member_overview_before_site_access(uuid) from public,anon,authenticated;
create function public.organization_member_overview(p_organization_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 result=public.organization_member_overview_before_site_access(p_organization_id);
 result=jsonb_set(result,'{permissions,site_scoped_roles}','true'::jsonb);
 result=result||jsonb_build_object('site_access',public.organization_site_access_overview(p_organization_id));
 if public.is_org_owner(p_organization_id) then
 result=jsonb_set(result,'{invitations}',(select coalesce(jsonb_agg(x),'[]'::jsonb) from (select id,email,role,case when status='pending' and expires_at<=now() then 'expired' else status end status,created_at,expires_at,accepted_at,revoked_at,site_scope,site_grants from public.organization_invitations where organization_id=p_organization_id order by created_at desc,id limit 100) x));
 end if;
 return result;
end; $$;

-- Private locks serialize owner scope/membership changes before operational writes.
create function public.lock_site_access(p_site_id uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.organizations o join public.sites s on s.organization_id=o.id where s.id=p_site_id for update of o;
 if not public.can_manage_site(p_site_id) then raise insufficient_privilege; end if;
end; $$;
create function public.lock_intervention_organization(p_id uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.organizations o join public.sites s on s.organization_id=o.id join public.interventions i on i.site_id=s.id where i.id=p_id for update of o;
end; $$;
alter function public.create_intervention(text,text,text,text,text,text,uuid) rename to create_intervention_before_site_access;
revoke execute on function public.create_intervention_before_site_access(text,text,text,text,text,text,uuid) from public,anon,authenticated;
create function public.create_intervention(p_category text,p_description text,p_address text,p_postal_code text,p_city text,p_urgency text,p_site_id uuid default null) returns public.interventions language plpgsql security definer set search_path='' as $$
begin
 if p_site_id is not null then perform public.lock_site_access(p_site_id); end if;
 return public.create_intervention_before_site_access(p_category,p_description,p_address,p_postal_code,p_city,p_urgency,p_site_id);
end; $$;
revoke execute on function public.create_intervention(text,text,text,text,text,text,uuid) from public,anon,authenticated;
grant execute on function public.create_intervention(text,text,text,text,text,text,uuid) to authenticated;
alter function public.create_site(text,text,text,integer,uuid) rename to create_site_before_site_access;
revoke execute on function public.create_site_before_site_access(text,text,text,integer,uuid) from public,anon,authenticated;
create function public.create_site(p_name text,p_type text,p_address text,p_budget_cents integer,p_organization_id uuid default null) returns public.sites language plpgsql security definer set search_path='' as $$
begin
 if p_organization_id is not null then perform 1 from public.organizations where id=p_organization_id for update; if not public.can_access_organization_wide(p_organization_id,true) then raise insufficient_privilege; end if; end if;
 return public.create_site_before_site_access(p_name,p_type,p_address,p_budget_cents,p_organization_id);
end; $$;
revoke execute on function public.create_site(text,text,text,integer,uuid) from public,anon,authenticated;
grant execute on function public.create_site(text,text,text,integer,uuid) to authenticated;
alter function public.save_contract(uuid,text,text,date,date,text,text,uuid) rename to save_contract_before_site_access;
revoke execute on function public.save_contract_before_site_access(uuid,text,text,date,date,text,text,uuid) from public,anon,authenticated;
create function public.save_contract(p_organization_id uuid,p_title text,p_reference text,p_starts_on date,p_ends_on date,p_terms text,p_status text,p_id uuid default null) returns public.contracts language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.organizations where id=p_organization_id for update; if not public.can_access_organization_wide(p_organization_id,true) then raise insufficient_privilege; end if;
 return public.save_contract_before_site_access(p_organization_id,p_title,p_reference,p_starts_on,p_ends_on,p_terms,p_status,p_id);
end; $$;
revoke execute on function public.save_contract(uuid,text,text,date,date,text,text,uuid) from public,anon,authenticated;
grant execute on function public.save_contract(uuid,text,text,date,date,text,text,uuid) to authenticated;
alter function public.save_compliance(uuid,text,text,date,text,text,uuid) rename to save_compliance_before_site_access;
revoke execute on function public.save_compliance_before_site_access(uuid,text,text,date,text,text,uuid) from public,anon,authenticated;
create function public.save_compliance(p_site_id uuid,p_title text,p_kind text,p_due_on date,p_status text,p_notes text,p_id uuid default null) returns public.compliance_records language plpgsql security definer set search_path='' as $$
begin
 perform public.lock_site_access(p_site_id);
 return public.save_compliance_before_site_access(p_site_id,p_title,p_kind,p_due_on,p_status,p_notes,p_id);
end; $$;
revoke execute on function public.save_compliance(uuid,text,text,date,text,text,uuid) from public,anon,authenticated;
grant execute on function public.save_compliance(uuid,text,text,date,text,text,uuid) to authenticated;
alter function public.set_site_budget(uuid,integer) rename to set_site_budget_before_site_access;
revoke execute on function public.set_site_budget_before_site_access(uuid,integer) from public,anon,authenticated;
create function public.set_site_budget(p_site_id uuid,p_budget_cents integer) returns public.sites language plpgsql security definer set search_path='' as $$
begin
 perform public.lock_site_access(p_site_id);
 return public.set_site_budget_before_site_access(p_site_id,p_budget_cents);
end; $$;
revoke execute on function public.set_site_budget(uuid,integer) from public,anon,authenticated;
grant execute on function public.set_site_budget(uuid,integer) to authenticated;
alter function public.set_approval_rule(uuid,integer,text,boolean) rename to set_approval_rule_before_site_access;
revoke execute on function public.set_approval_rule_before_site_access(uuid,integer,text,boolean) from public,anon,authenticated;
create function public.set_approval_rule(p_site_id uuid,p_threshold_cents integer,p_required_role text,p_enabled boolean) returns public.approval_rules language plpgsql security definer set search_path='' as $$
begin
 perform public.lock_site_access(p_site_id);
 return public.set_approval_rule_before_site_access(p_site_id,p_threshold_cents,p_required_role,p_enabled);
end; $$;
revoke execute on function public.set_approval_rule(uuid,integer,text,boolean) from public,anon,authenticated;
grant execute on function public.set_approval_rule(uuid,integer,text,boolean) to authenticated;
alter function public.decide_approval(uuid,text,text) rename to decide_approval_before_site_access;
revoke execute on function public.decide_approval_before_site_access(uuid,text,text) from public,anon,authenticated;
create function public.decide_approval(p_approval_id uuid,p_decision text,p_note text) returns public.approvals language plpgsql security definer set search_path='' as $$
begin
 perform public.lock_site_access((select site_id from public.approvals where id=p_approval_id));
 return public.decide_approval_before_site_access(p_approval_id,p_decision,p_note);
end; $$;
revoke execute on function public.decide_approval(uuid,text,text) from public,anon,authenticated;
grant execute on function public.decide_approval(uuid,text,text) to authenticated;
alter function public.intervention_action(uuid,text,jsonb,numeric,uuid) rename to intervention_action_before_site_access;
revoke execute on function public.intervention_action_before_site_access(uuid,text,jsonb,numeric,uuid) from public,anon,authenticated;
create function public.intervention_action(p_id uuid,p_action text,p_lines jsonb default null,p_tax_rate numeric default 20,p_quote_id uuid default null) returns public.interventions language plpgsql security definer set search_path='' as $$
begin
 perform public.lock_intervention_organization(p_id);
 return public.intervention_action_before_site_access(p_id,p_action,p_lines,p_tax_rate,p_quote_id);
end; $$;
revoke execute on function public.intervention_action(uuid,text,jsonb,numeric,uuid) from public,anon,authenticated;
grant execute on function public.intervention_action(uuid,text,jsonb,numeric,uuid) to authenticated;
alter function public.reject_intervention_quote(uuid,uuid,text) rename to reject_intervention_quote_before_site_access;
revoke execute on function public.reject_intervention_quote_before_site_access(uuid,uuid,text) from public,anon,authenticated;
create function public.reject_intervention_quote(p_id uuid,p_quote_id uuid,p_reason text) returns public.interventions language plpgsql security definer set search_path='' as $$
begin
 perform public.lock_intervention_organization(p_id);
 return public.reject_intervention_quote_before_site_access(p_id,p_quote_id,p_reason);
end; $$;
revoke execute on function public.reject_intervention_quote(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.reject_intervention_quote(uuid,uuid,text) to authenticated;
alter function public.save_intervention_appointment(uuid,timestamptz,timestamptz,text) rename to save_intervention_appointment_before_site_access;
revoke execute on function public.save_intervention_appointment_before_site_access(uuid,timestamptz,timestamptz,text) from public,anon,authenticated;
create function public.save_intervention_appointment(p_id uuid,p_starts_at timestamptz,p_ends_at timestamptz,p_note text) returns public.intervention_appointments language plpgsql security definer set search_path='' as $$
begin
 perform public.lock_intervention_organization(p_id);
 return public.save_intervention_appointment_before_site_access(p_id,p_starts_at,p_ends_at,p_note);
end; $$;
revoke execute on function public.save_intervention_appointment(uuid,timestamptz,timestamptz,text) from public,anon,authenticated;
grant execute on function public.save_intervention_appointment(uuid,timestamptz,timestamptz,text) to authenticated;
alter function public.send_message(uuid,text) rename to send_message_before_site_access;
revoke execute on function public.send_message_before_site_access(uuid,text) from public,anon,authenticated;
create function public.send_message(p_intervention_id uuid,p_body text) returns public.messages language plpgsql security definer set search_path='' as $$
begin
 perform public.lock_intervention_organization(p_intervention_id);
 return public.send_message_before_site_access(p_intervention_id,p_body);
end; $$;
revoke execute on function public.send_message(uuid,text) from public,anon,authenticated;
grant execute on function public.send_message(uuid,text) to authenticated;
revoke execute on function public.validate_site_grants(uuid,text,text,jsonb),public.lock_site_access(uuid),public.lock_intervention_organization(uuid) from public,anon,authenticated;
revoke execute on function public.can_access_site(uuid) from public,anon,authenticated;
grant execute on function public.can_access_site(uuid) to authenticated;
revoke execute on function public.can_manage_site(uuid) from public,anon,authenticated;
grant execute on function public.can_manage_site(uuid) to authenticated;
revoke execute on function public.can_access_organization_wide(uuid,boolean) from public,anon,authenticated;
grant execute on function public.can_access_organization_wide(uuid,boolean) to authenticated;
revoke execute on function public.set_organization_member_site_access(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.set_organization_member_site_access(uuid,uuid,text,jsonb) to authenticated;
revoke execute on function public.organization_site_access_overview(uuid) from public,anon,authenticated;
grant execute on function public.organization_site_access_overview(uuid) to authenticated;
revoke execute on function public.create_organization_invitation(uuid,text,text,text,integer,text,jsonb) from public,anon,authenticated;
grant execute on function public.create_organization_invitation(uuid,text,text,text,integer,text,jsonb) to authenticated;
revoke execute on function public.accept_organization_invitation(text) from public,anon,authenticated;
grant execute on function public.accept_organization_invitation(text) to authenticated;
revoke execute on function public.organization_member_overview(uuid) from public,anon,authenticated;
grant execute on function public.organization_member_overview(uuid) to authenticated;
commit;

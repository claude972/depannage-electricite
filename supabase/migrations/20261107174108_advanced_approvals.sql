begin;
create table public.advanced_approval_policies(site_id uuid primary key references public.sites(id),version integer not null check(version>0),enabled boolean not null,threshold_cents integer not null check(threshold_cents between 0 and 100000000),steps jsonb not null,updated_by uuid not null references public.profiles(id));
create table public.advanced_approval_workflows(quote_id uuid primary key references public.quotes(id),site_id uuid not null references public.sites(id),version integer not null check(version>0),policy_version integer not null,steps jsonb not null,snapshot jsonb not null,state text not null check(state in('pending','changes_requested','approved','rejected')),current_step integer not null check(current_step between 1 and 10),approvals jsonb not null default '[]');
create table public.advanced_approval_commands(command_id uuid primary key,actor_id uuid not null references public.profiles(id),subject_id uuid not null,action text not null,inputs jsonb not null,result jsonb not null,created_at timestamptz not null default clock_timestamp());
create table public.advanced_approval_events(quote_id uuid not null references public.quotes(id),version integer not null,actor_id uuid not null references public.profiles(id),action text not null,note text not null check(char_length(note)<=2000),record jsonb not null,created_at timestamptz not null default clock_timestamp(),primary key(quote_id,version));
alter table public.advanced_approval_policies enable row level security;
alter table public.advanced_approval_workflows enable row level security;
alter table public.advanced_approval_commands enable row level security;
alter table public.advanced_approval_events enable row level security;
revoke all on public.advanced_approval_policies,public.advanced_approval_workflows,public.advanced_approval_commands,public.advanced_approval_events from public,anon,authenticated,service_role;

-- Explicit site membership, without an administrator or owner-to-manager shortcut.
create function public.advanced_approval_member(p_site uuid,p_actor uuid)returns boolean language sql stable security definer set search_path=''as $$
 select exists(select 1 from public.sites s join public.organizations o on o.id=s.organization_id join public.organization_members m on m.organization_id=o.id and m.user_id=p_actor
 left join public.organization_member_site_scopes sc on sc.organization_id=m.organization_id and sc.user_id=m.user_id where s.id=p_site and
 (o.owner_id=p_actor or coalesce(sc.scope,'all')='all'or exists(select 1 from public.organization_member_site_grants g where g.organization_id=m.organization_id and g.user_id=m.user_id and g.site_id=s.id)));
$$;
create function public.advanced_approval_reviewer(p_site uuid,p_step jsonb,p_actor uuid)returns boolean language sql stable security definer set search_path=''as $$
 select public.advanced_approval_member(p_site,p_actor)and((p_step->>'user_id')=p_actor::text or exists(select 1 from public.sites s join public.organization_members m on m.organization_id=s.organization_id and m.user_id=p_actor where s.id=p_site and m.role=p_step->>'role'));
$$;
create function public.advanced_approval_snapshot(p_quote uuid)returns jsonb language sql stable security definer set search_path=''as $$
 select jsonb_build_object('id',q.id,'intervention_id',q.intervention_id,'artisan_id',q.artisan_id,'lines',q.lines,'subtotal_cents',q.subtotal_cents,'tax_rate',q.tax_rate,'tax_cents',q.tax_cents,'total_cents',q.total_cents,'valid_until',t.valid_until)
 from public.quotes q left join public.quote_terms t on t.quote_id=q.id where q.id=p_quote;
$$;
create function public.advanced_approval_current(p_quote uuid)returns boolean language sql stable security definer set search_path=''as $$
 select exists(select 1 from public.advanced_approval_workflows w join public.advanced_approval_policies p on p.site_id=w.site_id join public.quotes q on q.id=w.quote_id join public.interventions i on i.id=q.intervention_id
 where w.quote_id=p_quote and i.site_id=w.site_id and p.enabled and w.policy_version=p.version and w.snapshot=public.advanced_approval_snapshot(q.id)
 and w.state='approved'and jsonb_array_length(w.approvals)=jsonb_array_length(w.steps)and not exists(select 1 from jsonb_array_elements(w.approvals)a where not public.advanced_approval_reviewer(w.site_id,w.steps->((a->>'step')::integer-1),(a->>'actor_id')::uuid)));
$$;
revoke all on function public.advanced_approval_member(uuid,uuid),public.advanced_approval_reviewer(uuid,jsonb,uuid),public.advanced_approval_snapshot(uuid),public.advanced_approval_current(uuid)from public,anon,authenticated,service_role;

create function public.set_advanced_approval_policy(p_site_id uuid,p_command_id uuid,p_expected_version integer,p_enabled boolean,p_threshold_cents integer,p_steps jsonb)returns jsonb language plpgsql security definer set search_path=''as $$
declare actor uuid=auth.uid();s public.sites;p public.advanced_approval_policies;prior public.advanced_approval_commands;step jsonb;inputs jsonb;r jsonb;
begin
 if actor is null then raise insufficient_privilege;end if;
 perform public.lock_site_access(p_site_id);select *into s from public.sites where id=p_site_id;
 if not exists(select 1 from public.organizations o join public.organization_members m on m.organization_id=o.id and m.user_id=actor and m.role='owner'where o.id=s.organization_id and o.owner_id=actor)then raise insufficient_privilege;end if;
 if p_command_id is null or p_enabled is null or p_threshold_cents is null or p_threshold_cents not between 0 and 100000000 or jsonb_typeof(p_steps)is distinct from 'array'or jsonb_array_length(p_steps)not between 1 and 10 or(p_expected_version is not null and p_expected_version not between 1 and 2147483646)then raise invalid_parameter_value;end if;
 inputs=jsonb_build_object('expected_version',p_expected_version,'enabled',p_enabled,'threshold_cents',p_threshold_cents,'steps',p_steps);
 select *into prior from public.advanced_approval_commands where command_id=p_command_id;
 if found then
  if prior.actor_id<>actor or prior.subject_id<>p_site_id or prior.action<>'policy'or prior.inputs<>inputs then raise exception 'Command changed'using errcode='P0001';end if;
  return prior.result||jsonb_build_object('replayed',true);
 end if;
 if p_enabled and s.archived_at is not null then raise exception 'Site archived'using errcode='P0001';end if;
 for step in select value from jsonb_array_elements(p_steps)loop
  if jsonb_typeof(step)is distinct from 'object'then raise invalid_parameter_value;end if;
  if step?'role'and step-array['role']='{}'::jsonb and step->>'role'in('owner','manager')then null;
  elsif step?'user_id'and step-array['user_id']='{}'::jsonb then
   if not public.advanced_approval_member(p_site_id,(step->>'user_id')::uuid)then raise insufficient_privilege;end if;
  else raise invalid_parameter_value;end if;
 end loop;
 select *into p from public.advanced_approval_policies where site_id=p_site_id for update;
 if p.version is distinct from p_expected_version then raise exception 'Policy version changed'using errcode='P0001';end if;
 perform public.consume_action('advanced_approval_policy',20);
 insert into public.advanced_approval_policies(site_id,version,enabled,threshold_cents,steps,updated_by)values(p_site_id,1,p_enabled,p_threshold_cents,p_steps,actor)
 on conflict(site_id)do update set version=advanced_approval_policies.version+1,enabled=excluded.enabled,threshold_cents=excluded.threshold_cents,steps=excluded.steps,updated_by=actor returning *into p;
 if not p_enabled then
  insert into public.approvals(quote_id,site_id)select q.id,p_site_id from public.quotes q join public.interventions i on i.id=q.intervention_id join public.approval_rules r on r.site_id=i.site_id where i.site_id=p_site_id and q.status='sent'and r.enabled and q.total_cents>r.threshold_cents on conflict(quote_id)do nothing;
 end if;
 r=jsonb_build_object('site_id',p_site_id,'version',p.version,'replayed',false);
 insert into public.advanced_approval_commands(command_id,actor_id,subject_id,action,inputs,result)values(p_command_id,actor,p_site_id,'policy',inputs,r);
 return r;
end;$$;
revoke all on function public.set_advanced_approval_policy(uuid,uuid,integer,boolean,integer,jsonb)from public,anon,authenticated,service_role;
grant execute on function public.set_advanced_approval_policy(uuid,uuid,integer,boolean,integer,jsonb)to authenticated;

create function public.advanced_approval_command(p_quote_id uuid,p_command_id uuid,p_action text,p_expected_version integer,p_note text)returns jsonb language plpgsql security definer set search_path=''as $$
declare actor uuid=auth.uid();q public.quotes;j public.interventions;p public.advanced_approval_policies;w public.advanced_approval_workflows;prior public.advanced_approval_commands;inputs jsonb;r jsonb;reviewer boolean;responder boolean;event_record jsonb;
begin
 if actor is null then raise insufficient_privilege;end if;
 if p_command_id is null or p_action is null or p_action not in('submit','approve','reject','request_information','respond')or p_note is null or char_length(p_note)>2000 or(p_expected_version is not null and p_expected_version not between 1 and 2147483646)then raise invalid_parameter_value;end if;
 select *into q from public.quotes where id=p_quote_id;if not found then raise no_data_found;end if;
 perform public.lock_intervention_organization(q.intervention_id);select *into j from public.interventions where id=q.intervention_id for update;
 select *into q from public.quotes where id=p_quote_id for update;
 if not public.can_access_intervention(j.id)or j.site_id is null then raise no_data_found;end if;
 select *into p from public.advanced_approval_policies where site_id=j.site_id;
 select *into w from public.advanced_approval_workflows where quote_id=q.id for update;
 reviewer=w.quote_id is not null and public.advanced_approval_reviewer(j.site_id,w.steps->(w.current_step-1),actor);
 responder=public.can_manage_site(j.site_id)or(j.artisan_id=actor and exists(select 1 from public.profiles where id=actor and role='artisan'and artisan_approved)and not exists(select 1 from public.artisan_profiles where user_id=actor and application_status<>'approved'));
 inputs=jsonb_build_object('expected_version',p_expected_version,'note',p_note);
 select *into prior from public.advanced_approval_commands where command_id=p_command_id;
 if found then
  if prior.actor_id<>actor or prior.subject_id<>p_quote_id or prior.action<>p_action or prior.inputs<>inputs then raise exception 'Command changed'using errcode='P0001';end if;
  select record into event_record from public.advanced_approval_events where quote_id=q.id and version=(prior.result->>'version')::integer;
  if p_action in('approve','reject','request_information')then reviewer=public.advanced_approval_reviewer(j.site_id,event_record->'steps'->(case when p_action='approve'then(event_record->'approvals'->-1->>'step')::integer else(event_record->>'current_step')::integer end-1),actor);end if;
 end if;
 if(p_action='submit'and not public.can_manage_site(j.site_id))or(p_action in('approve','reject','request_information')and not coalesce(reviewer,false))or(p_action='respond'and not coalesce(responder,false))then raise insufficient_privilege;end if;
 if prior.command_id is not null then return prior.result||jsonb_build_object('replayed',true);end if;
 if q.status<>'sent'or q.artisan_id is distinct from j.artisan_id or j.status<>'quoted'or p.site_id is null or not p.enabled or q.total_cents<=p.threshold_cents then raise exception 'Approval not applicable to current quote'using errcode='P0001';end if;
 if exists(select 1 from public.sites where id=j.site_id and archived_at is not null)then raise exception 'Site archived'using errcode='P0001';end if;
 if w.version is distinct from p_expected_version then raise exception 'Workflow version changed'using errcode='P0001';end if;
 if p_action='submit'then
  if public.advanced_approval_current(q.id) then
   raise exception 'The current quote is already approved'using errcode='P0001';
  end if;
  insert into public.advanced_approval_workflows(quote_id,site_id,version,policy_version,steps,snapshot,state,current_step)values(q.id,j.site_id,1,p.version,p.steps,public.advanced_approval_snapshot(q.id),'pending',1)
  on conflict(quote_id)do update set site_id=excluded.site_id,version=advanced_approval_workflows.version+1,policy_version=excluded.policy_version,steps=excluded.steps,snapshot=excluded.snapshot,state='pending',current_step=1,approvals='[]'returning *into w;
 else
  if w.quote_id is null or w.site_id<>j.site_id or w.policy_version<>p.version or w.snapshot<>public.advanced_approval_snapshot(q.id)then raise exception 'Resubmit changed quote or policy'using errcode='P0001';end if;
  if p_action='respond'then
   if w.state<>'changes_requested'or char_length(btrim(p_note))=0 then raise exception 'Information response required'using errcode='P0001';end if;
   update public.advanced_approval_workflows set state='pending',version=version+1 where quote_id=q.id returning *into w;
  else
   if w.state<>'pending'then raise exception 'Step not pending'using errcode='P0001';end if;
   if p_action in('reject','request_information')and char_length(btrim(p_note))=0 then raise invalid_parameter_value;end if;
   if p_action='approve'then
    update public.advanced_approval_workflows set approvals=approvals||jsonb_build_array(jsonb_build_object('step',current_step,'actor_id',actor)),state=case when current_step=jsonb_array_length(steps)then'approved'else'pending'end,current_step=least(current_step+1,jsonb_array_length(steps)),version=version+1 where quote_id=q.id returning *into w;
   else update public.advanced_approval_workflows set state=case when p_action='reject'then'rejected'else'changes_requested'end,version=version+1 where quote_id=q.id returning *into w;end if;
  end if;
 end if;
 perform public.consume_action('advanced_approval_command',30);
 insert into public.advanced_approval_events(quote_id,version,actor_id,action,note,record)values(q.id,w.version,actor,p_action,btrim(p_note),to_jsonb(w));
 r=jsonb_build_object('quote_id',q.id,'version',w.version,'state',w.state,'current_step',w.current_step,'replayed',false);
 insert into public.advanced_approval_commands(command_id,actor_id,subject_id,action,inputs,result)values(p_command_id,actor,q.id,p_action,inputs,r);
 return r;
end;$$;
revoke all on function public.advanced_approval_command(uuid,uuid,text,integer,text)from public,anon,authenticated,service_role;
grant execute on function public.advanced_approval_command(uuid,uuid,text,integer,text)to authenticated;

-- Existing simple behavior is kept exactly when no explicit advanced policy is active.
create or replace function public.queue_quote_approval()returns trigger language plpgsql security definer set search_path=''as $$
declare site uuid;
begin
 select site_id into site from public.interventions where id=new.intervention_id;
 if not exists(select 1 from public.advanced_approval_policies where site_id=site and enabled)and exists(select 1 from public.approval_rules where site_id=site and enabled and new.total_cents>threshold_cents)then insert into public.approvals(quote_id,site_id)values(new.id,site);end if;
 return new;
end;$$;
create or replace function public.guard_quote_approval()returns trigger language plpgsql security definer set search_path=''as $$
declare site uuid;p public.advanced_approval_policies;
begin
 if new.status='accepted'and old.status is distinct from'accepted'then
  select site_id into site from public.interventions where id=new.intervention_id;
  select *into p from public.advanced_approval_policies where site_id=site and enabled;
  if found then
   if new.total_cents>p.threshold_cents and not public.advanced_approval_current(new.id)then raise exception 'Advanced approval required for exact quote'using errcode='P0001';end if;
  elsif exists(select 1 from public.approval_rules where site_id=site and enabled and new.total_cents>threshold_cents)and not exists(select 1 from public.approvals where quote_id=new.id and status='approved')then raise exception 'Approval required'using errcode='P0001';end if;
 end if;
 return new;
end;$$;
-- Legacy decision endpoint cannot report a misleading approval of an advanced circuit.
alter function public.decide_approval(uuid,text,text)rename to decide_approval_before_advanced;
revoke all on function public.decide_approval_before_advanced(uuid,text,text)from public,anon,authenticated,service_role;
create function public.decide_approval(p_approval_id uuid,p_decision text,p_note text)returns public.approvals language plpgsql security definer set search_path=''as $$
declare site uuid;
begin
 select site_id into site from public.approvals where id=p_approval_id;
 perform public.lock_site_access(site);
 if exists(select 1 from public.advanced_approval_policies where site_id=site and enabled)then raise exception 'Use advanced approval workflow'using errcode='P0001';end if;
 return public.decide_approval_before_advanced(p_approval_id,p_decision,p_note);
end;$$;
revoke all on function public.decide_approval(uuid,text,text)from public,anon,authenticated,service_role;
grant execute on function public.decide_approval(uuid,text,text)to authenticated;
create function public.advanced_approval_policy_status(p_site_id uuid)returns jsonb language plpgsql stable security definer set search_path=''as $$
declare p public.advanced_approval_policies;
begin
 if auth.uid()is null or not public.can_access_site(p_site_id)then raise insufficient_privilege;end if;
 select *into p from public.advanced_approval_policies where site_id=p_site_id;
 return jsonb_build_object('site_id',p_site_id,'policy',case when p.site_id is null then null else jsonb_build_object('version',p.version,'enabled',p.enabled,'threshold_cents',p.threshold_cents,'steps',p.steps)end,'can_manage',exists(select 1 from public.sites s join public.organizations o on o.id=s.organization_id join public.organization_members m on m.organization_id=o.id and m.user_id=auth.uid()and m.role='owner'where s.id=p_site_id and o.owner_id=auth.uid()));
end;$$;
revoke all on function public.advanced_approval_policy_status(uuid)from public,anon,authenticated,service_role;
grant execute on function public.advanced_approval_policy_status(uuid)to authenticated;
create function public.advanced_approval_status(p_quote_id uuid,p_after integer default 0)returns jsonb language plpgsql stable security definer set search_path=''as $$
declare q public.quotes;j public.interventions;p public.advanced_approval_policies;w public.advanced_approval_workflows;rows jsonb;required boolean;matches boolean;current boolean;
begin
 if auth.uid()is null then raise insufficient_privilege;end if;
 if p_after is null or p_after<0 then raise invalid_parameter_value;end if;
 select *into q from public.quotes where id=p_quote_id;select *into j from public.interventions where id=q.intervention_id;
 if j.site_id is null or not public.can_access_intervention(j.id)then raise no_data_found;end if;
 select *into p from public.advanced_approval_policies where site_id=j.site_id;
 select *into w from public.advanced_approval_workflows where quote_id=q.id;
 required=coalesce(p.enabled and q.total_cents>p.threshold_cents,false);
 matches=coalesce(w.policy_version=p.version and w.site_id=j.site_id and w.snapshot=public.advanced_approval_snapshot(q.id),false);
 current=required and matches and q.status='sent'and j.status='quoted'and not exists(select 1 from public.sites where id=j.site_id and archived_at is not null);
 select coalesce(jsonb_agg(to_jsonb(x)order by x.version),'[]'::jsonb)into rows from(select version,actor_id,action,note,created_at from public.advanced_approval_events where quote_id=q.id and version>p_after order by version limit 51)x;
 return jsonb_build_object('quote_id',q.id,'site_id',j.site_id,'required',required,'approved_current',public.advanced_approval_current(q.id),
 'policy',case when p.site_id is null then null else jsonb_build_object('version',p.version,'enabled',p.enabled,'threshold_cents',p.threshold_cents,'steps',p.steps)end,
 'workflow',case when w.quote_id is null then null else jsonb_build_object('version',w.version,'policy_version',w.policy_version,'state',w.state,'current_step',w.current_step,'steps',w.steps,'snapshot_matches',matches)end,
 'permissions',jsonb_build_object('can_submit',required and not public.advanced_approval_current(q.id) and q.status='sent'and j.status='quoted'and public.can_manage_site(j.site_id)and not exists(select 1 from public.sites where id=j.site_id and archived_at is not null),
 'can_decide',coalesce(current and w.state='pending'and public.advanced_approval_reviewer(j.site_id,w.steps->(w.current_step-1),auth.uid()),false),
 'can_respond',coalesce(current and w.state='changes_requested'and(public.can_manage_site(j.site_id)or(j.artisan_id=auth.uid()and exists(select 1 from public.profiles where id=auth.uid()and role='artisan'and artisan_approved)and not exists(select 1 from public.artisan_profiles where user_id=auth.uid()and application_status<>'approved'))),false)),
 'events',case when jsonb_array_length(rows)>50 then rows-50 else rows end,'next_after',case when jsonb_array_length(rows)>50 then(rows->49->>'version')::integer else null end);
end;$$;
revoke all on function public.advanced_approval_status(uuid,integer)from public,anon,authenticated,service_role;
grant execute on function public.advanced_approval_status(uuid,integer)to authenticated;

commit;

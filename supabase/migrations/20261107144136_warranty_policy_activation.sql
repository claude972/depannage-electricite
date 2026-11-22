-- Empty by default: no legal content, commercial duration or activation is seeded.
begin;
create table public.warranty_policy_versions(
 version integer primary key check(version>0),command_id uuid not null unique,
 actor_id uuid not null references public.profiles(id),
 action text not null check(action in('save','publish','withdraw','enable','disable')),
 title text not null,body text not null,
 published_version integer references public.warranty_policy_versions(version),
 created_at timestamptz not null default clock_timestamp()
);
alter table public.warranty_policy_versions enable row level security;
revoke all on public.warranty_policy_versions from public,anon,authenticated,service_role;
alter table public.warranty_cases add column terms_version integer references public.warranty_policy_versions(version);

create function public.read_public_warranty_terms(p_version integer default null)returns jsonb language sql stable security definer set search_path=''as $$
 select case when v.action='publish'then jsonb_build_object('version',v.version,'title',v.title,'body',v.body,'published_at',v.created_at)else null end
 from public.warranty_policy_versions v
 where (p_version is null and v.action in('publish','withdraw'))or(p_version is not null and v.version=p_version and v.action='publish')
 order by v.version desc limit 1;
$$;
revoke all on function public.read_public_warranty_terms(integer)from public,anon,authenticated,service_role;
grant execute on function public.read_public_warranty_terms(integer)to anon,authenticated;

-- app_settings is still the operator switch, now constrained to an explicitly enabled publication.
create or replace function public.warranty_requests_enabled()returns boolean language sql stable security definer set search_path=''as $$
 select exists(select 1 from public.app_settings where key='warranty_requests_enabled'and value='true'::jsonb)
 and exists(select 1 from public.warranty_policy_versions v where v.version=(select max(version)from public.warranty_policy_versions where action in('enable','disable','publish','withdraw'))
 and v.action='enable'and v.published_version=(public.read_public_warranty_terms()->>'version')::integer);
$$;

create function public.read_warranty_policy_editor()returns jsonb language plpgsql stable security definer set search_path=''as $$
declare latest public.warranty_policy_versions;
begin
 if auth.uid()is null or not public.is_admin()then raise insufficient_privilege;end if;
 select *into latest from public.warranty_policy_versions order by version desc limit 1;
 return jsonb_build_object('version',coalesce(latest.version,0),'draft',jsonb_build_object('title',coalesce(latest.title,''),'body',coalesce(latest.body,'')),'published',public.read_public_warranty_terms(),'operator_enabled',public.warranty_requests_enabled());
end;$$;
revoke all on function public.read_warranty_policy_editor()from public,anon,authenticated,service_role;
grant execute on function public.read_warranty_policy_editor()to authenticated;

create function public.write_warranty_policy(p_command_id uuid,p_expected_version integer,p_action text,p_title text default null,p_body text default null,p_published_version integer default null)returns jsonb language plpgsql security definer set search_path=''as $$
declare actor uuid=auth.uid();latest public.warranty_policy_versions;written public.warranty_policy_versions;published jsonb;title text;body text;
begin
 if actor is null then raise insufficient_privilege;end if;
 perform 1 from public.profiles where id=actor and role='admin'for share;
 if not found then raise insufficient_privilege;end if;
 if p_command_id is null or p_expected_version is null or p_expected_version not between 0 and 2147483646 or p_action is null or p_action not in('save','publish','withdraw','enable','disable')
 or(p_action<>'save'and(p_title is not null or p_body is not null))or(p_action<>'enable'and p_published_version is not null)
 or(p_action='enable'and(p_published_version is null or p_published_version<1))then raise invalid_parameter_value;end if;
 if p_action='save'and(p_title is null or p_body is null or char_length(p_title)>160 or char_length(p_body)>20000 or p_title<>btrim(p_title)or p_body<>btrim(p_body))then raise invalid_parameter_value;end if;
 perform pg_advisory_xact_lock(hashtextextended('platform:warranty_policy',0));
 select *into written from public.warranty_policy_versions where command_id=p_command_id;
 if found then
  if written.actor_id<>actor or written.version<>p_expected_version+1 or written.action<>p_action
  or(p_action='save'and(written.title is distinct from p_title or written.body is distinct from p_body))
  or(p_action='enable'and written.published_version is distinct from p_published_version)then raise exception 'Warranty policy command conflict'using errcode='P0001';end if;
  return jsonb_build_object('version',written.version,'action',written.action,'replayed',true);
 end if;
 select *into latest from public.warranty_policy_versions order by version desc limit 1;
 if coalesce(latest.version,0)<>p_expected_version then raise exception 'Warranty policy version conflict'using errcode='P0001';end if;
 title=case when p_action='save'then p_title else coalesce(latest.title,'')end;
 body=case when p_action='save'then p_body else coalesce(latest.body,'')end;
 published=public.read_public_warranty_terms();
 if p_action='publish'and(title !~ '[^[:space:]]' or body !~ '[^[:space:]]')then raise invalid_parameter_value;end if;
 if p_action='withdraw'and published is null then raise exception 'No warranty terms published'using errcode='P0001';end if;
 if p_action='enable'and(published is null or(published->>'version')::integer<>p_published_version)then raise exception 'Published warranty terms changed'using errcode='P0001';end if;
 perform public.consume_action('warranty_policy',20);
 insert into public.warranty_policy_versions(version,command_id,actor_id,action,title,body,published_version)
 values(p_expected_version+1,p_command_id,actor,p_action,title,body,case when p_action='enable'then p_published_version else null end)returning *into written;
 if p_action in('enable','disable','publish','withdraw')then
  insert into public.app_settings(key,value)values('warranty_requests_enabled',to_jsonb(p_action='enable'))on conflict(key)do update set value=excluded.value;
 end if;
 insert into public.audit_log(actor_id,action)values(actor,'warranty_policy:'||p_action||':'||written.version::text);
 return jsonb_build_object('version',written.version,'action',written.action,'replayed',false);
end;$$;
revoke all on function public.write_warranty_policy(uuid,integer,text,text,text,integer)from public,anon,authenticated,service_role;
grant execute on function public.write_warranty_policy(uuid,integer,text,text,text,integer)to authenticated;

create or replace function public.request_warranty(p_intervention_id uuid,p_description text)returns public.warranty_cases language plpgsql security definer set search_path=''as $$
declare result public.warranty_cases;
begin
 -- Serialize the admission decision with publication/withdrawal/activation.
 perform pg_advisory_xact_lock(hashtextextended('platform:warranty_policy',0));
 if not public.warranty_requests_enabled()then raise exception 'Commercial warranty terms not enabled'using errcode='P0001';end if;
 -- Existing eligibility is deliberately unchanged; this delta defines no new commercial duration.
 if not public.can_access_intervention(p_intervention_id)or not exists(select 1 from public.interventions where id=p_intervention_id and client_id=auth.uid()and status='paid'and completed_at is not null and completed_at+interval '1 year'>=now())then raise insufficient_privilege;end if;
 perform public.consume_action('warranty',5);
 insert into public.warranty_cases(intervention_id,client_id,description,terms_version)values(p_intervention_id,auth.uid(),trim(p_description),(public.read_public_warranty_terms()->>'version')::integer)returning *into result;
 insert into public.audit_log(actor_id,intervention_id,action)values(auth.uid(),p_intervention_id,'warranty_requested');
 return result;
end;$$;
commit;

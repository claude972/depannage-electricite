begin;
create table indicative_price_private.publication_gate(singleton boolean primary key default true check(singleton),enabled boolean not null default false);
insert into indicative_price_private.publication_gate default values;
alter table indicative_price_private.publication_gate enable row level security;
create table indicative_price_private.publications(
 command_id uuid primary key,actor_id uuid not null references public.profiles(id),
 from_version integer not null references indicative_price_private.versions(version),
 to_version integer not null references indicative_price_private.versions(version),
 reason text not null check(char_length(reason)between 10 and 1000),created_at timestamptz not null default clock_timestamp(),
 check(to_version>from_version)
);
alter table indicative_price_private.publications enable row level security;
revoke all on indicative_price_private.publication_gate,indicative_price_private.publications from public,anon,authenticated,service_role;
create trigger immutable before update or delete on indicative_price_private.publications for each row execute function indicative_price_private.immutable();
alter table indicative_price_private.control drop constraint control_active_version_check;
alter table indicative_price_private.control add constraint control_active_version_check check(active_version>0 and active_version<=latest_version);
-- A pointer movement must have its immutable publication event in the same transaction.
create function indicative_price_private.guard_publication_pointer()returns trigger language plpgsql security definer set search_path=''as $$
begin
 if new.active_version is distinct from old.active_version and not exists(select 1 from indicative_price_private.publications where from_version=old.active_version and to_version=new.active_version)then raise exception 'Publication audit required'using errcode='P0001';end if;
 return new;
end;$$;
revoke all on function indicative_price_private.guard_publication_pointer()from public,anon,authenticated,service_role;
create trigger publication_pointer before update of active_version on indicative_price_private.control for each row execute function indicative_price_private.guard_publication_pointer();
-- Public discovery follows committed publication, regardless of subsequent gate disabling.
create or replace function public.read_indicative_prices()returns jsonb language sql stable security definer set search_path=''as $$
 select jsonb_build_object('version',v.version,'currency','eur','ranges',v.ranges,'indicative',true,'publication_available',false,
 'source',case when v.version=1 then 'existing_baseline'else'operator_version'end)
 from indicative_price_private.control c join indicative_price_private.versions v on v.version=c.active_version;
$$;
create or replace function public.read_indicative_price_staging()returns jsonb language plpgsql stable security definer set search_path=''as $$
begin
 if not public.is_admin()then raise insufficient_privilege;end if;
 return(select jsonb_build_object('active',public.read_indicative_prices(),'latest_version',c.latest_version,
  'staged',case when v.version=c.active_version then null else jsonb_build_object('version',v.version,'ranges',v.ranges,'reason',v.reason,'created_at',v.created_at)end,
  'publication_available',g.enabled)from indicative_price_private.control c join indicative_price_private.versions v on v.version=c.latest_version cross join indicative_price_private.publication_gate g);
end;$$;
create function public.publish_indicative_prices(p_command uuid,p_expected_active integer,p_expected_latest integer,p_reason text)returns jsonb language plpgsql security definer set search_path=''as $$
declare actor uuid=auth.uid();c indicative_price_private.control;prior indicative_price_private.publications;v indicative_price_private.versions;enabled boolean;
begin
 perform 1 from public.profiles where id=actor and role='admin'for share;if not found then raise insufficient_privilege;end if;
 if p_command is null or p_expected_active is null or p_expected_latest is null or p_expected_active<1 or p_expected_latest<=p_expected_active or p_reason is null or char_length(btrim(p_reason))not between 10 and 1000 then raise invalid_parameter_value;end if;
 select g.enabled into enabled from indicative_price_private.publication_gate g where singleton for share;
 if enabled is distinct from true then raise exception 'Publication disabled'using errcode='P0001';end if;
 select *into c from indicative_price_private.control where singleton for update;
 select *into prior from indicative_price_private.publications where command_id=p_command;
 if found then
  if prior.actor_id<>actor or prior.from_version<>p_expected_active or prior.to_version<>p_expected_latest or prior.reason<>btrim(p_reason)then raise exception 'Publication command conflict'using errcode='P0001';end if;
  return jsonb_build_object('published_version',prior.to_version,'active_version',c.active_version,'replayed',true);
 end if;
 if c.active_version<>p_expected_active or c.latest_version<>p_expected_latest then raise exception 'Publication version conflict'using errcode='P0001';end if;
 select *into v from indicative_price_private.versions where version=c.latest_version;
 -- Conservative PaymentIntent eight-digit bound, EUR minimum50 minor units.
 -- These are technical request bounds, not commercial prices or card approval guarantees.
 if exists(select 1 from jsonb_each(v.ranges)x where(x.value->>'max_cents')::integer not between 50 and 99999999)then raise invalid_parameter_value;end if;
 insert into indicative_price_private.publications(command_id,actor_id,from_version,to_version,reason)values(p_command,actor,c.active_version,c.latest_version,btrim(p_reason));
 update indicative_price_private.control set active_version=c.latest_version where singleton;
 return jsonb_build_object('published_version',c.latest_version,'active_version',c.latest_version,'replayed',false);
end;$$;
revoke all on function public.publish_indicative_prices(uuid,integer,integer,text)from public,anon,authenticated,service_role;
grant execute on function public.publish_indicative_prices(uuid,integer,integer,text)to authenticated;

create or replace function public.stage_indicative_prices(p_command uuid,p_expected_version integer,p_ranges jsonb,p_reason text)returns jsonb language plpgsql security definer set search_path=''as $$
declare actor uuid=auth.uid();c indicative_price_private.control;v indicative_price_private.versions;
begin
 perform 1 from public.profiles where id=actor and role='admin'for share;if not found then raise insufficient_privilege;end if;
 if p_command is null or p_expected_version is null or p_expected_version<1 or not indicative_price_private.valid_ranges(p_ranges)
  or p_reason is null or char_length(btrim(p_reason))not between 10 and 1000 then raise invalid_parameter_value;end if;
 select *into c from indicative_price_private.control where singleton for update;
 select *into v from indicative_price_private.versions where actor_id=actor and command_id=p_command;
 if found then
  if v.expected_version<>p_expected_version or v.ranges is distinct from p_ranges or v.reason<>btrim(p_reason)then raise exception 'Command conflict'using errcode='P0001';end if;
  return jsonb_build_object('version',v.version,'replayed',true,'publication_available',false,'active_version',c.active_version);
 end if;
 if c.latest_version<>p_expected_version then raise exception 'Version conflict'using errcode='P0001';end if;
 insert into indicative_price_private.versions(version,ranges,actor_id,command_id,expected_version,reason)values(c.latest_version+1,p_ranges,actor,p_command,p_expected_version,btrim(p_reason))returning *into v;
 update indicative_price_private.control set latest_version=v.version where singleton;
 -- This immutable row is the decision journal, not a publication or a booking mutation.
 return jsonb_build_object('version',v.version,'replayed',false,'publication_available',false,'active_version',c.active_version);
end;$$;
commit;

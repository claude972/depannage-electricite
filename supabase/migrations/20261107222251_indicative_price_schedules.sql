begin;
create schema indicative_price_private;
revoke all on schema indicative_price_private from public,anon,authenticated,service_role;
create table indicative_price_private.versions(
 version integer primary key check(version>0),ranges jsonb not null,
 actor_id uuid references public.profiles(id),command_id uuid,expected_version integer,
 reason text,created_at timestamptz not null default clock_timestamp(),
 unique(actor_id,command_id),
 check((version=1 and actor_id is null and command_id is null and expected_version is null and reason is null)
 or(version>1 and actor_id is not null and command_id is not null and expected_version=version-1 and char_length(reason)between 10 and 1000))
);
create table indicative_price_private.control(
 singleton boolean primary key default true check(singleton),
 active_version integer not null default 1 check(active_version=1)references indicative_price_private.versions(version),
 latest_version integer not null references indicative_price_private.versions(version)
);
alter table indicative_price_private.versions enable row level security;
alter table indicative_price_private.control enable row level security;
revoke all on all tables in schema indicative_price_private from public,anon,authenticated,service_role;
insert into indicative_price_private.versions(version,ranges)values(1,'{"outage":{"min_cents":15000,"max_cents":25000},"panel":{"min_cents":15000,"max_cents":35000},"socket":{"min_cents":8000,"max_cents":18000},"lighting":{"min_cents":8000,"max_cents":20000},"diagnostic":{"min_cents":12000,"max_cents":28000}}');
insert into indicative_price_private.control(latest_version)values(1);
create function indicative_price_private.immutable()returns trigger language plpgsql set search_path=''as $$begin raise exception 'Schedule versions are immutable'using errcode='P0001';end;$$;
create trigger immutable before update or delete on indicative_price_private.versions for each row execute function indicative_price_private.immutable();
create function indicative_price_private.valid_ranges(p_ranges jsonb)returns boolean language plpgsql immutable set search_path=''as $$
declare k text;r jsonb;
begin
 if jsonb_typeof(p_ranges)is distinct from 'object' or not p_ranges?&array['outage','panel','socket','lighting','diagnostic'] or p_ranges-array['outage','panel','socket','lighting','diagnostic']<>'{}'then return false;end if;
 for k,r in select *from jsonb_each(p_ranges)loop
  if jsonb_typeof(r)is distinct from 'object'or not r?&array['min_cents','max_cents']or r-array['min_cents','max_cents']<>'{}'
   or jsonb_typeof(r->'min_cents')is distinct from 'number'or jsonb_typeof(r->'max_cents')is distinct from 'number'then return false;end if;
  if(r->>'min_cents')::numeric<>trunc((r->>'min_cents')::numeric)or(r->>'max_cents')::numeric<>trunc((r->>'max_cents')::numeric)
   or(r->>'min_cents')::numeric<1 or(r->>'max_cents')::numeric<(r->>'min_cents')::numeric or(r->>'max_cents')::numeric>2147483647 then return false;end if;
 end loop;return true;
end;$$;
alter table indicative_price_private.versions add constraint valid_ranges check(indicative_price_private.valid_ranges(ranges));
create function public.read_indicative_prices()returns jsonb language sql stable security definer set search_path=''as $$
 select jsonb_build_object('version',v.version,'currency','eur','ranges',v.ranges,'indicative',true,'publication_available',false,'source','existing_baseline')from indicative_price_private.versions v where v.version=1;
$$;
create function public.read_indicative_price_staging()returns jsonb language plpgsql stable security definer set search_path=''as $$
begin
 if not public.is_admin()then raise insufficient_privilege;end if;
 return(select jsonb_build_object('active',public.read_indicative_prices(),'latest_version',c.latest_version,
  'staged',case when v.version=1 then null else jsonb_build_object('version',v.version,'ranges',v.ranges,'reason',v.reason,'created_at',v.created_at)end,
  'publication_available',false)from indicative_price_private.control c join indicative_price_private.versions v on v.version=c.latest_version);
end;$$;
create function public.stage_indicative_prices(p_command uuid,p_expected_version integer,p_ranges jsonb,p_reason text)returns jsonb language plpgsql security definer set search_path=''as $$
declare actor uuid=auth.uid();c indicative_price_private.control;v indicative_price_private.versions;
begin
 perform 1 from public.profiles where id=actor and role='admin'for share;if not found then raise insufficient_privilege;end if;
 if p_command is null or p_expected_version is null or p_expected_version<1 or not indicative_price_private.valid_ranges(p_ranges)
  or p_reason is null or char_length(btrim(p_reason))not between 10 and 1000 then raise invalid_parameter_value;end if;
 select *into c from indicative_price_private.control where singleton for update;
 select *into v from indicative_price_private.versions where actor_id=actor and command_id=p_command;
 if found then
  if v.expected_version<>p_expected_version or v.ranges is distinct from p_ranges or v.reason<>btrim(p_reason)then raise exception 'Command conflict'using errcode='P0001';end if;
  return jsonb_build_object('version',v.version,'replayed',true,'publication_available',false,'active_version',1);
 end if;
 if c.latest_version<>p_expected_version then raise exception 'Version conflict'using errcode='P0001';end if;
 insert into indicative_price_private.versions(version,ranges,actor_id,command_id,expected_version,reason)values(c.latest_version+1,p_ranges,actor,p_command,p_expected_version,btrim(p_reason))returning *into v;
 update indicative_price_private.control set latest_version=v.version where singleton;
 -- This immutable row is the decision journal, not a publication or a booking mutation.
 return jsonb_build_object('version',v.version,'replayed',false,'publication_available',false,'active_version',1);
end;$$;
revoke all on all functions in schema indicative_price_private from public,anon,authenticated,service_role;
revoke all on function public.read_indicative_prices(),public.read_indicative_price_staging(),public.stage_indicative_prices(uuid,integer,jsonb,text)from public,anon,authenticated,service_role;
grant execute on function public.read_indicative_prices()to anon,authenticated;
grant execute on function public.read_indicative_price_staging(),public.stage_indicative_prices(uuid,integer,jsonb,text)to authenticated;
commit;

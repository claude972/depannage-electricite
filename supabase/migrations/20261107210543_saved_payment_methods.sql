begin;
create schema if not exists saved_payment_private;
revoke all on schema saved_payment_private from public,anon,authenticated;
create table saved_payment_private.customers(
 id uuid primary key default gen_random_uuid(),user_id uuid not null references public.profiles(id) on delete cascade,
 live boolean not null,customer_id text check(customer_id~'^cus_[A-Za-z0-9]{1,200}$'),created_at timestamptz not null default clock_timestamp(),
 unique(user_id,live),unique(live,customer_id)
);
create table saved_payment_private.commands(
 id uuid primary key default gen_random_uuid(),user_id uuid not null references public.profiles(id)on delete cascade,live boolean not null,command_id uuid not null,
 action text not null check(action in('setup','remove')),method_id text check(method_id~'^pm_[A-Za-z0-9]{1,200}$'),
 return_origin text,consent boolean,created_at timestamptz not null default clock_timestamp(),
 session_id text check(session_id~'^cs_[A-Za-z0-9_]{1,240}$'),verified_customer text,
 removed boolean not null default false,
 unique(user_id,live,command_id),
 check((action='setup'and method_id is null and consent=true and return_origin is not null and not removed and verified_customer is null)or(action='remove'and method_id is not null and consent is null and return_origin is null and session_id is null))
);
alter table saved_payment_private.customers enable row level security;
alter table saved_payment_private.commands enable row level security;
revoke all on all tables in schema saved_payment_private from public,anon,authenticated,service_role;
-- No direct API table access, including service role. Only narrow RPCs below.
create function saved_payment_private.authorized(p_actor uuid)returns boolean language sql stable security definer set search_path=''as $$
 select exists(select 1 from public.profiles p join auth.users u on u.id=p.id where p.id=p_actor and p.role='client'and u.email_confirmed_at is not null and nullif(btrim(u.email),'')is not null and coalesce((to_jsonb(u)->>'is_anonymous')::boolean,false)=false);
$$;
revoke all on function saved_payment_private.authorized(uuid)from public,anon,authenticated,service_role;
create function public.saved_methods_guard()returns uuid language plpgsql security definer set search_path=''as $$
begin if auth.uid()is null or not saved_payment_private.authorized(auth.uid())then raise insufficient_privilege;end if;return auth.uid();end;$$;
revoke all on function public.saved_methods_guard()from public,anon,authenticated,service_role;
grant execute on function public.saved_methods_guard()to authenticated;
create function public.saved_methods_context(p_actor uuid,p_live boolean)returns jsonb language plpgsql security definer set search_path=''as $$
declare c saved_payment_private.customers;
begin
 if not saved_payment_private.authorized(p_actor)then raise insufficient_privilege;end if;
 if p_live is null then raise invalid_parameter_value;end if;
 select *into c from saved_payment_private.customers where user_id=p_actor and live=p_live;
 return jsonb_build_object('customer',case when c.id is null then null else to_jsonb(c)end);
end;$$;
create function public.begin_saved_method_command(p_actor uuid,p_live boolean,p_command uuid,p_action text,p_method text,p_origin text,p_consent boolean)returns jsonb language plpgsql security definer set search_path=''as $$
declare c saved_payment_private.commands;b saved_payment_private.customers;
begin
 if not saved_payment_private.authorized(p_actor)then raise insufficient_privilege;end if;
 if p_live is null or p_command is null or p_action is null or p_action not in('setup','remove')then raise invalid_parameter_value;end if;
 if p_action='setup'and(p_method is not null or p_consent is distinct from true or p_origin is null or char_length(p_origin)>500 or p_origin!~'^(https://[^/@?#[:space:]]+|http://(localhost|127\.0\.0\.1)(:[0-9]+)?)$')then raise invalid_parameter_value;end if;
 if p_action='remove'and(p_method is null or p_method!~'^pm_[A-Za-z0-9]{1,200}$'or p_origin is not null or p_consent is not null)then raise invalid_parameter_value;end if;
 perform pg_advisory_xact_lock(hashtextextended('saved-methods:'||p_actor::text||':'||p_live::text,0));
 select *into c from saved_payment_private.commands where user_id=p_actor and live=p_live and command_id=p_command;
 if found then
  if c.action<>p_action or c.method_id is distinct from p_method or c.return_origin is distinct from p_origin or c.consent is distinct from p_consent then raise exception 'Command already used'using errcode='P0001';end if;
 else
  if p_action='setup'then
   -- A lost setup creation must be resumed with its original command, never replaced blindly.
   if exists(select 1 from saved_payment_private.commands where user_id=p_actor and live=p_live and action='setup'and session_id is null)then raise exception 'Setup needs original command'using errcode='P0001';end if;
   insert into saved_payment_private.customers(user_id,live)values(p_actor,p_live)on conflict(user_id,live)do nothing;
  elsif not exists(select 1 from saved_payment_private.customers where user_id=p_actor and live=p_live and customer_id is not null)then raise insufficient_privilege;
  end if;
  insert into saved_payment_private.commands(user_id,live,command_id,action,method_id,return_origin,consent)values(p_actor,p_live,p_command,p_action,p_method,p_origin,p_consent)returning *into c;
 end if;
 select *into b from saved_payment_private.customers where user_id=p_actor and live=p_live;
 return jsonb_build_object('command',to_jsonb(c),'customer',to_jsonb(b));
end;$$;
create function public.bind_saved_customer(p_actor uuid,p_live boolean,p_binding uuid,p_customer text)returns void language plpgsql security definer set search_path=''as $$
declare c saved_payment_private.customers;
begin
 if not saved_payment_private.authorized(p_actor)then raise insufficient_privilege;end if;
 if p_customer is null or p_customer!~'^cus_[A-Za-z0-9]{1,200}$'then raise invalid_parameter_value;end if;
 select *into c from saved_payment_private.customers where id=p_binding and user_id=p_actor and live=p_live for update;
 if not found then raise insufficient_privilege;end if;
 if c.customer_id is not null then if c.customer_id<>p_customer then raise exception 'Customer conflict'using errcode='P0001';end if;return;end if;
 if c.created_at<=clock_timestamp()-interval '23 hours'then raise exception 'Customer creation needs review'using errcode='P0001';end if;
 update saved_payment_private.customers set customer_id=p_customer where id=c.id;
end;$$;
create function public.record_saved_method_proof(p_actor uuid,p_live boolean,p_command uuid,p_customer text,p_kind text,p_session text default null)returns void language plpgsql security definer set search_path=''as $$
declare c saved_payment_private.commands;b saved_payment_private.customers;
begin
 if not saved_payment_private.authorized(p_actor)then raise insufficient_privilege;end if;
 select *into b from saved_payment_private.customers where user_id=p_actor and live=p_live;
 if b.customer_id is null or b.customer_id is distinct from p_customer then raise insufficient_privilege;end if;
 select *into c from saved_payment_private.commands where user_id=p_actor and live=p_live and command_id=p_command for update;
 if not found then raise insufficient_privilege;end if;
 if p_kind='setup'and c.action='setup'and p_session~'^cs_[A-Za-z0-9_]{1,240}$'then
  if c.session_id is not null and c.session_id<>p_session then raise exception 'Session conflict'using errcode='P0001';end if;
  update saved_payment_private.commands set session_id=p_session where id=c.id;
 elsif p_kind='verified'and c.action='remove'and p_session is null then
  update saved_payment_private.commands set verified_customer=p_customer where id=c.id;
 elsif p_kind='removed'and c.action='remove'and c.verified_customer=p_customer and p_session is null then
  update saved_payment_private.commands set removed=true where id=c.id;
 else raise invalid_parameter_value;end if;
end;$$;
revoke all on function public.saved_methods_context(uuid,boolean),public.begin_saved_method_command(uuid,boolean,uuid,text,text,text,boolean),public.bind_saved_customer(uuid,boolean,uuid,text),public.record_saved_method_proof(uuid,boolean,uuid,text,text,text)from public,anon,authenticated,service_role;
grant execute on function public.saved_methods_context(uuid,boolean),public.begin_saved_method_command(uuid,boolean,uuid,text,text,text,boolean),public.bind_saved_customer(uuid,boolean,uuid,text),public.record_saved_method_proof(uuid,boolean,uuid,text,text,text)to service_role;
commit;

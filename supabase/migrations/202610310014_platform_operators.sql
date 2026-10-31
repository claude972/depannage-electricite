-- ADV-PLATFORM-FINANCE-001. Depends only on 001-013.
-- Section 1: explicit platform operator scopes (never profiles.role='admin'), last-super-admin
-- protection, immutable server-timestamped audit, persistent settings.
-- Section 2: prepared finance (idempotent integer-cent ledger, reconciliation against payments,
-- invoices/credit notes from real issuer data only, refund requests that never equal refunds,
-- disputes) and review moderation/contestation without deletion.
-- No payment-provider call exists here; settlement is service-role only with a provider event.
begin;

-- =====================================================================================
-- Section 1 — operators, super admins, audit, settings
-- =====================================================================================
create function public.platform_deny_mutation() returns trigger language plpgsql as $$
#variable_conflict use_variable
begin raise exception 'Immutable platform record' using errcode='P0001'; end; $$;
revoke execute on function public.platform_deny_mutation() from public,anon,authenticated;

create table public.platform_audit (
 id bigint generated always as identity primary key,
 actor_id uuid references public.profiles(id),
 action text not null check(char_length(action) between 1 and 80),
 target_kind text not null check(target_kind in ('operator','super_admin','setting','reconciliation','ledger','invoice','refund_request','dispute','review')),
 target_id text not null default '' check(char_length(target_id)<=80),
 details jsonb not null default '{}'::jsonb check(jsonb_typeof(details)='object'),
 created_at timestamptz not null default now()
);
create index platform_audit_target on public.platform_audit(target_kind,target_id,id desc);
alter table public.platform_audit enable row level security;
revoke all on public.platform_audit from public,anon,authenticated;
grant select on public.platform_audit to authenticated;
grant select,insert on public.platform_audit to service_role;
revoke update,delete,truncate on public.platform_audit from service_role;
grant usage,select on sequence public.platform_audit_id_seq to service_role;
create trigger platform_audit_immutable before update or delete on public.platform_audit for each row execute function public.platform_deny_mutation();
create trigger platform_audit_no_truncate before truncate on public.platform_audit for each statement execute function public.platform_deny_mutation();

create function public.platform_audit_write(p_action text,p_target_kind text,p_target_id text,p_details jsonb default '{}'::jsonb) returns void language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
begin
 insert into public.platform_audit(actor_id,action,target_kind,target_id,details) values(auth.uid(),p_action,p_target_kind,coalesce(p_target_id,''),coalesce(p_details,'{}'::jsonb));
end; $$;
revoke execute on function public.platform_audit_write(text,text,text,jsonb) from public,anon,authenticated;

create table public.platform_operator_grants (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public.profiles(id),
 scope text not null check(scope in ('finance_read','finance_write','reviews_moderate','audit_read')),
 status text not null default 'active' check(status in ('active','revoked')),
 note text not null default '' check(char_length(note)<=500),
 granted_by uuid not null references public.profiles(id), granted_at timestamptz not null default now(),
 revoked_by uuid references public.profiles(id), revoked_at timestamptz, revoke_note text not null default '' check(char_length(revoke_note)<=500),
 check((status='active' and revoked_by is null and revoked_at is null) or (status='revoked' and revoked_by is not null and revoked_at is not null))
);
create unique index platform_operator_grants_active on public.platform_operator_grants(user_id,scope) where status='active';
create index platform_operator_grants_page on public.platform_operator_grants(granted_at desc,id desc);
create index platform_operator_grants_user on public.platform_operator_grants(user_id,status);
alter table public.platform_operator_grants enable row level security;
revoke all on public.platform_operator_grants from public,anon,authenticated;
grant select on public.platform_operator_grants to authenticated;
grant select,insert,update on public.platform_operator_grants to service_role;
revoke delete,truncate on public.platform_operator_grants from service_role;
create function public.platform_guard_grant_update() returns trigger language plpgsql as $$
#variable_conflict use_variable
begin
 -- The only permitted mutation is a single active -> revoked transition with its revocation fields.
 if old.status<>'active' or new.status<>'revoked' or new.id<>old.id or new.user_id<>old.user_id or new.scope<>old.scope
  or new.note<>old.note or new.granted_by<>old.granted_by or new.granted_at<>old.granted_at or new.revoked_by is null or new.revoked_at is null then
  raise exception 'Grant history is immutable' using errcode='P0001';
 end if;
 return new;
end; $$;
revoke execute on function public.platform_guard_grant_update() from public,anon,authenticated;
create trigger platform_operator_grants_guard before update on public.platform_operator_grants for each row execute function public.platform_guard_grant_update();
create trigger platform_operator_grants_no_delete before delete on public.platform_operator_grants for each row execute function public.platform_deny_mutation();

create function public.has_platform_scope(p_scope text) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and (public.is_admin() or exists(select 1 from public.platform_operator_grants g where g.user_id=auth.uid() and g.scope=p_scope and g.status='active'));
$$;
revoke execute on function public.has_platform_scope(text) from public,anon,authenticated;
grant execute on function public.has_platform_scope(text) to authenticated;
create policy platform_operator_grants_read on public.platform_operator_grants for select to authenticated using(user_id=auth.uid() or public.is_admin());
create policy platform_audit_read on public.platform_audit for select to authenticated using(public.has_platform_scope('audit_read'));

create function public.platform_access() returns jsonb language plpgsql stable security definer set search_path='' as $$
#variable_conflict use_variable
begin
 if auth.uid() is null then raise insufficient_privilege; end if;
 return jsonb_build_object('super_admin',public.is_admin(),
  'scopes',(select coalesce(jsonb_agg(scope order by scope),'[]'::jsonb) from public.platform_operator_grants where user_id=auth.uid() and status='active'),
  'super_admin_count',case when public.is_admin() then (select count(*) from public.profiles where role='admin') else null end);
end; $$;
revoke execute on function public.platform_access() from public,anon,authenticated;
grant execute on function public.platform_access() to authenticated;

create function public.platform_grant_scope(p_user_id uuid,p_scope text,p_note text default '') returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
declare target public.profiles; row public.platform_operator_grants; note text;
begin
 if not public.is_admin() then raise insufficient_privilege; end if;
 note=coalesce(regexp_replace(p_note,'^[[:space:]]+|[[:space:]]+$','','g'),'');
 if p_user_id is null or p_scope is null or p_scope not in ('finance_read','finance_write','reviews_moderate','audit_read') or char_length(note)>500 then raise invalid_parameter_value; end if;
 perform public.consume_action('platform_operators',30);
 select * into target from public.profiles where id=p_user_id for no key update;
 if not found then raise no_data_found; end if;
 if target.role='admin' then raise exception 'Super admins hold every scope implicitly' using errcode='P0001'; end if;
 select * into row from public.platform_operator_grants where user_id=p_user_id and scope=p_scope and status='active';
 if found then return jsonb_build_object('grant',to_jsonb(row),'replayed',true); end if;
 insert into public.platform_operator_grants(user_id,scope,note,granted_by) values(p_user_id,p_scope,note,auth.uid()) returning * into row;
 perform public.platform_audit_write('operator_scope_granted','operator',p_user_id::text,jsonb_build_object('scope',p_scope,'grant_id',row.id,'note',note));
 return jsonb_build_object('grant',to_jsonb(row),'replayed',false);
end; $$;
create function public.platform_revoke_scope(p_grant_id uuid,p_note text default '') returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
declare row public.platform_operator_grants; note text;
begin
 if not public.is_admin() then raise insufficient_privilege; end if;
 note=coalesce(regexp_replace(p_note,'^[[:space:]]+|[[:space:]]+$','','g'),'');
 if p_grant_id is null or char_length(note)>500 then raise invalid_parameter_value; end if;
 perform public.consume_action('platform_operators',30);
 select * into row from public.platform_operator_grants where id=p_grant_id for update;
 if not found then raise no_data_found; end if;
 if row.status='revoked' then return jsonb_build_object('grant',to_jsonb(row),'replayed',true); end if;
 update public.platform_operator_grants set status='revoked',revoked_by=auth.uid(),revoked_at=now(),revoke_note=note where id=p_grant_id returning * into row;
 perform public.platform_audit_write('operator_scope_revoked','operator',row.user_id::text,jsonb_build_object('scope',row.scope,'grant_id',row.id,'note',note));
 return jsonb_build_object('grant',to_jsonb(row),'replayed',false);
end; $$;
revoke execute on function public.platform_grant_scope(uuid,text,text),public.platform_revoke_scope(uuid,text) from public,anon,authenticated;
grant execute on function public.platform_grant_scope(uuid,text,text),public.platform_revoke_scope(uuid,text) to authenticated;

-- Last super admin: protected on every path, including service_role and the auth.users cascade.
create function public.platform_guard_last_super_admin() returns trigger language plpgsql as $$
#variable_conflict use_variable
begin
 if old.role='admin' and (tg_op='DELETE' or new.role<>'admin') then
  -- Serialize every super-admin removal (direct update, service_role, auth.users cascade) before counting.
  perform pg_advisory_xact_lock(hashtext('profiles_super_admin'));
 end if;
 if old.role='admin' and (tg_op='DELETE' or new.role<>'admin') and not exists(select 1 from public.profiles where role='admin' and id<>old.id) then
  raise exception 'The last super admin cannot be removed or demoted' using errcode='P0001';
 end if;
 if tg_op='DELETE' then return old; end if;
 return new;
end; $$;
revoke execute on function public.platform_guard_last_super_admin() from public,anon,authenticated;
create trigger profiles_last_super_admin before update of role or delete on public.profiles for each row execute function public.platform_guard_last_super_admin();

create function public.platform_set_super_admin(p_user_id uuid,p_enabled boolean,p_restore_role text default 'client',p_note text default '') returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
declare target public.profiles; note text; revoked integer;
begin
 if not public.is_admin() then raise insufficient_privilege; end if;
 note=coalesce(regexp_replace(p_note,'^[[:space:]]+|[[:space:]]+$','','g'),'');
 if p_user_id is null or p_enabled is null or p_restore_role not in ('client','manager') or char_length(note)>500 then raise invalid_parameter_value; end if;
 if p_user_id=auth.uid() then raise exception 'A super admin cannot change their own status' using errcode='P0001'; end if;
 perform public.consume_action('platform_admin',10);
 -- Same lock as the trigger: concurrent decisions on the admin set are serialized before counting.
 perform pg_advisory_xact_lock(hashtext('profiles_super_admin'));
 select * into target from public.profiles where id=p_user_id for no key update;
 if not found then raise no_data_found; end if;
 if p_enabled then
  if target.role='admin' then return jsonb_build_object('profile_id',target.id,'role','admin','replayed',true); end if;
  if target.role='artisan' then raise exception 'Artisan accounts are governed by artisan approval' using errcode='P0001'; end if;
  update public.profiles set role='admin' where id=p_user_id;
  update public.platform_operator_grants set status='revoked',revoked_by=auth.uid(),revoked_at=now(),revoke_note='superseded by super admin status' where user_id=p_user_id and status='active';
  get diagnostics revoked=row_count;
  perform public.platform_audit_write('super_admin_granted','super_admin',p_user_id::text,jsonb_build_object('previous_role',target.role,'grants_revoked',revoked,'note',note));
  return jsonb_build_object('profile_id',target.id,'role','admin','replayed',false);
 end if;
 if target.role<>'admin' then return jsonb_build_object('profile_id',target.id,'role',target.role,'replayed',true); end if;
 if (select count(*) from public.profiles where role='admin')<=1 then raise exception 'The last super admin cannot be removed or demoted' using errcode='P0001'; end if;
 update public.profiles set role=p_restore_role where id=p_user_id;
 perform public.platform_audit_write('super_admin_revoked','super_admin',p_user_id::text,jsonb_build_object('restored_role',p_restore_role,'note',note));
 return jsonb_build_object('profile_id',target.id,'role',p_restore_role,'replayed',false);
end; $$;
revoke execute on function public.platform_set_super_admin(uuid,boolean,text,text) from public,anon,authenticated;
grant execute on function public.platform_set_super_admin(uuid,boolean,text,text) to authenticated;

create table public.platform_settings (
 key text primary key check(key in ('invoice_issuer','commission_bps')),
 value jsonb not null, version integer not null default 1 check(version between 1 and 2147483647),
 updated_by uuid not null references public.profiles(id), updated_at timestamptz not null default now()
);
alter table public.platform_settings enable row level security;
revoke all on public.platform_settings from public,anon,authenticated;
grant select on public.platform_settings to authenticated;
grant all on public.platform_settings to service_role;
create policy platform_settings_read on public.platform_settings for select to authenticated using(public.has_platform_scope('finance_read'));
create function public.platform_validate_issuer(p_value jsonb) returns void language plpgsql immutable set search_path='' as $$
#variable_conflict use_variable
declare keys text[]; vat text; rate text;
begin
 if p_value is null or jsonb_typeof(p_value)<>'object' then raise invalid_parameter_value; end if;
 select array_agg(k order by k) into keys from jsonb_object_keys(p_value) k;
 if keys is distinct from array['address','commission_vat_rate','legal_name','siret','vat_number'] then raise invalid_parameter_value; end if;
 if jsonb_typeof(p_value->'legal_name')<>'string' or char_length(trim(p_value->>'legal_name')) not between 1 and 160 then raise invalid_parameter_value; end if;
 if jsonb_typeof(p_value->'siret')<>'string' or (p_value->>'siret') !~ '^[0-9]{14}$' then raise invalid_parameter_value; end if;
 if jsonb_typeof(p_value->'address')<>'string' or char_length(trim(p_value->>'address')) not between 5 and 500 then raise invalid_parameter_value; end if;
 vat=p_value->>'vat_number';
 if jsonb_typeof(p_value->'vat_number') not in ('null','string') or (vat is not null and vat !~ '^[A-Z]{2}[0-9A-Z]{2,13}$') then raise invalid_parameter_value; end if;
 rate=p_value->>'commission_vat_rate';
 if jsonb_typeof(p_value->'commission_vat_rate') not in ('null','number') or (rate is not null and rate::numeric not in (0,5.5,10,20)) then raise invalid_parameter_value; end if;
end; $$;
revoke execute on function public.platform_validate_issuer(jsonb) from public,anon,authenticated;
create function public.platform_validate_commission(p_value jsonb) returns void language plpgsql immutable set search_path='' as $$
#variable_conflict use_variable
declare keys text[];
begin
 if p_value is null or jsonb_typeof(p_value)<>'object' then raise invalid_parameter_value; end if;
 select array_agg(k order by k) into keys from jsonb_object_keys(p_value) k;
 if keys is distinct from array['bps'] or jsonb_typeof(p_value->'bps')<>'number' or (p_value->>'bps') !~ '^[0-9]{1,5}$' or (p_value->>'bps')::integer not between 0 and 10000 then raise invalid_parameter_value; end if;
end; $$;
revoke execute on function public.platform_validate_commission(jsonb) from public,anon,authenticated;
-- Server-trusted commission rate: only a super admin writes it; every ledger estimate snapshots bps and version.
create function public.platform_commission_setting() returns public.platform_settings language sql stable security definer set search_path='' as $$
 select * from public.platform_settings where key='commission_bps';
$$;
revoke execute on function public.platform_commission_setting() from public,anon,authenticated;
create function public.platform_set_setting(p_key text,p_value jsonb,p_expected_version integer default null) returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
declare current public.platform_settings; row public.platform_settings;
begin
 if not public.is_admin() then raise insufficient_privilege; end if;
 if p_key='invoice_issuer' then perform public.platform_validate_issuer(p_value);
 elsif p_key='commission_bps' then perform public.platform_validate_commission(p_value);
 else raise invalid_parameter_value; end if;
 perform public.consume_action('platform_admin',10);
 select * into current from public.platform_settings where key=p_key for update;
 if found then
  if p_expected_version is null or p_expected_version<>current.version or current.version=2147483647 then raise exception 'Setting revision changed' using errcode='P0001'; end if;
  update public.platform_settings set value=p_value,version=version+1,updated_by=auth.uid(),updated_at=now() where key=p_key returning * into row;
 else
  if p_expected_version is not null then raise exception 'Setting revision changed' using errcode='P0001'; end if;
  insert into public.platform_settings(key,value,updated_by) values(p_key,p_value,auth.uid()) returning * into row;
 end if;
 perform public.platform_audit_write('setting_updated','setting',p_key,jsonb_build_object('previous',case when current.key is null then null else current.value end,'next',p_value,'version',row.version));
 return jsonb_build_object('setting',to_jsonb(row));
end; $$;
revoke execute on function public.platform_set_setting(text,jsonb,integer) from public,anon,authenticated;
grant execute on function public.platform_set_setting(text,jsonb,integer) to authenticated;

-- =====================================================================================
-- Section 2 — prepared finance and review moderation
-- =====================================================================================
create table public.platform_ledger_entries (
 id uuid primary key default gen_random_uuid(), request_id uuid not null unique,
 entry_kind text not null check(entry_kind in ('payment_settled','commission_estimated','commission_withheld','refund_settled')),
 direction text not null check(direction in ('credit','debit')),
 amount_cents integer not null check(amount_cents>0), currency text not null check(currency='eur'),
 payment_id uuid not null references public.payments(id), external_event_id text check(external_event_id is null or char_length(external_event_id) between 1 and 255),
 basis jsonb not null default '{}'::jsonb check(jsonb_typeof(basis)='object'),
 recorded_by uuid references public.profiles(id), created_at timestamptz not null default now(),
 check((entry_kind='payment_settled' and direction='credit') or (entry_kind<>'payment_settled' and direction='debit'))
);
create unique index platform_ledger_one_settlement on public.platform_ledger_entries(payment_id) where entry_kind='payment_settled';
create unique index platform_ledger_one_commission_estimate on public.platform_ledger_entries(payment_id) where entry_kind='commission_estimated';
create unique index platform_ledger_one_commission_withheld on public.platform_ledger_entries(payment_id) where entry_kind='commission_withheld';
create unique index platform_ledger_external_event on public.platform_ledger_entries(entry_kind,external_event_id) where external_event_id is not null;
create index platform_ledger_page on public.platform_ledger_entries(created_at desc,id desc);
create index platform_ledger_payment on public.platform_ledger_entries(payment_id,entry_kind);
alter table public.platform_ledger_entries enable row level security;
revoke all on public.platform_ledger_entries from public,anon,authenticated;
grant select on public.platform_ledger_entries to authenticated;
grant select,insert on public.platform_ledger_entries to service_role;
revoke update,delete,truncate on public.platform_ledger_entries from service_role;
create trigger platform_ledger_immutable before update or delete on public.platform_ledger_entries for each row execute function public.platform_deny_mutation();
create trigger platform_ledger_no_truncate before truncate on public.platform_ledger_entries for each statement execute function public.platform_deny_mutation();
create policy platform_ledger_read on public.platform_ledger_entries for select to authenticated using(public.has_platform_scope('finance_read'));

create function public.platform_reconcile(p_limit integer default 200) returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
declare settled_added integer=0; commission_added integer=0; pay record; remaining integer; fee integer; rate public.platform_settings; bps integer;
begin
 if not public.has_platform_scope('finance_write') then raise insufficient_privilege; end if;
 if p_limit is null or p_limit not between 1 and 500 then raise invalid_parameter_value; end if;
 perform public.consume_action('platform_reconcile',10);
 -- The rate is never an argument: it is the audited persisted setting at the time of this run, or absent.
 rate=public.platform_commission_setting();
 bps=case when rate.key is null then null else (rate.value->>'bps')::integer end;
 for pay in select p.* from public.payments p where p.status='paid' and not exists(select 1 from public.platform_ledger_entries l where l.payment_id=p.id and l.entry_kind='payment_settled') order by p.paid_at,p.id limit p_limit for update of p loop
  insert into public.platform_ledger_entries(request_id,entry_kind,direction,amount_cents,currency,payment_id,external_event_id,basis,recorded_by)
  values(gen_random_uuid(),'payment_settled','credit',pay.total_cents,pay.currency,pay.id,pay.session_id,jsonb_build_object('source','payments','paid_at',pay.paid_at,'quote_id',pay.quote_id),auth.uid())
  on conflict (payment_id) where entry_kind='payment_settled' do nothing;
  if found then settled_added=settled_added+1; end if;
 end loop;
 if bps is not null then
  for pay in select p.* from public.payments p where p.status='paid' and exists(select 1 from public.platform_ledger_entries l where l.payment_id=p.id and l.entry_kind='payment_settled')
   and not exists(select 1 from public.platform_ledger_entries l where l.payment_id=p.id and l.entry_kind='commission_estimated') order by p.paid_at,p.id limit p_limit for update of p loop
   fee=round(pay.total_cents::numeric*bps/10000);
   if fee>0 then
    insert into public.platform_ledger_entries(request_id,entry_kind,direction,amount_cents,currency,payment_id,basis,recorded_by)
    values(gen_random_uuid(),'commission_estimated','debit',fee,pay.currency,pay.id,jsonb_build_object('rate_source','platform_setting','bps',bps,'setting_version',rate.version,'gross_cents',pay.total_cents),auth.uid())
    on conflict (payment_id) where entry_kind='commission_estimated' do nothing;
    if found then commission_added=commission_added+1; end if;
   end if;
  end loop;
 end if;
 select count(*) into remaining from public.payments p where p.status='paid' and not exists(select 1 from public.platform_ledger_entries l where l.payment_id=p.id and l.entry_kind='payment_settled');
 perform public.platform_audit_write('reconciliation_run','reconciliation','',jsonb_build_object('settled_added',settled_added,'commission_added',commission_added,'commission_bps',bps,'setting_version',rate.version,'remaining_unsettled',remaining,'limit',p_limit));
 return jsonb_build_object('settled_added',settled_added,'commission_added',commission_added,'commission_bps',bps,'setting_version',rate.version,'remaining_unsettled',remaining);
end; $$;
revoke execute on function public.platform_reconcile(integer) from public,anon,authenticated;
grant execute on function public.platform_reconcile(integer) to authenticated;

-- Service-only: the commission actually withheld is known solely from a confirmed provider event.
create function public.platform_record_commission_withheld(p_payment_id uuid,p_event_id text,p_event_type text,p_session_id text,p_provider_reference text,p_provider_status text,p_amount_cents integer,p_currency text) returns boolean language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
declare pay public.payments;
begin
 if p_payment_id is null or p_event_id is null or char_length(p_event_id) not between 1 and 255 or p_event_type is null or char_length(p_event_type) not between 1 and 80 or p_session_id is null or char_length(p_session_id) not between 1 and 255
  or p_provider_reference is null or char_length(p_provider_reference) not between 1 and 255 or p_provider_status is null or p_amount_cents is null or p_amount_cents<1 or p_currency is distinct from 'eur' then raise invalid_parameter_value; end if;
 if exists(select 1 from public.stripe_events where id=p_event_id) then return false; end if;
 if p_provider_status<>'succeeded' then raise exception 'Commission not succeeded at provider' using errcode='P0001'; end if;
 select * into pay from public.payments where id=p_payment_id for update;
 if not found or pay.status<>'paid' or pay.session_id<>p_session_id or pay.currency<>p_currency or p_amount_cents>pay.total_cents then raise exception 'Commission event mismatch' using errcode='P0001'; end if;
 if exists(select 1 from public.platform_ledger_entries where payment_id=p_payment_id and entry_kind='commission_withheld') then raise exception 'Commission already recorded' using errcode='P0001'; end if;
 insert into public.stripe_events(id,event_type) values(p_event_id,p_event_type) on conflict do nothing;
 if not found then return false; end if;
 insert into public.platform_ledger_entries(request_id,entry_kind,direction,amount_cents,currency,payment_id,external_event_id,basis)
 values(gen_random_uuid(),'commission_withheld','debit',p_amount_cents,p_currency,p_payment_id,p_event_id,jsonb_build_object('source','provider_event','event_type',p_event_type,'provider_reference',p_provider_reference,'provider_status',p_provider_status,'session_id',p_session_id,'tax_included',true));
 insert into public.platform_audit(actor_id,action,target_kind,target_id,details) values(null,'commission_withheld','ledger',p_payment_id::text,jsonb_build_object('event_id',p_event_id,'amount_cents',p_amount_cents));
 return true;
end; $$;
revoke execute on function public.platform_record_commission_withheld(uuid,text,text,text,text,text,integer,text) from public,anon,authenticated;
grant execute on function public.platform_record_commission_withheld(uuid,text,text,text,text,text,integer,text) to service_role;

create table public.platform_refund_requests (
 id uuid primary key default gen_random_uuid(), request_id uuid not null unique,
 payment_id uuid not null references public.payments(id), amount_cents integer not null check(amount_cents>0), currency text not null check(currency='eur'),
 reason text not null check(char_length(reason) between 10 and 2000), content_fingerprint text not null check(char_length(content_fingerprint)=32),
 status text not null default 'requested' check(status in ('requested','approved','rejected','cancelled','settled')),
 version integer not null default 1 check(version between 1 and 2147483647),
 requested_by uuid not null references public.profiles(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 decided_by uuid references public.profiles(id), decided_at timestamptz, decision_note text not null default '' check(char_length(decision_note)<=1000),
 provider_reference text check(provider_reference is null or char_length(provider_reference) between 1 and 255), settled_event_id text, settled_at timestamptz
);
create index platform_refund_requests_page on public.platform_refund_requests(created_at desc,id desc);
create index platform_refund_requests_payment on public.platform_refund_requests(payment_id,status);
alter table public.platform_refund_requests enable row level security;
revoke all on public.platform_refund_requests from public,anon,authenticated;
grant select on public.platform_refund_requests to authenticated;
grant select,insert,update on public.platform_refund_requests to service_role;
revoke delete,truncate on public.platform_refund_requests from service_role;
create trigger platform_refund_requests_no_delete before delete on public.platform_refund_requests for each row execute function public.platform_deny_mutation();
create policy platform_refund_requests_read on public.platform_refund_requests for select to authenticated using(public.has_platform_scope('finance_read'));

create function public.platform_request_refund(p_request_id uuid,p_payment_id uuid,p_amount_cents integer,p_reason text) returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
declare pay public.payments; row public.platform_refund_requests; reason text; committed bigint; fingerprint text;
begin
 if not public.has_platform_scope('finance_write') then raise insufficient_privilege; end if;
 reason=regexp_replace(p_reason,'^[[:space:]]+|[[:space:]]+$','','g');
 if p_request_id is null or p_payment_id is null or p_amount_cents is null or p_amount_cents<1 or reason is null or char_length(reason) not between 10 and 2000 then raise invalid_parameter_value; end if;
 -- Lock order for every finance write: the payment row first, then the entity.
 select * into pay from public.payments where id=p_payment_id for update;
 if not found then raise no_data_found; end if;
 fingerprint=md5('refund|'||p_payment_id::text||'|'||p_amount_cents::text||'|'||pay.currency||'|'||reason);
 select * into row from public.platform_refund_requests where request_id=p_request_id;
 if found then
  if row.content_fingerprint<>fingerprint then raise exception 'Request key content conflict' using errcode='P0001'; end if;
  return jsonb_build_object('request',to_jsonb(row),'replayed',true);
 end if;
 if pay.status<>'paid' then raise exception 'Only a settled payment can be refunded' using errcode='P0001'; end if;
 perform public.consume_action('platform_refunds',20);
 select coalesce(sum(amount_cents),0) into committed from public.platform_refund_requests where payment_id=p_payment_id and status in ('requested','approved','settled');
 if committed+p_amount_cents>pay.total_cents then raise exception 'Refund requests exceed the settled amount' using errcode='P0001'; end if;
 insert into public.platform_refund_requests(request_id,payment_id,amount_cents,currency,reason,content_fingerprint,requested_by) values(p_request_id,p_payment_id,p_amount_cents,pay.currency,reason,fingerprint,auth.uid()) returning * into row;
 perform public.platform_audit_write('refund_requested','refund_request',row.id::text,jsonb_build_object('payment_id',p_payment_id,'amount_cents',p_amount_cents,'currency',pay.currency,'version',row.version));
 return jsonb_build_object('request',to_jsonb(row),'replayed',false);
end; $$;
create function public.platform_decide_refund(p_id uuid,p_action text,p_expected_version integer,p_note text default '') returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
declare row public.platform_refund_requests; note text; next_status text; previous text;
begin
 if not public.has_platform_scope('finance_write') then raise insufficient_privilege; end if;
 note=coalesce(regexp_replace(p_note,'^[[:space:]]+|[[:space:]]+$','','g'),'');
 if p_id is null or p_action not in ('approve','reject','cancel') or p_expected_version is null or p_expected_version<1 or char_length(note)>1000 then raise invalid_parameter_value; end if;
 if p_action='reject' and char_length(note)<10 then raise invalid_parameter_value; end if;
 perform 1 from public.payments p join public.platform_refund_requests r on r.payment_id=p.id where r.id=p_id for update of p;
 select * into row from public.platform_refund_requests where id=p_id for update;
 if not found then raise no_data_found; end if;
 if row.version<>p_expected_version or row.version=2147483647 then raise exception 'Refund request revision changed' using errcode='P0001'; end if;
 next_status=case when p_action='approve' then 'approved' when p_action='reject' then 'rejected' else 'cancelled' end;
 if not ((row.status='requested' and next_status in ('approved','rejected','cancelled')) or (row.status='approved' and next_status='cancelled')) then raise exception 'Invalid refund transition' using errcode='P0001'; end if;
 perform public.consume_action('platform_refunds',20);
 previous=row.status;
 update public.platform_refund_requests set status=next_status,version=version+1,updated_at=now(),decided_by=auth.uid(),decided_at=now(),decision_note=note where id=p_id returning * into row;
 perform public.platform_audit_write('refund_'||next_status,'refund_request',row.id::text,jsonb_build_object('from',previous,'to',next_status,'version',row.version,'amount_cents',row.amount_cents,'note',note));
 return jsonb_build_object('request',to_jsonb(row));
end; $$;
revoke execute on function public.platform_request_refund(uuid,uuid,integer,text),public.platform_decide_refund(uuid,text,integer,text) from public,anon,authenticated;
grant execute on function public.platform_request_refund(uuid,uuid,integer,text),public.platform_decide_refund(uuid,text,integer,text) to authenticated;

-- Service-only settlement. Requires a provider event never processed before; no HTTP route in this lot calls it.
create function public.platform_settle_refund(p_id uuid,p_event_id text,p_event_type text,p_session_id text,p_provider_reference text,p_provider_status text,p_amount_cents integer,p_currency text) returns boolean language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
declare row public.platform_refund_requests; pay public.payments;
begin
 if p_id is null or p_event_id is null or char_length(p_event_id) not between 1 and 255 or p_event_type not in ('charge.refunded','refund.updated') or p_session_id is null or char_length(p_session_id) not between 1 and 255
  or p_provider_reference is null or char_length(p_provider_reference) not between 1 and 255 or p_provider_status is null or p_amount_cents is null or p_amount_cents<1 or p_currency is distinct from 'eur' then raise invalid_parameter_value; end if;
 if exists(select 1 from public.stripe_events where id=p_event_id) then return false; end if;
 -- An event name proves nothing: the provider result, the payment row, session, currency and amount are all checked.
 if p_provider_status<>'succeeded' then raise exception 'Refund not succeeded at provider' using errcode='P0001'; end if;
 select p.* into pay from public.payments p join public.platform_refund_requests r on r.payment_id=p.id where r.id=p_id for update of p;
 if not found or pay.status<>'paid' or pay.session_id<>p_session_id or pay.currency<>p_currency then raise exception 'Refund settlement mismatch' using errcode='P0001'; end if;
 select * into row from public.platform_refund_requests where id=p_id for update;
 if not found or row.status<>'approved' or row.amount_cents<>p_amount_cents or row.currency<>p_currency or p_amount_cents>pay.total_cents then raise exception 'Refund settlement mismatch' using errcode='P0001'; end if;
 insert into public.stripe_events(id,event_type) values(p_event_id,p_event_type) on conflict do nothing;
 if not found then return false; end if;
 update public.platform_refund_requests set status='settled',version=version+1,updated_at=now(),provider_reference=p_provider_reference,settled_event_id=p_event_id,settled_at=now() where id=p_id returning * into row;
 insert into public.platform_ledger_entries(request_id,entry_kind,direction,amount_cents,currency,payment_id,external_event_id,basis)
 values(gen_random_uuid(),'refund_settled','debit',p_amount_cents,p_currency,row.payment_id,p_event_id,jsonb_build_object('refund_request_id',row.id,'provider_reference',p_provider_reference,'provider_status',p_provider_status,'event_type',p_event_type,'session_id',p_session_id));
 insert into public.platform_audit(actor_id,action,target_kind,target_id,details) values(null,'refund_settled','refund_request',row.id::text,jsonb_build_object('event_id',p_event_id,'amount_cents',p_amount_cents,'version',row.version));
 return true;
end; $$;
revoke execute on function public.platform_settle_refund(uuid,text,text,text,text,text,integer,text) from public,anon,authenticated;
grant execute on function public.platform_settle_refund(uuid,text,text,text,text,text,integer,text) to service_role;

create table public.platform_disputes (
 id uuid primary key default gen_random_uuid(), request_id uuid not null unique,
 payment_id uuid not null references public.payments(id), intervention_id uuid not null references public.interventions(id),
 origin text not null check(origin in ('client','artisan','platform')),
 subject text not null check(char_length(subject) between 4 and 160), description text not null check(char_length(description) between 10 and 4000),
 content_fingerprint text not null check(char_length(content_fingerprint)=32),
 status text not null default 'open' check(status in ('open','under_review','resolved','closed')),
 outcome text not null default 'none' check(outcome in ('none','refund_requested','no_refund','other')),
 refund_request_id uuid references public.platform_refund_requests(id),
 version integer not null default 1 check(version between 1 and 2147483647),
 opened_by uuid not null references public.profiles(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 resolved_by uuid references public.profiles(id), resolved_at timestamptz, resolution_note text not null default '' check(char_length(resolution_note)<=2000)
);
create index platform_disputes_page on public.platform_disputes(created_at desc,id desc);
create index platform_disputes_payment on public.platform_disputes(payment_id,status);
alter table public.platform_disputes enable row level security;
revoke all on public.platform_disputes from public,anon,authenticated;
grant select on public.platform_disputes to authenticated;
grant select,insert,update on public.platform_disputes to service_role;
revoke delete,truncate on public.platform_disputes from service_role;
create trigger platform_disputes_no_delete before delete on public.platform_disputes for each row execute function public.platform_deny_mutation();
create policy platform_disputes_read on public.platform_disputes for select to authenticated using(public.has_platform_scope('finance_read'));

create function public.platform_open_dispute(p_request_id uuid,p_payment_id uuid,p_origin text,p_subject text,p_description text) returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
declare pay public.payments; q public.quotes; row public.platform_disputes; subject text; description text; fingerprint text;
begin
 if not public.has_platform_scope('finance_write') then raise insufficient_privilege; end if;
 subject=regexp_replace(p_subject,'^[[:space:]]+|[[:space:]]+$','','g'); description=regexp_replace(p_description,'^[[:space:]]+|[[:space:]]+$','','g');
 if p_request_id is null or p_payment_id is null or p_origin not in ('client','artisan','platform') or subject is null or description is null or char_length(subject) not between 4 and 160 or char_length(description) not between 10 and 4000 then raise invalid_parameter_value; end if;
 select * into pay from public.payments where id=p_payment_id for update;
 if not found then raise no_data_found; end if;
 fingerprint=md5('dispute|'||p_payment_id::text||'|'||p_origin||'|'||subject||'|'||description);
 select * into row from public.platform_disputes where request_id=p_request_id;
 if found then
  if row.content_fingerprint<>fingerprint then raise exception 'Request key content conflict' using errcode='P0001'; end if;
  return jsonb_build_object('dispute',to_jsonb(row),'replayed',true);
 end if;
 select * into q from public.quotes where id=pay.quote_id;
 perform public.consume_action('platform_disputes',20);
 insert into public.platform_disputes(request_id,payment_id,intervention_id,origin,subject,description,content_fingerprint,opened_by) values(p_request_id,p_payment_id,q.intervention_id,p_origin,subject,description,fingerprint,auth.uid()) returning * into row;
 perform public.platform_audit_write('dispute_opened','dispute',row.id::text,jsonb_build_object('payment_id',p_payment_id,'origin',p_origin,'version',row.version));
 return jsonb_build_object('dispute',to_jsonb(row),'replayed',false);
end; $$;
create function public.platform_decide_dispute(p_id uuid,p_action text,p_expected_version integer,p_note text default '',p_outcome text default null,p_refund_request_id uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
declare row public.platform_disputes; note text; next_status text; previous text;
begin
 if not public.has_platform_scope('finance_write') then raise insufficient_privilege; end if;
 note=coalesce(regexp_replace(p_note,'^[[:space:]]+|[[:space:]]+$','','g'),'');
 if p_id is null or p_action not in ('review','resolve','close') or p_expected_version is null or p_expected_version<1 or char_length(note)>2000 then raise invalid_parameter_value; end if;
 if p_action='resolve' and (p_outcome is null or p_outcome not in ('refund_requested','no_refund','other') or char_length(note)<10) then raise invalid_parameter_value; end if;
 if p_action<>'resolve' and (p_outcome is not null or p_refund_request_id is not null) then raise invalid_parameter_value; end if;
 if p_outcome='refund_requested' and p_refund_request_id is null then raise invalid_parameter_value; end if;
 if p_outcome is distinct from 'refund_requested' and p_refund_request_id is not null then raise invalid_parameter_value; end if;
 perform 1 from public.payments p join public.platform_disputes d on d.payment_id=p.id where d.id=p_id for update of p;
 select * into row from public.platform_disputes where id=p_id for update;
 if not found then raise no_data_found; end if;
 if row.version<>p_expected_version or row.version=2147483647 then raise exception 'Dispute revision changed' using errcode='P0001'; end if;
 next_status=case when p_action='review' then 'under_review' when p_action='resolve' then 'resolved' else 'closed' end;
 if not ((row.status='open' and next_status in ('under_review','closed')) or (row.status='under_review' and next_status in ('resolved','closed'))) then raise exception 'Invalid dispute transition' using errcode='P0001'; end if;
 if p_refund_request_id is not null and not exists(select 1 from public.platform_refund_requests r where r.id=p_refund_request_id and r.payment_id=row.payment_id) then raise exception 'Refund request belongs to another payment' using errcode='P0001'; end if;
 perform public.consume_action('platform_disputes',20);
 previous=row.status;
 update public.platform_disputes set status=next_status,version=version+1,updated_at=now(),
  outcome=case when p_action='resolve' then p_outcome else outcome end,refund_request_id=case when p_action='resolve' then p_refund_request_id else refund_request_id end,
  resolved_by=case when next_status in ('resolved','closed') then auth.uid() else resolved_by end,resolved_at=case when next_status in ('resolved','closed') then now() else resolved_at end,
  resolution_note=case when next_status in ('resolved','closed') then note else resolution_note end where id=p_id returning * into row;
 perform public.platform_audit_write('dispute_'||next_status,'dispute',row.id::text,jsonb_build_object('from',previous,'to',next_status,'version',row.version,'outcome',row.outcome,'refund_request_id',row.refund_request_id,'note',note));
 return jsonb_build_object('dispute',to_jsonb(row));
end; $$;
revoke execute on function public.platform_open_dispute(uuid,uuid,text,text,text),public.platform_decide_dispute(uuid,text,integer,text,text,uuid) from public,anon,authenticated;
grant execute on function public.platform_open_dispute(uuid,uuid,text,text,text),public.platform_decide_dispute(uuid,text,integer,text,text,uuid) to authenticated;

-- Billing details are never inferred from an intervention address or a requester name.
create table public.platform_billing_contacts (
 subject_kind text not null check(subject_kind in ('profile','organization')), subject_id uuid not null,
 legal_name text not null check(char_length(legal_name) between 1 and 160), address text not null check(char_length(address) between 5 and 500),
 siret text check(siret is null or siret ~ '^[0-9]{14}$'), vat_number text check(vat_number is null or vat_number ~ '^[A-Z]{2}[0-9A-Z]{2,13}$'),
 version integer not null default 1 check(version between 1 and 2147483647), updated_by uuid not null references public.profiles(id), updated_at timestamptz not null default now(),
 primary key(subject_kind,subject_id)
);
alter table public.platform_billing_contacts enable row level security;
revoke all on public.platform_billing_contacts from public,anon,authenticated;
grant select on public.platform_billing_contacts to authenticated;
grant select,insert,update on public.platform_billing_contacts to service_role;
revoke delete,truncate on public.platform_billing_contacts from service_role;
create trigger platform_billing_contacts_no_delete before delete on public.platform_billing_contacts for each row execute function public.platform_deny_mutation();
create policy platform_billing_contacts_read on public.platform_billing_contacts for select to authenticated using(public.has_platform_scope('finance_read'));
create function public.platform_set_billing_contact(p_subject_kind text,p_subject_id uuid,p_legal_name text,p_address text,p_siret text default null,p_vat_number text default null,p_expected_version integer default null) returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
declare current public.platform_billing_contacts; row public.platform_billing_contacts; legal_name text; address text;
begin
 if not public.has_platform_scope('finance_write') then raise insufficient_privilege; end if;
 legal_name=regexp_replace(p_legal_name,'^[[:space:]]+|[[:space:]]+$','','g'); address=regexp_replace(p_address,'^[[:space:]]+|[[:space:]]+$','','g');
 if p_subject_kind not in ('profile','organization') or p_subject_id is null or legal_name is null or address is null or char_length(legal_name) not between 1 and 160 or char_length(address) not between 5 and 500
  or (p_siret is not null and p_siret !~ '^[0-9]{14}$') or (p_vat_number is not null and p_vat_number !~ '^[A-Z]{2}[0-9A-Z]{2,13}$') or (p_expected_version is not null and p_expected_version<1) then raise invalid_parameter_value; end if;
 if p_subject_kind='profile' and not exists(select 1 from public.profiles where id=p_subject_id) then raise no_data_found; end if;
 if p_subject_kind='organization' and not exists(select 1 from public.organizations where id=p_subject_id) then raise no_data_found; end if;
 perform public.consume_action('platform_billing',20);
 select * into current from public.platform_billing_contacts where subject_kind=p_subject_kind and subject_id=p_subject_id for update;
 if found then
  if p_expected_version is null or p_expected_version<>current.version or current.version=2147483647 then raise exception 'Billing contact revision changed' using errcode='P0001'; end if;
  update public.platform_billing_contacts set legal_name=legal_name,address=address,siret=p_siret,vat_number=p_vat_number,version=version+1,updated_by=auth.uid(),updated_at=now() where subject_kind=p_subject_kind and subject_id=p_subject_id returning * into row;
 else
  if p_expected_version is not null then raise exception 'Billing contact revision changed' using errcode='P0001'; end if;
  insert into public.platform_billing_contacts(subject_kind,subject_id,legal_name,address,siret,vat_number,updated_by) values(p_subject_kind,p_subject_id,legal_name,address,p_siret,p_vat_number,auth.uid()) returning * into row;
 end if;
 perform public.platform_audit_write('billing_contact_updated','invoice',p_subject_kind||':'||p_subject_id::text,jsonb_build_object('version',row.version,'previous',case when current.subject_id is null then null else jsonb_build_object('legal_name',current.legal_name,'address',current.address,'siret',current.siret,'vat_number',current.vat_number) end));
 return jsonb_build_object('billing_contact',to_jsonb(row));
end; $$;
revoke execute on function public.platform_set_billing_contact(text,uuid,text,text,text,text,integer) from public,anon,authenticated;
grant execute on function public.platform_set_billing_contact(text,uuid,text,text,text,text,integer) to authenticated;

create table public.platform_invoice_counters (issuer_key text not null, kind text not null check(kind in ('invoice','credit_note')), year integer not null, last_number integer not null default 0, primary key(issuer_key,kind,year));
alter table public.platform_invoice_counters enable row level security;
revoke all on public.platform_invoice_counters from public,anon,authenticated;
grant all on public.platform_invoice_counters to service_role;
create table public.platform_invoices (
 id uuid primary key default gen_random_uuid(), request_id uuid not null unique,
 kind text not null check(kind in ('invoice','credit_note')), basis text not null check(basis in ('service','platform_commission')),
 number text not null check(char_length(number) between 1 and 40), issuer_key text not null check(char_length(issuer_key) between 1 and 80),
 issuer jsonb not null check(jsonb_typeof(issuer)='object'), recipient jsonb not null check(jsonb_typeof(recipient)='object'),
 payment_id uuid not null references public.payments(id), quote_id uuid not null references public.quotes(id), intervention_id uuid not null references public.interventions(id),
 related_invoice_id uuid references public.platform_invoices(id),
 lines jsonb not null check(jsonb_typeof(lines)='array'), subtotal_cents integer not null check(subtotal_cents>=0), tax_rate numeric not null check(tax_rate in (0,5.5,10,20)),
 tax_cents integer not null check(tax_cents>=0), total_cents integer not null check(total_cents>0), currency text not null check(currency='eur'),
 reason text not null default '' check(char_length(reason)<=1000), content_fingerprint text not null check(char_length(content_fingerprint)=32),
 issued_by uuid not null references public.profiles(id), issued_at timestamptz not null default now(),
 check((kind='invoice' and related_invoice_id is null) or (kind='credit_note' and related_invoice_id is not null)),
 check(subtotal_cents+tax_cents=total_cents), unique(issuer_key,number)
);
create unique index platform_invoices_one_per_payment on public.platform_invoices(payment_id,basis) where kind='invoice';
create index platform_invoices_page on public.platform_invoices(issued_at desc,id desc);
create index platform_invoices_related on public.platform_invoices(related_invoice_id);
alter table public.platform_invoices enable row level security;
revoke all on public.platform_invoices from public,anon,authenticated;
grant select on public.platform_invoices to authenticated;
grant select,insert on public.platform_invoices to service_role;
revoke update,delete,truncate on public.platform_invoices from service_role;
create trigger platform_invoices_immutable before update or delete on public.platform_invoices for each row execute function public.platform_deny_mutation();
create trigger platform_invoices_no_truncate before truncate on public.platform_invoices for each statement execute function public.platform_deny_mutation();
create policy platform_invoices_read on public.platform_invoices for select to authenticated using(public.has_platform_scope('finance_read'));

-- Readiness never substitutes data: it lists exactly what real condition is missing.
create function public.platform_invoice_readiness(p_basis text,p_payment_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
#variable_conflict use_variable
declare pay public.payments; q public.quotes; job public.interventions; artisan public.artisan_profiles; artisan_account public.profiles; billing public.platform_billing_contacts;
 missing text[]='{}'; issuer jsonb; recipient jsonb; lines jsonb; subtotal integer; tax_rate numeric; tax integer; total integer; setting public.platform_settings; fee public.platform_ledger_entries; org uuid; issuer_key text; service_address text;
begin
 if not public.has_platform_scope('finance_read') then raise insufficient_privilege; end if;
 if p_basis not in ('service','platform_commission') or p_payment_id is null then raise invalid_parameter_value; end if;
 select * into pay from public.payments where id=p_payment_id;
 if not found then raise no_data_found; end if;
 if pay.status<>'paid' then missing=array_append(missing,'payment_not_settled'); end if;
 select * into q from public.quotes where id=pay.quote_id;
 if q.status is distinct from 'accepted' then missing=array_append(missing,'quote_not_accepted'); end if;
 select * into job from public.interventions where id=q.intervention_id;
 select * into artisan from public.artisan_profiles where user_id=q.artisan_id;
 select * into artisan_account from public.profiles where id=q.artisan_id;
 if job.site_id is not null then select s.organization_id into org from public.sites s where s.id=job.site_id; end if;
 service_address=job.address||', '||job.postal_code||' '||job.city;
 if exists(select 1 from public.platform_invoices where payment_id=p_payment_id and basis=p_basis and kind='invoice') then missing=array_append(missing,'already_issued'); end if;
 if p_basis='service' then
  if artisan.user_id is null or char_length(trim(artisan.company_name))<1 then missing=array_append(missing,'artisan_company_name'); end if;
  if artisan.user_id is null or artisan.siret !~ '^[0-9]{14}$' then missing=array_append(missing,'artisan_siret'); end if;
  if artisan.user_id is null or char_length(trim(artisan.legal_status))<1 then missing=array_append(missing,'artisan_legal_status'); end if;
  if artisan.user_id is null or char_length(trim(artisan.address))<5 then missing=array_append(missing,'artisan_address'); end if;
  issuer=jsonb_build_object('legal_name',artisan.company_name,'siret',artisan.siret,'legal_status',artisan.legal_status,'address',artisan.address,'vat_number',null,'profile_id',q.artisan_id);
  issuer_key='artisan:'||q.artisan_id::text;
  -- Authoritative billing contact only: organization of the site when present, otherwise the requester profile.
  if org is not null then select * into billing from public.platform_billing_contacts where subject_kind='organization' and subject_id=org; end if;
  if billing.subject_id is null then select * into billing from public.platform_billing_contacts where subject_kind='profile' and subject_id=job.client_id; end if;
  if billing.subject_id is null then missing=array_append(missing,'billing_contact'); end if;
  recipient=case when billing.subject_id is null then null else jsonb_build_object('name',billing.legal_name,'address',billing.address,'siret',billing.siret,'vat_number',billing.vat_number,'subject_kind',billing.subject_kind,'subject_id',billing.subject_id,'billing_version',billing.version) end;
  lines=q.lines; subtotal=q.subtotal_cents; tax_rate=q.tax_rate; tax=q.tax_cents; total=q.total_cents;
 else
  select * into setting from public.platform_settings where key='invoice_issuer';
  if setting.key is null then missing=array_append(missing,'platform_issuer'); end if;
  if setting.key is null or setting.value->>'commission_vat_rate' is null then missing=array_append(missing,'platform_commission_vat_rate'); end if;
  -- Only a provider-confirmed withheld commission can be invoiced; the estimate never is.
  select * into fee from public.platform_ledger_entries where payment_id=p_payment_id and entry_kind='commission_withheld';
  if fee.id is null then missing=array_append(missing,'commission_not_confirmed'); end if;
  if artisan.user_id is null or char_length(trim(artisan.company_name))<1 or artisan.siret !~ '^[0-9]{14}$' or char_length(trim(artisan.address))<5 then missing=array_append(missing,'artisan_identity'); end if;
  issuer=case when setting.key is null then null else jsonb_build_object('legal_name',setting.value->>'legal_name','siret',setting.value->>'siret','legal_status',null,'address',setting.value->>'address','vat_number',setting.value->'vat_number') end;
  issuer_key='platform';
  recipient=jsonb_build_object('name',coalesce(nullif(artisan.company_name,''),artisan_account.full_name),'siret',artisan.siret,'address',artisan.address,'organization',null,'profile_id',q.artisan_id);
  -- The withheld amount is what was actually taken (tax included); VAT is extracted from within, never added on top.
  total=fee.amount_cents; tax_rate=(setting.value->>'commission_vat_rate')::numeric;
  tax=case when total is null or tax_rate is null then null else total-round(total/(1+tax_rate/100)) end; subtotal=total-tax;
  lines=jsonb_build_array(jsonb_build_object('label','Commission de mise en relation — devis '||upper(left(q.id::text,8)),'quantity',1,'unit_price_cents',subtotal));
 end if;
 return jsonb_build_object('ready',cardinality(missing)=0,'missing',to_jsonb(missing),'preview',jsonb_build_object('basis',p_basis,'issuer_key',issuer_key,'issuer',issuer,'recipient',recipient,'lines',lines,'subtotal_cents',subtotal,'tax_rate',tax_rate,'tax_cents',tax,'total_cents',total,'currency',pay.currency,'payment_id',pay.id,'quote_id',q.id,'intervention_id',job.id,'service_address',service_address,'ledger_entry_id',fee.id));
end; $$;
create function public.platform_next_invoice_number(p_issuer_key text,p_kind text) returns text language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
declare y integer=extract(year from now())::integer; n integer;
begin
 insert into public.platform_invoice_counters(issuer_key,kind,year,last_number) values(p_issuer_key,p_kind,y,1)
 on conflict (issuer_key,kind,year) do update set last_number=public.platform_invoice_counters.last_number+1 returning last_number into n;
 return case when p_kind='invoice' then 'F' else 'A' end||y::text||'-'||lpad(n::text,6,'0');
end; $$;
revoke execute on function public.platform_next_invoice_number(text,text) from public,anon,authenticated;
create function public.platform_issue_invoice(p_request_id uuid,p_basis text,p_payment_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
declare readiness jsonb; preview jsonb; row public.platform_invoices; fingerprint text;
begin
 if not public.has_platform_scope('finance_write') then raise insufficient_privilege; end if;
 if p_request_id is null or p_basis not in ('service','platform_commission') or p_payment_id is null then raise invalid_parameter_value; end if;
 fingerprint=md5('invoice|'||p_basis||'|'||p_payment_id::text);
 select * into row from public.platform_invoices where request_id=p_request_id;
 if found then
  if row.content_fingerprint<>fingerprint then raise exception 'Request key content conflict' using errcode='P0001'; end if;
  return jsonb_build_object('invoice',to_jsonb(row),'replayed',true);
 end if;
 perform 1 from public.payments where id=p_payment_id for update;
 readiness=public.platform_invoice_readiness(p_basis,p_payment_id);
 if not (readiness->>'ready')::boolean then raise exception 'Invoice conditions are not met: %',readiness->>'missing' using errcode='P0001'; end if;
 perform public.consume_action('platform_invoices',20);
 preview=readiness->'preview';
 insert into public.platform_invoices(request_id,kind,basis,number,issuer_key,issuer,recipient,payment_id,quote_id,intervention_id,lines,subtotal_cents,tax_rate,tax_cents,total_cents,currency,content_fingerprint,issued_by)
 values(p_request_id,'invoice',p_basis,public.platform_next_invoice_number(preview->>'issuer_key','invoice'),preview->>'issuer_key',preview->'issuer',preview->'recipient',p_payment_id,(preview->>'quote_id')::uuid,(preview->>'intervention_id')::uuid,
  preview->'lines',(preview->>'subtotal_cents')::integer,(preview->>'tax_rate')::numeric,(preview->>'tax_cents')::integer,(preview->>'total_cents')::integer,preview->>'currency',fingerprint,auth.uid()) returning * into row;
 perform public.platform_audit_write('invoice_issued','invoice',row.id::text,jsonb_build_object('number',row.number,'basis',row.basis,'payment_id',row.payment_id,'total_cents',row.total_cents,'currency',row.currency));
 return jsonb_build_object('invoice',to_jsonb(row),'replayed',false);
end; $$;
create function public.platform_issue_credit_note(p_request_id uuid,p_invoice_id uuid,p_amount_cents integer,p_reason text) returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
declare invoice public.platform_invoices; row public.platform_invoices; reason text; credited bigint; tax integer; fingerprint text;
begin
 if not public.has_platform_scope('finance_write') then raise insufficient_privilege; end if;
 reason=regexp_replace(p_reason,'^[[:space:]]+|[[:space:]]+$','','g');
 if p_request_id is null or p_invoice_id is null or p_amount_cents is null or p_amount_cents<1 or reason is null or char_length(reason) not between 10 and 1000 then raise invalid_parameter_value; end if;
 fingerprint=md5('credit_note|'||p_invoice_id::text||'|'||p_amount_cents::text||'|'||reason);
 select * into row from public.platform_invoices where request_id=p_request_id;
 if found then
  if row.content_fingerprint<>fingerprint then raise exception 'Request key content conflict' using errcode='P0001'; end if;
  return jsonb_build_object('invoice',to_jsonb(row),'replayed',true);
 end if;
 select * into invoice from public.platform_invoices where id=p_invoice_id;
 if not found then raise no_data_found; end if;
 if invoice.kind<>'invoice' then raise exception 'A credit note references an invoice' using errcode='P0001'; end if;
 -- Serialize credit notes of one invoice on its payment row.
 perform 1 from public.payments where id=invoice.payment_id for update;
 select coalesce(sum(total_cents),0) into credited from public.platform_invoices where related_invoice_id=p_invoice_id and kind='credit_note';
 if credited+p_amount_cents>invoice.total_cents then raise exception 'Credit notes exceed the invoice total' using errcode='P0001'; end if;
 perform public.consume_action('platform_invoices',20);
 tax=round(p_amount_cents::numeric*invoice.tax_cents/invoice.total_cents);
 insert into public.platform_invoices(request_id,kind,basis,number,issuer_key,issuer,recipient,payment_id,quote_id,intervention_id,related_invoice_id,lines,subtotal_cents,tax_rate,tax_cents,total_cents,currency,reason,content_fingerprint,issued_by)
 values(p_request_id,'credit_note',invoice.basis,public.platform_next_invoice_number(invoice.issuer_key,'credit_note'),invoice.issuer_key,invoice.issuer,invoice.recipient,invoice.payment_id,invoice.quote_id,invoice.intervention_id,p_invoice_id,
  jsonb_build_array(jsonb_build_object('label','Avoir sur facture '||invoice.number,'quantity',1,'unit_price_cents',p_amount_cents-tax)),p_amount_cents-tax,invoice.tax_rate,tax,p_amount_cents,invoice.currency,reason,fingerprint,auth.uid()) returning * into row;
 perform public.platform_audit_write('credit_note_issued','invoice',row.id::text,jsonb_build_object('number',row.number,'related_invoice_id',p_invoice_id,'related_number',invoice.number,'total_cents',row.total_cents,'currency',row.currency,'reason',reason));
 return jsonb_build_object('invoice',to_jsonb(row),'replayed',false);
end; $$;
revoke execute on function public.platform_invoice_readiness(text,uuid),public.platform_issue_invoice(uuid,text,uuid),public.platform_issue_credit_note(uuid,uuid,integer,text) from public,anon,authenticated;
grant execute on function public.platform_invoice_readiness(text,uuid),public.platform_issue_invoice(uuid,text,uuid),public.platform_issue_credit_note(uuid,uuid,integer,text) to authenticated;

create function public.platform_finance_report() returns jsonb language plpgsql stable security definer set search_path='' as $$
#variable_conflict use_variable
begin
 if not public.has_platform_scope('finance_read') then raise insufficient_privilege; end if;
 return jsonb_build_object(
  'payments',jsonb_build_object('paid_count',(select count(*) from public.payments where status='paid'),'paid_cents',(select coalesce(sum(total_cents),0) from public.payments where status='paid'),
   'pending_count',(select count(*) from public.payments where status='pending'),'failed_count',(select count(*) from public.payments where status='failed'),'failed_attempts',(select count(*) from public.payment_attempts where status='failed')),
  'ledger',jsonb_build_object('settled_count',(select count(*) from public.platform_ledger_entries where entry_kind='payment_settled'),'settled_cents',(select coalesce(sum(amount_cents),0) from public.platform_ledger_entries where entry_kind='payment_settled'),
   'missing_settlement',(select count(*) from public.payments p where p.status='paid' and not exists(select 1 from public.platform_ledger_entries l where l.payment_id=p.id and l.entry_kind='payment_settled')),
   'amount_mismatches',(select count(*) from public.platform_ledger_entries l join public.payments p on p.id=l.payment_id where l.entry_kind='payment_settled' and (l.amount_cents<>p.total_cents or l.currency<>p.currency)),
   'commission_estimated_count',(select count(*) from public.platform_ledger_entries where entry_kind='commission_estimated'),'commission_estimated_cents',(select coalesce(sum(amount_cents),0) from public.platform_ledger_entries where entry_kind='commission_estimated'),
   'commission_withheld_count',(select count(*) from public.platform_ledger_entries where entry_kind='commission_withheld'),'commission_withheld_cents',(select coalesce(sum(amount_cents),0) from public.platform_ledger_entries where entry_kind='commission_withheld'),
   'refund_settled_count',(select count(*) from public.platform_ledger_entries where entry_kind='refund_settled'),'refund_settled_cents',(select coalesce(sum(amount_cents),0) from public.platform_ledger_entries where entry_kind='refund_settled')),
  'refund_requests',(select coalesce(jsonb_object_agg(status,jsonb_build_object('count',c,'cents',s)),'{}'::jsonb) from (select status,count(*) c,sum(amount_cents) s from public.platform_refund_requests group by status) x),
  'disputes',(select coalesce(jsonb_object_agg(status,c),'{}'::jsonb) from (select status,count(*) c from public.platform_disputes group by status) x),
  'invoices',jsonb_build_object('invoice_count',(select count(*) from public.platform_invoices where kind='invoice'),'credit_note_count',(select count(*) from public.platform_invoices where kind='credit_note')),
  'commission_setting',(select case when key is null then null else jsonb_build_object('bps',(value->>'bps')::integer,'version',version,'updated_at',updated_at) end from public.platform_commission_setting()),
  'currency','eur','generated_at',now());
end; $$;
revoke execute on function public.platform_finance_report() from public,anon,authenticated;
grant execute on function public.platform_finance_report() to authenticated;

-- Review moderation: reviews are never deleted or edited; visibility is a separate, audited state.
create table public.platform_review_moderation (
 review_id uuid primary key references public.reviews(id), state text not null default 'visible' check(state in ('visible','hidden')),
 version integer not null default 1 check(version between 1 and 2147483647), note text not null default '' check(char_length(note)<=1000),
 updated_by uuid not null references public.profiles(id), updated_at timestamptz not null default now()
);
create table public.platform_review_contestations (
 id uuid primary key default gen_random_uuid(), request_id uuid not null unique, review_id uuid not null references public.reviews(id),
 contested_by uuid not null references public.profiles(id), reason text not null check(char_length(reason) between 10 and 2000),
 status text not null default 'open' check(status in ('open','upheld','dismissed')), version integer not null default 1 check(version between 1 and 2147483647),
 created_at timestamptz not null default now(), decided_by uuid references public.profiles(id), decided_at timestamptz, decision_note text not null default '' check(char_length(decision_note)<=1000)
);
create unique index platform_review_contestation_open on public.platform_review_contestations(review_id) where status='open';
create index platform_review_contestations_page on public.platform_review_contestations(created_at desc,id desc);
alter table public.platform_review_moderation enable row level security;
alter table public.platform_review_contestations enable row level security;
revoke all on public.platform_review_moderation,public.platform_review_contestations from public,anon,authenticated;
grant select on public.platform_review_moderation,public.platform_review_contestations to authenticated;
grant select,insert,update on public.platform_review_moderation,public.platform_review_contestations to service_role;
revoke delete,truncate on public.platform_review_moderation,public.platform_review_contestations from service_role;
create trigger platform_review_moderation_no_delete before delete on public.platform_review_moderation for each row execute function public.platform_deny_mutation();
create trigger platform_review_contestations_no_delete before delete on public.platform_review_contestations for each row execute function public.platform_deny_mutation();
create function public.review_visible(p_review_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select not exists(select 1 from public.platform_review_moderation m where m.review_id=p_review_id and m.state='hidden');
$$;
revoke execute on function public.review_visible(uuid) from public,anon,authenticated;
grant execute on function public.review_visible(uuid) to authenticated;
-- A restrictive policy grants nothing: the moderator scope needs its own permissive read.
create policy reviews_moderator_read on public.reviews for select to authenticated using(public.has_platform_scope('reviews_moderate'));
create policy reviews_moderation_visibility on public.reviews as restrictive for select to authenticated using(public.review_visible(id) or author_id=auth.uid() or public.has_platform_scope('reviews_moderate'));
create policy platform_review_moderation_read on public.platform_review_moderation for select to authenticated using(public.has_platform_scope('reviews_moderate') or exists(select 1 from public.reviews r where r.id=review_id and (r.author_id=auth.uid() or public.can_access_intervention(r.intervention_id))));
create policy platform_review_contestations_read on public.platform_review_contestations for select to authenticated using(contested_by=auth.uid() or public.has_platform_scope('reviews_moderate'));

create function public.platform_moderate_review(p_review_id uuid,p_action text,p_note text default '',p_expected_version integer default null) returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
declare review public.reviews; row public.platform_review_moderation; note text; next_state text;
begin
 if not public.has_platform_scope('reviews_moderate') then raise insufficient_privilege; end if;
 note=coalesce(regexp_replace(p_note,'^[[:space:]]+|[[:space:]]+$','','g'),'');
 if p_review_id is null or p_action not in ('hide','restore') or char_length(note)>1000 or (p_expected_version is not null and p_expected_version<1) then raise invalid_parameter_value; end if;
 if p_action='hide' and char_length(note)<10 then raise invalid_parameter_value; end if;
 select * into review from public.reviews where id=p_review_id for update;
 if not found then raise no_data_found; end if;
 select * into row from public.platform_review_moderation where review_id=p_review_id for update;
 next_state=case when p_action='hide' then 'hidden' else 'visible' end;
 if found then
  if p_expected_version is null or p_expected_version<>row.version or row.version=2147483647 then raise exception 'Moderation revision changed' using errcode='P0001'; end if;
  if row.state=next_state then raise exception 'Review already in that state' using errcode='P0001'; end if;
  perform public.consume_action('platform_reviews',30);
  update public.platform_review_moderation set state=next_state,version=version+1,note=note,updated_by=auth.uid(),updated_at=now() where review_id=p_review_id returning * into row;
 else
  if p_expected_version is not null then raise exception 'Moderation revision changed' using errcode='P0001'; end if;
  if next_state='visible' then raise exception 'Review already in that state' using errcode='P0001'; end if;
  perform public.consume_action('platform_reviews',30);
  insert into public.platform_review_moderation(review_id,state,note,updated_by) values(p_review_id,next_state,note,auth.uid()) returning * into row;
 end if;
 perform public.platform_audit_write(case when next_state='hidden' then 'review_hidden' else 'review_restored' end,'review',p_review_id::text,jsonb_build_object('version',row.version,'note',note));
 return jsonb_build_object('moderation',to_jsonb(row));
end; $$;
create function public.platform_contest_review(p_request_id uuid,p_review_id uuid,p_reason text) returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
declare review public.reviews; row public.platform_review_contestations; reason text;
begin
 if auth.uid() is null then raise insufficient_privilege; end if;
 reason=regexp_replace(p_reason,'^[[:space:]]+|[[:space:]]+$','','g');
 if p_request_id is null or p_review_id is null or reason is null or char_length(reason) not between 10 and 2000 then raise invalid_parameter_value; end if;
 select * into review from public.reviews where id=p_review_id for update;
 if not found or not exists(select 1 from public.interventions i where i.id=review.intervention_id and i.artisan_id=auth.uid()) then raise insufficient_privilege; end if;
 select * into row from public.platform_review_contestations where request_id=p_request_id;
 if found then
  if row.contested_by<>auth.uid() or row.review_id<>p_review_id or row.reason<>reason then raise exception 'Request key content conflict' using errcode='P0001'; end if;
  return jsonb_build_object('contestation',to_jsonb(row),'replayed',true);
 end if;
 perform public.consume_action('platform_contest',5);
 insert into public.platform_review_contestations(request_id,review_id,contested_by,reason) values(p_request_id,p_review_id,auth.uid(),reason) returning * into row;
 perform public.platform_audit_write('review_contested','review',p_review_id::text,jsonb_build_object('contestation_id',row.id));
 return jsonb_build_object('contestation',to_jsonb(row),'replayed',false);
end; $$;
create function public.platform_decide_contestation(p_id uuid,p_decision text,p_note text,p_expected_version integer) returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
declare row public.platform_review_contestations; moderation public.platform_review_moderation; note text;
begin
 if not public.has_platform_scope('reviews_moderate') then raise insufficient_privilege; end if;
 note=regexp_replace(p_note,'^[[:space:]]+|[[:space:]]+$','','g');
 if p_id is null or p_decision not in ('upheld','dismissed') or note is null or char_length(note) not between 10 and 1000 or p_expected_version is null or p_expected_version<1 then raise invalid_parameter_value; end if;
 perform 1 from public.reviews r join public.platform_review_contestations c on c.review_id=r.id where c.id=p_id for update of r;
 select * into row from public.platform_review_contestations where id=p_id for update;
 if not found then raise no_data_found; end if;
 if row.version<>p_expected_version or row.version=2147483647 then raise exception 'Contestation revision changed' using errcode='P0001'; end if;
 if row.status<>'open' then raise exception 'Contestation already decided' using errcode='P0001'; end if;
 perform public.consume_action('platform_reviews',30);
 update public.platform_review_contestations set status=p_decision,version=version+1,decided_by=auth.uid(),decided_at=now(),decision_note=note where id=p_id returning * into row;
 if p_decision='upheld' then
  select * into moderation from public.platform_review_moderation where review_id=row.review_id for update;
  if found then
   if moderation.state<>'hidden' then update public.platform_review_moderation set state='hidden',version=version+1,note=note,updated_by=auth.uid(),updated_at=now() where review_id=row.review_id returning * into moderation; end if;
  else
   insert into public.platform_review_moderation(review_id,state,note,updated_by) values(row.review_id,'hidden',note,auth.uid()) returning * into moderation;
  end if;
 end if;
 perform public.platform_audit_write('contestation_decided','review',row.review_id::text,jsonb_build_object('contestation_id',row.id,'decision',p_decision,'version',row.version,'note',note));
 return jsonb_build_object('contestation',to_jsonb(row),'moderation',case when moderation.review_id is null then null else to_jsonb(moderation) end);
end; $$;
revoke execute on function public.platform_moderate_review(uuid,text,text,integer),public.platform_contest_review(uuid,uuid,text),public.platform_decide_contestation(uuid,text,text,integer),public.review_visible(uuid) from public,anon,authenticated;
grant execute on function public.platform_moderate_review(uuid,text,text,integer),public.platform_contest_review(uuid,uuid,text),public.platform_decide_contestation(uuid,text,text,integer),public.review_visible(uuid) to authenticated;
-- Hidden reviews leave every aggregate, including this SECURITY DEFINER read model from 007 (same signature).
alter function public.artisan_performance(timestamptz,timestamptz,timestamptz,timestamptz) rename to artisan_performance_before_review_moderation;
revoke execute on function public.artisan_performance_before_review_moderation(timestamptz,timestamptz,timestamptz,timestamptz) from public,anon,authenticated;
create function public.artisan_performance(p_current_start timestamptz,p_current_end timestamptz,p_previous_start timestamptz,p_previous_end timestamptz) returns jsonb language plpgsql stable security definer set search_path='' as $$
#variable_conflict use_variable
declare base jsonb; review_count bigint; review_average numeric;
begin
 base=public.artisan_performance_before_review_moderation(p_current_start,p_current_end,p_previous_start,p_previous_end);
 select count(*),round(avg(r.rating),1) into review_count,review_average from public.reviews r join public.interventions i on i.id=r.intervention_id where i.artisan_id=auth.uid() and public.review_visible(r.id);
 return jsonb_set(jsonb_set(base,'{rating}',jsonb_build_object('average',review_average,'count',review_count,'period','all_time')),'{basis,rating}',to_jsonb('Moyenne des avis visibles liés aux interventions attribuées à cet artisan ; arrondie à une décimale. Les avis masqués par la modération sont exclus.'::text));
end; $$;
revoke execute on function public.artisan_performance(timestamptz,timestamptz,timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function public.artisan_performance(timestamptz,timestamptz,timestamptz,timestamptz) to authenticated;
grant all on public.platform_settings,public.platform_invoice_counters to service_role;
commit;

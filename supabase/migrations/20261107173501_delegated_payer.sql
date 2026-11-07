begin;
-- An explicit payment mandate never grants dossier/document reading rights.
create table public.intervention_payers(intervention_id uuid primary key references public.interventions(id),site_id uuid not null references public.sites(id),payer_id uuid references public.profiles(id),version integer not null check(version>0),updated_by uuid not null references public.profiles(id),updated_at timestamptz not null default clock_timestamp());
create index intervention_payers_actor on public.intervention_payers(payer_id)where payer_id is not null;
create table public.intervention_payer_commands(command_id uuid primary key,intervention_id uuid not null references public.interventions(id),actor_id uuid not null references public.profiles(id),payer_id uuid references public.profiles(id),expected_version integer,result jsonb not null,created_at timestamptz not null default clock_timestamp());
create table public.platform_checkout_payer_bindings(checkout_id uuid primary key references public.platform_checkouts(id),payer_version integer not null check(payer_version>0));
alter table public.intervention_payers enable row level security;
alter table public.intervention_payer_commands enable row level security;
alter table public.platform_checkout_payer_bindings enable row level security;
revoke all on public.intervention_payers,public.intervention_payer_commands,public.platform_checkout_payer_bindings from public,anon,authenticated,service_role;

create function public.delegated_payer_member(p_job uuid,p_actor uuid)returns boolean language sql stable security definer set search_path=''as $$
 select exists(select 1 from public.interventions i join public.sites s on s.id=i.site_id
 join public.organizations o on o.id=s.organization_id join public.organization_members m on m.organization_id=o.id and m.user_id=p_actor
 left join public.organization_member_site_scopes sc on sc.organization_id=m.organization_id and sc.user_id=m.user_id
 where i.id=p_job and (o.owner_id=p_actor or coalesce(sc.scope,'all')='all' or exists(select 1 from public.organization_member_site_grants g where g.organization_id=m.organization_id and g.user_id=m.user_id and g.site_id=s.id)));
$$;
revoke all on function public.delegated_payer_member(uuid,uuid)from public,anon,authenticated,service_role;
-- Access loss ends the mandate permanently; rejoining requires a new owner command.
create table public.intervention_payer_events(intervention_id uuid not null,version integer not null,record jsonb not null,actor_id uuid,created_at timestamptz not null default clock_timestamp(),primary key(intervention_id,version));
alter table public.intervention_payer_events enable row level security;
revoke all on public.intervention_payer_events from public,anon,authenticated,service_role;
create function public.audit_intervention_payer()returns trigger language plpgsql security definer set search_path=''as $$begin
 insert into public.intervention_payer_events(intervention_id,version,record,actor_id)values(new.intervention_id,new.version,to_jsonb(new),auth.uid());return new;end;$$;
revoke all on function public.audit_intervention_payer()from public,anon,authenticated,service_role;
create trigger intervention_payer_audit after insert or update on public.intervention_payers for each row execute function public.audit_intervention_payer();
create function public.revoke_inaccessible_payer()returns trigger language plpgsql security definer set search_path=''as $$
declare org uuid;person uuid;
begin
 if tg_op='DELETE'then org=old.organization_id;person=old.user_id;else org=new.organization_id;person=new.user_id;end if;
 update public.intervention_payers d set payer_id=null,version=d.version+1,updated_by=coalesce(auth.uid(),d.updated_by),updated_at=clock_timestamp()
 where d.payer_id=person and exists(select 1 from public.interventions i join public.sites s on s.id=i.site_id where i.id=d.intervention_id and s.organization_id=org)
 and not public.delegated_payer_member(d.intervention_id,person);
 return null;
end;$$;
revoke all on function public.revoke_inaccessible_payer()from public,anon,authenticated,service_role;
create trigger delegated_payer_member_removed after delete on public.organization_members for each row execute function public.revoke_inaccessible_payer();
create trigger delegated_payer_scope_changed after insert or update on public.organization_member_site_scopes for each row execute function public.revoke_inaccessible_payer();
create trigger delegated_payer_grant_removed after delete or update on public.organization_member_site_grants for each row execute function public.revoke_inaccessible_payer();

create function public.revoke_moved_intervention_payer()returns trigger language plpgsql security definer set search_path=''as $$begin
 if new.site_id is distinct from old.site_id then update public.intervention_payers set payer_id=null,version=version+1,updated_by=coalesce(auth.uid(),updated_by),updated_at=clock_timestamp()where intervention_id=new.id and payer_id is not null;end if;
 return null;
end;$$;
revoke all on function public.revoke_moved_intervention_payer()from public,anon,authenticated,service_role;
create trigger delegated_payer_site_changed after update of site_id on public.interventions for each row execute function public.revoke_moved_intervention_payer();

create function public.platform_checkout_can_pay(p_job uuid,p_actor uuid)returns boolean language sql stable security definer set search_path=''as $$
 select public.platform_checkout_actor_can_pay(p_job,p_actor)or(
 public.delegated_payer_member(p_job,p_actor)and exists(select 1 from public.intervention_payers d where d.intervention_id=p_job and d.payer_id=p_actor and exists(select 1 from public.interventions i where i.id=p_job and i.site_id=d.site_id))
 and not exists(select 1 from public.phone_booking_requests where intervention_id=p_job)
 and not exists(select 1 from public.guest_settlements where intervention_id=p_job)
 and not exists(select 1 from public.on_site_receipts where intervention_id=p_job));
$$;
revoke all on function public.platform_checkout_can_pay(uuid,uuid)from public,anon,authenticated,service_role;
create function public.platform_checkout_payer_current(p_checkout uuid,p_actor uuid)returns boolean language sql stable security definer set search_path=''as $$
 select exists(select 1 from public.platform_checkouts l where l.id=p_checkout and l.actor_id=p_actor and public.platform_checkout_can_pay(l.intervention_id,p_actor)
 and(public.platform_checkout_actor_can_pay(l.intervention_id,p_actor)or exists(select 1 from public.platform_checkout_payer_bindings b join public.intervention_payers d on d.intervention_id=l.intervention_id and d.payer_id=p_actor and d.version=b.payer_version where b.checkout_id=l.id)));
$$;
revoke all on function public.platform_checkout_payer_current(uuid,uuid)from public,anon,authenticated,service_role;

create function public.set_intervention_payer(p_intervention_id uuid,p_command_id uuid,p_payer_id uuid,p_expected_version integer)returns jsonb language plpgsql security definer set search_path=''as $$
declare actor uuid=auth.uid();j public.interventions;s public.sites;d public.intervention_payers;prior public.intervention_payer_commands;r jsonb;
begin
 if actor is null then raise insufficient_privilege;end if;
 if p_command_id is null or p_intervention_id is null or(p_expected_version is not null and p_expected_version not between 1 and 2147483646)then raise invalid_parameter_value;end if;
 perform public.lock_intervention_organization(p_intervention_id);
 select *into j from public.interventions where id=p_intervention_id for update;
 select *into s from public.sites where id=j.site_id;
 if s.id is null or not exists(select 1 from public.organizations o join public.organization_members m on m.organization_id=o.id and m.user_id=actor and m.role='owner' where o.id=s.organization_id and o.owner_id=actor)then raise insufficient_privilege;end if;
 select *into prior from public.intervention_payer_commands where command_id=p_command_id;
 if found then
  if prior.actor_id<>actor or prior.intervention_id<>j.id or prior.payer_id is distinct from p_payer_id or prior.expected_version is distinct from p_expected_version then raise exception 'Payer command changed'using errcode='P0001';end if;
  return prior.result||jsonb_build_object('replayed',true);
 end if;
 select *into d from public.intervention_payers where intervention_id=j.id for update;
 if d.version is distinct from p_expected_version then raise exception 'Payer version changed'using errcode='P0001';end if;
 if p_payer_id is not null then
  if s.archived_at is not null or j.status in('paid','cancelled')or not public.delegated_payer_member(j.id,p_payer_id)then raise insufficient_privilege;end if;
  if exists(select 1 from public.phone_booking_requests where intervention_id=j.id)or exists(select 1 from public.guest_settlements where intervention_id=j.id)or exists(select 1 from public.on_site_receipts where intervention_id=j.id)then raise exception 'Delegation requires account B2B checkout'using errcode='P0001';end if;
 end if;
 if d.intervention_id is null and p_payer_id is null then raise invalid_parameter_value;end if;
 if d.intervention_id is not null and d.payer_id is not distinct from p_payer_id then raise exception 'Payer unchanged'using errcode='P0001';end if;
 perform public.consume_action('delegated_payer',20);
 insert into public.intervention_payers(intervention_id,site_id,payer_id,version,updated_by)values(j.id,j.site_id,p_payer_id,1,actor)
 on conflict(intervention_id)do update set site_id=excluded.site_id,payer_id=excluded.payer_id,version=intervention_payers.version+1,updated_by=actor,updated_at=clock_timestamp()returning *into d;
 r=jsonb_build_object('intervention_id',j.id,'payer_id',d.payer_id,'version',d.version,'replayed',false);
 insert into public.intervention_payer_commands(command_id,intervention_id,actor_id,payer_id,expected_version,result)values(p_command_id,j.id,actor,p_payer_id,p_expected_version,r);
 return r;
end;$$;
revoke all on function public.set_intervention_payer(uuid,uuid,uuid,integer)from public,anon,authenticated,service_role;
grant execute on function public.set_intervention_payer(uuid,uuid,uuid,integer)to authenticated;
create function public.intervention_payer_status(p_intervention_id uuid)returns jsonb language plpgsql stable security definer set search_path=''as $$
declare j public.interventions;s public.sites;d public.intervention_payers;owner boolean;
begin
 if auth.uid()is null then raise insufficient_privilege;end if;
 select *into j from public.interventions where id=p_intervention_id;
 if j.site_id is null or not public.delegated_payer_member(j.id,auth.uid())then raise no_data_found;end if;
 select *into s from public.sites where id=j.site_id;
 select *into d from public.intervention_payers where intervention_id=j.id;
 owner=exists(select 1 from public.organizations o join public.organization_members m on m.organization_id=o.id and m.user_id=auth.uid()and m.role='owner'where o.id=s.organization_id and o.owner_id=auth.uid());
 if not owner and auth.uid()is distinct from j.client_id and auth.uid()is distinct from d.payer_id then raise no_data_found;end if;
 return jsonb_build_object('intervention_id',j.id,'payer_id',d.payer_id,'version',d.version,'can_manage',owner,
 'can_checkout',public.platform_checkout_can_pay(j.id,auth.uid()),'delegate_current',d.payer_id is not null and d.site_id=j.site_id and public.delegated_payer_member(j.id,d.payer_id),
 'external_session_pending',exists(select 1 from public.platform_checkouts where intervention_id=j.id and status not in('expired','paid')),
 'link','/#detail/'||j.id::text);
end;$$;
revoke all on function public.intervention_payer_status(uuid)from public,anon,authenticated,service_role;
grant execute on function public.intervention_payer_status(uuid)to authenticated;

create or replace function public.platform_checkout_source(p_quote uuid,p_actor uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare q public.quotes; j public.interventions; a public.profiles; amount bigint; amendments jsonb;
begin
 select * into q from public.quotes where id=p_quote;
 if not found then raise no_data_found; end if;
 select * into j from public.interventions where id=q.intervention_id;
 if not found or not public.platform_checkout_can_pay(j.id,p_actor) then raise no_data_found; end if;
 if q.status<>'accepted' or j.status not in ('completed','paid') or q.artisan_id is distinct from j.artisan_id then
  raise exception 'Accepted completed work required' using errcode='P0001'; end if;
 if exists(select 1 from public.phone_booking_requests where intervention_id=j.id and
  (actor_id is distinct from p_actor or method<>'on_site' or status<>'confirmed')) or
  exists(select 1 from public.guest_settlements where intervention_id=j.id) or
  exists(select 1 from public.on_site_receipts where intervention_id=j.id) then
  raise exception 'Conflicting settlement method' using errcode='P0001'; end if;
 select * into a from public.profiles where id=j.artisan_id and role='artisan' and artisan_approved;
 if not found or a.stripe_account_id is null or a.stripe_account_id !~ '^acct_[A-Za-z0-9]{1,200}$' or
  exists(select 1 from public.artisan_profiles where user_id=a.id and application_status<>'approved') then
  raise exception 'Recipient account not ready' using errcode='P0001'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'version',m.version,'total_cents',m.total_cents) order by m.id),'[]'::jsonb),
  q.total_cents+coalesce(sum(m.total_cents),0) into amendments,amount
  from public.quote_amendments m where m.base_quote_id=q.id and m.status='accepted';
 if amount is null or amount<1 or amount>2147483647 or exists(select 1 from public.quote_amendments where base_quote_id=q.id
  and status='accepted' and (intervention_id<>j.id or artisan_id is distinct from j.artisan_id)) then
  raise exception 'Invalid agreed amount' using errcode='P0001'; end if;
 return jsonb_build_object('quote_id',q.id,'intervention_id',j.id,'actor_id',p_actor,'artisan_id',a.id,
  'account_id',a.stripe_account_id,'amount_cents',amount,'currency','eur','amendments',amendments,'job_status',j.status);
end; $$;

create or replace function public.guard_phone_booking_checkout(p_quote_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare q public.quotes; j public.interventions;
begin
 if auth.uid() is null then raise insufficient_privilege; end if;
 select * into q from public.quotes where id=p_quote_id;
 select * into j from public.interventions where id=q.intervention_id;
 if not found or not public.platform_checkout_can_pay(j.id,auth.uid()) then raise no_data_found; end if;
 if exists(select 1 from public.phone_booking_requests where intervention_id=j.id and
  (actor_id is distinct from auth.uid() or method<>'on_site' or status<>'confirmed')) or
  exists(select 1 from public.on_site_receipts where intervention_id=j.id) or
  exists(select 1 from public.guest_settlements where intervention_id=j.id) then
  raise exception 'Conflicting settlement method' using errcode='P0001'; end if;
end; $$;

create or replace function public.begin_platform_checkout(p_quote_id uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare actor uuid=auth.uid(); job uuid; s jsonb; l public.platform_checkouts; pay public.payments;
begin
 if actor is null then raise insufficient_privilege; end if;
 select i.id into job from public.quotes q join public.interventions i on i.id=q.intervention_id
  where q.id=p_quote_id and public.platform_checkout_can_pay(i.id,actor);
 if not found then raise no_data_found; end if;
 perform public.lock_intervention_organization(job);
 perform 1 from public.interventions where id=job for update;
 perform 1 from public.quotes where id=p_quote_id for update;
 s=public.platform_checkout_source(p_quote_id,actor);
 if(s->>'intervention_id')::uuid is distinct from job then raise exception 'Intervention changed during Checkout' using errcode='P0001';end if;
 select * into pay from public.payments where quote_id=p_quote_id for update;
 if found and (pay.status='paid' or pay.method<>'stripe') then raise exception 'Payment already settled' using errcode='P0001'; end if;
 select * into l from public.platform_checkouts where quote_id=p_quote_id and status<>'expired' for update;
 if found then
  if l.actor_id<>actor or l.intervention_id<>job or l.amount_cents<>(s->>'amount_cents')::integer or
   l.artisan_id::text is distinct from s->>'artisan_id' or l.account_id is distinct from s->>'account_id' or
   l.amendments is distinct from s->'amendments' then raise exception 'Checkout snapshot changed' using errcode='P0001'; end if;
  if not public.platform_checkout_payer_current(l.id,actor)then raise insufficient_privilege;end if;
  return l.id;
 end if;
 if s->>'job_status'<>'completed' or (pay.id is not null and not(pay.status='failed' and pay.failure_code='expired')) then
  raise exception 'Existing payment must be reconciled' using errcode='P0001'; end if;
 perform public.consume_action('platform_checkout',5);
 insert into public.platform_checkouts(quote_id,intervention_id,actor_id,artisan_id,amount_cents,amendments,account_id)
 values(p_quote_id,job,actor,(s->>'artisan_id')::uuid,(s->>'amount_cents')::integer,s->'amendments',s->>'account_id') returning id into job;
 if not public.platform_checkout_actor_can_pay((s->>'intervention_id')::uuid,actor)then
  insert into public.platform_checkout_payer_bindings(checkout_id,payer_version)select job,version from public.intervention_payers where intervention_id=(s->>'intervention_id')::uuid and payer_id=actor;
 end if;
 return job;
end; $$;

create or replace function public.platform_checkout_private(p_id uuid,p_actor uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare l public.platform_checkouts;
begin
 select * into l from public.platform_checkouts where id=p_id and actor_id=p_actor;
 if not found then raise no_data_found; end if;
 if not public.platform_checkout_payer_current(l.id,p_actor)then raise insufficient_privilege;end if;
 return to_jsonb(l);
end; $$;

create or replace function public.qualify_platform_checkout(p_id uuid,p_actor uuid,p_account text,p_fee integer,p_origin text) returns void
language plpgsql security definer set search_path='' as $$
declare l public.platform_checkouts; s jsonb; job uuid; fee integer;
begin
 select intervention_id into job from public.platform_checkouts where id=p_id and actor_id=p_actor;
 if not found then raise no_data_found; end if;
 perform public.lock_intervention_organization(job);perform 1 from public.interventions where id=job for update;
 select * into l from public.platform_checkouts where id=p_id and actor_id=p_actor for update;
 if not public.platform_checkout_payer_current(l.id,p_actor)then raise insufficient_privilege;end if;
 s=public.platform_checkout_source(l.quote_id,p_actor);
 if l.status not in ('preparing','open') or l.account_id is distinct from p_account or
  l.account_id is distinct from s->>'account_id' or l.amount_cents<>(s->>'amount_cents')::integer or
  l.amendments is distinct from s->'amendments' or p_fee is null or p_fee not between 0 and 9999 or p_origin is null or char_length(p_origin)>255 or
  p_origin !~ '^(https://[A-Za-z0-9.-]+(:[0-9]{1,5})?|http://(localhost|127[.]0[.]0[.]1)(:[0-9]{1,5})?)$' then raise insufficient_privilege; end if;
 fee=round(l.amount_cents::numeric*p_fee/10000)::integer;
 if fee>=l.amount_cents or(l.fee_bps is not null and (l.fee_bps<>p_fee or l.fee_cents<>fee or l.return_origin is distinct from p_origin)) then
  raise exception 'Checkout fee changed' using errcode='P0001'; end if;
 update public.platform_checkouts set fee_bps=p_fee,fee_cents=fee,return_origin=p_origin where id=l.id;
end; $$;

create or replace function public.bind_platform_checkout(p_id uuid,p_actor uuid,p_session text,p_amount integer,p_currency text,p_expires timestamptz) returns void
language plpgsql security definer set search_path='' as $$
declare l public.platform_checkouts; s jsonb; job uuid; pay public.payments;
begin
 select intervention_id into job from public.platform_checkouts where id=p_id and actor_id=p_actor;
 if not found then raise no_data_found; end if;
 perform public.lock_intervention_organization(job);perform public.lock_intervention_organization(job);perform 1 from public.interventions where id=job for update;
 select * into l from public.platform_checkouts where id=p_id and actor_id=p_actor for update;
 if not public.platform_checkout_payer_current(l.id,p_actor)then raise insufficient_privilege;end if;
 s=public.platform_checkout_source(l.quote_id,p_actor);
 if l.status not in ('preparing','open') or l.fee_bps is null or l.fee_cents is null or
  p_session is null or p_session !~ '^cs_[A-Za-z0-9_]{1,240}$' or p_amount is distinct from l.amount_cents or
  p_currency is distinct from l.currency or l.account_id is distinct from s->>'account_id' or
  l.amendments is distinct from s->'amendments' or l.amount_cents<>(s->>'amount_cents')::integer or
  p_expires is null or p_expires<=l.created_at or p_expires>l.created_at+interval '25 hours' or
  (l.session_id is not null and l.session_id<>p_session) then raise exception 'Checkout session mismatch' using errcode='P0001'; end if;
 select * into pay from public.payments where quote_id=l.quote_id for update;
 if found then
  if pay.session_id=p_session and pay.total_cents=l.amount_cents and pay.currency=l.currency and pay.status='pending' then null;
  elsif pay.status='failed' and pay.failure_code='expired' and pay.method='stripe' then
   update public.payments set session_id=p_session,total_cents=l.amount_cents,currency=l.currency,status='pending',failure_code=null,paid_at=null where id=pay.id;
  else raise exception 'Concurrent payment exists' using errcode='P0001'; end if;
 else
  insert into public.payments(quote_id,session_id,total_cents,currency,status,method)values(l.quote_id,p_session,l.amount_cents,l.currency,'pending','stripe');
 end if;
 update public.platform_checkouts set session_id=p_session,status='open',expires_at=p_expires where id=l.id;
end; $$;

-- Bank facts use the immutable mandate at creation, never current membership.
create or replace function public.stripe_checkout_expected_total(p_quote uuid,p_session text) returns integer
language plpgsql stable security definer set search_path='' as $$
declare q public.quotes; j public.interventions; l public.platform_checkouts; amount bigint;
begin
 select * into q from public.quotes where id=p_quote;
 select * into j from public.interventions where id=q.intervention_id;
 if q.id is null or j.id is null or q.status<>'accepted' or q.artisan_id is distinct from j.artisan_id or
  exists(select 1 from public.on_site_receipts where intervention_id=j.id) then
  raise exception 'Invalid financial reference' using errcode='P0001'; end if;
 select * into l from public.platform_checkouts where quote_id=p_quote and session_id=p_session;
 if found then
  if l.intervention_id<>j.id or l.artisan_id<>q.artisan_id or (l.actor_id<>j.client_id and not exists(select 1 from public.platform_checkout_payer_bindings b join public.intervention_payer_events e on e.intervention_id=l.intervention_id and e.version=b.payer_version where b.checkout_id=l.id and e.record->>'payer_id'=l.actor_id::text)) or l.fee_bps is null or l.fee_cents is null then
   raise exception 'Checkout snapshot mismatch' using errcode='P0001'; end if;
  return l.amount_cents;
 end if;
 if exists(select 1 from public.phone_booking_requests where intervention_id=j.id and method<>'on_site') or
  exists(select 1 from public.guest_settlements where intervention_id=j.id) then
  raise exception 'Wrong settlement channel' using errcode='P0001'; end if;
 select q.total_cents+coalesce(sum(total_cents),0) into amount from public.quote_amendments where base_quote_id=q.id and status='accepted';
 if amount is null or amount<1 or amount>2147483647 or exists(select 1 from public.quote_amendments where base_quote_id=q.id and status='accepted'
  and(intervention_id<>j.id or artisan_id is distinct from j.artisan_id))then raise exception 'Invalid agreed amount' using errcode='P0001';end if;
 return amount::integer;
end; $$;
commit;

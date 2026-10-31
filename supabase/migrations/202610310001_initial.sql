-- Courant: initial schema. Apply only to the dedicated project.
-- Access patterns: https://supabase.com/docs/guides/database/postgres/row-level-security
begin;
create extension if not exists pgcrypto;
revoke create on schema public from public;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'client' check (role in ('client','artisan','manager','admin')),
  full_name text not null check (char_length(full_name) between 1 and 120),
  phone text not null default '' check (char_length(phone) <= 30),
  artisan_approved boolean not null default false,
  stripe_account_id text unique,
  created_at timestamptz not null default now()
);
create table public.organizations (
  id uuid primary key default gen_random_uuid(), name text not null check(char_length(name) between 1 and 160),
  owner_id uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);
create table public.organization_members (
  organization_id uuid references public.organizations(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete cascade,
  role text not null check(role in ('owner','manager','viewer')),
  primary key(organization_id,user_id)
);
create table public.sites (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
  name text not null check(char_length(name) between 1 and 160),
  type text not null check(type in ('syndic','restaurant','office','erp')),
  address text not null check(char_length(address) between 5 and 500),
  budget_cents integer not null default 0 check(budget_cents between 0 and 100000000),
  created_at timestamptz not null default now()
);
create table public.interventions (
  id uuid primary key default gen_random_uuid(), client_id uuid not null references public.profiles(id),
  artisan_id uuid references public.profiles(id), site_id uuid references public.sites(id),
  category text not null check(category in ('outage','panel','socket','lighting','diagnostic')),
  description text not null check(char_length(description) between 10 and 4000),
  address text not null check(char_length(address) between 5 and 500),
  postal_code text not null check(postal_code ~ '^[0-9]{5}$'),
  city text not null check(char_length(city) between 2 and 120),
  urgency text not null check(urgency in ('urgent','scheduled')),
  estimate_min_cents integer not null check(estimate_min_cents > 0),
  estimate_max_cents integer not null check(estimate_max_cents >= estimate_min_cents),
  status text not null default 'requested' check(status in ('requested','assigned','quoted','accepted','in_progress','completed','paid','cancelled')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  completed_at timestamptz, paid_at timestamptz
);
create index interventions_client on public.interventions(client_id,created_at desc);
create index interventions_artisan on public.interventions(artisan_id,status);
create index interventions_site on public.interventions(site_id);
create index interventions_available on public.interventions(status,created_at) where status='requested';
create table public.quotes (
  id uuid primary key default gen_random_uuid(), intervention_id uuid not null references public.interventions(id),
  artisan_id uuid not null references public.profiles(id), lines jsonb not null check(jsonb_typeof(lines)='array'),
  subtotal_cents integer not null check(subtotal_cents > 0), tax_rate numeric not null check(tax_rate in (0,5.5,10,20)),
  tax_cents integer not null check(tax_cents >= 0), total_cents integer not null check(total_cents between 1 and 10000000),
  status text not null default 'sent' check(status in ('sent','accepted','rejected')),
  created_at timestamptz not null default now(), accepted_at timestamptz
);
create unique index quotes_active_one on public.quotes(intervention_id) where status in ('sent','accepted');
create table public.payments (
  id uuid primary key default gen_random_uuid(), quote_id uuid not null unique references public.quotes(id),
  session_id text not null unique, total_cents integer not null check(total_cents > 0),
  currency text not null default 'eur' check(currency='eur'), status text not null default 'pending' check(status in ('pending','paid','failed')),
  created_at timestamptz not null default now(), paid_at timestamptz
);
create table public.stripe_events (
  id text primary key, event_type text not null, created_at timestamptz not null default now()
);
create table public.messages (
  id uuid primary key default gen_random_uuid(), intervention_id uuid not null references public.interventions(id),
  author_id uuid not null references public.profiles(id), body text not null check(char_length(body) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index messages_intervention on public.messages(intervention_id,created_at);
create table public.documents (
  id uuid primary key default gen_random_uuid(), intervention_id uuid references public.interventions(id),
  owner_id uuid not null references public.profiles(id), name text not null,
  path text not null unique, mime_type text not null, created_at timestamptz not null default now()
);
create table public.reviews (
  id uuid primary key default gen_random_uuid(), intervention_id uuid not null unique references public.interventions(id),
  author_id uuid not null references public.profiles(id), rating integer not null check(rating between 1 and 5),
  body text not null default '' check(char_length(body)<=2000), created_at timestamptz not null default now()
);
create table public.audit_log (
  id bigint generated always as identity primary key, actor_id uuid references public.profiles(id),
  intervention_id uuid references public.interventions(id), action text not null,
  created_at timestamptz not null default now()
);

create table public.action_limits (
  actor_id uuid not null references public.profiles(id) on delete cascade,
  action text not null, window_start timestamptz not null, count integer not null,
  primary key(actor_id,action,window_start)
);
alter table public.action_limits enable row level security;
-- Internal transactional throttle; failures roll back the action and its counter.
create function public.consume_action(p_action text,p_limit integer) returns void language plpgsql security definer set search_path='' as $$
declare used integer;
begin
 if auth.uid() is null then raise insufficient_privilege; end if;
 insert into public.action_limits(actor_id,action,window_start,count) values(auth.uid(),p_action,date_trunc('minute',now()),1)
 on conflict(actor_id,action,window_start) do update set count=public.action_limits.count+1 where public.action_limits.count<p_limit returning count into used;
 if used is null then raise exception 'Rate limit exceeded' using errcode='53300'; end if;
end; $$;
create function public.check_upload_limit() returns void language plpgsql security definer set search_path='' as $$
begin perform public.consume_action('upload',10); end; $$;

create function public.is_admin() returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.profiles where id=auth.uid() and role='admin');
$$;
create function public.is_org_member(org uuid, write_access boolean default false) returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.organization_members where organization_id=org and user_id=auth.uid() and (not write_access or role in ('owner','manager')));
$$;
create function public.can_access_intervention(target uuid) returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.interventions i left join public.sites s on s.id=i.site_id
    where i.id=target and (i.client_id=auth.uid() or i.artisan_id=auth.uid() or public.is_org_member(s.organization_id) or public.is_admin()));
$$;
create function public.owns_intervention(target uuid) returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.interventions i left join public.sites s on s.id=i.site_id
    where i.id=target and (i.client_id=auth.uid() or public.is_org_member(s.organization_id,true)));
$$;

create function public.create_profile() returns trigger language plpgsql security definer set search_path='' as $$
begin
  insert into public.profiles(id,role,full_name) values(new.id,
    case when new.raw_user_meta_data->>'role' in ('artisan','manager') then new.raw_user_meta_data->>'role' else 'client' end,
    left(coalesce(nullif(trim(new.raw_user_meta_data->>'full_name'),''),'Mon compte'),120));
  return new;
end;
$$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.create_profile();

alter table public.profiles enable row level security;
alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.sites enable row level security;
alter table public.interventions enable row level security;
alter table public.quotes enable row level security;
alter table public.payments enable row level security;
alter table public.stripe_events enable row level security;
alter table public.messages enable row level security;
alter table public.documents enable row level security;
alter table public.reviews enable row level security;
alter table public.audit_log enable row level security;

-- Direct mutations are intentionally not granted: commands below enforce transitions atomically.
revoke all on all tables in schema public from anon,authenticated;
grant select on public.profiles,public.organizations,public.organization_members,public.sites,public.interventions,public.quotes,public.payments,public.messages,public.documents,public.reviews,public.audit_log to authenticated;
create policy profiles_read on public.profiles for select to authenticated using(id=auth.uid() or public.is_admin());
create policy organizations_read on public.organizations for select to authenticated using(public.is_org_member(id) or public.is_admin());
create policy members_read on public.organization_members for select to authenticated using(public.is_org_member(organization_id) or public.is_admin());
create policy sites_read on public.sites for select to authenticated using(public.is_org_member(organization_id) or public.is_admin());
create policy interventions_read on public.interventions for select to authenticated using(public.can_access_intervention(id));
create policy quotes_read on public.quotes for select to authenticated using(public.can_access_intervention(intervention_id));
create policy payments_read on public.payments for select to authenticated using(exists(select 1 from public.quotes q where q.id=quote_id and public.can_access_intervention(q.intervention_id)));
create policy messages_read on public.messages for select to authenticated using(public.can_access_intervention(intervention_id));
create policy documents_read on public.documents for select to authenticated using(owner_id=auth.uid() or public.can_access_intervention(intervention_id) or public.is_admin());
create policy reviews_read on public.reviews for select to authenticated using(public.can_access_intervention(intervention_id));
create policy audit_read on public.audit_log for select to authenticated using(public.is_admin() or public.can_access_intervention(intervention_id));

create function public.update_profile(p_full_name text,p_phone text) returns public.profiles language plpgsql security definer set search_path='' as $$
declare result public.profiles;
begin
 if auth.uid() is null then raise insufficient_privilege; end if;
 if char_length(trim(p_full_name)) not between 1 and 120 or char_length(p_phone)>30 then raise invalid_parameter_value; end if;
 update public.profiles set full_name=trim(p_full_name),phone=p_phone where id=auth.uid() returning * into result;
 return result;
end; $$;

create function public.create_intervention(p_category text,p_description text,p_address text,p_postal_code text,p_city text,p_urgency text,p_site_id uuid default null)
returns public.interventions language plpgsql security definer set search_path='' as $$
declare result public.interventions; lower_amount integer; upper_amount integer;
begin
 if not exists(select 1 from public.profiles where id=auth.uid() and role in ('client','manager','admin')) then raise insufficient_privilege; end if;
 if p_site_id is not null and not exists(select 1 from public.sites where id=p_site_id and public.is_org_member(organization_id,true)) then raise insufficient_privilege; end if;
 select case p_category when 'outage' then 15000 when 'panel' then 15000 when 'socket' then 8000 when 'lighting' then 8000 when 'diagnostic' then 12000 end,
 case p_category when 'outage' then 25000 when 'panel' then 35000 when 'socket' then 18000 when 'lighting' then 20000 when 'diagnostic' then 28000 end into lower_amount,upper_amount;
 if lower_amount is null then raise invalid_parameter_value; end if;
 perform public.consume_action('create_intervention',5);
 insert into public.interventions(client_id,site_id,category,description,address,postal_code,city,urgency,estimate_min_cents,estimate_max_cents)
 values(auth.uid(),p_site_id,p_category,trim(p_description),trim(p_address),p_postal_code,trim(p_city),p_urgency,lower_amount,upper_amount) returning * into result;
 insert into public.audit_log(actor_id,intervention_id,action) values(auth.uid(),result.id,'created');
 return result;
end; $$;

-- Offers exclude names, full addresses, photos and free text, until an approved artisan accepts.
create function public.available_missions() returns table(id uuid,category text,city text,postal_code text,urgency text,status text,estimate_min_cents integer,estimate_max_cents integer,created_at timestamptz)
language plpgsql stable security definer set search_path='' as $$
begin
 if not exists(select 1 from public.profiles where profiles.id=auth.uid() and role='artisan' and artisan_approved) then return; end if;
 return query select i.id,i.category,i.city,left(i.postal_code,3)||'**',i.urgency,i.status,i.estimate_min_cents,i.estimate_max_cents,i.created_at
 from public.interventions i where i.status='requested' and i.artisan_id is null and i.client_id<>auth.uid() order by i.created_at limit 100;
end; $$;

create function public.intervention_action(p_id uuid,p_action text,p_lines jsonb default null,p_tax_rate numeric default 20)
returns public.interventions language plpgsql security definer set search_path='' as $$
declare job public.interventions; q public.quotes; subtotal bigint; tax bigint; valid_count integer; item_count integer;
begin
 if auth.uid() is null then raise insufficient_privilege; end if;
 perform public.consume_action('intervention_action',30);
 select * into job from public.interventions where id=p_id for update;
 if not found then raise no_data_found; end if;
 if p_action='accept_mission' then
   if not exists(select 1 from public.profiles where id=auth.uid() and role='artisan' and artisan_approved) then raise insufficient_privilege; end if;
   if job.status<>'requested' or job.artisan_id is not null or job.client_id=auth.uid() then raise exception 'Mission unavailable' using errcode='P0001'; end if;
   update public.interventions set artisan_id=auth.uid(),status='assigned',updated_at=now() where id=p_id returning * into job;
 elsif p_action='send_quote' then
   if job.artisan_id is distinct from auth.uid() then raise insufficient_privilege; end if;
   if job.status not in ('assigned','quoted') then raise exception 'Invalid transition' using errcode='P0001'; end if;
   if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) not between 1 and 30 or p_tax_rate not in (0,5.5,10,20) or p_tax_rate is null then raise invalid_parameter_value; end if;
   select count(*),count(*) filter(where char_length(trim(x.label)) between 1 and 160 and x.quantity between 1 and 1000 and x.quantity=trunc(x.quantity) and x.unit_price_cents between 0 and 10000000 and x.unit_price_cents=trunc(x.unit_price_cents)),sum(x.quantity*x.unit_price_cents)
   into item_count,valid_count,subtotal from jsonb_to_recordset(p_lines) as x(label text,quantity numeric,unit_price_cents numeric);
   if item_count<>valid_count or subtotal is null or subtotal<1 then raise invalid_parameter_value; end if;
   tax=round(subtotal*p_tax_rate/100);
   if subtotal+tax>10000000 then raise invalid_parameter_value; end if;
   update public.quotes set status='rejected' where intervention_id=p_id and status='sent';
   insert into public.quotes(intervention_id,artisan_id,lines,subtotal_cents,tax_rate,tax_cents,total_cents) values(p_id,auth.uid(),p_lines,subtotal,p_tax_rate,tax,subtotal+tax);
   update public.interventions set status='quoted',updated_at=now() where id=p_id returning * into job;
 elsif p_action='accept_quote' then
   if not public.owns_intervention(p_id) then raise insufficient_privilege; end if;
   if job.status<>'quoted' then raise exception 'Invalid transition' using errcode='P0001'; end if;
   select * into q from public.quotes where intervention_id=p_id and status='sent' for update;
   if not found then raise exception 'No active quote' using errcode='P0001'; end if;
   update public.quotes set status='accepted',accepted_at=now() where id=q.id;
   update public.interventions set status='accepted',updated_at=now() where id=p_id returning * into job;
 elsif p_action='start' then
   if job.artisan_id is distinct from auth.uid() then raise insufficient_privilege; end if;
   if job.status<>'accepted' then raise exception 'Invalid transition' using errcode='P0001'; end if;
   update public.interventions set status='in_progress',updated_at=now() where id=p_id returning * into job;
 elsif p_action='complete' then
   if job.artisan_id is distinct from auth.uid() then raise insufficient_privilege; end if;
   if job.status<>'in_progress' then raise exception 'Invalid transition' using errcode='P0001'; end if;
   update public.interventions set status='completed',completed_at=now(),updated_at=now() where id=p_id returning * into job;
 elsif p_action='cancel' then
   if not public.owns_intervention(p_id) then raise insufficient_privilege; end if;
   if job.status not in ('requested','assigned','quoted') then raise exception 'Invalid transition' using errcode='P0001'; end if;
   update public.quotes set status='rejected' where intervention_id=p_id and status='sent';
   update public.interventions set status='cancelled',updated_at=now() where id=p_id returning * into job;
 else raise invalid_parameter_value;
 end if;
 insert into public.audit_log(actor_id,intervention_id,action) values(auth.uid(),p_id,p_action);
 return job;
end; $$;

create function public.create_site(p_name text,p_type text,p_address text,p_budget_cents integer,p_organization_id uuid default null)
returns public.sites language plpgsql security definer set search_path='' as $$
declare org uuid; result public.sites;
begin
 if not exists(select 1 from public.profiles where id=auth.uid() and role in ('manager','admin')) then raise insufficient_privilege; end if;
 perform public.consume_action('create_site',10);
 org=p_organization_id;
 if org is null then
   select organization_id into org from public.organization_members where user_id=auth.uid() and role='owner' order by organization_id limit 1;
   if org is null then
     insert into public.organizations(name,owner_id) values('Mon organisation',auth.uid()) returning id into org;
     insert into public.organization_members(organization_id,user_id,role) values(org,auth.uid(),'owner');
   end if;
 end if;
 if not public.is_org_member(org,true) then raise insufficient_privilege; end if;
 insert into public.sites(organization_id,name,type,address,budget_cents) values(org,trim(p_name),p_type,trim(p_address),p_budget_cents) returning * into result;
 return result;
end; $$;

create function public.send_message(p_intervention_id uuid,p_body text) returns public.messages language plpgsql security definer set search_path='' as $$
declare result public.messages;
begin
 if not (public.owns_intervention(p_intervention_id) or public.is_admin() or exists(select 1 from public.interventions where id=p_intervention_id and artisan_id=auth.uid())) then raise insufficient_privilege; end if;
 if not exists(select 1 from public.interventions where id=p_intervention_id and artisan_id is not null and status<>'cancelled') then raise exception 'Conversation unavailable' using errcode='P0001'; end if;
 perform public.consume_action('send_message',30);
 insert into public.messages(intervention_id,author_id,body) values(p_intervention_id,auth.uid(),trim(p_body)) returning * into result;
 return result;
end; $$;

create function public.approve_artisan(p_user_id uuid,p_approved boolean) returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.is_admin() then raise insufficient_privilege; end if;
 if not exists(select 1 from public.profiles where id=p_user_id and role='artisan') then raise no_data_found; end if;
 update public.profiles set artisan_approved=p_approved where id=p_user_id;
 insert into public.audit_log(actor_id,action) values(auth.uid(),'artisan_approval:'||p_user_id::text||':'||p_approved::text);
end; $$;

create function public.submit_review(p_intervention_id uuid,p_rating integer,p_body text) returns public.reviews language plpgsql security definer set search_path='' as $$
declare result public.reviews;
begin
 if not exists(select 1 from public.interventions where id=p_intervention_id and client_id=auth.uid() and status='paid') then raise insufficient_privilege; end if;
 insert into public.reviews(intervention_id,author_id,rating,body) values(p_intervention_id,auth.uid(),p_rating,trim(p_body)) returning * into result;
 return result;
end; $$;

-- Service-only transaction. A retried event is recorded only after all business validation succeeds.
create function public.confirm_stripe_payment(p_event_id text,p_event_type text,p_session_id text,p_quote_id uuid,p_amount integer,p_currency text)
returns boolean language plpgsql security definer set search_path='' as $$
declare pay public.payments; q public.quotes; job public.interventions;
begin
 if p_event_id is null or char_length(p_event_id) not between 1 and 255 or p_event_type is null or p_event_type not in ('checkout.session.completed','checkout.session.async_payment_succeeded') or p_session_id is null or p_quote_id is null or p_amount is null or p_amount<1 or p_currency is distinct from 'eur' then raise invalid_parameter_value; end if;
 if exists(select 1 from public.stripe_events where id=p_event_id) then return false; end if;
 select * into q from public.quotes where id=p_quote_id for update;
 if not found or q.status<>'accepted' then raise exception 'Invalid quote' using errcode='P0001'; end if;
 select * into pay from public.payments where quote_id=p_quote_id for update;
 if not found or pay.session_id is distinct from p_session_id or pay.total_cents is distinct from p_amount or q.total_cents is distinct from p_amount or p_currency is distinct from 'eur' then raise exception 'Payment mismatch' using errcode='P0001'; end if;
 select * into job from public.interventions where id=q.intervention_id for update;
 if job.status not in ('completed','paid') then raise exception 'Intervention not completed' using errcode='P0001'; end if;
 insert into public.stripe_events(id,event_type) values(p_event_id,p_event_type) on conflict do nothing;
 if not found then return false; end if;
 update public.payments set status='paid',paid_at=coalesce(paid_at,now()) where id=pay.id;
 update public.interventions set status='paid',paid_at=coalesce(paid_at,now()),updated_at=now() where id=job.id;
 insert into public.audit_log(intervention_id,action) values(job.id,'payment_confirmed');
 return true;
end; $$;

-- No function is callable by an anonymous visitor or PUBLIC by default.
revoke execute on all functions in schema public from public,anon,authenticated;
grant execute on function public.is_admin(),public.is_org_member(uuid,boolean),public.can_access_intervention(uuid),public.owns_intervention(uuid),public.update_profile(text,text),public.create_intervention(text,text,text,text,text,text,uuid),public.available_missions(),public.intervention_action(uuid,text,jsonb,numeric),public.create_site(text,text,text,integer,uuid),public.send_message(uuid,text),public.approve_artisan(uuid,boolean),public.submit_review(uuid,integer,text),public.check_upload_limit() to authenticated;
grant execute on function public.confirm_stripe_payment(text,text,text,uuid,integer,text) to service_role;
grant all on all tables in schema public to service_role;
grant usage,select on all sequences in schema public to service_role;

-- Photo/document uploads: private bucket, 4MiB max, restricted MIME types. No public URLs.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('intervention-documents','intervention-documents',false,4194304,array['image/jpeg','image/png','image/webp','application/pdf']) on conflict(id) do nothing;
create policy documents_objects_read on storage.objects for select to authenticated using(
 bucket_id='intervention-documents' and exists(select 1 from public.documents d where d.path=storage.objects.name and (d.owner_id=auth.uid() or public.can_access_intervention(d.intervention_id) or public.is_admin())));
-- Uploads are mediated by the server, which validates membership and creates metadata.
commit;

-- Private versioned quote drafts. No customer-visible quote is changed before explicit publication.
-- Only the dedicated project; existing quotation/approval calculations remain authoritative.
begin;
create table public.quote_drafts (
 intervention_id uuid not null references public.interventions(id),
 artisan_id uuid not null references public.profiles(id),
 version integer not null check(version between 1 and 2147483647),
 state text not null check(state in ('draft','discarded','sent')),
 assignment_token text not null check(assignment_token ~ '^[a-f0-9]{64}$'),
 base_quote_id uuid references public.quotes(id),
 lines jsonb not null default '[]' check(jsonb_typeof(lines)='array' and jsonb_array_length(lines)<=30),
 tax_rate numeric check(tax_rate in (0,5.5,10,20)),
 published_quote_id uuid references public.quotes(id),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 primary key(intervention_id,artisan_id)
);
-- The assignment-epoch lookup must not scan the complete audit trail on each draft read.
create index audit_assignment_revision on public.audit_log(intervention_id,id desc) where action in ('accept_mission','admin_reassigned');
alter table public.quote_drafts enable row level security;
revoke all on public.quote_drafts from public,anon,authenticated;
grant select on public.quote_drafts to authenticated;
grant all on public.quote_drafts to service_role;
-- The RLS read path is also assignment-bound: a former assignment cannot be revived
-- through direct table reads when the same artisan is assigned again later.
create policy quote_drafts_private_read on public.quote_drafts for select to authenticated using(
 artisan_id=auth.uid() and state='draft'
 and exists(select 1 from public.interventions i where i.id=quote_drafts.intervention_id and i.artisan_id=auth.uid() and i.status in ('assigned','quoted'))
 and exists(select 1 from public.profiles p where p.id=auth.uid() and p.role='artisan' and p.artisan_approved)
 and exists(select 1 from public.artisan_profiles a where a.user_id=auth.uid() and a.application_status='approved')
 and assignment_token=encode(sha256(convert_to(intervention_id::text||':'||artisan_id::text||':'||
 (select coalesce(max(l.id)::text,'0') from public.audit_log l where l.intervention_id=quote_drafts.intervention_id and l.action in ('accept_mission','admin_reassigned')),'UTF8')),'hex')
);

create function public.validate_quote_draft_content(p_lines jsonb,p_tax_rate numeric) returns void language plpgsql security definer set search_path='' as $$
begin
 if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines)>30
 or (p_tax_rate is not null and p_tax_rate not in (0,5.5,10,20)) then raise invalid_parameter_value; end if;
 if exists(select 1 from jsonb_array_elements(p_lines) x where jsonb_typeof(x)<>'object'
  or x-array['label','quantity','unit_price_cents']<>'{}'::jsonb
  or jsonb_typeof(x->'label') is distinct from 'string' or char_length(x->>'label')>160
  or jsonb_typeof(x->'quantity') is distinct from 'number' or jsonb_typeof(x->'unit_price_cents') is distinct from 'number') then raise invalid_parameter_value; end if;
 if exists(select 1 from jsonb_to_recordset(p_lines) x(quantity numeric,unit_price_cents numeric)
  where x.quantity not between 1 and 1000 or x.quantity<>trunc(x.quantity)
  or x.unit_price_cents not between 0 and 10000000 or x.unit_price_cents<>trunc(x.unit_price_cents)) then raise invalid_parameter_value; end if;
end; $$;
revoke execute on function public.validate_quote_draft_content(jsonb,numeric) from public,anon,authenticated;

create function public.manage_quote_draft(p_id uuid,p_action text,p_expected_version integer default null,p_assignment_token text default null,p_base_quote_id uuid default null,p_lines jsonb default null,p_tax_rate numeric default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare job public.interventions; account public.profiles; dossier public.artisan_profiles; draft public.quote_drafts;
 current_version integer; token text; current_quote uuid; published_quote uuid; rendered_draft jsonb;
begin
 if auth.uid() is null then raise insufficient_privilege; end if;
 if p_action is null or p_action not in ('load','save','discard','send') then raise invalid_parameter_value; end if;
 -- Scope/membership mutations use the same organization -> dossier order (migration009).
 perform public.lock_intervention_organization(p_id);
 select * into job from public.interventions where id=p_id for update;
 if not found then raise no_data_found; end if;
 if job.artisan_id is distinct from auth.uid() then raise insufficient_privilege; end if;
 -- Serialize suspension and dossier edits without reversing profiles -> artisan_profiles.
 select * into account from public.profiles where id=auth.uid() for update;
 select * into dossier from public.artisan_profiles where user_id=auth.uid() for update;
 if account.role is distinct from 'artisan' or not coalesce(account.artisan_approved,false)
  or dossier.application_status is distinct from 'approved' then raise insufficient_privilege; end if;
 if job.status not in ('assigned','quoted') then raise exception 'Quotation editing unavailable at this stage' using errcode='P0001'; end if;
 select encode(sha256(convert_to(p_id::text||':'||auth.uid()::text||':'||coalesce(max(id)::text,'0'),'UTF8')),'hex') into token
 from public.audit_log where intervention_id=p_id and action in ('accept_mission','admin_reassigned');
 select id into current_quote from public.quotes where intervention_id=p_id and status='sent';
 select * into draft from public.quote_drafts where intervention_id=p_id and artisan_id=auth.uid() for update;
 current_version=coalesce(draft.version,0);
 if p_action='load' then
  if p_expected_version is not null or p_assignment_token is not null or p_base_quote_id is not null or p_lines is not null or p_tax_rate is not null then raise invalid_parameter_value; end if;
 else
  if p_expected_version is null or p_expected_version<0 or p_assignment_token is null or p_assignment_token !~ '^[a-f0-9]{64}$' then raise invalid_parameter_value; end if;
  if p_expected_version<>current_version or p_assignment_token<>token or current_version=2147483647 then raise exception 'Draft revision or assignment changed' using errcode='P0001'; end if;
  perform public.consume_action('quote_draft',30);
  if p_action='save' then
   if p_base_quote_id is distinct from current_quote then raise exception 'Displayed quotation changed' using errcode='P0001'; end if;
   perform public.validate_quote_draft_content(p_lines,p_tax_rate);
   insert into public.quote_drafts(intervention_id,artisan_id,version,state,assignment_token,base_quote_id,lines,tax_rate)
   values(p_id,auth.uid(),current_version+1,'draft',token,current_quote,p_lines,p_tax_rate)
   on conflict(intervention_id,artisan_id) do update set version=excluded.version,state='draft',assignment_token=excluded.assignment_token,
    base_quote_id=excluded.base_quote_id,lines=excluded.lines,tax_rate=excluded.tax_rate,published_quote_id=null,updated_at=now() returning * into draft;
  else
   if p_base_quote_id is not null or p_lines is not null or p_tax_rate is not null then raise invalid_parameter_value; end if;
   if draft.state is distinct from 'draft' or draft.assignment_token is distinct from token then raise exception 'No current draft' using errcode='P0001'; end if;
   if p_action='send' then
    if draft.base_quote_id is distinct from current_quote then raise exception 'Quotation was published outside this draft' using errcode='P0001'; end if;
    -- Reuse all existing role/status/amount/approval/locking rules. Failure rolls back
    -- the previous sent quote and leaves the private draft/version untouched.
    job=public.intervention_action(p_id,'send_quote',draft.lines,draft.tax_rate,null);
    select id into published_quote from public.quotes where intervention_id=p_id and artisan_id=auth.uid() and status='sent';
    if published_quote is null then raise exception 'Published quote missing' using errcode='P0001'; end if;
    current_quote=published_quote;
   end if;
   update public.quote_drafts set version=current_version+1,state=case when p_action='send' then 'sent' else 'discarded' end,
    lines='[]'::jsonb,tax_rate=null,base_quote_id=null,published_quote_id=published_quote,updated_at=now()
    where intervention_id=p_id and artisan_id=auth.uid() returning * into draft;
  end if;
  current_version=draft.version;
 end if;
 if draft.state='draft' and draft.assignment_token=token then
  rendered_draft=jsonb_build_object('intervention_id',draft.intervention_id,'artisan_id',draft.artisan_id,'version',draft.version,
   'assignment_token',draft.assignment_token,'base_quote_id',draft.base_quote_id,'lines',draft.lines,'tax_rate',draft.tax_rate,'updated_at',draft.updated_at);
 else rendered_draft=null; end if;
 return jsonb_build_object('draft',rendered_draft,'version',current_version,'assignment_token',token,'current_quote_id',current_quote)
  ||case when p_action='send' then jsonb_build_object('quote_id',published_quote,'intervention',to_jsonb(job)) else '{}'::jsonb end;
end; $$;
revoke execute on function public.manage_quote_draft(uuid,text,integer,text,uuid,jsonb,numeric) from public,anon,authenticated;
grant execute on function public.manage_quote_draft(uuid,text,integer,text,uuid,jsonb,numeric) to authenticated;
commit;

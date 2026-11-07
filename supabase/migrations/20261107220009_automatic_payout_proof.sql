begin;
create table charge_proof_private.payout_commands(actor_id uuid not null references public.profiles(id),command_id uuid not null,source jsonb not null,created_at timestamptz not null default clock_timestamp(),primary key(actor_id,command_id));
create table charge_proof_private.payouts(event_id text primary key references public.stripe_financial_observations(event_id),source jsonb not null,proof jsonb not null,qualified_at timestamptz not null default clock_timestamp(),qualified_by uuid not null references public.profiles(id));
alter table charge_proof_private.payout_commands enable row level security;alter table charge_proof_private.payouts enable row level security;
revoke all on charge_proof_private.payout_commands,charge_proof_private.payouts from public,anon,authenticated,service_role;
create function charge_proof_private.payout_source(p_event text)returns jsonb language plpgsql stable security definer set search_path=''as $$
declare o public.stripe_financial_observations;artisan uuid;e jsonb;
begin
 select *into o from public.stripe_financial_observations where event_id=p_event;if not found then raise no_data_found;end if;e=o.event;
 if e->>'family'<>'payout'or e->>'source_account'is null or e->'object'->>'id'!~'^po_[A-Za-z0-9_]{1,240}$'or e->'object'->>'currency'<>'eur'or(e->'object'->>'amount')::bigint not between 1 and 2147483647 then raise exception 'Connected payout observation required'using errcode='P0001';end if;
 select id into artisan from public.profiles where role='artisan'and stripe_account_id=e->>'source_account';if not found then raise exception 'Unknown connected account'using errcode='P0001';end if;
 return jsonb_build_object('event_id',p_event,'account_id',e->>'source_account','artisan_id',artisan,'payout_id',e->'object'->>'id','live',(e->>'livemode')::boolean,'amount_cents',(e->'object'->>'amount')::integer,'currency','eur','observation_fingerprint',o.fingerprint,'observation_created',e->>'created');
end;$$;
create function public.begin_automatic_payout_proof(p_actor uuid,p_event text,p_command uuid,p_live boolean)returns jsonb language plpgsql security definer set search_path=''as $$
declare s jsonb;c charge_proof_private.payout_commands;r charge_proof_private.payouts;
begin
 perform 1 from public.profiles where id=p_actor for share;perform 1 from public.platform_operator_grants where user_id=p_actor and status='active'and scope in('finance_read','finance_write')order by scope,id for share;
 if not charge_proof_private.authorized(p_actor,true)then raise insufficient_privilege;end if;
 if not(select enabled from charge_proof_private.control)then raise exception 'Qualification disabled'using errcode='P0001';end if;
 if p_command is null or p_live is null then raise invalid_parameter_value;end if;s=charge_proof_private.payout_source(p_event);
 if(s->>'live')::boolean<>p_live then raise exception 'Mode mismatch'using errcode='P0001';end if;
 perform pg_advisory_xact_lock(hashtextextended('payout-proof-command:'||p_actor::text||':'||p_command::text,0));
 select *into c from charge_proof_private.payout_commands where actor_id=p_actor and command_id=p_command;
 if found then if c.source<>s then raise exception 'Command conflict'using errcode='P0001';end if;
 else insert into charge_proof_private.payout_commands(actor_id,command_id,source)values(p_actor,p_command,s);end if;
 select *into r from charge_proof_private.payouts where event_id=p_event;if found and r.source<>s then raise exception 'Proof source conflict'using errcode='P0001';end if;
 return jsonb_build_object('source',s,'completed',r.event_id is not null);
end;$$;
create function public.store_automatic_payout_proof(p_actor uuid,p_command uuid,p_source jsonb,p_proof jsonb)returns void language plpgsql security definer set search_path=''as $$
declare c charge_proof_private.payout_commands;s jsonb;r charge_proof_private.payouts;l jsonb;d jsonb;seen text[]='{}';gross bigint;fee bigint;net bigint;total bigint=0;n integer=0;observed timestamptz;
begin
 perform 1 from public.profiles where id=p_actor for share;perform 1 from public.platform_operator_grants where user_id=p_actor and status='active'and scope in('finance_read','finance_write')order by scope,id for share;
 if not charge_proof_private.authorized(p_actor,true)then raise insufficient_privilege;end if;
 if not(select enabled from charge_proof_private.control)then raise exception 'Qualification disabled'using errcode='P0001';end if;
 select *into c from charge_proof_private.payout_commands where actor_id=p_actor and command_id=p_command for update;
 if not found or c.source is distinct from p_source then raise exception 'Command mismatch'using errcode='P0001';end if;
 perform 1 from public.profiles where id=(p_source->>'artisan_id')::uuid for share;
 s=charge_proof_private.payout_source(p_source->>'event_id');if s<>p_source then raise exception 'Connected source changed'using errcode='P0001';end if;
 if jsonb_typeof(p_proof)is distinct from'object'or not(p_proof?&array['payout_id','live','currency','amount_cents','status','automatic','reconciliation_status','payout_created','debit','components','own_debit_included','page_count','listed_count','net_components_cents','provider_observed_at','bank_receipt_confirmed'])or p_proof-array['payout_id','live','currency','amount_cents','status','automatic','reconciliation_status','payout_created','debit','components','own_debit_included','page_count','listed_count','net_components_cents','provider_observed_at','bank_receipt_confirmed']<>'{}'::jsonb then raise invalid_parameter_value;end if;
 if p_proof->'payout_id'is distinct from s->'payout_id'or p_proof->'live'is distinct from s->'live'or p_proof->>'currency'is distinct from'eur'or p_proof->'amount_cents'is distinct from s->'amount_cents'or p_proof->>'status'is distinct from'paid'or p_proof->'automatic'is distinct from'true'::jsonb or p_proof->>'reconciliation_status'is distinct from'completed'or p_proof->'bank_receipt_confirmed'is distinct from'false'::jsonb then raise exception 'Payout proof mismatch'using errcode='P0001';end if;
 if jsonb_typeof(p_proof->'page_count')<>'number'or jsonb_typeof(p_proof->'listed_count')<>'number'or jsonb_typeof(p_proof->'net_components_cents')<>'number'or jsonb_typeof(p_proof->'payout_created')<>'number'or jsonb_typeof(p_proof->'provider_observed_at')<>'string'or jsonb_typeof(p_proof->'components')<>'array'or jsonb_array_length(p_proof->'components')not between 1 and 500 or jsonb_typeof(p_proof->'own_debit_included')<>'boolean'or coalesce(p_proof->>'page_count','')!~'^[1-5]$'or coalesce(p_proof->>'listed_count','')!~'^[0-9]+$'or(p_proof->>'listed_count')::integer not between 1 and 500 then raise invalid_parameter_value;end if;
 observed=(p_proof->>'provider_observed_at')::timestamptz;if observed is null or not isfinite(observed)or observed<c.created_at-interval '5 seconds'or observed>clock_timestamp()+interval '30 seconds'or coalesce(p_proof->>'payout_created','')!~'^[0-9]+$'or(p_proof->>'payout_created')::bigint>extract(epoch from observed)then raise invalid_parameter_value;end if;
 d=p_proof->'debit';
 for l in select value from jsonb_array_elements(jsonb_build_array(d)||(p_proof->'components'))loop
  if jsonb_typeof(l)is distinct from'object'or not(l?&array['id','amount_cents','fee_cents','net_cents','currency','type','source_id','created','available_on','status','allocation'])or l-array['id','amount_cents','fee_cents','net_cents','currency','type','source_id','created','available_on','status','allocation']<>'{}'::jsonb then raise invalid_parameter_value;end if;
  if l->>'id'is null or l->>'id'!~'^txn_[A-Za-z0-9_]{1,240}$'or(l->>'id')=any(seen)or l->>'currency'is distinct from'eur'or l->>'status'is distinct from'available'or l->>'allocation'is distinct from'unallocated'or coalesce(l->>'type','')!~'^[a-z_]{1,80}$'or(l->>'source_id'is not null and l->>'source_id'!~'^(ch|py|re|tr|fee|fr|po|du|dp|txn|adj|tu|topup|ob|issauth|isscur|issdp)_[A-Za-z0-9_]{1,240}$')then raise invalid_parameter_value;end if;
  if jsonb_typeof(l->'amount_cents')<>'number'or jsonb_typeof(l->'fee_cents')<>'number'or jsonb_typeof(l->'net_cents')<>'number'or jsonb_typeof(l->'created')<>'number'or jsonb_typeof(l->'available_on')<>'number'or coalesce(l->>'amount_cents','')!~'^-?[0-9]+$'or coalesce(l->>'fee_cents','')!~'^-?[0-9]+$'or coalesce(l->>'net_cents','')!~'^-?[0-9]+$'or coalesce(l->>'created','')!~'^[0-9]+$'or coalesce(l->>'available_on','')!~'^[0-9]+$'then raise invalid_parameter_value;end if;
  gross=(l->>'amount_cents')::bigint;fee=(l->>'fee_cents')::bigint;net=(l->>'net_cents')::bigint;
  if abs(gross)>2147483647 or abs(fee)>2147483647 or abs(net)>2147483647 or net<>gross-fee or(l->>'created')::bigint>extract(epoch from observed)then raise invalid_parameter_value;end if;
  if n=0 then
   if l->>'type'<>'payout'or l->>'source_id'is distinct from s->>'payout_id'or gross<>-(s->>'amount_cents')::bigint or fee<>0 or net<>gross then raise exception 'Own payout debit mismatch'using errcode='P0001';end if;
  else
   if l->>'type'='payout'or l->>'source_id'=s->>'payout_id'then raise exception 'Unexpected payout component'using errcode='P0001';end if;total=total+net;
  end if;
  n=n+1;seen=array_append(seen,l->>'id');
 end loop;
 if total<>(s->>'amount_cents')::bigint or p_proof->>'net_components_cents'is distinct from total::text or(p_proof->>'listed_count')::integer<>n-1+(case when(p_proof->>'own_debit_included')::boolean then 1 else 0 end) then raise exception 'Incomplete payout reconciliation'using errcode='P0001';end if;
 perform pg_advisory_xact_lock(hashtextextended('payout-proof-event:'||(s->>'event_id'),0));
 select *into r from charge_proof_private.payouts where event_id=s->>'event_id';if found then if r.source<>s then raise exception 'Proof conflict'using errcode='P0001';end if;return;end if;
 insert into charge_proof_private.payouts(event_id,source,proof,qualified_by)values(s->>'event_id',s,p_proof,p_actor);
end;$$;
create function public.read_automatic_payout_proof(p_event text)returns jsonb language plpgsql stable security definer set search_path=''as $$
declare r charge_proof_private.payouts;
begin
 if not charge_proof_private.authorized(auth.uid(),false)then raise insufficient_privilege;end if;
 select *into r from charge_proof_private.payouts where event_id=p_event;
 return jsonb_build_object('qualification',case when found then to_jsonb(r)-'qualified_by'else null end);
end;$$;
revoke all on function charge_proof_private.payout_source(text)from public,anon,authenticated,service_role;
revoke all on function public.begin_automatic_payout_proof(uuid,text,uuid,boolean),public.store_automatic_payout_proof(uuid,uuid,jsonb,jsonb),public.read_automatic_payout_proof(text)from public,anon,authenticated,service_role;
grant execute on function public.begin_automatic_payout_proof(uuid,text,uuid,boolean),public.store_automatic_payout_proof(uuid,uuid,jsonb,jsonb)to service_role;
grant execute on function public.read_automatic_payout_proof(text)to authenticated;
commit;

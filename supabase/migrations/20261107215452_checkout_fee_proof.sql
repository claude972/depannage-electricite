begin;
create table charge_proof_private.fee_commands(actor_id uuid not null references public.profiles(id),command_id uuid not null,source jsonb not null,created_at timestamptz not null default clock_timestamp(),primary key(actor_id,command_id));
create table charge_proof_private.fees(
 event_id text primary key references public.stripe_financial_observations(event_id),payment_id uuid not null references charge_proof_private.proofs(payment_id),
 source jsonb not null,provider_amount_refunded_cents integer,provider_refunded boolean not null,fee_created bigint not null,
 provider_observed_at timestamptz not null,qualified_at timestamptz not null default clock_timestamp(),qualified_by uuid not null references public.profiles(id)
);
alter table charge_proof_private.fee_commands enable row level security;alter table charge_proof_private.fees enable row level security;
revoke all on charge_proof_private.fee_commands,charge_proof_private.fees from public,anon,authenticated,service_role;
create function charge_proof_private.fee_source(p_payment uuid,p_event text)returns jsonb language plpgsql stable security definer set search_path=''as $$
declare p charge_proof_private.proofs;o public.stripe_financial_observations;e jsonb;
begin
 select *into p from charge_proof_private.proofs where payment_id=p_payment;if not found then raise exception 'Charge proof required'using errcode='P0001';end if;
 select *into o from public.stripe_financial_observations where event_id=p_event;if not found then raise no_data_found;end if;e=o.event;
 if e->>'family'<>'fee'or e->>'type'not in('application_fee.created','application_fee.refunded')or e->>'source_account'is not null or(e->>'livemode')::boolean is distinct from p.live or e->'object'->>'id'!~'^fee_[A-Za-z0-9_]{1,240}$'or e->'object'->>'source_charge'is null or e->'object'->>'source_charge'!~'^ch_[A-Za-z0-9_]{1,240}$'or e->'object'->>'currency'<>'eur'or(e->'object'->>'amount')::bigint is distinct from(p.source->>'fee_cents')::bigint then raise exception 'Fee observation not qualified'using errcode='P0001';end if;
 return jsonb_build_object('payment_id',p_payment,'event_id',p_event,'live',p.live,'fee_id',e->'object'->>'id','charge_id',p.charge_id,'connected_charge_id',e->'object'->>'source_charge','destination_account',p.source->>'destination_account','amount_cents',(p.source->>'fee_cents')::integer,'currency','eur','observation_fingerprint',o.fingerprint,'observation_created',e->>'created');
end;$$;
create function public.begin_checkout_fee_proof(p_actor uuid,p_payment uuid,p_event text,p_command uuid,p_live boolean)returns jsonb language plpgsql security definer set search_path=''as $$
declare s jsonb;c charge_proof_private.fee_commands;existing charge_proof_private.fees;
begin
 perform 1 from public.profiles where id=p_actor for share;perform 1 from public.platform_operator_grants where user_id=p_actor and status='active'and scope in('finance_read','finance_write')order by scope,id for share;
 if not charge_proof_private.authorized(p_actor,true)then raise insufficient_privilege;end if;
 if not(select enabled from charge_proof_private.control)then raise exception 'Proof qualification disabled'using errcode='P0001';end if;
 if p_command is null or p_live is null then raise invalid_parameter_value;end if;
 s=charge_proof_private.fee_source(p_payment,p_event);if(s->>'live')::boolean<>p_live then raise exception 'Mode mismatch'using errcode='P0001';end if;
 perform pg_advisory_xact_lock(hashtextextended('checkout-fee-command:'||p_actor::text||':'||p_command::text,0));
 select *into c from charge_proof_private.fee_commands where actor_id=p_actor and command_id=p_command;
 if found then if c.source<>s then raise exception 'Fee command conflict'using errcode='P0001';end if;
 else insert into charge_proof_private.fee_commands(actor_id,command_id,source)values(p_actor,p_command,s)returning *into c;end if;
 select *into existing from charge_proof_private.fees where event_id=p_event;
 if found and(existing.payment_id<>p_payment or existing.source<>s)then raise exception 'Fee association conflict'using errcode='P0001';end if;
 return jsonb_build_object('source',s,'completed',existing.event_id is not null);
end;$$;
create function public.store_checkout_fee_proof(p_actor uuid,p_command uuid,p_source jsonb,p_provider jsonb)returns void language plpgsql security definer set search_path=''as $$
declare c charge_proof_private.fee_commands;old charge_proof_private.fees;s jsonb;amount_refunded integer;refunded boolean;created bigint;observed timestamptz;
begin
 perform 1 from public.profiles where id=p_actor for share;perform 1 from public.platform_operator_grants where user_id=p_actor and status='active'and scope in('finance_read','finance_write')order by scope,id for share;
 if not charge_proof_private.authorized(p_actor,true)then raise insufficient_privilege;end if;
 if not(select enabled from charge_proof_private.control)then raise exception 'Proof qualification disabled'using errcode='P0001';end if;
 select *into c from charge_proof_private.fee_commands where actor_id=p_actor and command_id=p_command for update;
 if not found or c.source is distinct from p_source then raise exception 'Fee command mismatch'using errcode='P0001';end if;
 s=charge_proof_private.fee_source((p_source->>'payment_id')::uuid,p_source->>'event_id');if s<>p_source then raise exception 'Fee source changed'using errcode='P0001';end if;
 if jsonb_typeof(p_provider)is distinct from'object'or not(p_provider?&array['id','object','livemode','currency','account','amount','charge','originating_transaction','amount_refunded','refunded','created','observed_at'])or p_provider-array['id','object','livemode','currency','account','amount','charge','originating_transaction','amount_refunded','refunded','created','observed_at']<>'{}'::jsonb then raise invalid_parameter_value;end if;
 if p_provider->>'object'is distinct from'application_fee'or p_provider->>'id'is distinct from s->>'fee_id'or p_provider->'livemode'is distinct from s->'live'or p_provider->>'currency'is distinct from'eur'or p_provider->>'account'is distinct from s->>'destination_account'or p_provider->'amount'is distinct from s->'amount_cents'or p_provider->>'charge'is distinct from s->>'connected_charge_id'or p_provider->>'originating_transaction'is distinct from s->>'charge_id'then raise exception 'Provider fee references mismatch'using errcode='P0001';end if;
 if jsonb_typeof(p_provider->'refunded')<>'boolean'or coalesce(p_provider->>'created','')!~'^[0-9]+$'or(jsonb_typeof(p_provider->'amount_refunded')<>'null'and coalesce(p_provider->>'amount_refunded','')!~'^[0-9]+$')then raise invalid_parameter_value;end if;
 amount_refunded=(p_provider->>'amount_refunded')::integer;refunded=(p_provider->>'refunded')::boolean;created=(p_provider->>'created')::bigint;observed=(p_provider->>'observed_at')::timestamptz;
 if observed is null or not isfinite(observed)or observed<c.created_at-interval '5 seconds'or observed>clock_timestamp()+interval '30 seconds'or created>extract(epoch from observed)or(amount_refunded is not null and(amount_refunded>(s->>'amount_cents')::integer or refunded<>(amount_refunded=(s->>'amount_cents')::integer)))then raise invalid_parameter_value;end if;
 perform pg_advisory_xact_lock(hashtextextended('checkout-fee-event:'||(s->>'event_id'),0));
 select *into old from charge_proof_private.fees where event_id=s->>'event_id';
 -- First completed attestation wins. Later reads never rewrite its dated refund observation.
 if found then if old.source<>s then raise exception 'Fee association conflict'using errcode='P0001';end if;return;end if;
 insert into charge_proof_private.fees(event_id,payment_id,source,provider_amount_refunded_cents,provider_refunded,fee_created,provider_observed_at,qualified_by)values(s->>'event_id',(s->>'payment_id')::uuid,s,amount_refunded,refunded,created,observed,p_actor);
end;$$;
create function public.read_checkout_fee_proof(p_payment uuid,p_event text)returns jsonb language plpgsql stable security definer set search_path=''as $$
declare f charge_proof_private.fees;
begin
 if not charge_proof_private.authorized(auth.uid(),false)then raise insufficient_privilege;end if;
 select *into f from charge_proof_private.fees where payment_id=p_payment and event_id=p_event;
 return jsonb_build_object('qualification',case when found then to_jsonb(f)-'qualified_by'else null end);
end;$$;
revoke all on function charge_proof_private.fee_source(uuid,text)from public,anon,authenticated,service_role;
revoke all on function public.begin_checkout_fee_proof(uuid,uuid,text,uuid,boolean),public.store_checkout_fee_proof(uuid,uuid,jsonb,jsonb),public.read_checkout_fee_proof(uuid,text)from public,anon,authenticated,service_role;
grant execute on function public.begin_checkout_fee_proof(uuid,uuid,text,uuid,boolean),public.store_checkout_fee_proof(uuid,uuid,jsonb,jsonb)to service_role;
grant execute on function public.read_checkout_fee_proof(uuid,text)to authenticated;
commit;

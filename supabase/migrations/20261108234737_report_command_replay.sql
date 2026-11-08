begin;

create schema if not exists command_replay_private;
revoke all on schema command_replay_private from public, anon, authenticated, service_role;
create table if not exists command_replay_private.receipts (
  scope text not null,
  command_id uuid not null,
  actor_id uuid not null,
  target_id uuid not null,
  fingerprint bytea not null,
  result jsonb not null check (jsonb_typeof(result) = 'object'),
  primary key (scope, command_id)
);
alter table command_replay_private.receipts enable row level security;
revoke all on command_replay_private.receipts from public, anon, authenticated, service_role;

-- The caller must check the actor's current authority before reading a receipt.
-- The transaction lock stays held until any new result is recorded or rolled back.
create or replace function command_replay_private.read_locked(
  p_scope text, p_command_id uuid, p_target_id uuid, p_fingerprint bytea
)
returns jsonb language plpgsql security invoker set search_path = ''
as $$
declare
  prior command_replay_private.receipts;
begin
  if auth.uid() is null or p_command_id is null or p_target_id is null or p_fingerprint is null then
    raise invalid_parameter_value;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('command-replay:' || p_scope || ':' || p_command_id, 0));
  select * into prior from command_replay_private.receipts
    where scope = p_scope and command_id = p_command_id;
  if not found then return null; end if;
  if prior.actor_id is distinct from auth.uid() or prior.target_id is distinct from p_target_id
    or prior.fingerprint is distinct from p_fingerprint then
    raise exception 'Command identity conflict' using errcode = 'P0001';
  end if;
  return prior.result;
end;
$$;
revoke all on function command_replay_private.read_locked(text, uuid, uuid, bytea)
  from public, anon, authenticated, service_role;

create or replace function public.save_intervention_report(
  p_id uuid, p_summary text, p_checks jsonb, p_signature_name text, p_command_id uuid
)
returns public.intervention_reports
language plpgsql security definer set search_path = ''
as $$
declare
  result public.intervention_reports;
  prior jsonb;
  payload bytea := sha256(convert_to(jsonb_build_array(trim(p_summary), p_checks, trim(p_signature_name))::text, 'UTF8'));
begin
  perform 1 from public.interventions where id = p_id for update;
  if not exists (
    select 1 from public.interventions i join public.profiles p on p.id = i.artisan_id
    where i.id = p_id and i.artisan_id = auth.uid() and p.artisan_approved
      and i.status in ('in_progress', 'completed', 'paid')
  ) then raise insufficient_privilege; end if;
  prior := command_replay_private.read_locked('work_report', p_command_id, p_id, payload);
  if prior is not null then return jsonb_populate_record(null::public.intervention_reports, prior); end if;

  result := public.save_intervention_report(p_id, p_summary, p_checks, p_signature_name);
  insert into command_replay_private.receipts (scope, command_id, actor_id, target_id, fingerprint, result)
    values ('work_report', p_command_id, auth.uid(), p_id, payload, to_jsonb(result));
  return result;
end;
$$;

revoke all on function public.save_intervention_report(uuid, text, jsonb, text)
  from public, anon, authenticated, service_role;
revoke all on function public.save_intervention_report(uuid, text, jsonb, text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.save_intervention_report(uuid, text, jsonb, text, uuid) to authenticated;

commit;

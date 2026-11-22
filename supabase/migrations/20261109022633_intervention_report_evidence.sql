begin;

-- Existing dossiers can already be in progress, with no way to recover a before photo.
alter table public.interventions
  add column if not exists report_evidence_required boolean not null default false;
alter table public.interventions alter column report_evidence_required set default true;
alter table public.intervention_reports
  add column if not exists before_photo_id uuid references public.documents(id),
  add column if not exists after_photo_id uuid references public.documents(id),
  add column if not exists report_revision uuid not null default gen_random_uuid();

create schema if not exists intervention_report_private;
revoke all on schema intervention_report_private from public, anon, authenticated, service_role;

create table if not exists public.intervention_report_receipts (
  intervention_id uuid not null references public.interventions(id),
  report_revision uuid not null,
  signed_by uuid not null references public.profiles(id),
  acknowledged_at timestamptz not null,
  signed_at timestamptz not null,
  signature_name text not null check (char_length(trim(signature_name)) between 2 and 120),
  report_snapshot jsonb not null check (jsonb_typeof(report_snapshot) = 'object'),
  primary key (intervention_id, report_revision)
);
alter table public.intervention_report_receipts enable row level security;
revoke all on public.intervention_report_receipts from public, anon, authenticated, service_role;
grant select (intervention_id, report_revision, acknowledged_at, signed_at, signature_name)
  on public.intervention_report_receipts to authenticated;
drop policy if exists report_receipts_participants on public.intervention_report_receipts;
create policy report_receipts_participants on public.intervention_report_receipts
  for select to authenticated using (exists (
    select 1 from public.interventions i
    where i.id = intervention_report_receipts.intervention_id and auth.uid() in (i.client_id, i.artisan_id)
  ));

create or replace function intervention_report_private.photos_exist(
  p_id uuid, p_artisan uuid, p_before uuid, p_after uuid
)
returns boolean language sql stable security invoker set search_path = ''
as $$
  select p_before is not null and p_after is not null and p_before <> p_after and (
    select count(*) = 2
    from public.documents d
    where d.id in (p_before, p_after) and d.intervention_id = p_id and d.owner_id = p_artisan
      and d.mime_type in ('image/jpeg', 'image/png', 'image/webp')
      and exists (
        select 1 from storage.objects o
        where o.bucket_id = 'intervention-documents' and o.name = d.path
      )
  )
$$;

create or replace function intervention_report_private.rotate_revision()
returns trigger language plpgsql security invoker set search_path = ''
as $$
begin
  new.report_revision := gen_random_uuid();
  return new;
end;
$$;
drop trigger if exists report_revision_on_write on public.intervention_reports;
create trigger report_revision_on_write before update on public.intervention_reports
  for each row execute function intervention_report_private.rotate_revision();

create or replace function intervention_report_private.save_versioned(
  p_id uuid, p_summary text, p_checks jsonb, p_signature_name text, p_command_id uuid,
  p_before_photo_id uuid, p_after_photo_id uuid
)
returns public.intervention_reports language plpgsql security invoker set search_path = ''
as $$
declare
  job public.interventions;
  report public.intervention_reports;
  prior jsonb;
  payload bytea;
begin
  select * into job from public.interventions where id = p_id for update;
  if not found or auth.uid() is null or job.artisan_id is distinct from auth.uid()
    or job.status not in ('in_progress', 'completed', 'paid')
    or not exists (select 1 from public.profiles where id = auth.uid() and role = 'artisan' and artisan_approved)
  then raise insufficient_privilege; end if;

  -- Preserve the fingerprint of commands issued by the previous client.
  payload := sha256(convert_to(
    (case when p_before_photo_id is null and p_after_photo_id is null
      then jsonb_build_array(trim(p_summary), p_checks, trim(p_signature_name))
      else jsonb_build_array(trim(p_summary), p_checks, trim(p_signature_name), p_before_photo_id, p_after_photo_id)
    end)::text, 'UTF8'
  ));
  prior := command_replay_private.read_locked('work_report', p_command_id, p_id, payload);
  if prior is not null then return jsonb_populate_record(null::public.intervention_reports, prior); end if;

  if (p_before_photo_id is null) <> (p_after_photo_id is null)
    or ((job.report_evidence_required or p_before_photo_id is not null)
      and not intervention_report_private.photos_exist(p_id, auth.uid(), p_before_photo_id, p_after_photo_id))
  then raise exception 'report_photos_invalid' using errcode = '22023'; end if;

  if jsonb_typeof(p_checks) is distinct from 'array' then raise invalid_parameter_value; end if;
  if jsonb_array_length(p_checks) > 50 or exists (
    select 1 from jsonb_array_elements(p_checks) x
    where jsonb_typeof(x) <> 'object' or jsonb_typeof(x->'label') is distinct from 'string'
      or jsonb_typeof(x->'result') is distinct from 'string'
      or (x - array['label', 'result']::text[]) <> '{}'::jsonb
      or char_length(trim(coalesce(x->>'label', ''))) not between 1 and 160
      or coalesce(x->>'result', '') not in ('pass', 'issue', 'not_applicable')
  ) then raise invalid_parameter_value; end if;

  perform public.consume_action('operations', 30);
  insert into public.intervention_reports (
    intervention_id, artisan_id, summary, checks, signature_name, before_photo_id, after_photo_id
  ) values (
    p_id, auth.uid(), trim(p_summary), p_checks, trim(p_signature_name), p_before_photo_id, p_after_photo_id
  ) on conflict (intervention_id) do update set
    artisan_id = excluded.artisan_id, summary = excluded.summary, checks = excluded.checks,
    signature_name = excluded.signature_name, before_photo_id = excluded.before_photo_id,
    after_photo_id = excluded.after_photo_id, updated_at = clock_timestamp()
  returning * into report;

  insert into public.audit_log(actor_id, intervention_id, action) values (auth.uid(), p_id, 'report_saved');
  insert into command_replay_private.receipts (scope, command_id, actor_id, target_id, fingerprint, result)
    values ('work_report', p_command_id, auth.uid(), p_id, payload, to_jsonb(report));
  return report;
end;
$$;

create or replace function public.save_intervention_report(
  p_id uuid, p_summary text, p_checks jsonb, p_signature_name text, p_command_id uuid
)
returns public.intervention_reports language sql security definer set search_path = ''
as $$
  select * from intervention_report_private.save_versioned(
    p_id, p_summary, p_checks, p_signature_name, p_command_id, null, null
  )
$$;

create or replace function public.save_intervention_report(
  p_id uuid, p_summary text, p_checks jsonb, p_signature_name text, p_command_id uuid,
  p_before_photo_id uuid, p_after_photo_id uuid
)
returns public.intervention_reports language sql security definer set search_path = ''
as $$
  select * from intervention_report_private.save_versioned(
    p_id, p_summary, p_checks, p_signature_name, p_command_id, p_before_photo_id, p_after_photo_id
  )
$$;

create or replace function intervention_report_private.require_photos_before_completion()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if old.report_evidence_required and old.status = 'in_progress' and new.status = 'completed'
    and not exists (
      select 1 from public.intervention_reports r
      where r.intervention_id = new.id and r.artisan_id = new.artisan_id
        and intervention_report_private.photos_exist(new.id, new.artisan_id, r.before_photo_id, r.after_photo_id)
    )
  then raise exception 'report_photos_required' using errcode = 'P0001'; end if;
  return new;
end;
$$;
drop trigger if exists require_report_photos_before_completion on public.interventions;
create trigger require_report_photos_before_completion before update of status on public.interventions
  for each row execute function intervention_report_private.require_photos_before_completion();

create or replace function public.sign_intervention_report(
  p_id uuid, p_report_revision uuid, p_acknowledged boolean, p_signature_name text
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  job public.interventions;
  report public.intervention_reports;
  receipt public.intervention_report_receipts;
  signed_time timestamptz := clock_timestamp();
begin
  select * into job from public.interventions where id = p_id for update;
  if not found or auth.uid() is null or job.client_id is distinct from auth.uid()
  then raise insufficient_privilege; end if;
  if p_acknowledged is distinct from true or p_report_revision is null or p_signature_name is null
    or char_length(trim(p_signature_name)) not between 2 and 120 or p_signature_name !~ '[^[:space:]]'
  then raise invalid_parameter_value; end if;

  select * into receipt from public.intervention_report_receipts
    where intervention_id = p_id and report_revision = p_report_revision;
  if found then
    if receipt.signed_by is distinct from auth.uid() or receipt.signature_name <> trim(p_signature_name)
    then raise exception 'report_receipt_conflict' using errcode = 'P0001'; end if;
  else
    select * into report from public.intervention_reports where intervention_id = p_id;
    if not found or job.status not in ('completed', 'paid')
      or report.report_revision is distinct from p_report_revision
    then raise exception 'report_revision_changed' using errcode = 'P0001'; end if;

    perform public.consume_action('operations', 30);
    insert into public.intervention_report_receipts (
      intervention_id, report_revision, signed_by, acknowledged_at, signed_at, signature_name, report_snapshot
    ) values (
      p_id, p_report_revision, auth.uid(), signed_time, signed_time, trim(p_signature_name), to_jsonb(report)
    ) returning * into receipt;
    insert into public.audit_log(actor_id, intervention_id, action) values (auth.uid(), p_id, 'report_receipt_signed');
  end if;
  return jsonb_build_object(
    'report_revision', receipt.report_revision, 'acknowledged_at', receipt.acknowledged_at,
    'signed_at', receipt.signed_at, 'signature_name', receipt.signature_name
  );
end;
$$;

revoke all on all functions in schema intervention_report_private from public, anon, authenticated, service_role;
revoke all on function public.save_intervention_report(uuid, text, jsonb, text, uuid),
  public.save_intervention_report(uuid, text, jsonb, text, uuid, uuid, uuid),
  public.sign_intervention_report(uuid, uuid, boolean, text) from public, anon, authenticated, service_role;
grant execute on function public.save_intervention_report(uuid, text, jsonb, text, uuid),
  public.save_intervention_report(uuid, text, jsonb, text, uuid, uuid, uuid),
  public.sign_intervention_report(uuid, uuid, boolean, text) to authenticated;
commit;

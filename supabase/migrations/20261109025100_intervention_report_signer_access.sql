begin;

-- A former organization member can still be the recorded requester. Recheck dossier access
-- before signing or returning any previous receipt through the security-definer function.
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
    or not public.can_access_intervention(p_id)
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

commit;

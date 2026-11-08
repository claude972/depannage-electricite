begin;

create index personal_payment_reminders_account_export
  on public.personal_payment_reminders (recipient_id, id);

-- The write table and its payment bindings remain private. Only the holder's
-- personal scheduling records enter this read-only projection.
create function public.export_personal_payment_reminders(p_after uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  page jsonb;
  next_id uuid;
begin
  if actor is null then raise insufficient_privilege; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', entry.id,
    'recipient_id', entry.recipient_id,
    'version', entry.version,
    'remind_at', entry.remind_at,
    'status', entry.status,
    'processed_at', entry.processed_at
  ) order by entry.id), '[]'::jsonb)
  into page
  from (
    select r.id, r.recipient_id, r.version, r.remind_at, r.status, r.processed_at
    from public.personal_payment_reminders r
    where r.recipient_id = actor and (p_after is null or r.id > p_after)
    order by r.id
    limit 101
  ) entry;

  if jsonb_array_length(page) = 101 then
    next_id := (page -> 99 ->> 'id')::uuid;
    page := page - 100;
  end if;

  return jsonb_build_object('rows', page, 'next_cursor', next_id);
end;
$$;

revoke all on function public.export_personal_payment_reminders(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.export_personal_payment_reminders(uuid)
  to authenticated;

commit;

begin;

create or replace function public.decide_artisan_application(
  p_user_id uuid, p_action text, p_expected_version integer, p_command_id uuid
)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  prior jsonb;
  payload bytea := sha256(convert_to(jsonb_build_array(p_action, p_expected_version)::text, 'UTF8'));
begin
  if not public.is_admin() then raise insufficient_privilege; end if;
  prior := command_replay_private.read_locked('artisan_decision', p_command_id, p_user_id, payload);
  if prior is not null then return; end if;

  perform public.decide_artisan_application(p_user_id, p_action, p_expected_version);
  insert into command_replay_private.receipts (scope, command_id, actor_id, target_id, fingerprint, result)
    values ('artisan_decision', p_command_id, auth.uid(), p_user_id, payload, '{"success":true}');
end;
$$;

revoke all on function public.decide_artisan_application(uuid, text, integer)
  from public, anon, authenticated, service_role;
revoke all on function public.decide_artisan_application(uuid, text, integer, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.decide_artisan_application(uuid, text, integer, uuid) to authenticated;

commit;

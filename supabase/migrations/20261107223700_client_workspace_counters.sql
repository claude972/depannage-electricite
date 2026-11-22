begin;

create function public.client_workspace_counters()
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  actor uuid := auth.uid();
begin
  if actor is null or not exists (select 1 from public.profiles where id = actor and role = 'client') then
    raise insufficient_privilege;
  end if;
  return (
    with owned as not materialized (select id, status from public.interventions where client_id = actor)
    select jsonb_build_object(
      'active_interventions', (select count(*) from owned where status not in ('paid', 'cancelled')),
      'received_messages', (select count(*) from owned i join public.messages m on m.intervention_id = i.id where m.author_id <> actor)
    )
  );
end;
$$;
revoke all on function public.client_workspace_counters() from public, anon, authenticated, service_role;
grant execute on function public.client_workspace_counters() to authenticated;

commit;

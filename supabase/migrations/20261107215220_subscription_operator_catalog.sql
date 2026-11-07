begin;

create function public.subscription_operator_catalog(p_live boolean)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.has_platform_scope('finance_read') then
    raise insufficient_privilege;
  end if;
  if p_live is null then raise invalid_parameter_value; end if;
  return jsonb_build_object(
    'can_write', public.has_platform_scope('finance_write'),
    'catalog_enabled', coalesce((select enabled from subscription_private.control where singleton), false),
    'offers', coalesce((select jsonb_agg(to_jsonb(o) order by o.id)
      from subscription_private.offers o where o.live = p_live), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.subscription_operator_catalog(boolean) from public, anon, authenticated, service_role;
grant execute on function public.subscription_operator_catalog(boolean) to authenticated;

commit;

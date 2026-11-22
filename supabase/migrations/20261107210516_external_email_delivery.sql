begin;

alter table notification_delivery_private.outbox add column email_payload_fingerprint bytea;

-- Bind the exact verified address and the sender/body fingerprint to this delivery before
-- opening the network request. Resend retains idempotency keys for 24 hours. Bound our own
-- window from the earlier enqueue time, including recovery after an outage.
create function public.authorize_external_email(p_id uuid, p_lease uuid, p_payload_tag text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  item notification_delivery_private.outbox;
  address text;
  fingerprint bytea;
begin
  if p_payload_tag is null or p_payload_tag !~ '^[0-9a-f]{64}$' then
    raise invalid_parameter_value;
  end if;
  select * into item from notification_delivery_private.outbox where id = p_id for update;
  if not found or item.channel <> 'email' or item.provider is distinct from 'resend'
    or item.status <> 'sending' or item.lease_token is distinct from p_lease
    or item.lease_until <= clock_timestamp()
    or item.created_at <= clock_timestamp() - interval '23 hours'
    or not exists (select 1 from notification_delivery_private.control
                   where enabled and generation = item.activation_generation)
    or not notification_delivery_private.eligible(item.notification_id, 'email') then
    return null;
  end if;

  select u.email into address
  from public.notifications n join auth.users u on u.id = n.recipient_id
  where n.id = item.notification_id and u.email_confirmed_at is not null;
  if address is null or char_length(address) > 254 or address ~ '[[:space:][:cntrl:]]' then
    return null;
  end if;

  fingerprint := sha256(convert_to(jsonb_build_array(p_payload_tag, address)::text, 'UTF8'));
  if item.email_payload_fingerprint is not null and item.email_payload_fingerprint <> fingerprint then
    return null;
  end if;
  update notification_delivery_private.outbox set email_payload_fingerprint = fingerprint where id = p_id;
  return address;
end;
$$;
revoke all on function public.authorize_external_email(uuid, uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.authorize_external_email(uuid, uuid, text) to service_role;

create function public.external_notification_dispatch_enabled()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from notification_delivery_private.control where enabled);
$$;
revoke all on function public.external_notification_dispatch_enabled() from public, anon, authenticated, service_role;
grant execute on function public.external_notification_dispatch_enabled() to service_role;

commit;

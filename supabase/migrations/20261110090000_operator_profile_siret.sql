begin;

-- Additive: same rules as 20261108043254 plus the optional SIRET (14 digits, only alongside the
-- SIREN it starts with). Existing rows carry no SIRET and stay valid; the minimum required to
-- publish is unchanged.
create or replace function public.valid_public_operator_profile(p_profile jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare
  entry record;
  max_chars integer;
  value_text text;
begin
  if jsonb_typeof(p_profile) is distinct from 'object' then return false; end if;
  for entry in select key, value from jsonb_each(p_profile) loop
    max_chars := case entry.key
      when 'about_text' then 2000
      when 'hq_address' then 500
      when 'host_address' then 500
      when 'public_email' then 254
      when 'privacy_email' then 254
      when 'privacy_controller' then 200
      when 'privacy_retention' then 2000
      when 'privacy_notice' then 8000
      when 'team_text' then 4000
      when 'network_terms' then 8000
      when 'host_contact' then 254
      when 'public_phone' then 16
      when 'siren' then 9
      when 'siret' then 14
      when 'vat_number' then 16
      when 'legal_name' then 160
      when 'legal_form' then 80
      when 'publication_director' then 160
      when 'display_name' then 120
      when 'host_name' then 160
      when 'rights_holder' then 160
      when 'service_area' then 500
      else 0
    end;
    if max_chars = 0 or jsonb_typeof(entry.value) <> 'string' then return false; end if;
    value_text := entry.value #>> '{}';
    if char_length(value_text) not between 1 and max_chars or btrim(value_text) <> value_text then return false; end if;
    if entry.key in ('public_email','privacy_email') and value_text !~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$' then return false; end if;
    if entry.key = 'public_phone' and value_text !~ '^[+][1-9][0-9]{6,14}$' then return false; end if;
    if entry.key = 'siren' and value_text !~ '^[0-9]{9}$' then return false; end if;
    if entry.key = 'siret' and value_text !~ '^[0-9]{14}$' then return false; end if;
    if entry.key = 'vat_number' and value_text !~ '^[A-Z]{2}[0-9A-Z]{2,14}$' then return false; end if;
  end loop;
  value_text := p_profile ->> 'siret';
  if value_text is not null and left(value_text, 9) is distinct from (p_profile ->> 'siren') then return false; end if;
  return true;
end;
$$;
revoke all on function public.valid_public_operator_profile(jsonb) from public, anon, authenticated, service_role;

commit;

begin;

-- Website signup (POST /api/auth/signup) validates the phone number and sends it, already
-- normalised, in the user metadata: +596, +590 or +33 followed by nine digits.
-- The profile receives it when the account is created, so the number is there before the first login.
-- Any other value keeps the empty default, and so does an account created without a number
-- (the native builds already delivered sign up that way): nothing is refused at this level.
create or replace function public.create_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  given_name text;
  family_name text;
  complete_name text;
  contact_phone text := '';
begin
  if jsonb_typeof(new.raw_user_meta_data->'first_name') = 'string'
    and jsonb_typeof(new.raw_user_meta_data->'last_name') = 'string' then
    given_name := btrim(new.raw_user_meta_data->>'first_name');
    family_name := btrim(new.raw_user_meta_data->>'last_name');
  end if;

  if char_length(given_name) between 1 and 60
    and char_length(family_name) between 1 and 60
    and char_length(given_name || ' ' || family_name) <= 120 then
    complete_name := given_name || ' ' || family_name;
  else
    given_name := null;
    family_name := null;
    complete_name := left(coalesce(nullif(trim(new.raw_user_meta_data->>'full_name'), ''), 'Mon compte'), 120);
  end if;

  if jsonb_typeof(new.raw_user_meta_data->'phone') = 'string'
    and new.raw_user_meta_data->>'phone' ~ '^\+(596|590|33)[1-9][0-9]{8}$' then
    contact_phone := new.raw_user_meta_data->>'phone';
  end if;

  insert into public.profiles (id, role, full_name, first_name, last_name, phone)
  values (new.id,
    case when new.raw_user_meta_data->>'role' in ('artisan','manager') then new.raw_user_meta_data->>'role' else 'client' end,
    complete_name, given_name, family_name, contact_phone);
  return new;
end;
$$;

commit;

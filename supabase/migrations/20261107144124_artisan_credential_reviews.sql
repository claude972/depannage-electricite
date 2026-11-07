begin;

create table public.artisan_credential_reviews (
  credential_id uuid not null references public.artisan_credentials(id),
  version integer not null check (version > 0),
  command_id uuid not null unique,
  reviewer_id uuid not null references public.profiles(id),
  decision text not null check (decision in ('accepted', 'changes_requested', 'rejected')),
  reason text not null check (char_length(btrim(reason)) between 1 and 1000),
  reviewed_at timestamptz not null default clock_timestamp(),
  primary key (credential_id, version)
);

alter table public.artisan_credential_reviews enable row level security;
revoke all on table public.artisan_credential_reviews from public, anon, authenticated, service_role;

-- Keep the exact document metadata referenced by a decision. Corrections use a new document.
create function public.freeze_reviewed_artisan_credential()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (new.kind is distinct from old.kind or new.expires_on is distinct from old.expires_on)
    and exists (
      select 1 from public.artisan_credential_reviews where credential_id = old.id
    ) then
    raise exception 'A reviewed credential requires a new document' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke all on function public.freeze_reviewed_artisan_credential() from public, anon, authenticated, service_role;
create trigger freeze_reviewed_artisan_credential
  before update of kind, expires_on on public.artisan_credentials
  for each row execute function public.freeze_reviewed_artisan_credential();

create function public.read_artisan_credential_reviews(p_credential_id uuid, p_before_version integer default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  actor_role text;
  credential public.artisan_credentials;
begin
  if actor is null then raise insufficient_privilege; end if;
  if p_credential_id is null or (p_before_version is not null and p_before_version <= 1) then
    raise invalid_parameter_value;
  end if;

  select role into actor_role from public.profiles where id = actor;
  select * into credential from public.artisan_credentials
    where id = p_credential_id and (actor_role = 'admin' or (actor_role = 'artisan' and user_id = actor));
  if not found then raise no_data_found; end if;

  return jsonb_build_object(
    'credential_id', credential.id,
    'kind', credential.kind,
    'expires_on', credential.expires_on,
    'can_review', actor_role = 'admin',
    'current_version', coalesce((
      select max(version) from public.artisan_credential_reviews where credential_id = credential.id
    ), 0),
    'reviews', coalesce((
      select jsonb_agg(to_jsonb(r) order by r.version desc) from (
        select version, decision, reason, reviewed_at
        from public.artisan_credential_reviews
        where credential_id = credential.id and (p_before_version is null or version < p_before_version)
        order by version desc limit 51
      ) r
    ), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.read_artisan_credential_reviews(uuid, integer) from public, anon, authenticated, service_role;
grant execute on function public.read_artisan_credential_reviews(uuid, integer) to authenticated;

create function public.review_artisan_credential(
  p_credential_id uuid, p_command_id uuid, p_expected_version integer, p_decision text, p_reason text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  credential public.artisan_credentials;
  review public.artisan_credential_reviews;
  current_version integer;
  reason_text text := btrim(p_reason);
begin
  if actor is null then raise insufficient_privilege; end if;
  perform 1 from public.profiles where id = actor and role = 'admin' for share;
  if not found then raise insufficient_privilege; end if;

  if p_credential_id is null or p_command_id is null or p_expected_version is null or p_expected_version not between 0 and 2147483646
    or p_decision is null or p_decision not in ('accepted', 'changes_requested', 'rejected')
    or reason_text is null or char_length(reason_text) not between 1 and 1000 then
    raise invalid_parameter_value;
  end if;

  select * into credential from public.artisan_credentials where id = p_credential_id for update;
  if not found then raise no_data_found; end if;

  select * into review from public.artisan_credential_reviews where command_id = p_command_id;
  if found then
    if review.credential_id <> p_credential_id or review.reviewer_id <> actor
      or review.version <> p_expected_version + 1 or review.decision <> p_decision or review.reason <> reason_text then
      raise exception 'Credential review command conflict' using errcode = 'P0001';
    end if;
  else
    select coalesce(max(version), 0) into current_version
      from public.artisan_credential_reviews where credential_id = credential.id;
    if p_expected_version <> current_version then
      raise exception 'Credential review version conflict' using errcode = 'P0001';
    end if;
    if p_decision = 'accepted' and credential.expires_on < timezone('America/Martinique', now())::date then
      raise exception 'An expired credential cannot be accepted' using errcode = '22023';
    end if;

    perform public.consume_action('artisan_credential_review', 30);
    insert into public.artisan_credential_reviews (credential_id, version, command_id, reviewer_id, decision, reason)
      values (credential.id, current_version + 1, p_command_id, actor, p_decision, reason_text)
      returning * into review;
    insert into public.audit_log (actor_id, action)
      values (actor, 'artisan_credential_review:' || credential.id::text || ':' || review.version::text || ':' || review.decision);
  end if;

  return to_jsonb(review) - array['reviewer_id', 'command_id'];
end;
$$;
revoke all on function public.review_artisan_credential(uuid, uuid, integer, text, text) from public, anon, authenticated, service_role;
grant execute on function public.review_artisan_credential(uuid, uuid, integer, text, text) to authenticated;

commit;

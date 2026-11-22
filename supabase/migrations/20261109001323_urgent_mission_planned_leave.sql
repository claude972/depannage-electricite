begin;

-- Listing and acceptance share this predicate. The planning writer and mission
-- acceptance already serialize on the same profile and artisan profile rows.
create or replace function public.mission_eligible(p_id uuid, p_artisan_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.interventions i
    join public.artisan_profiles a on a.user_id = p_artisan_id
    join public.profiles p on p.id = a.user_id
    where i.id = p_id and i.status = 'requested' and i.artisan_id is null
      and i.client_id <> p_artisan_id and p.role = 'artisan' and p.artisan_approved
      and a.application_status = 'approved' and a.available
      and i.postal_code = any(a.postal_codes) and i.category = any(a.categories)
      and not exists (
        select 1 from public.mission_declines d
        where d.intervention_id = i.id and d.artisan_id = p_artisan_id
      )
      and (i.urgency <> 'urgent' or not exists (
        select 1 from public.artisan_planning_entries e
        where e.artisan_id = p_artisan_id and e.kind = 'unavailable'
          and e.starts_at <= statement_timestamp() and e.ends_at > statement_timestamp()
      ))
      and mission_radius_private.within_radius(i.id, p_artisan_id)
  );
$$;

commit;

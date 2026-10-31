-- Cross-review CL-001: suspension remains an operator decision, not an editable application state.
-- All affected writers acquire locks in the same order: profiles, then artisan_profiles.
-- CL-002: restrict the offer scan to the indexed open/unassigned candidate set first.
begin;

alter function public.save_artisan_profile(text,text,text,integer,text,text[],text[]) rename to save_artisan_profile_before_suspension_guard;
alter function public.submit_artisan_application() rename to submit_artisan_application_before_suspension_guard;
alter function public.set_artisan_availability(boolean) rename to set_artisan_availability_before_suspension_guard;
revoke execute on function public.save_artisan_profile_before_suspension_guard(text,text,text,integer,text,text[],text[]),public.submit_artisan_application_before_suspension_guard(),public.set_artisan_availability_before_suspension_guard(boolean) from public,anon,authenticated;

create function public.guard_artisan_self_edit() returns void language plpgsql security definer set search_path='' as $$
declare account public.profiles; dossier public.artisan_profiles;
begin
 select * into account from public.profiles where id=auth.uid() for update;
 if not found or account.role<>'artisan' then raise insufficient_privilege; end if;
 select * into dossier from public.artisan_profiles where user_id=auth.uid() for update;
 if found and dossier.application_status='suspended' then raise insufficient_privilege; end if;
end; $$;
revoke execute on function public.guard_artisan_self_edit() from public,anon,authenticated;

create function public.save_artisan_profile(p_company_name text,p_siret text,p_legal_status text,p_employee_count integer,p_address text,p_postal_codes text[],p_categories text[])
returns public.artisan_profiles language plpgsql security definer set search_path='' as $$
begin
 perform public.guard_artisan_self_edit();
 return public.save_artisan_profile_before_suspension_guard(p_company_name,p_siret,p_legal_status,p_employee_count,p_address,p_postal_codes,p_categories);
end; $$;
create function public.submit_artisan_application() returns public.artisan_profiles language plpgsql security definer set search_path='' as $$
begin
 perform public.guard_artisan_self_edit();
 return public.submit_artisan_application_before_suspension_guard();
end; $$;
create function public.set_artisan_availability(p_available boolean) returns public.artisan_profiles language plpgsql security definer set search_path='' as $$
begin
 perform public.guard_artisan_self_edit();
 return public.set_artisan_availability_before_suspension_guard(p_available);
end; $$;

create or replace function public.approve_artisan(p_user_id uuid,p_approved boolean) returns void language plpgsql security definer set search_path='' as $$
declare account public.profiles; dossier public.artisan_profiles; next_status text;
begin
 if not public.is_admin() then raise insufficient_privilege; end if;
 if p_approved is null then raise invalid_parameter_value; end if;
 select * into account from public.profiles where id=p_user_id for update;
 if not found or account.role<>'artisan' then raise no_data_found; end if;
 select * into dossier from public.artisan_profiles where user_id=p_user_id for update;
 if p_approved then
  -- Explicit operator reinstatement is permitted only for a configured, submitted/reviewed dossier.
  -- This checks required declared fields, not legal identity or qualification authenticity.
  if dossier.user_id is null or dossier.application_status not in ('submitted','approved','suspended')
   or char_length(trim(dossier.company_name))<1 or char_length(dossier.siret)<>14
   or char_length(trim(dossier.address))<5 or cardinality(dossier.postal_codes)<1 or cardinality(dossier.categories)<1 then
   raise exception 'A complete submitted application is required for approval or reinstatement' using errcode='P0001';
  end if;
  next_status='approved';
 else
  -- A repeated suspension must never become changes_requested. Preserve legacy approved
  -- accounts without a dossier as an explicit suspended shell, rather than enabling self-reset.
  next_status=case when account.artisan_approved or dossier.application_status in ('approved','suspended') then 'suspended' else 'changes_requested' end;
 end if;
 update public.profiles set artisan_approved=p_approved where id=p_user_id;
 insert into public.artisan_profiles(user_id,application_status,available)
 values(p_user_id,next_status,false)
 on conflict(user_id) do update set application_status=excluded.application_status,
 available=case when p_approved then public.artisan_profiles.available else false end,updated_at=now();
 insert into public.audit_log(actor_id,action) values(auth.uid(),'artisan_approval:'||p_user_id::text||':'||p_approved::text);
end; $$;

create or replace function public.available_missions() returns table(id uuid,category text,city text,postal_code text,urgency text,status text,estimate_min_cents integer,estimate_max_cents integer,created_at timestamptz)
language sql stable security definer set search_path='' as $$
 select i.id,i.category,i.city,left(i.postal_code,3)||'**',i.urgency,i.status,i.estimate_min_cents,i.estimate_max_cents,i.created_at
 from public.interventions i
 where i.status='requested' and i.artisan_id is null and public.mission_eligible(i.id,auth.uid())
 order by i.created_at,i.id limit 100;
$$;

revoke execute on function public.save_artisan_profile(text,text,text,integer,text,text[],text[]),public.submit_artisan_application(),public.set_artisan_availability(boolean),public.approve_artisan(uuid,boolean),public.available_missions() from public,anon,authenticated;
grant execute on function public.save_artisan_profile(text,text,text,integer,text,text[],text[]),public.submit_artisan_application(),public.set_artisan_availability(boolean),public.approve_artisan(uuid,boolean),public.available_missions() to authenticated;
commit;

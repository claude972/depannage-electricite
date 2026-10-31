-- CL-BE-001: retain approval while attributed work or settlement is outstanding.
-- Assignment writers serialize with profile edits; the edit guard never locks jobs.
begin;
alter function public.save_artisan_profile(text,text,text,integer,text,text[],text[]) rename to save_artisan_profile_before_active_work_guard;
revoke execute on function public.save_artisan_profile_before_active_work_guard(text,text,text,integer,text,text[],text[]) from public,anon,authenticated;
create function public.save_artisan_profile(p_company_name text,p_siret text,p_legal_status text,p_employee_count integer,p_address text,p_postal_codes text[],p_categories text[])
returns public.artisan_profiles language plpgsql security definer set search_path='' as $$
begin
 -- Existing guard validates the artisan/suspension and locks profile -> artisan dossier.
 perform public.guard_artisan_self_edit();
 -- Ordinary MVCC read only: taking a job lock here would reverse assignment lock order.
 if exists(select 1 from public.interventions where artisan_id=auth.uid() and status in ('assigned','quoted','accepted','in_progress','completed')) then
  raise exception 'Terminez les missions et leurs règlements avant de modifier votre dossier professionnel.' using errcode='P0001';
 end if;
 return public.save_artisan_profile_before_active_work_guard(p_company_name,p_siret,p_legal_status,p_employee_count,p_address,p_postal_codes,p_categories);
end; $$;

alter function public.intervention_action(uuid,text,jsonb,numeric,uuid) rename to intervention_action_before_active_work_guard;
revoke execute on function public.intervention_action_before_active_work_guard(uuid,text,jsonb,numeric,uuid) from public,anon,authenticated;
create function public.intervention_action(p_id uuid,p_action text,p_lines jsonb default null,p_tax_rate numeric default 20,p_quote_id uuid default null)
returns public.interventions language plpgsql security definer set search_path='' as $$
begin
 if p_action='accept_mission' then
  if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid() and role='artisan') then raise insufficient_privilege; end if;
  perform public.lock_intervention_organization(p_id);
  perform 1 from public.interventions where id=p_id for update;
  if not found then raise no_data_found; end if;
  perform 1 from public.profiles where id=auth.uid() for update;
  perform 1 from public.artisan_profiles where user_id=auth.uid() for update;
 end if;
 -- Existing scope, status, exact-quote, approval, amounts and eligibility remain authoritative.
 return public.intervention_action_before_active_work_guard(p_id,p_action,p_lines,p_tax_rate,p_quote_id);
end; $$;

alter function public.reassign_intervention(uuid,uuid,text) rename to reassign_intervention_before_active_work_guard;
revoke execute on function public.reassign_intervention_before_active_work_guard(uuid,uuid,text) from public,anon,authenticated;
create function public.reassign_intervention(p_id uuid,p_artisan_id uuid,p_reason text)
returns public.interventions language plpgsql security definer set search_path='' as $$
begin
 -- Validate the operator before acquiring any lock on a different target account.
 if not public.is_admin() then raise insufficient_privilege; end if;
 perform public.lock_intervention_organization(p_id);
 perform 1 from public.interventions where id=p_id for update;
 if not found then raise no_data_found; end if;
 if p_artisan_id is not null then
  perform 1 from public.profiles where id=p_artisan_id and role='artisan' for update;
  if not found then raise insufficient_privilege; end if;
  perform 1 from public.artisan_profiles where user_id=p_artisan_id for update;
 end if;
 return public.reassign_intervention_before_active_work_guard(p_id,p_artisan_id,p_reason);
end; $$;

revoke execute on function public.save_artisan_profile(text,text,text,integer,text,text[],text[]),public.intervention_action(uuid,text,jsonb,numeric,uuid),public.reassign_intervention(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.save_artisan_profile(text,text,text,integer,text,text[],text[]),public.intervention_action(uuid,text,jsonb,numeric,uuid),public.reassign_intervention(uuid,uuid,text) to authenticated;
commit;

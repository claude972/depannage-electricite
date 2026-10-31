-- Accept only the exact quote version displayed to the deciding user.
begin;
alter function public.intervention_action(uuid,text,jsonb,numeric) rename to intervention_action_checked_base;
revoke execute on function public.intervention_action_checked_base(uuid,text,jsonb,numeric) from public,anon,authenticated;
create function public.intervention_action(p_id uuid,p_action text,p_lines jsonb default null,p_tax_rate numeric default 20,p_quote_id uuid default null)
returns public.interventions language plpgsql security definer set search_path='' as $$
declare job public.interventions;
begin
 select * into job from public.interventions where id=p_id for update;
 if not found then raise no_data_found; end if;
 if p_action='accept_quote' then
  if not public.owns_intervention(p_id) then raise insufficient_privilege; end if;
  if p_quote_id is null then raise invalid_parameter_value; end if;
  if job.status<>'quoted' then raise exception 'Invalid transition' using errcode='P0001'; end if;
  perform 1 from public.quotes where id=p_quote_id and intervention_id=p_id and status='sent' for update;
  if not found then raise exception 'Displayed quote is no longer active' using errcode='P0001'; end if;
 elsif p_quote_id is not null then raise invalid_parameter_value;
 end if;
 return public.intervention_action_checked_base(p_id,p_action,p_lines,p_tax_rate);
end; $$;
revoke execute on function public.intervention_action(uuid,text,jsonb,numeric,uuid) from public,anon,authenticated;
grant execute on function public.intervention_action(uuid,text,jsonb,numeric,uuid) to authenticated;
commit;

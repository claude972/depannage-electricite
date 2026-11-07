-- Read-only anonymized eligible feed. Acceptance remains the existing locked intervention_action.
begin;
create function public.available_missions_page(p_after_at timestamptz default null,p_after_id uuid default null,p_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor uuid=auth.uid(); eligible boolean;
begin
 if actor is null or not exists(select 1 from public.profiles where id=actor and role='artisan')then raise insufficient_privilege;end if;
 if (p_after_at is null)<>(p_after_id is null)or not isfinite(coalesce(p_after_at,now()))or(p_id is not null and p_after_at is not null)then raise invalid_parameter_value;end if;
 select coalesce(p.artisan_approved and a.application_status='approved' and a.available,false)into eligible from public.profiles p left join public.artisan_profiles a on a.user_id=p.id where p.id=actor;
 return jsonb_build_object('eligible',eligible,'captured_at',now(),'items',(
 select coalesce(jsonb_agg(to_jsonb(r)order by r.created_at,r.id),'[]'::jsonb)from(
 select i.id,i.category,i.city,left(i.postal_code,3)||'**'as postal_code,i.urgency,i.status,i.estimate_min_cents,i.estimate_max_cents,i.created_at
 from public.interventions i where eligible and i.status='requested'and i.artisan_id is null and(p_id is null or i.id=p_id)
 and(p_after_at is null or(i.created_at,i.id)>(p_after_at,p_after_id))
 and public.mission_eligible(i.id,actor) order by i.created_at,i.id limit 51
 )r));
end;$$;
revoke all on function public.available_missions_page(timestamptz,uuid,uuid)from public,anon,authenticated,service_role;
grant execute on function public.available_missions_page(timestamptz,uuid,uuid)to authenticated;
commit;

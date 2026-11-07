begin;
create or replace function public.artisan_mission_history_page(p_filter text,p_before_at timestamptz default null,p_before_id uuid default null)
returns jsonb language plpgsql stable security invoker set search_path=''as $$
declare rows jsonb; counts jsonb;
begin
 if auth.uid()is null or not exists(select 1 from public.profiles p where p.id=auth.uid()and p.role='artisan')then raise insufficient_privilege;end if;
 if p_filter is null or p_filter not in('active','done')or((p_before_at is null)<>(p_before_id is null))or(p_before_at is not null and not isfinite(p_before_at))then raise invalid_parameter_value;end if;
 -- Deliberately invoker: existing intervention RLS still applies before this projection.
 -- Site scopes or other participant relationships never replace exact assignment here.
 -- Page and both complete counts share this one statement snapshot and current RLS.
 select coalesce(jsonb_agg(to_jsonb(x)order by x.created_at desc,x.id desc),'[]'::jsonb),
 (select jsonb_build_object(
   'active',count(*)filter(where c.status in('assigned','quoted','accepted','in_progress')),
   'done',count(*)filter(where c.status in('completed','paid')))
  from public.interventions c where c.artisan_id=auth.uid()
  and c.status in('assigned','quoted','accepted','in_progress','completed','paid'))
 into rows,counts from(
  select i.id,i.category,i.address,i.city,i.urgency,i.status,i.created_at,i.completed_at,i.paid_at
  from public.interventions i
  where i.artisan_id=auth.uid()
  and((p_filter='active'and i.status in('assigned','quoted','accepted','in_progress'))or(p_filter='done'and i.status in('completed','paid')))
  and(p_before_at is null or(i.created_at,i.id)<(p_before_at,p_before_id))
  order by i.created_at desc,i.id desc limit 51
 )x;
 return jsonb_build_object('items',rows,'counts',counts,'captured_at',statement_timestamp());
end;$$;
commit;

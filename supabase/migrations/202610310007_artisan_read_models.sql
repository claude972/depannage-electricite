-- Artisan-owned dashboard aggregates are not limited by workspace pagination.
-- Security-definer scope is derived from auth.uid(), never a browser target id.
begin;
create function public.artisan_performance(
 p_current_start timestamptz,p_current_end timestamptz,
 p_previous_start timestamptz,p_previous_end timestamptz
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
 actor uuid=auth.uid(); current_amount numeric; previous_amount numeric;
 current_paid bigint; previous_paid bigint; current_completed bigint; previous_completed bigint;
 review_count bigint; review_average numeric; growth numeric;
begin
 if actor is null or not exists(select 1 from public.profiles where id=actor and role='artisan') then raise insufficient_privilege; end if;
 if p_current_start is null or p_current_end is null or p_previous_start is null or p_previous_end is null
 or not isfinite(p_current_start) or not isfinite(p_current_end) or not isfinite(p_previous_start) or not isfinite(p_previous_end)
 or p_current_end<=p_current_start or p_previous_end<=p_previous_start
 or p_current_end-p_current_start>interval '32 days' or p_previous_end-p_previous_start>interval '32 days'
 or p_previous_end<>p_current_start then raise invalid_parameter_value; end if;
 select coalesce(sum(p.total_cents) filter(where p.paid_at>=p_current_start and p.paid_at<p_current_end),0),
 coalesce(sum(p.total_cents) filter(where p.paid_at>=p_previous_start and p.paid_at<p_previous_end),0),
 count(*) filter(where p.paid_at>=p_current_start and p.paid_at<p_current_end),
 count(*) filter(where p.paid_at>=p_previous_start and p.paid_at<p_previous_end)
 into current_amount,previous_amount,current_paid,previous_paid
 from public.payments p join public.quotes q on q.id=p.quote_id join public.interventions i on i.id=q.intervention_id
 where i.artisan_id=actor and q.artisan_id=actor and p.status='paid' and p.paid_at>=p_previous_start and p.paid_at<p_current_end;
 select count(*) filter(where i.completed_at>=p_current_start and i.completed_at<p_current_end),
 count(*) filter(where i.completed_at>=p_previous_start and i.completed_at<p_previous_end)
 into current_completed,previous_completed from public.interventions i
 where i.artisan_id=actor and i.status in ('completed','paid') and i.completed_at>=p_previous_start and i.completed_at<p_current_end;
 select count(*),round(avg(r.rating),1) into review_count,review_average
 from public.reviews r join public.interventions i on i.id=r.intervention_id where i.artisan_id=actor;
 -- JSON numbers must survive JavaScript without rounding a monetary total or a count.
 if greatest(current_amount,previous_amount,current_paid,previous_paid,current_completed,previous_completed,review_count)>9007199254740991 then
  raise exception 'Aggregate exceeds safe integer range' using errcode='22003';
 end if;
 growth=case when previous_amount=0 then null else round((current_amount-previous_amount)*100/previous_amount,1) end;
 return jsonb_build_object(
 'period',jsonb_build_object('current_start',p_current_start,'current_end',p_current_end,'previous_start',p_previous_start,'previous_end',p_previous_end,'boundary','inclusive_start_exclusive_end'),
 'current',jsonb_build_object('paid_service_cents',current_amount,'paid_count',current_paid,'completed_missions_count',current_completed),
 'previous',jsonb_build_object('paid_service_cents',previous_amount,'paid_count',previous_paid,'completed_missions_count',previous_completed),
 'rating',jsonb_build_object('average',review_average,'count',review_count,'period','all_time'),
 'growth_percent',growth,'punctuality_rate',null,'currency','eur','scope','all_current_artisan_records','limited',false,
 'basis',jsonb_build_object(
 'revenue','Prestations TTC dont le règlement est confirmé (payment.status=paid), selon paid_at. Ce montant ne représente pas le net artisan, les transferts ou les virements bancaires.',
 'completed','Interventions terminées ou payées, selon completed_at, sur chaque intervalle.',
 'rating','Moyenne de tous les avis liés aux interventions attribuées à cet artisan ; arrondie à une décimale.',
 'growth','Écart du montant payé par rapport à la période précédente, arrondi à une décimale ; absent si le précédent montant est nul.',
 'punctuality','Non calculée : définition et source de ponctualité non établies.'));
end; $$;
revoke execute on function public.artisan_performance(timestamptz,timestamptz,timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function public.artisan_performance(timestamptz,timestamptz,timestamptz,timestamptz) to authenticated;
commit;

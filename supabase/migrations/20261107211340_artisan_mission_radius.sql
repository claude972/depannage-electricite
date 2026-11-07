begin;
create schema if not exists mission_radius_private;
revoke all on schema mission_radius_private from public,anon,authenticated,service_role;
create table mission_radius_private.commune_centres(
 code text primary key check(code~'^972[0-9]{2}$'),name text not null,
 postal_codes text[] not null,longitude double precision not null check(longitude between -180 and 180),latitude double precision not null check(latitude between -90 and 90)
);
alter table mission_radius_private.commune_centres enable row level security;
revoke all on mission_radius_private.commune_centres from public,anon,authenticated,service_role;
-- Official geo.api.gouv.fr snapshot: HTTP200, 34 distinct communes, GeoJSON Point [longitude,latitude].
-- URL https://geo.api.gouv.fr/departements/972/communes?fields=nom,code,codesPostaux,centre
-- Retrieved 2026-11-07T21:13:50Z. Raw SHA256 82062cf6109f14601417f446f737639756fb6278faf2e8a15f879632c4059ecc.
-- Public commune centres only: no personal coordinate and no runtime provider call.
insert into mission_radius_private.commune_centres(code,name,postal_codes,longitude,latitude)values
('97201','L''Ajoupa-Bouillon',array['97216'],-61.1305,14.816),
('97202','Les Anses-d''Arlet',array['97217'],-61.0736,14.4996),
('97203','Basse-Pointe',array['97218'],-61.1237,14.841),
('97204','Le Carbet',array['97221'],-61.1583,14.7041),
('97205','Case-Pilote',array['97222'],-61.1297,14.6594),
('97206','Le Diamant',array['97223'],-61.0165,14.4787),
('97207','Ducos',array['97224'],-60.9685,14.5785),
('97208','Fonds-Saint-Denis',array['97250'],-61.1207,14.7228),
('97209','Fort-de-France',array['97200','97234'],-61.0686,14.6492),
('97210','Le François',array['97240'],-60.8976,14.6093),
('97211','Grand''Rivière',array['97218'],-61.1836,14.847),
('97212','Gros-Morne',array['97213'],-61.0303,14.7084),
('97213','Le Lamentin',array['97232'],-60.9923,14.6231),
('97214','Le Lorrain',array['97214'],-61.074,14.7995),
('97215','Macouba',array['97218'],-61.1465,14.8474),
('97216','Le Marigot',array['97225'],-61.053,14.7795),
('97217','Le Marin',array['97290'],-60.8589,14.4822),
('97218','Le Morne-Rouge',array['97260'],-61.1217,14.7695),
('97219','Le Prêcheur',array['97250'],-61.1963,14.8221),
('97220','Rivière-Pilote',array['97211'],-60.897,14.5027),
('97221','Rivière-Salée',array['97215'],-60.9623,14.5262),
('97222','Le Robert',array['97231'],-60.9243,14.6786),
('97223','Saint-Esprit',array['97270'],-60.9233,14.5617),
('97224','Saint-Joseph',array['97212'],-61.0407,14.6835),
('97225','Saint-Pierre',array['97250'],-61.1735,14.7717),
('97226','Sainte-Anne',array['97227'],-60.8516,14.4314),
('97227','Sainte-Luce',array['97228'],-60.9467,14.4904),
('97228','Sainte-Marie',array['97230'],-61.0084,14.773),
('97229','Schœlcher',array['97233'],-61.1001,14.6518),
('97230','La Trinité',array['97220'],-60.9469,14.7518),
('97231','Les Trois-Îlets',array['97229'],-61.0376,14.5329),
('97232','Le Vauclin',array['97280'],-60.8595,14.542),
('97233','Le Morne-Vert',array['97226'],-61.1362,14.7046),
('97234','Bellefontaine',array['97222'],-61.146,14.6747);
create table mission_radius_private.preferences(
 artisan_id uuid primary key references public.artisan_profiles(user_id)on delete cascade,
 reference_code text references mission_radius_private.commune_centres(code),radius_km integer,
 version integer not null default 1 check(version between 1 and 2147483647),updated_at timestamptz not null default clock_timestamp(),
 check((reference_code is null and radius_km is null)or(reference_code is not null and radius_km between 1 and 200 and radius_km is not null))
);
alter table mission_radius_private.preferences enable row level security;
revoke all on mission_radius_private.preferences from public,anon,authenticated,service_role;
create function public.artisan_mission_radius()returns jsonb language plpgsql stable security definer set search_path=''as $$
declare p mission_radius_private.preferences;
begin
 if auth.uid()is null or not exists(select 1 from public.profiles where id=auth.uid()and role='artisan')then raise insufficient_privilege;end if;
 select *into p from mission_radius_private.preferences where artisan_id=auth.uid();
 return jsonb_build_object('preference',jsonb_build_object('version',coalesce(p.version,0),'reference_code',p.reference_code,'radius_km',p.radius_km),
 'options',(select jsonb_agg(jsonb_build_object('code',code,'name',name)order by name,code)from mission_radius_private.commune_centres),
 'source',jsonb_build_object('url','https://geo.api.gouv.fr/departements/972/communes?fields=nom,code,codesPostaux,centre','retrieved_at','2026-11-07T21:13:50Z'),
 'basis','commune_centres','unknown_postal_policy','postal_only');
end;$$;
create function public.save_artisan_mission_radius(p_expected_version integer,p_reference_code text,p_radius_km integer)returns jsonb language plpgsql security definer set search_path=''as $$
declare p mission_radius_private.preferences;
begin
 if auth.uid()is null then raise insufficient_privilege;end if;
 -- Same serialization order as acceptance/suspension. Never acquire any job lock here.
 perform 1 from public.profiles where id=auth.uid()and role='artisan'for update;
 if not found then raise insufficient_privilege;end if;
 perform 1 from public.artisan_profiles where user_id=auth.uid()for update;
 if not found then raise insufficient_privilege;end if;
 if p_expected_version is null or p_expected_version not between 0 and 2147483646 or(p_reference_code is null)<>(p_radius_km is null)or(p_radius_km is not null and p_radius_km not between 1 and 200)or(p_reference_code is not null and not exists(select 1 from mission_radius_private.commune_centres where code=p_reference_code))then raise invalid_parameter_value;end if;
 select *into p from mission_radius_private.preferences where artisan_id=auth.uid();
 if coalesce(p.version,0)<>p_expected_version then raise exception 'Radius preference changed'using errcode='P0001';end if;
 insert into mission_radius_private.preferences(artisan_id,reference_code,radius_km,version)values(auth.uid(),p_reference_code,p_radius_km,p_expected_version+1)
 on conflict(artisan_id)do update set reference_code=excluded.reference_code,radius_km=excluded.radius_km,version=excluded.version,updated_at=clock_timestamp();
 return public.artisan_mission_radius();
end;$$;
revoke all on function public.artisan_mission_radius(),public.save_artisan_mission_radius(integer,text,integer)from public,anon,authenticated,service_role;
grant execute on function public.artisan_mission_radius(),public.save_artisan_mission_radius(integer,text,integer)to authenticated;
create function mission_radius_private.within_radius(p_job uuid,p_artisan uuid)returns boolean language plpgsql stable security definer set search_path=''as $$
declare preference mission_radius_private.preferences;origin mission_radius_private.commune_centres;destination mission_radius_private.commune_centres;postal text;n integer;km double precision;
begin
 select *into preference from mission_radius_private.preferences where artisan_id=p_artisan;
 if preference.reference_code is null then return true;end if;
 select postal_code into postal from public.interventions where id=p_job;
 select count(*)into n from mission_radius_private.commune_centres where postal=any(postal_codes);
 -- No fabricated position from a city string, address, ambiguous/unknown postal or device GPS.
 -- Missing geographic evidence preserves the existing postal eligibility; never treats unknown as zero.
 if n<>1 then return true;end if;
 select *into origin from mission_radius_private.commune_centres where code=preference.reference_code;
 select *into destination from mission_radius_private.commune_centres where postal=any(postal_codes);
 km=2*6371.0088*asin(sqrt(least(1.0,greatest(0.0,
  power(sin(radians(destination.latitude-origin.latitude)/2),2)+cos(radians(origin.latitude))*cos(radians(destination.latitude))*power(sin(radians(destination.longitude-origin.longitude)/2),2)))));
 return km<=preference.radius_km;
end;$$;
revoke all on function mission_radius_private.within_radius(uuid,uuid)from public,anon,authenticated,service_role;
-- Keep the original predicate and OID: all existing listing/acceptance call sites see this addition.
-- Existing feed keeps its (created_at,id) cursor and evaluates eligibility BEFORE limit 51.
create or replace function public.mission_eligible(p_id uuid,p_artisan_id uuid)returns boolean language sql stable security definer set search_path=''as $$
 select exists(select 1 from public.interventions i join public.artisan_profiles a on a.user_id=p_artisan_id join public.profiles p on p.id=a.user_id
 where i.id=p_id and i.status='requested'and i.artisan_id is null and i.client_id<>p_artisan_id and p.role='artisan'and p.artisan_approved
 and a.application_status='approved'and a.available and i.postal_code=any(a.postal_codes)and i.category=any(a.categories)
 and not exists(select 1 from public.mission_declines d where d.intervention_id=i.id and d.artisan_id=p_artisan_id)
 and mission_radius_private.within_radius(i.id,p_artisan_id));
$$;
commit;

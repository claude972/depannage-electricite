begin;
create schema if not exists photo_triage_private;
revoke all on schema photo_triage_private from public,anon,authenticated,service_role;
create table photo_triage_private.reviews(
 id uuid primary key default gen_random_uuid(),intervention_id uuid not null references public.interventions(id)on delete cascade,
 document_id uuid not null unique references public.documents(id)on delete cascade,owner_id uuid not null references public.profiles(id),artisan_id uuid not null references public.profiles(id),
 document_path text not null,document_mime text not null check(document_mime in('image/jpeg','image/png','image/webp')),
 request_command_id uuid not null,version integer not null default 1 check(version between 1 and 2147483647),
 status text not null default 'requested'check(status in('requested','withdrawn','uncertain','awaiting_review','validated','rejected','invalidated')),
 category text check(category in('panel','socket','lighting','other','undetermined')),readability text check(readability in('readable','limited','unusable')),
 consent_at timestamptz not null default clock_timestamp(),transmission_reserved_at timestamptz,reviewed_at timestamptz,
 content_sha256 text check(content_sha256~'^[a-f0-9]{64}$'),created_at timestamptz not null default clock_timestamp(),
 check((category is null)=(readability is null))
);
create table photo_triage_private.commands(actor_id uuid not null references public.profiles(id)on delete cascade,command_id uuid not null,review_id uuid not null references photo_triage_private.reviews(id)on delete cascade,input jsonb not null,primary key(actor_id,command_id));
alter table photo_triage_private.reviews enable row level security;alter table photo_triage_private.commands enable row level security;
revoke all on all tables in schema photo_triage_private from public,anon,authenticated,service_role;
create function photo_triage_private.current(r photo_triage_private.reviews)returns boolean language sql stable security definer set search_path=''as $$
 select exists(select 1 from public.interventions i join public.documents d on d.id=r.document_id join public.profiles p on p.id=i.artisan_id join public.artisan_profiles a on a.user_id=p.id
 where i.id=r.intervention_id and i.site_id is null and i.client_id=r.owner_id and i.artisan_id=r.artisan_id and i.status<>'cancelled'
 and d.intervention_id=i.id and d.owner_id=r.owner_id and d.path=r.document_path and d.mime_type=r.document_mime
 and p.role='artisan'and p.artisan_approved and a.application_status='approved');
$$;
create function photo_triage_private.guard(p_job uuid)returns boolean language plpgsql stable security definer set search_path=''as $$
declare i public.interventions;role text;
begin
 select *into i from public.interventions where id=p_job;select p.role into role from public.profiles p where p.id=auth.uid();
 if auth.uid()is null or i.id is null or i.site_id is not null or i.artisan_id is null or i.status='cancelled'or not((role='client'and auth.uid()=i.client_id)or(role='artisan'and auth.uid()=i.artisan_id and exists(select 1 from public.profiles p join public.artisan_profiles a on a.user_id=p.id where p.id=auth.uid()and p.artisan_approved and a.application_status='approved')))then raise insufficient_privilege;end if;
 return role='client';
end;$$;
create function public.photo_review_list(p_job uuid)returns jsonb language plpgsql stable security definer set search_path=''as $$
declare owner boolean;
begin
 owner=photo_triage_private.guard(p_job);
 return jsonb_build_object('can_request',owner,'items',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'document_id',r.document_id,'version',r.version,'status',case when not photo_triage_private.current(r)then'invalidated'else r.status end,
 'can_withdraw',owner and r.status='requested'and photo_triage_private.current(r),
 'can_review',not owner and r.status='awaiting_review'and photo_triage_private.current(r),
 'result',case when photo_triage_private.current(r)and(r.status='validated'or(not owner and r.status='awaiting_review'))then jsonb_build_object('category',r.category,'readability',r.readability)else null end)order by r.created_at,r.id)from photo_triage_private.reviews r where r.intervention_id=p_job),'[]'::jsonb));
end;$$;
create function public.photo_review_command(p_job uuid,p_command uuid,p_action text,p_expected_version integer,p_document uuid default null,p_review uuid default null,p_consent boolean default null,p_decision text default null)returns uuid language plpgsql security definer set search_path=''as $$
declare owner boolean;r photo_triage_private.reviews;d public.documents;i public.interventions;previous photo_triage_private.commands;payload jsonb;
begin
 -- Serialize against assignment and document changes. No provider mutation exists in SQL.
 select *into i from public.interventions where id=p_job for update;owner=photo_triage_private.guard(p_job);
 if p_command is null or p_expected_version is null or p_expected_version not between 0 and 2147483646 or p_action is null or p_action not in('request','withdraw','review')then raise invalid_parameter_value;end if;
 payload=jsonb_build_object('job',p_job,'action',p_action,'version',p_expected_version,'document',p_document,'review',p_review,'consent',p_consent,'decision',p_decision);
 select *into previous from photo_triage_private.commands where actor_id=auth.uid()and command_id=p_command;
 if found then if previous.input<>payload then raise exception 'Command conflict'using errcode='P0001';end if;return previous.review_id;end if;
 if p_action='request'then
  if not owner then raise insufficient_privilege;end if;
  if p_document is null or p_review is not null or p_consent is distinct from true or p_decision is not null then raise invalid_parameter_value;end if;
  select *into d from public.documents where id=p_document for share;
  if not found or d.owner_id<>auth.uid()or d.intervention_id is distinct from p_job or d.mime_type not in('image/jpeg','image/png','image/webp')then raise insufficient_privilege;end if;
  select *into r from photo_triage_private.reviews where document_id=d.id for update;
  if coalesce(r.version,0)<>p_expected_version or(r.id is not null and r.status<>'withdrawn')then raise exception 'Review already requested'using errcode='P0001';end if;
  if r.id is null and(select count(*)from photo_triage_private.reviews where intervention_id=p_job)>=20 then raise exception 'Review limit'using errcode='P0001';end if;
  insert into photo_triage_private.reviews(intervention_id,document_id,owner_id,artisan_id,document_path,document_mime,request_command_id,version)
  values(p_job,d.id,auth.uid(),i.artisan_id,d.path,d.mime_type,p_command,p_expected_version+1)
  on conflict(document_id)do update set status='requested',version=excluded.version,request_command_id=excluded.request_command_id,owner_id=excluded.owner_id,artisan_id=excluded.artisan_id,document_path=excluded.document_path,document_mime=excluded.document_mime,consent_at=clock_timestamp()returning *into r;
 else
  if p_review is null or p_document is not null or p_consent is not null then raise invalid_parameter_value;end if;
  select *into r from photo_triage_private.reviews where id=p_review and intervention_id=p_job for update;
  if not found or not photo_triage_private.current(r)then raise insufficient_privilege;end if;
  if r.version<>p_expected_version then raise exception 'Review changed'using errcode='P0001';end if;
  if p_action='withdraw'then
   if not owner or r.owner_id<>auth.uid()then raise insufficient_privilege;end if;
   if p_decision is not null then raise invalid_parameter_value;end if;
   if r.status<>'requested'then raise exception 'Transmission may have started'using errcode='P0001';end if;
   update photo_triage_private.reviews set status='withdrawn',version=version+1 where id=r.id;
  else
   if owner or r.artisan_id<>auth.uid()then raise insufficient_privilege;end if;
   if p_decision is null or p_decision not in('validate','reject')then raise invalid_parameter_value;end if;
   if r.status<>'awaiting_review'then raise exception 'No classification to review'using errcode='P0001';end if;
   update photo_triage_private.reviews set status=case p_decision when'validate'then'validated'else'rejected'end,version=version+1,reviewed_at=clock_timestamp()where id=r.id;
  end if;
 end if;
 insert into photo_triage_private.commands(actor_id,command_id,review_id,input)values(auth.uid(),p_command,r.id,payload);return r.id;
end;$$;
-- Private source uses the caller's authenticated session, not service-role file access.
create function public.photo_review_source(p_job uuid,p_review uuid)returns jsonb language plpgsql stable security definer set search_path=''as $$
declare r photo_triage_private.reviews;
begin
 if not photo_triage_private.guard(p_job)then raise insufficient_privilege;end if;
 select *into r from photo_triage_private.reviews where id=p_review and intervention_id=p_job;
 if not found or r.owner_id<>auth.uid()or not photo_triage_private.current(r)or r.status in('withdrawn','invalidated')then raise insufficient_privilege;end if;
 return jsonb_build_object('id',r.id,'document_id',r.document_id,'path',r.document_path,'mime',r.document_mime,'version',r.version,'status',r.status,'request_command_id',r.request_command_id,'sha256',r.content_sha256);
end;$$;
create function public.reserve_photo_review(p_job uuid,p_review uuid,p_command uuid,p_version integer,p_sha256 text)returns boolean language plpgsql security definer set search_path=''as $$
declare r photo_triage_private.reviews;
begin
 perform 1 from public.interventions where id=p_job for update;
 if not photo_triage_private.guard(p_job)then raise insufficient_privilege;end if;
 select *into r from photo_triage_private.reviews where id=p_review and intervention_id=p_job for update;
 if not found or r.owner_id<>auth.uid()or not photo_triage_private.current(r)then raise insufficient_privilege;end if;
 if p_sha256 is null or p_sha256!~'^[a-f0-9]{64}$'then raise invalid_parameter_value;end if;
 if r.status<>'requested'or r.version<>p_version or r.request_command_id<>p_command then return false;end if;
 update photo_triage_private.reviews set status='uncertain',version=version+1,content_sha256=p_sha256,transmission_reserved_at=clock_timestamp()where id=r.id;
 return true;
end;$$;
create function public.finish_photo_review(p_job uuid,p_review uuid,p_sha256 text,p_category text,p_readability text)returns boolean language plpgsql security definer set search_path=''as $$
declare r photo_triage_private.reviews;
begin
 perform 1 from public.interventions where id=p_job for update;
 if not photo_triage_private.guard(p_job)then raise insufficient_privilege;end if;
 select *into r from photo_triage_private.reviews where id=p_review and intervention_id=p_job for update;
 if not found or r.owner_id<>auth.uid()or not photo_triage_private.current(r)then raise insufficient_privilege;end if;
 if p_category is null or p_category not in('panel','socket','lighting','other','undetermined')or p_readability is null or p_readability not in('readable','limited','unusable')then raise invalid_parameter_value;end if;
 if r.status<>'uncertain'or r.content_sha256 is distinct from p_sha256 then return false;end if;
 update photo_triage_private.reviews set status='awaiting_review',version=version+1,category=p_category,readability=p_readability where id=r.id;return true;
end;$$;
create function photo_triage_private.invalidate()returns trigger language plpgsql security definer set search_path=''as $$
begin
 if tg_table_name='interventions'then
  if new.artisan_id is distinct from old.artisan_id or new.client_id is distinct from old.client_id or new.site_id is distinct from old.site_id or new.status='cancelled'then
   update photo_triage_private.reviews set status='invalidated',version=version+1 where intervention_id=new.id and status not in('withdrawn','invalidated');
  end if;
 else
  if new.owner_id is distinct from old.owner_id or new.intervention_id is distinct from old.intervention_id or new.path is distinct from old.path or new.mime_type is distinct from old.mime_type then
   update photo_triage_private.reviews set status='invalidated',version=version+1 where document_id=new.id and status not in('withdrawn','invalidated');
  end if;
 end if;return new;
end;$$;
create trigger photo_review_assignment after update of artisan_id,client_id,site_id,status on public.interventions for each row execute function photo_triage_private.invalidate();
create trigger photo_review_document after update on public.documents for each row execute function photo_triage_private.invalidate();
revoke all on all functions in schema photo_triage_private from public,anon,authenticated,service_role;
revoke all on function public.photo_review_list(uuid),public.photo_review_command(uuid,uuid,text,integer,uuid,uuid,boolean,text),public.photo_review_source(uuid,uuid),public.reserve_photo_review(uuid,uuid,uuid,integer,text),public.finish_photo_review(uuid,uuid,text,text,text)from public,anon,authenticated,service_role;
grant execute on function public.photo_review_list(uuid),public.photo_review_command(uuid,uuid,text,integer,uuid,uuid,boolean,text),public.photo_review_source(uuid,uuid)to authenticated;
-- Reserve/finish MUST NOT be exposed to clients: provider proof is trusted backend-only.
-- Service RPC wrappers below authorize explicit actor, while the file stays read under RLS.
alter function public.reserve_photo_review(uuid,uuid,uuid,integer,text)set schema photo_triage_private;
alter function public.finish_photo_review(uuid,uuid,text,text,text)set schema photo_triage_private;
create function public.photo_review_provider(p_actor uuid,p_job uuid,p_review uuid,p_action text,p_command uuid default null,p_version integer default null,p_sha256 text default null,p_category text default null,p_readability text default null)returns boolean language plpgsql security definer set search_path=''as $$
declare old_sub text=current_setting('request.jwt.claim.sub',true);old_claims text=current_setting('request.jwt.claims',true);result boolean;
begin
 if p_actor is null then raise insufficient_privilege;end if;
 perform set_config('request.jwt.claim.sub',p_actor::text,true);perform set_config('request.jwt.claims',jsonb_build_object('sub',p_actor,'role','authenticated')::text,true);
 if p_action='reserve'then result=photo_triage_private.reserve_photo_review(p_job,p_review,p_command,p_version,p_sha256);
 elsif p_action='finish'then result=photo_triage_private.finish_photo_review(p_job,p_review,p_sha256,p_category,p_readability);
 else raise invalid_parameter_value;end if;
 perform set_config('request.jwt.claim.sub',coalesce(old_sub,''),true);perform set_config('request.jwt.claims',coalesce(old_claims,''),true);return result;
exception when others then perform set_config('request.jwt.claim.sub',coalesce(old_sub,''),true);perform set_config('request.jwt.claims',coalesce(old_claims,''),true);raise;
end;$$;
revoke all on function public.photo_review_provider(uuid,uuid,uuid,text,uuid,integer,text,text,text)from public,anon,authenticated,service_role;
grant execute on function public.photo_review_provider(uuid,uuid,uuid,text,uuid,integer,text,text,text)to service_role;
commit;

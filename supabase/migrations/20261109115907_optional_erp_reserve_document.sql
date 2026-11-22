begin;

create or replace function public.so_checklist_items(p jsonb) returns jsonb language plpgsql immutable set search_path='' as $$
declare x jsonb; result jsonb='[]'::jsonb; keys text[]='{}'; k text; item jsonb;
begin
 if p is null or jsonb_typeof(p)<>'array' or jsonb_array_length(p)>200 then raise invalid_parameter_value; end if;
 for x in select * from jsonb_array_elements(p) loop
  perform public.so_keys(x,array['key','label','state','note','reserve_resolved_on','reserve_document_id']);
  k=public.so_text(x,'key',1,40);
  if k!~'^[A-Za-z0-9_-]+$' or k=any(keys) then raise invalid_parameter_value; end if;
  keys=keys||k;
  item=jsonb_build_object('key',k,'label',public.so_text(x,'label',1,240),'state',public.so_enum(x,'state',array['not_checked','ok','reserve','not_applicable'],true),'note',public.so_text(x,'note',0,1000),'reserve_resolved_on',public.so_date(x,'reserve_resolved_on',false));
  if x ? 'reserve_document_id' then
   if x->'reserve_document_id' = 'null'::jsonb then
    item := item || jsonb_build_object('reserve_document_id',null);
   elsif jsonb_typeof(x->'reserve_document_id') = 'string'
     and x->>'reserve_document_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    item := item || jsonb_build_object('reserve_document_id',(x->>'reserve_document_id')::uuid);
   else
    raise invalid_parameter_value;
   end if;
  end if;
  result := result || item;
 end loop;
 return result;
end; $$;

-- Validate against the site's private document inventory. A legacy edit which
-- omits the field preserves an existing proof when the reserve stays lifted.
create or replace function public.validate_erp_reserve_documents()
returns trigger language plpgsql set search_path = '' as $$
declare
  item jsonb;
  prior uuid;
  document_id uuid;
  lifted boolean;
  result jsonb := '[]'::jsonb;
begin
  for item in select value from jsonb_array_elements(new.items) loop
    prior := null;
    if tg_op = 'UPDATE' then
      select (previous.value->>'reserve_document_id')::uuid into prior
        from jsonb_array_elements(old.items) previous
        where previous.value->>'key' = item->>'key';
    end if;
    lifted := item->>'state' = 'reserve' and item->>'reserve_resolved_on' is not null;
    if lifted and not (item ? 'reserve_document_id') and prior is not null then
      item := item || jsonb_build_object('reserve_document_id', prior);
    end if;
    document_id := (item->>'reserve_document_id')::uuid;
    if document_id is not null and (
      not lifted or not exists (
        select 1 from public.site_documents d
        where d.id = document_id and d.site_id = new.site_id
          and (document_id = prior or (
            d.archived_at is null and d.replaced_at is null
            and exists (
              select 1 from storage.objects o
              where o.bucket_id = 'intervention-documents' and o.name = d.path
            )
          ))
      )
    ) then
      raise exception 'erp_reserve_document_invalid' using errcode = '22023';
    end if;
    result := result || item;
  end loop;
  new.items := result;
  return new;
end;
$$;
revoke all on function public.validate_erp_reserve_documents() from public, anon, authenticated, service_role;

drop trigger if exists site_erp_reserve_documents on public.site_erp_checklists;
create trigger site_erp_reserve_documents before insert or update of items, site_id on public.site_erp_checklists
for each row execute function public.validate_erp_reserve_documents();

commit;

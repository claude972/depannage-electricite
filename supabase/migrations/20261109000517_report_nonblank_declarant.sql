begin;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.intervention_reports'::regclass
      and conname = 'intervention_reports_declarant_nonblank'
  ) then
    -- Keep historic evidence unchanged. New and edited reports must name a declarant.
    alter table public.intervention_reports add constraint intervention_reports_declarant_nonblank
      check (signature_name ~ '[^[:space:]]') not valid;
  end if;
end;
$$;

commit;

-- Explicit rate representation only; no applicable-regime inference and no historical UPDATE.
-- https://www.impots.gouv.fr/professionnel/questions/quels-sont-les-differents-taux-de-tva-applicables-dans-les-dom
begin;
do $$
declare t text;c record;f record;definition text;patched text;changed integer=0;
 old_rates text='\(0,[[:space:]]*5[.]5,[[:space:]]*10,[[:space:]]*20\)';
begin
 -- These four column-only constraints are the original monetary whitelist.
 foreach t in array array['quotes','quote_drafts','quote_amendments','platform_invoices']loop
  select con.oid,con.conname into strict c from pg_constraint con join pg_attribute a on a.attrelid=con.conrelid and a.attname='tax_rate'
   where con.conrelid=('public.'||t)::regclass and con.contype='c'and con.conkey=array[a.attnum]::smallint[];
  if regexp_replace(pg_get_constraintdef(c.oid),'[[:space:]()]|::numeric','','g') <> 'CHECKtax_rate=ANYARRAY[0,5.5,10,20]' then raise exception 'Unexpected tax constraint %',t;end if;
  execute format('alter table public.%I drop constraint %I',t,c.conname);
  execute format('alter table public.%I add constraint %I check(tax_rate in(0,2.1,5.5,8.5,10,20))',t,c.conname);
 end loop;
 -- Patch ONLY the known rate predicates in four existing validators. pg_get_functiondef
 -- preserves all other guards and CREATE OR REPLACE preserves the OID and grants.
 for f in select p.oid,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'and p.proname in('intervention_action_base','validate_quote_draft_content','propose_quote_amendment','platform_validate_issuer')loop
  definition=pg_get_functiondef(f.oid);patched=regexp_replace(definition,old_rates,'(0,2.1,5.5,8.5,10,20)','g');
  if patched=definition then raise exception 'Expected whitelist not found in %',f.proname;end if;
  execute patched;changed=changed+1;
 end loop;
 if changed<>4 then raise exception 'Expected four tax validators, got %',changed;end if;
 -- Remove implicit20 from the public command and its private forwarding chain.
 -- Non-tax actions ignore the null; send_quote still requires an explicit rate.
 changed=0;
 for f in select p.oid,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'and p.proname like 'intervention_action%'loop
  definition=pg_get_functiondef(f.oid);patched=regexp_replace(definition,'p_tax_rate numeric DEFAULT 20(::numeric)?','p_tax_rate numeric DEFAULT NULL::numeric','gi');
  if patched<>definition then execute patched;changed=changed+1;end if;
 end loop;
 if changed<1 then raise exception 'Expected legacy tax default not found';end if;
end;$$;
commit;

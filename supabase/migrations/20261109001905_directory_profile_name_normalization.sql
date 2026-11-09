begin;

-- PostgREST computed field used by directory filters. The unnamed table-row
-- parameter keeps it out of the RPC surface and the source rows retain their RLS.
create or replace function public.directory_profile_name(public.profiles)
returns text language sql immutable set search_path = '' as $$
  select normalize($1.full_name, NFKC);
$$;
revoke all on function public.directory_profile_name(public.profiles) from public, anon, authenticated, service_role;
grant execute on function public.directory_profile_name(public.profiles) to authenticated;

commit;

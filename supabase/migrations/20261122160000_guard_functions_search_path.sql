-- Isolation — pin the search_path of the three platform guard functions.
--
-- Supabase security advisor on the recette database, 22 November 2026 (lint 0011, function search
-- path mutable): platform_deny_mutation, platform_guard_grant_update, platform_guard_last_super_admin.
-- They are the trigger guards of the immutable ledger and audit journal, of the grant history and of
-- the last super administrator. Every other function of the public schema already pins it.
--
-- Their bodies only use schema-qualified relations and pg_catalog built-ins, so an empty search_path
-- changes no behaviour; it removes the dependency on the caller's search_path. Nothing else changes:
-- same owners, same grants, same triggers, no data written.
alter function public.platform_deny_mutation() set search_path='';
alter function public.platform_guard_grant_update() set search_path='';
alter function public.platform_guard_last_super_admin() set search_path='';

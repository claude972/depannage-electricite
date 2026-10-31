-- QA-GW-EXPIRED-REVOKE-003 §2 (contract v4) — READ-ONLY observation, run by the pilot during the batch pause.
-- One row expected: the finalize_document_upload backend waiting (Lock) directly on the batch pid, and the
-- exact Storage object(s) under the sole authorised prefix <manager uid>/ (bucket intervention-documents),
-- both at the same DB clock_timestamp(). No text search, no other prefix, no full query/claims tracing.
select clock_timestamp() as t_observed,
       a.pid as finalize_pid,
       a.wait_event_type,
       a.wait_event,
       pg_blocking_pids(a.pid) as blocked_by,
       (select coalesce(jsonb_agg(o.name order by o.name), '[]'::jsonb)
          from storage.objects o
         where o.bucket_id = 'intervention-documents' and o.name like '{{MANAGER}}/%') as objects
  from pg_stat_activity a
 where a.query ilike '%finalize_document_upload%'
   and a.pid <> pg_backend_pid();
-- Copy the single result row (JSON) verbatim into the file given to --observation.

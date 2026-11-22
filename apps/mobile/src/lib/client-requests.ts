import { useCallback, useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { api } from './api';
import { job, type Job } from './contracts';

export type RequestSegment = 'active' | 'past' | 'all';
/** Mêmes ensembles que la recherche serveur : un dossier clos est réglé ou annulé ; « à régler » reste en cours. */
export const closedStatus = (status: Job['status']) => status === 'paid' || status === 'cancelled';
const page = z.object({
  items: z.array(job).max(50), total: z.number().int().nonnegative(),
  page: z.object({ has_more: z.boolean(), next_cursor: z.string().nullable() }),
});
type State = { key: string; items: Job[]; total: number; next: string | null; error: string | null; loading: boolean; more: boolean };

/** CLI-08 : demandes du particulier par segment, lues page par page sur POST /api/client/interventions/search. */
export function useClientRequests(token: string | undefined, actor: string | undefined, segment: RequestSegment) {
  const key = token && actor ? actor + '/' + segment : '';
  const [state, setState] = useState<State>({ key: '', items: [], total: 0, next: null, error: null, loading: false, more: false });
  const [revision, setRevision] = useState(0);
  const latest = useRef(token); latest.current = token;
  const run = useRef(0);
  useEffect(() => {
    if (!key || !latest.current) return;
    const controller = new AbortController(), turn = ++run.current;
    setState(value => value.key === key ? { ...value, loading: true, error: null } : { key, items: [], total: 0, next: null, error: null, loading: true, more: false });
    void api('/api/client/interventions/search', page, { token: latest.current, method: 'POST', body: { filter: segment, search: '', cursor: null }, signal: controller.signal })
      .then(result => { if (run.current === turn) setState({ key, items: result.items, total: result.total, next: result.page.next_cursor, error: null, loading: false, more: false }); },
        issue => { if (run.current === turn && !controller.signal.aborted) setState(value => ({ ...value, key, loading: false, error: issue instanceof Error ? issue.message : 'Les demandes n’ont pas pu être chargées.' })); });
    return () => controller.abort();
  }, [key, segment, revision]);
  const reload = useCallback(() => setRevision(value => value + 1), []);
  const more = useCallback(() => {
    const cursor = state.next, turn = run.current;
    if (!cursor || state.more || state.loading || !latest.current || state.key !== key) return;
    setState(value => ({ ...value, more: true, error: null }));
    void api('/api/client/interventions/search', page, { token: latest.current, method: 'POST', body: { filter: segment, search: '', cursor } }).then(result => {
      if (run.current !== turn) return;
      setState(value => {
        const known = new Set(value.items.map(item => item.id));
        return { ...value, items: [...value.items, ...result.items.filter(item => !known.has(item.id))], total: result.total, next: result.page.next_cursor, more: false };
      });
    }, issue => { if (run.current === turn) setState(value => ({ ...value, more: false, error: issue instanceof Error ? issue.message : 'La suite n’a pas pu être chargée.' })); });
  }, [state.next, state.more, state.loading, state.key, key, segment]);
  const current = state.key === key ? state : null;
  return { items: current?.items ?? null, total: current?.total ?? 0, next: current?.next ?? null, error: current?.error ?? null,
    loading: Boolean(key) && (!current || current.loading), loadingMore: current?.more ?? false, reload, more };
}

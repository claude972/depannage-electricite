import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import type { ZodType } from 'zod';
import { apiOrigin } from './config';

export class ApiFailure extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) { super(message); }
}

export async function api<T>(path: string, schema: ZodType<T>, options: {
  token?: string;
  method?: 'GET' | 'POST' | 'PATCH';
  body?: object | FormData;
  signal?: AbortSignal;
} = {}): Promise<T> {
  if (!apiOrigin || !path.startsWith('/api/') || new URL(path, apiOrigin).origin !== apiOrigin)
    throw new ApiFailure('L’environnement mobile n’est pas configuré.', 0);
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (options.signal?.aborted) abort();
  else options.signal?.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(abort, 20000);
  const multipart = options.body instanceof FormData;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  if (options.body && !multipart) headers['Content-Type'] = 'application/json';
  try {
    const response = await fetch(new URL(path, apiOrigin), {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : multipart ? options.body as FormData : JSON.stringify(options.body),
      signal: controller.signal,
      redirect: 'error',
      credentials: 'omit',
    });
    const data: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const message = data && typeof data === 'object' && 'error' in data && typeof data.error === 'string'
        ? data.error.slice(0, 350) : 'Le service est momentanément indisponible.';
      const code = data && typeof data === 'object' && 'code' in data && typeof data.code === 'string'
        ? data.code.slice(0, 80) : undefined;
      throw new ApiFailure(message, response.status, code);
    }
    const parsed = schema.safeParse(data);
    if (!parsed.success) throw new ApiFailure('La réponse du service est incomplète. Réessayez.', 502);
    return parsed.data;
  } catch (error) {
    if (error instanceof ApiFailure) throw error;
    throw new ApiFailure('Connexion interrompue. Vérifiez l’état du dossier avant de réessayer.', 0);
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', abort);
  }
}

export function useResource<T>(path: string | null, schema: ZodType<T>, token?: string, refreshActor?: string) {
  type Read = { path: string; revision:number; token?: string; actor?: string; data: T | null; error: string | null };
  const [read, setRead] = useState<Read | null>(null);
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => {
    if (!refreshActor) setRead(null);
    setRevision(value => value + 1);
  }, [refreshActor]);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') reload(); });
    return () => subscription.remove();
  }, [reload]);
  useEffect(() => {
    if (!path) return;
    const controller = new AbortController();
    void api(path, schema, { token, signal: controller.signal }).then(
      data => { if (!controller.signal.aborted) setRead({ path, revision, token, actor: refreshActor, data, error: null }); },
      error => { if (!controller.signal.aborted) setRead({ path, revision, token, actor: refreshActor, data: null, error: error instanceof Error ? error.message : 'Lecture indisponible.' }); },
    );
    return () => controller.abort();
  }, [path, schema, token, revision, refreshActor]);
  // A token rotation can refresh an already visible resource for the same
  // account. A different account or a denied read never inherits that data.
  const visible = read?.path === path && read.actor === refreshActor &&
    ((read.token === token && read.revision === revision) || (token && refreshActor && read.data !== null))
    ? read : null;
  return { data: visible?.data ?? null, error: visible?.error ?? null, loading: Boolean(path && !visible), reload };
}

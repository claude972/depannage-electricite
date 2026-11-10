import { useEffect, useRef, useState } from 'react';
import type { ZodType } from 'zod';
import { deviceDrafts } from './device-drafts';

const STORAGE_ERROR = 'Le brouillon n’a pas pu être enregistré sur cet appareil. Réessayez.';

// Editors are keyed by their authenticated account and dossier. The server
// must confirm access before the editor (and its draft) is mounted.
export function useDeviceDraft<T>(key: string, schema: ZodType<T>, initial: T) {
  const fallback = useRef(initial);
  const current = useRef<T | null>(null);
  const writeNumber = useRef(0);
  const [value, setValue] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    void deviceDrafts.read(key, schema).then(saved => {
      if (!active) return;
      const restored = saved ?? fallback.current;
      current.current = restored;
      setValue(restored);
      setError(null);
    }, () => { if (active) setError('Le brouillon de cet appareil est indisponible.'); });
    return () => { active = false; };
  }, [key, schema, attempt]);

  async function persist(next: T) {
    const write = ++writeNumber.current;
    setPending(true);
    try {
      await deviceDrafts.write(key, next);
      if (write === writeNumber.current) setError(null);
    } catch {
      if (write === writeNumber.current) setError(STORAGE_ERROR);
      throw new Error(STORAGE_ERROR);
    } finally {
      if (write === writeNumber.current) setPending(false);
    }
  }

  async function update(updater: (value: T) => T) {
    if (current.current === null) throw new Error('Le brouillon est en cours de restauration.');
    const next = updater(current.current);
    current.current = next;
    setValue(next);
    await persist(next);
  }

  return {
    value, error, pending, update,
    edit: (updater: (value: T) => T) => { void update(updater).catch(() => {}); },
    retry: () => {
      if (current.current === null) setAttempt(previous => previous + 1);
      else void persist(current.current).catch(() => {});
    },
    flush: async () => {
      if (current.current === null) throw new Error('Le brouillon est en cours de restauration.');
      await persist(current.current);
    },
    clear: () => deviceDrafts.clear(key),
  };
}

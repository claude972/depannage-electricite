import type { ZodType } from 'zod';

type Storage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};

// Expo SecureStore publishes a manifest after writing the new fragments. Serialize
// each key so that a late write cannot overwrite a confirmed save or a newer edit.
export function createDraftStore(storage: Storage) {
  const queues = new Map<string, Promise<unknown>>();
  const pendingWrites = new Map<string, { value: string; done: Promise<void> }>();
  function enqueue<T>(key: string, action: () => Promise<T>): Promise<T> {
    const operation = (queues.get(key) ?? Promise.resolve()).then(action, action);
    queues.set(key, operation);
    function release() {
      if (queues.get(key) === operation) queues.delete(key);
    }
    void operation.then(release, release);
    return operation;
  }
  return {
    read<T>(key: string, schema: ZodType<T>): Promise<T | null> {
      pendingWrites.delete(key);
      return enqueue(key, async () => {
        const raw = await storage.getItem(key);
        return raw === null ? null : schema.parse(JSON.parse(raw));
      });
    },
    update<T>(key: string, schema: ZodType<T>, change: (current: T | null) => T | null): Promise<T | null> {
      pendingWrites.delete(key);
      return enqueue(key, async () => {
        const raw = await storage.getItem(key);
        const current = raw === null ? null : schema.parse(JSON.parse(raw));
        const next = change(current);
        if (next !== current) {
          if (next === null) await storage.removeItem(key);
          else await storage.setItem(key, JSON.stringify(next));
        }
        return next;
      });
    },
    write(key: string, value: unknown): Promise<void> {
      const raw = JSON.stringify(value);
      const pending = pendingWrites.get(key);
      if (pending) {
        pending.value = raw;
        return pending.done;
      }
      // Coalesce only writes that have not started. Reads and clears are
      // barriers, so a later edit cannot be moved before either of them.
      let write: { value: string; done: Promise<void> };
      const done = enqueue(key, () => {
        if (pendingWrites.get(key) === write) pendingWrites.delete(key);
        return storage.setItem(key, write.value);
      });
      write = { value: raw, done };
      pendingWrites.set(key, write);
      return done;
    },
    clear(key: string): Promise<void> {
      pendingWrites.delete(key);
      return enqueue(key, () => storage.removeItem(key));
    },
  };
}

export const quoteDraftKey = (actor: string, dossier: string) => `draft.v1.quote.${actor}.${dossier}`;
export const reportDraftKey = (actor: string, dossier: string) => `draft.v1.report.${actor}.${dossier}`;
export const requestDraftKey = (actor: string) => `draft.v1.request.${actor}`;

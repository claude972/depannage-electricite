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
      return enqueue(key, async () => {
        const raw = await storage.getItem(key);
        return raw === null ? null : schema.parse(JSON.parse(raw));
      });
    },
    write(key: string, value: unknown): Promise<void> {
      const raw = JSON.stringify(value);
      return enqueue(key, () => storage.setItem(key, raw));
    },
    clear(key: string): Promise<void> {
      return enqueue(key, () => storage.removeItem(key));
    },
  };
}

export const quoteDraftKey = (actor: string, dossier: string) => `draft.v1.quote.${actor}.${dossier}`;
export const reportDraftKey = (actor: string, dossier: string) => `draft.v1.report.${actor}.${dossier}`;
export const requestDraftKey = (actor: string) => `draft.v1.request.${actor}`;

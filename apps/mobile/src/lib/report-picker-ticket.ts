import { randomUUID } from 'expo-crypto';
import * as ImagePicker from 'expo-image-picker';
import { z } from 'zod';
import { secureStorage } from './secure-storage';

// Android keeps ONE process-wide pending picker result when the activity is
// destroyed. This single marker says which account + dossier (draftKey) and
// which side opened the picker. The native result is only ever read by the
// editor whose draftKey matches the marker; anything else is drained unread
// before a new launch, so it can never reach another account, dossier or side.
const storageKey = 'picker.v1.report';
const ticket = z.object({ id: z.uuid(), draftKey: z.string().min(1), side: z.enum(['before', 'after']) });
type Ticket = z.infer<typeof ticket>;

let queue: Promise<unknown> = Promise.resolve();
function serial<T>(action: () => Promise<T>): Promise<T> {
  const operation = queue.then(action);
  queue = operation.catch(() => {});
  return operation;
}

// An unreadable marker is treated as absent: nothing is resumed from it.
async function saved(): Promise<Ticket | null> {
  try {
    const raw = await secureStorage.getItem(storageKey);
    return raw === null ? null : ticket.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

function forget(id: string) {
  return serial(async () => {
    try { if ((await saved())?.id === id) await secureStorage.removeItem(storageKey); }
    catch { /* A stale marker without native result is cleared by the next resume or launch. */ }
  });
}

// An editor can unmount before its native picker has returned. A different
// editor must not overwrite that ticket while the native result is still in flight.
let opened: { id: string; signal: AbortSignal } | null = null;

export async function launchWithTicket<T>(draftKey: string, side: Ticket['side'], signal: AbortSignal, launch: () => Promise<T>): Promise<T | null> {
  if (opened) throw new Error('Une sélection de photo est déjà en cours.');
  const id = randomUUID();
  opened = { id, signal };
  try {
    let marked: boolean;
    try {
      marked = await serial(async () => {
        if (signal.aborted) return false;
        // Drain any orphan result of an earlier interrupted selection, unread.
        await ImagePicker.getPendingResultAsync();
        await secureStorage.setItem(storageKey, JSON.stringify({ id, draftKey, side } satisfies Ticket));
        return true;
      });
    } catch {
      throw new Error('La sélection de photo n’a pas pu être préparée sur cet appareil. Réessayez.');
    }
    if (!marked) return null;
    if (signal.aborted) { await forget(id); return null; }
    try { return await launch(); }
    // After an unmount the marker is left for the resume of the same draftKey.
    finally { if (!signal.aborted) await forget(id); }
  } finally {
    if (opened?.id === id) opened = null;
  }
}

// Call only from an editor that is mounted, i.e. authorized again for draftKey.
export function takeInterruptedPick(draftKey: string, signal: AbortSignal) {
  return serial(async () => {
    if (signal.aborted || (opened && !opened.signal.aborted)) return null;
    const mark = await saved();
    if (!mark || mark.draftKey !== draftKey || signal.aborted || (opened && opened.id !== mark.id)) return null;
    const result = await ImagePicker.getPendingResultAsync();
    if (!result && opened?.id === mark.id) return null;
    if (opened?.id === mark.id) opened = null;
    try { await secureStorage.removeItem(storageKey); }
    catch { /* The native result is consumed; a stale marker is harmless. */ }
    return signal.aborted ? null : { side: mark.side, result };
  });
}

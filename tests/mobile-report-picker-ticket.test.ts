import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { reportDraftKey } from '../apps/mobile/src/lib/draft-store';
import { loadModule } from './documents/harness';

const actorA = '30000000-0000-4000-8000-000000000001';
const actorB = '30000000-0000-4000-8000-000000000002';
const dossierA = '30000000-0000-4000-8000-000000000003';
const dossierB = '30000000-0000-4000-8000-000000000004';
const scope = reportDraftKey(actorA, dossierA);
const otherActor = reportDraftKey(actorB, dossierA);
const otherDossier = reportDraftKey(actorA, dossierB);
const selected = { canceled: false, assets: [{ uri: 'file:///photo-qa.jpg', width: 640 }] };

function harness() {
  let marker: string | null = null;
  let pending: typeof selected | null = null;
  let nativeReads = 0;
  const boot = () => loadModule('apps/mobile/src/lib/report-picker-ticket.ts', {
    'expo-crypto': { randomUUID },
    'expo-image-picker': { getPendingResultAsync: async () => {
      const result = pending;
      pending = null;
      nativeReads++;
      return result;
    } },
    './secure-storage': { secureStorage: {
      getItem: async () => marker,
      setItem: async (_key: string, value: string) => { marker = value; },
      removeItem: async () => { marker = null; },
    } },
  }) as unknown as {
    launchWithTicket<T>(key: string, side: 'before' | 'after', signal: AbortSignal, launch: () => Promise<T>): Promise<T | null>;
    takeInterruptedPick(key: string, signal: AbortSignal): Promise<{ side: string; result: typeof selected | null } | null>;
  };
  return { boot, setPending: () => { pending = selected; }, marker: () => marker, nativeReads: () => nativeReads };
}

test('Android pending photo survives a runtime restart and can only be resumed for its account, dossier and side', async () => {
  const h = harness();
  const first = h.boot();
  const active = new AbortController();
  let finish!: (value: typeof selected) => void;
  let didLaunch!: () => void;
  const launched = new Promise<void>(resolve => { didLaunch = resolve; });
  const opening = first.launchWithTicket(scope, 'after', active.signal, () => {
    assert.equal(JSON.parse(h.marker()!).draftKey, scope);
    didLaunch();
    return new Promise(resolve => { finish = resolve; });
  });
  await launched;
  active.abort();
  h.setPending();
  const afterRestart = h.boot();
  const next = new AbortController();
  assert.equal(await afterRestart.takeInterruptedPick(otherActor, next.signal), null);
  assert.equal(await afterRestart.takeInterruptedPick(otherDossier, next.signal), null);
  assert.equal(h.nativeReads(), 1);
  const resumed = await afterRestart.takeInterruptedPick(scope, next.signal);
  assert.equal(resumed?.side, 'after');
  assert.equal(resumed?.result, selected);
  assert.equal(h.marker(), null);
  assert.equal(await afterRestart.takeInterruptedPick(scope, next.signal), null);
  finish(selected);
  await opening;
});

test('an unmounted editor cannot let another dossier replace a picker still in flight', async () => {
  const h = harness();
  const picker = h.boot();
  const old = new AbortController();
  const next = new AbortController();
  let finish!: (value: typeof selected) => void;
  let didLaunch!: () => void;
  const launched = new Promise<void>(resolve => { didLaunch = resolve; });
  const opening = picker.launchWithTicket(scope, 'before', old.signal, () => {
    didLaunch();
    return new Promise(resolve => { finish = resolve; });
  });
  await launched;
  old.abort();
  await assert.rejects(picker.launchWithTicket(otherDossier, 'after', next.signal, async () => selected), /déjà en cours/);
  assert.equal(await picker.takeInterruptedPick(otherDossier, next.signal), null);
  assert.equal(await picker.takeInterruptedPick(scope, next.signal), null);
  assert.equal(JSON.parse(h.marker()!).draftKey, scope);
  h.setPending();
  const resumed = await picker.takeInterruptedPick(scope, next.signal);
  assert.equal(resumed?.side, 'before');
  assert.equal(resumed?.result, selected);
  finish(selected);
  await opening;
  assert.equal(await picker.launchWithTicket(otherDossier, 'after', next.signal, async () => selected), selected);
  assert.equal(h.marker(), null);
});

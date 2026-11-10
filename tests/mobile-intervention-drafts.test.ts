import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createDraftStore, quoteDraftKey, reportDraftKey, requestDraftKey } from '../apps/mobile/src/lib/draft-store';
import { quoteDraft, reportDraft } from '../apps/mobile/src/lib/intervention-drafts';
import { requestDraft } from '../apps/mobile/src/lib/request-draft';

const owner = '10000000-0000-4000-8000-000000000001';
const dossier = '10000000-0000-4000-8000-000000000002';
const other = '10000000-0000-4000-8000-000000000003';
const photo = '10000000-0000-4000-8000-000000000004';
const pending = { fileId: '10000000-0000-4000-8000-000000000005', key: Buffer.alloc(32, 4).toString('base64') };
const quote = { lines: [{ label: 'Remplacement d’un interrupteur', quantity: '1', price: '80,50' }], rate: 8.5 };
const request = { intent: {
  id: dossier,
  payload: { category: 'socket', description: 'Plusieurs prises sans courant', address: 'Adresse de recette',
    postal_code: '97200', city: 'Fort-de-France', urgency: 'scheduled', reviewed_estimate_version: 1 },
  estimate: { min_cents: 12000, max_cents: 18000 },
  reviewRequired: false,
} };
const report = { summary: 'Travaux terminés, alimentation vérifiée.', name: 'Artisan de recette', before: photo, after: null, pendingBefore: null, pendingAfter: pending, command: null };

function diskStore(directory: string) {
  const filename = (key: string) => path.join(directory, key);
  return createDraftStore({
    getItem: async key => {
      try { return await readFile(filename(key), 'utf8'); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
    },
    setItem: async (key, value) => {
      await writeFile(filename(key) + '.tmp', value, { mode: 0o600 });
      await rename(filename(key) + '.tmp', filename(key));
    },
    removeItem: async key => { await rm(filename(key), { force: true }); },
  });
}

const index = process.argv.indexOf('--draft-worker');
if (index !== -1) {
  const store = diskStore(process.argv[index + 1]);
  if (process.argv[index + 2] === 'write') {
    void Promise.all([
      store.write(quoteDraftKey(owner, dossier), quote),
      store.write(reportDraftKey(owner, dossier), report),
      store.write(requestDraftKey(owner), request),
    ]).then(() => {
      process.stdout.write('persisted', () => { process.kill(process.pid, 'SIGKILL'); });
    });
  } else {
    void Promise.all([
      store.read(quoteDraftKey(owner, dossier), quoteDraft),
      store.read(reportDraftKey(owner, dossier), reportDraft),
      store.read(quoteDraftKey(other, dossier), quoteDraft),
      store.read(reportDraftKey(owner, other), reportDraft),
      store.read(requestDraftKey(owner), requestDraft),
      store.read(requestDraftKey(other), requestDraft),
    ]).then(values => { process.stdout.write(JSON.stringify(values)); });
  }
} else {
  test('a new process restores the exact quote, photo receipt, pending photo reference and request key after a kill', async t => {
    const directory = await mkdtemp(path.join(tmpdir(), 'mobile-drafts-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    function worker(mode: string) {
      return spawnSync(process.execPath, [...process.execArgv, import.meta.filename, '--draft-worker', directory, mode], {
        encoding: 'utf8', timeout: 10000,
      });
    }
    const first = worker('write');
    assert.equal(first.signal, 'SIGKILL', first.stderr);
    assert.equal(first.stdout, 'persisted');
    const reopened = worker('read');
    assert.equal(reopened.status, 0, reopened.stderr);
    assert.deepEqual(JSON.parse(reopened.stdout), [quote, report, null, null, request, null]);
  });

  test('the last local edit wins and a confirmed save clears only its own draft', async t => {
    const directory = await mkdtemp(path.join(tmpdir(), 'mobile-draft-order-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const store = diskStore(directory);
    const key = quoteDraftKey(owner, dossier);
    const unrelated = quoteDraftKey(owner, other);
    const second = { ...quote, rate: 20 };
    await Promise.all([store.write(key, quote), store.write(key, second), store.write(unrelated, quote)]);
    assert.deepEqual(await store.read(key, quoteDraft), second);
    await Promise.all([store.write(key, quote), store.clear(key)]);
    assert.equal(await store.read(key, quoteDraft), null);
    assert.deepEqual(await store.read(unrelated, quoteDraft), quote);
  });
}

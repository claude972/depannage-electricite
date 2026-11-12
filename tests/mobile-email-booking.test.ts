import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { createDraftStore } from '../apps/mobile/src/lib/draft-store';
import { accountContact, confirmedAccountEmail } from '../apps/mobile/src/lib/email-account';
import { hasPrivateLocation } from '../apps/mobile/src/lib/booking-location';
import type { StagedPhoneBooking } from '../apps/mobile/src/lib/phone-booking-draft';
import { ApiError, loadModule } from './documents/harness';

const ORIGIN = 'https://preview.example.test';
const EMAIL = 'camille@example.test';
const ACTOR = '10000000-0000-4000-8000-000000000001';
const OTHER = '10000000-0000-4000-8000-000000000002';
const REQUEST = '10000000-0000-4000-8000-000000000003';
const INTERVENTION = '10000000-0000-4000-8000-000000000004';
const location = { latitude: 14.6049, longitude: -61.0685, access_details: 'Entrée côté cour' };
const photo = { fileId: '10000000-0000-4000-8000-000000000005', key: Buffer.alloc(32, 4).toString('base64') };
const account = { first_name: ' Camille ', last_name: ' Recette ', email: ' CAMILLE@example.test ', phone: '0696 12 34 56' };
const draft = {
  id: REQUEST,
  input: {
    service_slug: 'panne-tableau-electrique', category: 'panel', description: 'Dépannage électrique · Tableau électrique',
    address: 'Adresse de recette', postal_code: '97200', city: 'Fort-de-France', urgency: 'scheduled', location,
  },
  contact: { first_name: 'Camille', last_name: 'Recette', phone: '+596696123456' },
  photo,
} satisfies StagedPhoneBooking;

function fixture() {
  const state = new Map<string, string>();
  const deviceDrafts = createDraftStore({
    getItem: async key => state.get(key) ?? null,
    setItem: async (key, value) => { state.set(key, value); },
    removeItem: async key => { state.delete(key); },
  });
  const load = () => loadModule('apps/mobile/src/lib/email-booking-draft.ts', {
    'expo-crypto': { CryptoDigestAlgorithm: { SHA256: 'SHA-256' }, digestStringAsync: async (_kind: string, input: string) => createHash('sha256').update(input).digest('hex') },
    './config': { apiOrigin: ORIGIN },
    './device-drafts': { deviceDrafts },
    './api': {},
  }) as unknown as typeof import('../apps/mobile/src/lib/email-booking-draft');
  return { load, deviceDrafts, state };
}

test('native contact uses the account formats and restores only a confirmed address', () => {
  assert.deepEqual(accountContact.parse(account), { ...draft.contact, email: EMAIL });
  assert.equal(accountContact.safeParse({ ...account, phone: '+44 7700 900123' }).success, false);
  assert.equal(accountContact.safeParse({ ...account, email: 'sans-domaine' }).success, false);
  assert.equal(confirmedAccountEmail({ email: EMAIL }), undefined);
  assert.equal(confirmedAccountEmail({ email: ' CAMILLE@example.test ', email_confirmed_at: '2026-11-12T12:00:00Z' }), EMAIL);
});

test('a staged booking survives reload and can only be taken once by the matching account', async () => {
  const f = fixture();
  const before = f.load();
  const key = await before.stageEmailBookingKey(account.email);
  assert.equal(key, await before.stageEmailBookingKey(EMAIL));
  assert.doesNotMatch(key, /camille|example/);
  await before.saveEmailBooking(key, EMAIL, draft, null);

  const reopened = f.load();
  assert.equal(await reopened.claimEmailBooking(key, 'another@example.test', OTHER), null);
  await assert.rejects(reopened.saveEmailBooking(key, EMAIL, { ...draft, id: OTHER }, null), reopened.PendingEmailBooking);
  assert.equal(await reopened.hasEmailBooking(EMAIL, ACTOR), true);

  const [owner, refused] = await Promise.all([
    reopened.claimEmailBooking(key, EMAIL, ACTOR),
    reopened.claimEmailBooking(key, EMAIL, OTHER),
  ]);
  assert.deepEqual(owner, draft);
  assert.equal(refused, null);
  assert.equal(await reopened.hasEmailBooking(EMAIL, OTHER), false);
  await reopened.clearEmailBooking(key, EMAIL, OTHER, REQUEST);
  await reopened.clearEmailBooking(key, EMAIL, ACTOR, OTHER);
  assert.deepEqual(await f.load().claimEmailBooking(key, EMAIL, ACTOR), draft);
});

test('edits preserve the original request and only the guest who staged it can change its e-mail before claim', async () => {
  const f = fixture();
  const api = f.load();
  const key = await api.stageEmailBookingKey(EMAIL);
  await assert.rejects(api.saveEmailBooking(key, EMAIL, draft, null, true), api.PendingEmailBooking);
  await api.saveEmailBooking(key, EMAIL, draft, null);
  const corrected = { ...draft, input: { ...draft.input, address: 'Adresse corrigée' } };
  await api.saveEmailBooking(key, EMAIL, corrected, null, true);
  assert.equal(await api.discardUnclaimedEmailBooking(key, EMAIL, OTHER), false);
  assert.equal(await api.discardUnclaimedEmailBooking(key, 'incorrect@example.test', REQUEST), false);
  assert.equal(await api.discardUnclaimedEmailBooking(key, EMAIL, REQUEST), true);
  await assert.rejects(api.saveEmailBooking(key, EMAIL, corrected, null, true), api.PendingEmailBooking);

  const updatedEmail = 'camille2@example.test';
  const updatedKey = await api.stageEmailBookingKey(updatedEmail);
  await api.saveEmailBooking(updatedKey, updatedEmail, corrected, null);
  assert.equal(await api.hasEmailBooking(EMAIL, ACTOR), false);
  assert.deepEqual(await api.claimEmailBooking(updatedKey, updatedEmail, ACTOR), corrected);
  assert.equal(await api.discardUnclaimedEmailBooking(updatedKey, updatedEmail, REQUEST), false);
  await assert.rejects(api.saveEmailBooking(updatedKey, updatedEmail, corrected, null, true), api.PendingEmailBooking);
  await assert.rejects(api.saveEmailBooking(updatedKey, updatedEmail, corrected, OTHER, true), api.PendingEmailBooking);
  const { location: _removed, ...input } = corrected.input;
  const saved = { ...corrected, input };
  await api.saveEmailBooking(updatedKey, updatedEmail, saved, ACTOR, true);
  assert.deepEqual(await f.load().claimEmailBooking(updatedKey, updatedEmail, ACTOR), saved);
});

test('a durable receipt preserves pending photo recovery after the staged details are cleared', async () => {
  const f = fixture();
  const api = f.load();
  const key = await api.stageEmailBookingKey(EMAIL);
  await api.saveEmailBooking(key, EMAIL, draft, ACTOR);
  const receipt = { intent: null, receipt: { requestId: REQUEST, interventionId: INTERVENTION, photo } };
  await f.deviceDrafts.write(api.emailBookingKey(ACTOR, key), receipt);
  await api.clearEmailBooking(key, EMAIL, ACTOR, REQUEST);
  const reopened = f.load();
  assert.equal(await reopened.claimEmailBooking(key, EMAIL, ACTOR), null);
  assert.equal(await reopened.hasEmailBooking(EMAIL, ACTOR), true);
  assert.equal(await reopened.hasEmailBooking(EMAIL, OTHER), false);
  assert.equal(f.state.has(key), false);
});

test('old API compatibility distinguishes an empty map value from a private point or access note', () => {
  assert.equal(hasPrivateLocation(undefined), false);
  assert.equal(hasPrivateLocation({ latitude: null, longitude: null, access_details: '' }), false);
  assert.equal(hasPrivateLocation({ latitude: null, longitude: null, access_details: 'Entrée côté cour' }), true);
  assert.equal(hasPrivateLocation({ latitude: 0, longitude: 0, access_details: '' }), true);
});

function nativeSignup(session: unknown = null) {
  const calls: Record<string, unknown>[] = [];
  const create: unknown[][] = [];
  const route = loadModule('app/api/auth/native-signup/route.ts', {
    '@/lib/supabase/server': { ApiError, serverClient: () => assert.fail('Native signup cannot start a browser cookie session.') },
    '@supabase/supabase-js': { createClient(...args: unknown[]) {
      create.push(args);
      return { auth: { signUp: async (value: Record<string, unknown>) => {
        calls.push(value);
        return { error: null, data: { user: { id: ACTOR }, session } };
      } } };
    } },
  }, { NEXT_PUBLIC_SUPABASE_URL: 'https://supabase.example.test', NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_fixture' });
  const post = (changes: Record<string, unknown> = {}, origin?: string) => {
    const headers = { 'Content-Type': 'application/json', ...(origin !== undefined ? { Origin: origin } : {}) };
    const body = JSON.stringify({ ...account, password: 'FictitiousPassword42!', role: 'client', ...changes });
    return (route.POST as (r: Request) => Promise<Response>)(new Request(ORIGIN + '/api/auth/native-signup', { method: 'POST', headers, body }));
  };
  return { calls, create, post };
}

test('native signup calls the provider without browser cookies, with the normalised contact and confirmation link', async () => {
  const f = nativeSignup();
  const response = await f.post();
  assert.equal(response.status, 201);
  assert.equal(response.headers.get('Set-Cookie'), null);
  assert.deepEqual(await response.json(), { status: 'confirmation_required' });
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].email, EMAIL);
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls[0].options)), {
    data: { ...draft.contact, full_name: 'Camille Recette', role: 'client' },
    emailRedirectTo: ORIGIN + '/auth/confirm',
  });
  assert.deepEqual(JSON.parse(JSON.stringify(f.create[0][2])), {
    auth: { flowType: 'implicit', persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
});

test('native signup refuses foreign browser origins and privileged roles before accessing the provider', async () => {
  const f = nativeSignup();
  assert.equal((await f.post({}, 'https://foreign.example.test')).status, 403);
  assert.equal((await f.post({}, 'null')).status, 403);
  assert.equal((await f.post({ role: 'manager' })).status, 422);
  assert.equal((await f.post({ phone: '' })).status, 422);
  assert.equal(f.create.length, 0);
  assert.equal(f.calls.length, 0);
});

test('even if the provider creates a session, native signup never shares its identity or tokens', async () => {
  const f = nativeSignup({ access_token: 'PRIVATE', refresh_token: 'PRIVATE' });
  const response = await f.post({}, ORIGIN);
  assert.equal(response.status, 201);
  assert.equal(response.headers.get('Set-Cookie'), null);
  assert.deepEqual(await response.json(), { status: 'sign_in_required' });
});

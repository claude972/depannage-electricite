// Real Next.js and PostgreSQL. The gateway supplies synthetic Auth identities.
// This test does not send SMS or run a Stripe operation.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { asUser, freshDatabase, withNext } from './phase2-lot-a-http-harness.mjs';

const identity = (phone, confirmed = true) => ({
  id: randomUUID(), aud: 'authenticated', role: 'authenticated',
  phone, phone_confirmed_at: confirmed ? new Date().toISOString() : null,
});
const owner = identity('596696000101'), other = identity('590690000101'), unverified = identity('596696000102', false);
const users = [owner, other, unverified];
const db = await freshDatabase();

try {
  for (const user of users) {
    await db.query(`insert into auth.users(id, raw_user_meta_data, phone, phone_confirmed_at)
      values ($1, '{"role":"client","full_name":"Prénom Recette"}', $2, $3)`,
    [user.id, user.phone, user.phone_confirmed_at]);
  }
  await withNext(db, async (http, sqlErrors) => {
    const get = (path, user = owner, headers) => http(path, { headers }, user, 'bearer');
    const post = (payload, user = owner, headers) => http('/api/bookings',
      { method: 'POST', body: JSON.stringify(payload), headers }, user, 'bearer');
    const price = (await db.query('select public.read_indicative_prices() v')).rows[0].v;
    const body = {
      request_id: randomUUID(), service_slug: 'plusieurs-prises-sans-courant', category: 'socket',
      description: 'Plusieurs prises de la pièce restent sans courant.', address: '1 Rue de recette',
      city: 'Fort-de-France', postal_code: '97200', urgency: 'scheduled',
      contact: { first_name: 'Prénom', last_name: 'Recette', phone: '+' + owner.phone, email: '' },
      payment_choice: 'on_site', reviewed_estimate_version: price.version,
    };
    const anonymous = await post(body, owner, { authorization: 'Bearer invalid.native.token' });
    assert.equal(anonymous.status, 401);
    assert.equal((await post({ ...body, contact: { ...body.contact, phone: '+' + other.phone } })).status, 403);
    const first = await post(body);
    assert.equal(first.status, 201, JSON.stringify(await first.clone().json()));
    assert.equal(first.headers.get('cache-control'), 'private, no-store');
    assert.equal(first.headers.has('set-cookie'), false);
    const confirmed = await first.json();
    assert.equal(confirmed.payment.method, 'on_site');
    assert.equal(confirmed.intervention.estimate_min_cents, price.ranges.socket.min_cents);
    for (let i = 0; i < 3; i++) {
      const replay = await post(body);
      assert.equal(replay.status, 201);
      assert.deepEqual(await replay.json(), confirmed);
    }
    assert.equal((await post({ ...body, description: body.description + ' Modifiée.' })).status, 409);
    const total = await db.query('select count(*)::int n from public.interventions');
    assert.equal(total.rows[0].n, 1);

    const history = '/api/auth/phone/history';
    const read = await get(history);
    assert.equal(read.status, 200, JSON.stringify(await read.clone().json()));
    const rows = (await read.json()).interventions;
    assert.deepEqual(rows.map(item => item.id), [confirmed.intervention.id]);
    for (const key of ['phone', 'email', 'address', 'description', 'client_id']) assert.equal(key in rows[0], false);
    const empty = await get(history, other);
    assert.equal(empty.status, 200);
    assert.deepEqual((await empty.json()).interventions, []);
    assert.equal((await get(history, unverified)).status, 403);
    assert.equal((await get(history, owner, { authorization: 'Bearer invalid.native.token' })).status, 401);
    assert.deepEqual(sqlErrors.map(item => item.code), ['42501', 'P0001']);
    console.log('PASS Native Bearer booking, same receipt after three retries, one dossier, scoped history, private fields absent. Synthetic Auth; no provider calls.');
  }, {}, {
    users, rpcAllowlist: new Set(['create_on_site_booking_reviewed']),
    async handle(request, response, { user, send }) {
      if (!user || request.method !== 'GET') return false;
      const url = new URL(request.url, 'http://127.0.0.1');
      if (url.pathname === '/rest/v1/profiles') {
        assert.equal(url.searchParams.get('id'), 'eq.' + user.id);
        const profile = await asUser(db, user, 'select to_jsonb(p) v from (select id, role from public.profiles where id=$1) p', [user.id]);
        send(200, profile ? [profile] : []);
        return true;
      }
      if (url.pathname === '/rest/v1/interventions') {
        assert.equal(url.searchParams.get('client_id'), 'eq.' + user.id);
        assert.equal(url.searchParams.get('select'), 'id,category,status,city,created_at,estimate_min_cents,estimate_max_cents');
        const rows = await asUser(db, user, `select coalesce(jsonb_agg(to_jsonb(i)),'[]') v
          from (select id, category, status, city, to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') created_at,
            estimate_min_cents, estimate_max_cents from public.interventions where client_id=$1
            order by created_at desc, id desc limit 26) i`, [user.id]);
        response.setHeader('Content-Range', rows.length ? '0-' + (rows.length - 1) + '/' + rows.length : '*/0');
        send(200, rows);
        return true;
      }
      return false;
    },
  });
} finally {
  await db.close();
}

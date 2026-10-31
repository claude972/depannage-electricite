import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateQuote, canTransition, verifyPayment } from '../lib/domain';

test('quote totals preserve cents and round the tax once', () => {
  assert.deepEqual(calculateQuote([{ label: 'Déplacement', quantity: 1, unit_price_cents: 8000 }, { label: 'Travail', quantity: 2, unit_price_cents: 12345 }], 5.5), { subtotal_cents: 32690, tax_cents: 1798, total_cents: 34488 });
});
test('negative, fractional, empty and excessive quotes are rejected', () => {
  for (const value of [-1, 1.5, Number.NaN, 10000001]) assert.throws(() => calculateQuote([{ label: 'Travail', quantity: 1, unit_price_cents: value }], 20));
  assert.throws(() => calculateQuote([], 20));
  assert.throws(() => calculateQuote([{ label: ' ', quantity: 1, unit_price_cents: 100 }], 20));
  assert.throws(() => calculateQuote([{ label: 'Pièces', quantity: 1001, unit_price_cents: 100 }], 20));
  assert.throws(() => calculateQuote([{ label: 'Travail', quantity: 1, unit_price_cents: 100 }], 21));
});
test('only expected roles and order can advance an intervention', () => {
  assert.equal(canTransition('requested', 'accept_mission', 'artisan'), true);
  assert.equal(canTransition('requested', 'accept_mission', 'client'), false);
  assert.equal(canTransition('paid', 'cancel', 'client'), false);
  assert.equal(canTransition('quoted', 'accept_quote', 'client'), true);
  assert.equal(canTransition('quoted', 'start', 'artisan'), false);
  assert.equal(canTransition('in_progress', 'complete', 'artisan'), true);
  assert.equal(canTransition('completed', 'complete', 'artisan'), false);
});
test('payment needs exact session, amount, currency, quote and paid status', () => {
  const expected = { total_cents: 12000, session_id: 'cs_test_a', quote_id: 'q1' };
  const received = { amount_total: 12000, currency: 'eur', id: 'cs_test_a', quote_id: 'q1', payment_status: 'paid' };
  assert.equal(verifyPayment(expected, received), true);
  for (const mismatch of [{ amount_total: 11999 }, { currency: 'usd' }, { id: 'cs_test_b' }, { quote_id: 'q2' }, { payment_status: 'unpaid' }]) assert.equal(verifyPayment(expected, { ...received, ...mismatch }), false);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateQuote, canTransition, verifyPayment, type InterventionStatus, type InterventionAction, type Role } from '../lib/domain';

const statuses: InterventionStatus[] = ['requested', 'assigned', 'quoted', 'accepted', 'in_progress', 'completed', 'paid', 'cancelled'];
const actions: InterventionAction[] = ['accept_mission', 'send_quote', 'accept_quote', 'start', 'complete', 'cancel'];
const roles: Role[] = ['client', 'artisan', 'manager', 'admin'];

test('settled and cancelled work cannot be mutated through normal role actions', () => {
  for (const status of ['paid', 'cancelled'] as const) {
    for (const role of roles) for (const action of actions) {
      assert.equal(canTransition(status, action, role), false, `${role} ${action} ${status}`);
    }
  }
});

test('a client or manager cannot act as an artisan even at an otherwise valid stage', () => {
  for (const role of ['client', 'manager'] as const) {
    for (const status of statuses) for (const action of ['accept_mission', 'send_quote', 'start', 'complete'] as const) {
      assert.equal(canTransition(status, action, role), false, `${role} ${action} ${status}`);
    }
  }
});

test('an artisan cannot accept or cancel a customer quote', () => {
  for (const status of statuses) {
    assert.equal(canTransition(status, 'accept_quote', 'artisan'), false);
    assert.equal(canTransition(status, 'cancel', 'artisan'), false);
  }
});

test('tax uses the invoice subtotal and a single rounding operation', () => {
  // Two one-cent lines at 20% would incorrectly become zero if rounded per line.
  const totals = calculateQuote([
    { label: 'Fourniture A', quantity: 1, unit_price_cents: 1 },
    { label: 'Fourniture B', quantity: 2, unit_price_cents: 1 },
  ], 20);
  assert.deepEqual(totals, { subtotal_cents: 3, tax_cents: 1, total_cents: 4 });
});

test('invoice ceiling includes tax and zero-price invoices cannot be sent', () => {
  assert.deepEqual(calculateQuote([{ label: 'Prestation', quantity: 1, unit_price_cents: 10000000 }], 0), {
    subtotal_cents: 10000000, tax_cents: 0, total_cents: 10000000,
  });
  assert.throws(() => calculateQuote([{ label: 'Prestation', quantity: 1, unit_price_cents: 10000000 }], 20));
  assert.throws(() => calculateQuote([{ label: 'Prestation', quantity: 1, unit_price_cents: 0 }], 0));
});

test('no incomplete checkout payload counts as a confirmed payment', () => {
  const expected = { total_cents: 12345, session_id: 'cs_test_verified', quote_id: 'quote_verified' };
  const base = { amount_total: 12345, currency: 'eur', id: 'cs_test_verified', payment_status: 'paid', quote_id: 'quote_verified' };
  assert.equal(verifyPayment(expected, { ...base, amount_total: null }), false);
  assert.equal(verifyPayment(expected, { ...base, currency: null }), false);
  assert.equal(verifyPayment(expected, { ...base, quote_id: undefined }), false);
  assert.equal(verifyPayment(expected, { ...base, payment_status: 'no_payment_required' }), false);
});

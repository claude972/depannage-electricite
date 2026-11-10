import test from 'node:test';
import assert from 'node:assert/strict';
import { paymentReturn, paymentReturnKey, paymentReturnStatus, recentPaymentReturn, stripeReadback } from '../apps/mobile/src/lib/payment-return';

const quote = '74da2e56-ff80-463b-bbc5-26c6de826b0e';
const dossier = '84da2e56-ff80-463b-bbc5-26c6de826b0e';
const paid = stripeReadback.parse({ payment: { quote_id:quote, method:'stripe', status:'paid' } });
const pending = stripeReadback.parse({ payment: { quote_id:quote, method:'stripe', status:'pending' } });
const absent = stripeReadback.parse({ payment:null });
test('payment return reads authoritative status before, during and after browser return', () => {
  for (const [results, states] of [
    [[paid], ['paid']],
    [[pending, paid], ['pending','paid']],
    [[absent, pending, paid], ['pending','pending','paid']],
  ] as const) assert.deepEqual(results.map(result => paymentReturnStatus(result,quote)),states);
  assert.equal(paymentReturnStatus(paid,dossier),'pending');
  assert.equal(paymentReturnStatus({ payment:{ ...paid.payment!, method:'on_site_declared' } },quote),'pending');
});
test('payment resume is recent, identity-bound and stores no provider token', () => {
  const startedAt = Date.now();
  const state = { dossier, quote, startedAt };
  assert.deepEqual(paymentReturn.parse(state),state);
  assert.equal(paymentReturn.safeParse({ ...state, token:'provider' }).success,false);
  assert.notEqual(paymentReturnKey(quote),paymentReturnKey(dossier));
  assert.ok(recentPaymentReturn(startedAt,startedAt+1));
  assert.equal(recentPaymentReturn(startedAt,startedAt+900000),false);
  assert.equal(recentPaymentReturn(startedAt,startedAt-1),false);
});

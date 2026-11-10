import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Action, Card, Copy } from './ui';
import { api, ApiFailure } from '@/lib/api';
import { deviceDrafts } from '@/lib/device-drafts';
import { paymentReturn, paymentReturnKey, paymentReturnStatus, recentPaymentReturn, stripeReadback } from '@/lib/payment-return';

export function PaymentReturnStatus({ id, actor, token, quote, fromLink, onPaid }: {
  id: string; actor: string; token: string; quote: string; fromLink: boolean; onPaid: () => void;
}) {
  const [visible, setVisible] = useState(fromLink);
  const [status, setStatus] = useState<'pending' | 'paid' | 'failed'>('pending');
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0), [active, setActive] = useState(AppState.currentState === 'active');
  const [focused, setFocused] = useState(false);
  const notify = useRef(onPaid); notify.current = onPaid;
  const key = paymentReturnKey(actor);
  useFocusEffect(useCallback(() => {
    setFocused(true);
    return () => setFocused(false);
  }, []));
  useEffect(() => {
    const listener = AppState.addEventListener('change', value => setActive(value === 'active'));
    return () => listener.remove();
  }, []);
  useEffect(() => {
    if (!focused || !active) return;
    let live = true;
    void deviceDrafts.read(key, paymentReturn).then(value => {
      if (live && value?.dossier === id && value.quote === quote && recentPaymentReturn(value.startedAt))
        setVisible(true);
    }, () => {});
    return () => { live = false; };
  }, [active, focused, key, id, quote, attempt]);
  useEffect(() => {
    if (!visible || !focused || !active) return;
    const controller = new AbortController();
    const delays = [2000, 4000, 8000, 16000];
    let timer: ReturnType<typeof setTimeout>, next = 0;
    async function check() {
      try {
        const result = await api('/api/payments/status?quote_id=' + quote, stripeReadback, { token, signal:controller.signal });
        if (controller.signal.aborted) return;
        const value = paymentReturnStatus(result, quote);
        setError(null); setStatus(value);
        if (value === 'paid') {
          notify.current();
          const saved = await deviceDrafts.read(key, paymentReturn);
          if (saved?.dossier === id && saved.quote === quote) await deviceDrafts.clear(key);
          return;
        }
        if (value === 'failed') return;
      } catch (issue) {
        if (controller.signal.aborted) return;
        setError(issue instanceof Error ? issue.message : 'Le règlement doit être vérifié.');
        if (issue instanceof ApiFailure && [401,403,404].includes(issue.status)) { setStatus('pending'); return; }
      }
      if (!controller.signal.aborted && next < delays.length) timer = setTimeout(check, delays[next++]);
    }
    void check();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [visible, focused, active, attempt, id, key, quote, token]);
  return visible ? <Card>
    <Copy kind="subtitle">Retour du paiement</Copy>
    <Copy>{status === 'paid' ? 'Règlement confirmé.' : status === 'failed' ? 'Règlement non abouti.' : 'Règlement en attente de confirmation.'}</Copy>
    {error && <Copy kind="error">{error}</Copy>}
    {status !== 'paid' && <Action label="Vérifier le règlement" secondary onPress={() => setAttempt(value => value + 1)} />}
  </Card> : null;
}

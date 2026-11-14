import { useEffect, useRef, useState } from 'react';
import { Keyboard } from 'react-native';
import { useRouter } from 'expo-router';
import { orderReference, parseOrderReference } from '../../../../shared/order-reference';
import { categories } from '@/lib/contracts';
import { jobStatus } from '@/lib/job-presentation';
import { findMyOrders } from '@/lib/session';
import { Action, Card, Copy, Field } from './ui';

export function OrderLookup() {
  const router = useRouter();
  const [input, setInput] = useState('');
  const [orders, setOrders] = useState<Awaited<ReturnType<typeof findMyOrders>> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => active.current?.abort(), []);

  async function search() {
    if (active.current) return;
    const reference = parseOrderReference(input);
    if (!reference) {
      setError('Saisissez un numéro de commande, par exemple INT-1A2B3C.');
      return;
    }
    const controller = new AbortController();
    active.current = controller;
    const timeout = setTimeout(() => {
      if (active.current !== controller) return;
      controller.abort();
      active.current = null;
      setBusy(false);
      setError('La recherche a pris trop de temps. Réessayez.');
    }, 20000);
    Keyboard.dismiss();
    setBusy(true);
    setError(null);
    setOrders(null);
    try {
      const results = await findMyOrders(reference, controller.signal);
      if (!controller.signal.aborted) setOrders(results);
    } catch (issue) {
      if (!controller.signal.aborted) setError(issue instanceof Error ? issue.message : 'Recherche indisponible.');
    } finally {
      clearTimeout(timeout);
      if (active.current === controller && !controller.signal.aborted) {
        active.current = null;
        setBusy(false);
      }
    }
  }

  return <Card>
    <Copy kind="subtitle">Retrouver une commande</Copy>
    <Field label="Numéro de commande" placeholder="INT-1A2B3C" value={input} onChangeText={value => {
      active.current?.abort();
      active.current = null;
      setBusy(false);
      setInput(value);
      setOrders(null);
      setError(null);
    }} autoCapitalize="characters" autoCorrect={false} maxLength={20} returnKeyType="search" onSubmitEditing={() => void search()} />
    <Action secondary disabled={busy} label={busy ? 'Recherche…' : 'Rechercher'} onPress={() => void search()} />
    {error && <Copy kind="error">{error}</Copy>}
    {orders?.length === 0 && <Copy kind="muted">Aucune commande de ce numéro dans votre compte.</Copy>}
    {orders?.map(order => <Card key={order.id}>
      <Copy kind="label">{orderReference(order.id)}</Copy>
      <Copy>{categories[order.category]} · {order.city} · {jobStatus(order.status, 'client')}</Copy>
      <Action label="Ouvrir la commande" onPress={() => router.push({ pathname: '/dossier/[id]', params: { id: order.id } })} />
    </Card>)}
  </Card>;
}

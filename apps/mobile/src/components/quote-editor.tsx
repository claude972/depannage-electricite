import { useState } from 'react';
import { Action, Card, Copy, Field, ReadState } from './ui';
import { quoteDraft, quoteRates, type DraftLine } from '@/lib/intervention-drafts';
import { useDeviceDraft } from '@/lib/use-device-draft';

type PricedLine = { label: string; quantity: number; unit_price_cents: number };
const newLine = (): DraftLine => ({ label: '', quantity: '1', price: '' });

export function QuoteEditor({ draftKey, busy, onSend }: {
  draftKey: string;
  busy: boolean;
  onSend: (lines: PricedLine[], rate: number, onSaved: () => Promise<void>) => void;
}) {
  const draft = useDeviceDraft(draftKey, quoteDraft, { lines: [newLine()], rate: null }, true);
  const [error, setError] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const disabled = busy || preparing;
  const update = (index: number, key: keyof DraftLine, value: string) =>
    draft.edit(current => ({ ...current, lines: current.lines.map((line, i) => i === index ? { ...line, [key]: value } : line) }));

  async function send() {
    if (!draft.value || disabled) return;
    setError(null);
    const { lines, rate } = draft.value;
    const priced = lines.map(line => {
      const price = line.price.trim().replace(',', '.');
      const quantity = Number(line.quantity);
      const cents = /^\d{1,6}(?:\.\d{1,2})?$/.test(price) ? Math.round(Number(price) * 100) : -1;
      return { label: line.label.trim(), quantity, unit_price_cents: cents };
    });
    if (rate === null || priced.some(line => !line.label || !Number.isSafeInteger(line.quantity) || line.quantity < 1 || line.quantity > 1000 || line.unit_price_cents < 0 || line.unit_price_cents > 10000000)) {
      setError('Renseignez les libellés, quantités, prix et le taux de TVA applicable.');
      return;
    }
    setPreparing(true);
    try {
      await draft.flush();
      onSend(priced, rate, draft.clear);
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : 'Le devis n’a pas pu être préparé.');
    } finally {
      setPreparing(false);
    }
  }

  if (!draft.value) return <Card>
    <ReadState loading={!draft.error} error={draft.error} onRetry={draft.retry} />
    {draft.canRecover && <Action secondary disabled={draft.pending} label="Préparer un nouveau brouillon" onPress={() => void draft.recover()} />}
  </Card>;
  const { lines, rate } = draft.value;
  return <Card>
    <Copy kind="subtitle">Préparer le devis</Copy>
    {lines.map((line, index) => <Card key={index}>
      <Copy kind="label">LIGNE {index + 1}</Copy>
      <Field label="Prestation ou pièce" value={line.label} onChangeText={value => update(index, 'label', value)} maxLength={160} editable={!disabled} />
      <Field label="Quantité" value={line.quantity} onChangeText={value => update(index, 'quantity', value)} maxLength={4} keyboardType="numeric" editable={!disabled} />
      <Field label="Prix unitaire HT en euros" value={line.price} onChangeText={value => update(index, 'price', value)} maxLength={9} keyboardType="decimal-pad" editable={!disabled} />
      {lines.length > 1 && <Action label="Retirer cette ligne" secondary disabled={disabled} onPress={() => draft.edit(current => ({ ...current, lines: current.lines.filter((_, i) => i !== index) }))} />}
    </Card>)}
    {lines.length < 30 && <Action label="Ajouter une ligne" secondary disabled={disabled} onPress={() => draft.edit(current => ({ ...current, lines: [...current.lines, newLine()] }))} />}
    <Copy>Taux de TVA applicable</Copy>
    {quoteRates.map(value => <Action key={value} label={`${value.toLocaleString('fr-FR')} %`} selected={rate === value} secondary={rate !== value} disabled={disabled} onPress={() => draft.edit(current => ({ ...current, rate: value }))} />)}
    {draft.pending && <Copy kind="muted">Enregistrement du brouillon…</Copy>}
    {draft.error && <ReadState loading={false} error={draft.error} onRetry={draft.retry} />}
    {error && <Copy kind="error">{error}</Copy>}
    <Action label="Envoyer le devis" disabled={disabled} onPress={() => void send()} />
  </Card>;
}

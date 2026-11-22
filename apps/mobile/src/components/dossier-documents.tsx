import { useRef, useState } from 'react';
import { openBrowserAsync } from 'expo-web-browser';
import { z } from 'zod';
import { Action, Card, Copy, ReadState } from './ui';
import { ApiFailure, api, useResource } from '@/lib/api';
import { supabaseOrigin } from '@/lib/config';
import { euros, link, timestamp, type Payment } from '@/lib/contracts';
import { paymentLabel } from '@/lib/job-presentation';

// CLI-08 : mêmes lectures que la page « Documents » du Web. Les PDF sont rendus par le serveur à partir de
// l’instantané enregistré ; l’application ne reçoit qu’un lien signé de courte durée, jamais le fichier d’un tiers.
const cents = z.number().int().nonnegative();
const pdf = z.object({ id: z.uuid(), kind: z.enum(['quote', 'amendment']), reference: z.string(), revision: z.number().int().positive(), generated_at: z.string(), snapshot_sha256: z.string() });
const terms = z.object({ valid_until: z.string().nullable(), validity: z.enum(['unspecified', 'valid', 'expired']) }).nullable().catch(null);
const amounts = { subtotal_cents: cents, tax_rate: z.coerce.number(), tax_cents: cents, total_cents: cents };
const overview = z.object({
  issuer: z.object({ ready: z.boolean() }).catch({ ready: true }),
  quotes: z.array(z.object({
    id: z.uuid(), reference: z.string(), status: z.string(), created_at: z.string(), accepted_at: z.string().nullish(), ...amounts, terms,
    permissions: z.object({ can_generate: z.boolean() }).catch({ can_generate: false }),
    documents: z.array(pdf).catch([]),
    amendments: z.array(z.object({
      id: z.uuid(), reference: z.string(), status: z.enum(['proposed', 'accepted', 'rejected', 'withdrawn']), reason: z.string().catch(''), ...amounts, created_at: z.string(),
      permissions: z.object({ can_generate: z.boolean() }).catch({ can_generate: false }), documents: z.array(pdf).catch([]),
    })).catch([]),
  })),
});
const generated = z.object({ action: z.literal('generate'), document: z.object({ id: z.uuid() }) });
const invoices = z.object({
  invoices: z.array(z.object({
    id: z.uuid(), kind: z.enum(['invoice', 'credit_note']), basis: z.enum(['service', 'platform_commission']), number: z.string(),
    issuer_name: z.string(), total_cents: cents, tax_cents: cents, issued_at: z.string(), version: z.object({ sha256: z.string() }),
  })),
  page: z.object({ total: z.number().int().nonnegative(), has_more: z.boolean() }),
});
const pieces = z.object({
  documents: z.array(z.object({ id: z.uuid(), owner_id: z.uuid(), name: z.string(), mime_type: z.string(), created_at: z.string() })),
  page: z.object({ has_more: z.boolean(), next_cursor: z.string().nullable() }),
});
const quoteStatus = (status: string) => status === 'accepted' ? 'accepté' : status === 'rejected' ? 'refusé' : status === 'sent' ? 'proposé' : status;
const amendmentStatus = { proposed: 'proposé', accepted: 'accepté', rejected: 'refusé', withdrawn: 'retiré' } as const;
const day = (value: string) => new Date(value.length === 10 ? value + 'T12:00:00Z' : value).toLocaleDateString('fr-FR', { dateStyle: 'medium', timeZone: 'America/Martinique' });
const validity = (value: z.infer<typeof terms>) => !value || value.validity === 'unspecified' || !value.valid_until ? 'Validité non précisée'
  : value.validity === 'expired' ? `Validité expirée depuis le ${day(value.valid_until)}` : `Valable jusqu’au ${day(value.valid_until)}`;
const rate = (value: number) => Number.isFinite(value) ? ` ${value.toLocaleString('fr-FR')} %` : '';

export function DossierDocuments({ id, token, actor, artisan, payments }: { id: string; token: string; actor: string; artisan: boolean; payments?: Payment[] }) {
  const quotes = useResource(`/api/quote-documents?intervention_id=${id}`, overview, token, actor);
  // Factures lisibles par leur destinataire, son organisation ou l’artisan émetteur (droits décidés par le serveur).
  const bills = useResource(`/api/invoices?intervention_id=${id}&limit=50`, invoices, token, actor);
  const [pieceLimit, setPieceLimit] = useState(25);
  const files = useResource(`/api/documents/history?intervention_id=${id}&limit=${pieceLimit}`, pieces, token, actor);
  const [busy, setBusy] = useState<string | null>(null), [error, setError] = useState<string | null>(null);
  const lock = useRef(false);
  async function run(key: string, work: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true; setBusy(key); setError(null);
    try { await work(); }
    catch (issue) { setError(issue instanceof ApiFailure || issue instanceof Error ? issue.message : 'Le document est momentanément indisponible.'); }
    finally { lock.current = false; setBusy(null); }
  }
  /** Lien signé de 60 secondes vers le PDF que le serveur vient de rendre pour ce lecteur. */
  const open = (key: string, path: string) => run(key, async () => {
    const target = new URL((await api(path, link, { token })).url);
    if (target.origin !== supabaseOrigin || !target.pathname.startsWith('/storage/v1/object/sign/')) throw Error('Le lien du document est invalide.');
    await openBrowserAsync(target.toString());
  });
  const generate = (quoteId: string, amendmentId: string | null) => run('g' + (amendmentId ?? quoteId), async () => {
    await api('/api/quote-documents', generated, { token, method: 'POST', body: { action: 'generate', quote_id: quoteId, amendment_id: amendmentId } });
    quotes.reload();
  });
  const versions = (reference: string, documents: z.infer<typeof pdf>[]) => [...documents].sort((a, b) => b.revision - a.revision).map((item, index) => <Copy key={item.id + 'v'} kind="muted" selectable>
    Révision {item.revision}{index === 0 && documents.length > 1 ? ' (la plus récente)' : ''} · générée le {timestamp(item.generated_at)} · empreinte {item.snapshot_sha256.slice(0, 12)}
  </Copy>);
  const openers = (reference: string, documents: z.infer<typeof pdf>[]) => [...documents].sort((a, b) => b.revision - a.revision).map(item =>
    <Action key={item.id} secondary disabled={busy !== null} label={busy === item.id ? 'Ouverture du PDF…' : `Ouvrir le PDF ${reference} · révision ${item.revision}`}
      onPress={() => void open(item.id, `/api/quote-documents/${item.id}?link=1`)} />);
  const paid = (payments ?? []).filter(item => item.status === 'paid');
  return <>
    <Card>
      <Copy kind="subtitle">Devis et documents</Copy>
      <ReadState loading={quotes.loading} error={quotes.error} onRetry={quotes.reload} />
      {error && <Copy kind="error">{error}</Copy>}
      {quotes.data && !quotes.data.quotes.length && <Copy kind="muted">Aucun devis n’a encore été émis pour ce dossier.</Copy>}
      {quotes.data?.quotes.map(quote => <Card key={quote.id}>
        <Copy kind="label">Devis {quote.reference} · {quoteStatus(quote.status)}</Copy>
        <Copy kind="muted" selectable>Émis le {timestamp(quote.created_at)}{quote.accepted_at ? ` · accepté le ${timestamp(quote.accepted_at)}` : ''}</Copy>
        <Copy selectable>Total HT {euros(quote.subtotal_cents)} · TVA{rate(quote.tax_rate)} {euros(quote.tax_cents)} · Total TTC {euros(quote.total_cents)}</Copy>
        <Copy kind="muted">{validity(quote.terms)}</Copy>
        {quote.documents.length ? <>{versions(quote.reference, quote.documents)}{openers(quote.reference, quote.documents)}</>
          : <Copy kind="muted">Aucun PDF n’a encore été généré pour ce devis.</Copy>}
        {quote.permissions.can_generate && (quotes.data!.issuer.ready
          ? <Action secondary disabled={busy !== null} label={busy === 'g' + quote.id ? 'Génération du PDF…' : quote.documents.length ? `Générer une nouvelle révision du PDF ${quote.reference}` : `Générer le PDF du devis ${quote.reference}`} onPress={() => void generate(quote.id, null)} />
          : <Copy kind="muted">Le dossier professionnel de l’émetteur est incomplet : le PDF ne peut pas encore être généré.</Copy>)}
        {quote.amendments.map(item => <Card key={item.id}>
          <Copy kind="label">Avenant {item.reference} · {amendmentStatus[item.status]}</Copy>
          {item.reason.trim() ? <Copy selectable>{item.reason.trim()}</Copy> : null}
          <Copy selectable>Total HT {euros(item.subtotal_cents)} · TVA{rate(item.tax_rate)} {euros(item.tax_cents)} · Total TTC {euros(item.total_cents)}</Copy>
          {versions(item.reference, item.documents)}{openers(item.reference, item.documents)}
          {item.permissions.can_generate && quotes.data!.issuer.ready && <Action secondary disabled={busy !== null} label={busy === 'g' + item.id ? 'Génération du PDF…' : `Générer le PDF de l’avenant ${item.reference}`} onPress={() => void generate(quote.id, item.id)} />}
        </Card>)}
      </Card>)}
      {quotes.data && quotes.data.quotes.length > 0 && <Copy kind="muted">Chaque révision reste consultable telle qu’elle a été générée ; un devis refusé ou remplacé n’est pas modifié.</Copy>}
    </Card>
    {<Card>
      <Copy kind="subtitle">Factures</Copy>
      <ReadState loading={bills.loading} error={bills.error} onRetry={bills.reload} />
      {bills.data && !bills.data.invoices.length && <Copy kind="muted">Aucune facture n’a été émise pour ce dossier.</Copy>}
      {bills.data?.invoices.map(item => {
        const name = (item.kind === 'credit_note' ? 'l’avoir n° ' : 'la facture n° ') + item.number;
        return <Card key={item.id}>
          <Copy kind="label">{item.kind === 'credit_note' ? 'Avoir' : 'Facture'} n° {item.number} · {item.basis === 'service' ? 'prestation' : 'commission de plateforme'}</Copy>
          <Copy selectable>{euros(item.total_cents)} TTC · dont TVA {euros(item.tax_cents)}</Copy>
          <Copy kind="muted" selectable>Émise le {timestamp(item.issued_at)} par {item.issuer_name} · empreinte {item.version.sha256.slice(0, 12)}</Copy>
          <Action secondary disabled={busy !== null} label={busy === item.id ? 'Ouverture du PDF…' : `Ouvrir ${name}`} onPress={() => void open(item.id, `/api/invoices/${item.id}/pdf?link=1`)} />
        </Card>;
      })}
      {bills.data?.page.has_more && <Copy kind="muted">Seules les 50 factures les plus récentes de ce dossier sont affichées.</Copy>}
    </Card>}
    {!artisan && paid.length > 0 && <Card>
      <Copy kind="subtitle">Reçu de règlement</Copy>
      {paid.map(item => <Card key={item.id}>
        <Copy kind="label">{paymentLabel(item)}</Copy>
        <Copy selectable>{euros(item.total_cents)}{item.paid_at ? ` · le ${timestamp(item.paid_at)}` : ''}</Copy>
        <Copy kind="muted" selectable>Mode · {item.method === 'stripe' ? 'carte bancaire, encaissée par la plateforme' : item.method === 'on_site_declared' ? 'déclaré sur place par l’artisan' : 'non précisé'} · référence du règlement {item.id.slice(0, 8).toUpperCase()}</Copy>
      </Card>)}
      <Copy kind="muted">Ce récapitulatif reprend l’état enregistré par la plateforme ; il ne remplace pas la facture ci-dessus lorsqu’elle a été émise.</Copy>
    </Card>}
    <Card>
      <Copy kind="subtitle">Historique des pièces</Copy>
      <ReadState loading={files.loading && !files.data} error={files.error} onRetry={files.reload} />
      {files.data && !files.data.documents.length && <Copy kind="muted">Aucune pièce n’a été déposée dans ce dossier.</Copy>}
      {files.data?.documents.map(item => <Copy key={item.id} kind="muted" selectable>{item.name} · déposée le {timestamp(item.created_at)} {item.owner_id === actor ? 'par vous' : 'par un autre participant du dossier'}</Copy>)}
      {files.data?.page.has_more && pieceLimit < 100 && <Action secondary label="Afficher les pièces plus anciennes" onPress={() => setPieceLimit(100)} />}
      {files.data?.page.has_more && pieceLimit >= 100 && <Copy kind="muted">Seules les 100 pièces les plus récentes sont affichées ici.</Copy>}
      {files.data && files.data.documents.length > 0 && <Copy kind="muted">Chaque dépôt est conservé séparément : une pièce remplacée reste listée à sa date. Ouvrez une pièce depuis « Pièces du dossier ».</Copy>}
    </Card>
  </>;
}

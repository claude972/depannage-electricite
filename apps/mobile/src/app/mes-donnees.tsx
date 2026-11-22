import { useEffect, useRef, useState } from 'react';
import { Alert, Share } from 'react-native';
import { useRouter } from 'expo-router';
import { randomUUID } from 'expo-crypto';
import { z } from 'zod';
import { Action, Card, Copy, ReadState, Screen } from '@/components/ui';
import { LabeledSwitch } from '@/components/labeled-switch';
import { PublicLink, usePublicPortal } from '@/components/mobile-public-content';
import { ApiFailure, api, useResource } from '@/lib/api';
import { categories, statuses, timestamp } from '@/lib/contracts';
import { useSession } from '@/lib/session';

// Contrat : app/api/profile/data. GET ?section=…[&after=uuid] → 100 lignes par page, propres au compte ;
// POST { action:'request_erasure', request_id, confirmed:true } ouvre un ticket d’assistance, sans rien effacer.
const PATH = '/api/profile/data';
const SECTIONS = [
  ['account', 'Compte et préférences'], ['addresses', 'Adresses enregistrées'], ['requests', 'Demandes d’intervention personnelles'],
  ['booking_locations', 'Lieux et compléments d’accès des réservations'], ['messages', 'Messages que vous avez écrits'],
  ['documents', 'Documents dont vous êtes propriétaire'], ['support', 'Demandes d’assistance'],
  ['erasure_requests', 'Demandes d’effacement'], ['payment_reminders', 'Rappels de règlement'],
] as const;
type Section = typeof SECTIONS[number][0];
type Row = Record<string, unknown>;
const row = z.record(z.string(), z.unknown());
const page = z.object({ section: z.string(), data: row.optional(), rows: z.array(row).max(100).optional(), next_cursor: z.uuid().nullable() });
const erasureState = z.enum(['requested', 'in_review', 'needs_information', 'approved', 'rejected']);
const erasureRow = z.object({ id: z.uuid(), ticket_id: z.uuid(), state: erasureState, execution_state: z.literal('not_started'), version: z.number().int(), created_at: z.string(), updated_at: z.string() });
const erasurePage = z.object({ section: z.literal('erasure_requests'), rows: z.array(erasureRow).max(100), next_cursor: z.uuid().nullable() });
const receipt = z.object({ ticket_id: z.uuid(), status: z.enum(['open', 'in_progress', 'awaiting_user', 'resolved']), replayed: z.boolean() });
const stateLabels = { requested: 'Demande reçue', in_review: 'En cours d’examen', needs_information: 'Informations demandées', approved: 'Approuvée', rejected: 'Refusée' };
const ticketLabels = { open: 'ouvert', in_progress: 'en cours de traitement', awaiting_user: 'en attente de votre réponse', resolved: 'résolu' };
const roleLabels: Record<string, string> = { client: 'Compte particulier', artisan: 'Compte électricien', manager: 'Compte entreprise', admin: 'Administration' };
const reminderLabels: Record<string, string> = { scheduled: 'programmé', cancelled: 'annulé', sent: 'envoyé', invalidated: 'invalidé', muted: 'désactivé' };
const supportLabels: Record<string, string> = { open: 'Ouverte', in_progress: 'En cours', awaiting_user: 'Réponse attendue', resolved: 'Résolue' };
const text = (value: unknown) => typeof value === 'string' ? value : value == null ? '' : String(value);
const date = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? timestamp(value) : '';
const join = (...parts: unknown[]) => parts.map(text).filter(Boolean).join(' · ');

/** Lecture lisible d’une ligne : uniquement les champs renvoyés par le serveur, sans interprétation. */
function lines(section: Section, item: Row): string[] {
  if (section === 'account') {
    const profile = (item.profile ?? {}) as Row, preferences = item.notification_preferences as Row | null;
    const muted = Array.isArray(preferences?.muted_kinds) ? preferences.muted_kinds.length : 0;
    return [
      join(profile.full_name, roleLabels[text(profile.role)] ?? profile.role),
      item.email ? `E-mail · ${text(item.email)}` : 'E-mail · non renseigné',
      `Téléphone du profil · ${text(profile.phone) || 'non renseigné'}`,
      `Téléphone vérifié · ${text(item.verified_phone) || 'aucun'}`,
      profile.created_at ? `Compte créé le ${date(profile.created_at)}` : '',
      preferences ? `Notifications · e-mail ${preferences.email_enabled ? 'activé' : 'désactivé'}, SMS ${preferences.sms_enabled ? 'activé' : 'désactivé'}, navigateur ${preferences.push_enabled ? 'activé' : 'désactivé'}, ${muted} événement(s) masqué(s)`
        : 'Notifications · aucune préférence enregistrée (réglages par défaut)',
    ].filter(Boolean);
  }
  if (section === 'addresses') return [join(item.label, item.is_preferred ? 'préférée' : '', item.archived_at ? 'archivée' : ''), `${text(item.first_name)} ${text(item.last_name)}`.trim(), `${text(item.address)}, ${text(item.postal_code)} ${text(item.city)}`, item.latitude != null ? `Position déclarée · ${text(item.latitude)}, ${text(item.longitude)}` : ''].filter(Boolean);
  if (section === 'requests') return [join((categories as Record<string, string>)[text(item.category)] ?? item.category, (statuses as Record<string, string>)[text(item.status)] ?? item.status, item.urgency === 'urgent' ? 'Urgent' : 'Planifié'), text(item.description), `${text(item.address)}, ${text(item.postal_code)} ${text(item.city)}`, `Créée le ${date(item.created_at)}`].filter(Boolean);
  if (section === 'booking_locations') {
    const location = (item.location ?? {}) as Row;
    return [location.latitude != null ? `Point sur la carte · ${text(location.latitude)}, ${text(location.longitude)}` : 'Aucun point sur la carte', text(location.access_details) ? `Complément d’accès · ${text(location.access_details)}` : 'Aucun complément d’accès'];
  }
  if (section === 'messages') return [date(item.created_at), text(item.body)].filter(Boolean);
  if (section === 'documents') return [text(item.name), join(item.mime_type, date(item.created_at))].filter(Boolean);
  if (section === 'support') return [text(item.subject), join(supportLabels[text(item.status)] ?? item.status, date(item.created_at))].filter(Boolean);
  if (section === 'erasure_requests') return [join(stateLabels[text(item.state) as keyof typeof stateLabels] ?? item.state, 'Effacement non commencé'), `Déposée le ${date(item.created_at)}`];
  return [`Rappel prévu le ${date(item.remind_at)}`, join(reminderLabels[text(item.status)] ?? item.status, item.processed_at ? `traité le ${date(item.processed_at)}` : '')].filter(Boolean);
}

type Collected = { exported_at: string; sections: Record<Section, Row[]> };
export default function MyData() {
  const { session } = useSession();
  return session ? <Data key={session.user.id} token={session.access_token} actor={session.user.id} /> : <Screen><Copy>Connectez-vous pour consulter vos données.</Copy></Screen>;
}
function Data({ token, actor }: { token: string; actor: string }) {
  const router = useRouter();
  const { openPortal, portalError } = usePublicPortal();
  const latestToken = useRef(token); latestToken.current = token;
  const requests = useResource(PATH + '?section=erasure_requests', erasurePage, token, actor);
  const [copy, setCopy] = useState<Collected | null>(null), [collecting, setCollecting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null), [shown, setShown] = useState<Partial<Record<Section, number>>>({});
  const [confirmed, setConfirmed] = useState(false), [sending, setSending] = useState(false);
  const [erasureError, setErasureError] = useState<string | null>(null), [done, setDone] = useState<z.infer<typeof receipt> | null>(null);
  // Le même identifiant est renvoyé tant que la demande n’est pas confirmée : aucun doublon de ticket.
  const requestId = useRef<string | null>(null), lock = useRef(false), abort = useRef<AbortController | null>(null), alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; abort.current?.abort(); }; }, []);

  async function collect() {
    if (lock.current) return;
    lock.current = true; setError(null); setCopy(null); setShown({});
    const controller = new AbortController(); abort.current = controller;
    const sections = {} as Record<Section, Row[]>;
    try {
      for (const [section, label] of SECTIONS) {
        const rows: Row[] = [];
        let after: string | null = null;
        for (let pages = 0; ; pages++) {
          if (pages >= 500) throw new ApiFailure('Réponse inattendue du serveur : la collecte est interrompue.', 502);
          setCollecting(`${label}${pages ? ` · page ${pages + 1}` : ''}`);
          const result: z.infer<typeof page> = await api(`${PATH}?section=${section}${after ? `&after=${after}` : ''}`, page, { token: latestToken.current, signal: controller.signal });
          if (result.section !== section || (section === 'account') !== Boolean(result.data) || (section !== 'account' && !result.rows))
            throw new ApiFailure('Réponse inattendue du serveur : la collecte est interrompue.', 502);
          if (result.data) rows.push(result.data); else rows.push(...result.rows!);
          if (!result.next_cursor || result.next_cursor === after) break;
          after = result.next_cursor;
        }
        sections[section] = rows;
      }
      if (alive.current && !controller.signal.aborted) setCopy({ exported_at: new Date().toISOString(), sections });
    } catch (issue) {
      if (alive.current && !controller.signal.aborted) setError(issue instanceof ApiFailure && issue.status === 401 ? 'Session expirée : reconnectez-vous.' : issue instanceof Error ? issue.message : 'La réponse n’a pas pu être vérifiée : réessayez.');
    } finally { lock.current = false; if (alive.current) setCollecting(null); }
  }
  function share() {
    if (!copy) return;
    const file = { note: 'Copie des données personnelles du compte au moment de l’export. Les dossiers d’organisation et les messages de tiers sont exclus.', ...copy };
    void Share.share({ title: 'Mes données', message: JSON.stringify(file, null, 2) }).catch(() => setError('Le partage n’a pas pu s’ouvrir sur cet appareil. Les données restent affichées ci-dessous.'));
  }
  function erase() {
    if (lock.current || !confirmed) return;
    Alert.alert('Demander l’effacement ?', 'Un ticket sera ouvert auprès de l’assistance. Aucune donnée n’est effacée à ce stade.', [
      { text: 'Revenir', style: 'cancel' },
      { text: 'Confirmer', onPress: () => void send() },
    ]);
  }
  async function send() {
    if (lock.current) return;
    lock.current = true; setSending(true); setErasureError(null);
    requestId.current ??= randomUUID();
    try {
      const result = await api(PATH, receipt, { token: latestToken.current, method: 'POST', body: { action: 'request_erasure', request_id: requestId.current, confirmed: true } });
      if (!alive.current) return;
      requestId.current = null; setDone(result); setConfirmed(false); requests.reload();
    } catch (issue) {
      if (!alive.current) return;
      const status = issue instanceof ApiFailure ? issue.status : 0;
      // Réponse perdue ou service indisponible : l’identifiant est conservé pour renvoyer la même demande.
      if (status === 0 || status >= 500 || status === 429) setErasureError('La demande n’est pas confirmée. Réessayez : la même demande sera renvoyée, sans doublon.');
      else { requestId.current = null; setErasureError(status === 401 ? 'Session expirée : reconnectez-vous. Rien n’a été enregistré.' : status === 409 ? 'La demande n’a pas pu être enregistrée en l’état : rien n’est renvoyé automatiquement. Consultez l’assistance avant de recommencer.' : 'Le serveur refuse cette demande : rien n’a été enregistré.'); }
    } finally { lock.current = false; if (alive.current) setSending(false); }
  }
  const ticket = (id: string) => router.push({ pathname: '/dossier/assistance-suivi', params: { ticket_id: id } });
  return <Screen>
    <Copy kind="title">Mes données</Copy>
    <Copy>Consultez une copie des données personnelles liées à votre compte, ou demandez leur effacement.</Copy>
    <Card>
      <Copy kind="subtitle">Confidentialité et choix</Copy>
      <PublicLink label="Consulter la confidentialité" onPress={() => openPortal('/#privacy')} />
      {portalError && <Copy kind="error">{portalError}</Copy>}
      <Action secondary label="Préférences de notification" onPress={() => router.push('/notification-preferences')} />
    </Card>
    <Card>
      <Copy kind="subtitle">Copie de mes données</Copy>
      <Copy kind="muted">La copie contient votre compte, vos préférences de notification, vos adresses, vos demandes d’intervention personnelles, leurs points sur la carte et les compléments d’accès que vous avez renseignés, les messages que vous avez écrits, vos documents et vos demandes d’assistance. Les dossiers d’une organisation et les messages écrits par d’autres personnes n’en font pas partie.</Copy>
      {collecting && <Copy>Collecte en cours… {collecting}</Copy>}
      {error && <Copy kind="error">{error}</Copy>}
      <Action label={collecting ? 'Collecte en cours…' : copy ? 'Actualiser la copie de mes données' : 'Afficher mes données'} disabled={Boolean(collecting)} onPress={() => void collect()} />
      {copy && <>
        <Copy kind="muted">Copie lue le {timestamp(copy.exported_at)}. Elle reste sur cet écran et n’est pas enregistrée sur l’appareil.</Copy>
        <Action secondary label="Partager la copie (JSON)" onPress={share} />
      </>}
    </Card>
    {copy && SECTIONS.map(([section, label]) => {
      const rows = copy.sections[section], limit = shown[section] ?? 0;
      return <Card key={section}>
        <Copy kind="subtitle">{label}</Copy>
        <Copy kind="muted">{section === 'account' ? '1 fiche' : `${rows.length} élément(s)`}</Copy>
        {rows.slice(0, section === 'account' ? 1 : limit).map((item, index) => <Card key={index}>{lines(section, item).map((line, position) => <Copy key={position} selectable>{line}</Copy>)}</Card>)}
        {section !== 'account' && rows.length > limit && <Action secondary label={limit ? `Afficher la suite · ${label}` : `Afficher le détail · ${label}`} onPress={() => setShown(current => ({ ...current, [section]: limit + 20 }))} />}
        {section !== 'account' && limit > 0 && <Action secondary label={`Masquer le détail · ${label}`} onPress={() => setShown(current => ({ ...current, [section]: 0 }))} />}
      </Card>;
    })}
    <Card>
      <Copy kind="subtitle">Demander l’effacement</Copy>
      <Copy kind="muted">Cette demande ouvre un ticket auprès de l’assistance de la plateforme, qui examinera l’effacement des données personnelles de votre compte. Aucune donnée n’est effacée à ce stade : l’effacement effectif et les durées de conservation sont traités séparément, et vous suivez la demande dans l’assistance.</Copy>
      {done && <>
        <Copy>{done.replayed ? 'Demande déjà déposée : c’est le même ticket d’assistance. Aucune donnée n’a été effacée à ce stade.' : 'Demande d’effacement enregistrée : un ticket d’assistance est ouvert. Aucune donnée n’a été effacée à ce stade.'}</Copy>
        <Copy kind="muted">Ticket {ticketLabels[done.status]}.</Copy>
        <Action secondary label="Voir le ticket d’assistance" onPress={() => ticket(done.ticket_id)} />
      </>}
      <LabeledSwitch label="Je demande l’effacement de mes données personnelles" value={confirmed} disabled={sending} onValueChange={setConfirmed} />
      {erasureError && <Copy kind="error">{erasureError}</Copy>}
      <Action label={sending ? 'Envoi de la demande…' : 'Confirmer la demande d’effacement'} disabled={sending || !confirmed} onPress={erase} />
    </Card>
    <Card>
      <Copy kind="subtitle">Mes demandes d’effacement</Copy>
      <ReadState loading={requests.loading} error={requests.error} onRetry={requests.reload} />
      {requests.data && !requests.data.rows.length && <Copy kind="muted">Aucune demande d’effacement déposée.</Copy>}
      {requests.data?.rows.map(item => <Card key={item.id}>
        <Copy kind="label">{stateLabels[item.state]}</Copy>
        <Copy>Effacement non commencé</Copy>
        <Copy kind="muted">Déposée le {date(item.created_at)} · mise à jour le {date(item.updated_at)}</Copy>
        <Action secondary label="Suivre cette demande dans l’assistance" onPress={() => ticket(item.ticket_id)} />
      </Card>)}
      {requests.data?.next_cursor && <Copy kind="muted">Seules les 100 premières demandes sont affichées.</Copy>}
    </Card>
  </Screen>;
}

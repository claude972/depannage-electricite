import { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { z } from 'zod';
import { Action, Card, Copy, Field } from './ui';
import { appointmentFields, appointmentTime } from '@/lib/appointment-time';
import { timestamp } from '@/lib/contracts';

// The server row names its slot revision `reminder_version` (same field as the Web client).
type Appointment = { reminder_version: number; starts_at: string; ends_at: string; note?: string; updated_by?: string | null; updated_at?: string | null };
type Event = { id: number; actor_id: string; kind: string; payload: unknown; created_at: string };
export type AppointmentCommand = { action: 'save_appointment'; expected_version: number; starts_at: string; ends_at: string; note: string };
export type AppointmentSaved = { ok: true } | { ok: false; message: string; conflict?: boolean };

const snapshot = z.object({ starts_at: z.string(), ends_at: z.string(), note: z.string().nullish() });
const DAY = 24 * 60 * 60 * 1000;
const DURATIONS = [[60, '1 h'], [90, '1 h 30'], [120, '2 h'], [180, '3 h'], [240, '4 h']] as const;
const STARTS = ['08:00', '10:00', '14:00', '16:00'];
/** Les sept prochains jours, à la date locale des Antilles (UTC−04:00). */
function nextDays(now = Date.now()) {
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(now - 4 * 60 * 60 * 1000 + index * DAY).toISOString().slice(0, 10);
    const label = index === 0 ? 'Aujourd’hui' : index === 1 ? 'Demain'
      : new Date(date + 'T16:00:00Z').toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'America/Martinique' });
    return { date, label };
  });
}
const clock = (minutes: number) => String(Math.floor(minutes / 60)).padStart(2, '0') + ':' + String(minutes % 60).padStart(2, '0');
function minutesOf(time: string) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time.trim());
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}
/** Même règle que le Web : dire qui a enregistré le créneau, jamais « confirmé » (aucune étape de confirmation côté serveur). */
export function appointmentOrigin(updatedBy: string | null | undefined, viewerId: string, artisanId: string | null | undefined, clientId: string | null | undefined, editable: boolean) {
  if (!updatedBy) return null;
  if (updatedBy === viewerId) return editable ? 'Créneau enregistré par vous — l’autre partie peut encore le modifier.' : 'Créneau enregistré par vous.';
  if (artisanId && updatedBy === artisanId) return editable ? 'Créneau proposé par l’artisan — modifiez-le s’il ne vous convient pas.' : 'Créneau proposé par l’artisan.';
  if (clientId && updatedBy === clientId) return editable ? 'Créneau proposé par le client — modifiez-le s’il ne vous convient pas.' : 'Créneau proposé par le client.';
  return null;
}
const author = (actor: string, viewerId: string, artisanId?: string | null, clientId?: string | null) =>
  actor === viewerId ? 'par vous' : actor === artisanId ? 'par l’artisan' : actor === clientId ? 'par le client' : 'par un autre intervenant autorisé';

export function AppointmentEditor({ current, busy, save, viewer, viewerId, artisanId, clientId, history }: {
  current: Appointment | null; busy: boolean; viewer: 'artisan' | 'client'; viewerId: string;
  artisanId?: string | null; clientId?: string | null; history?: Event[];
  save: (value: AppointmentCommand) => Promise<AppointmentSaved>;
}) {
  const start = current && appointmentFields(current.starts_at), end = current && appointmentFields(current.ends_at);
  const [open, setOpen] = useState(false), [error, setError] = useState<string | null>(null), [notice, setNotice] = useState<string | null>(null);
  const [date, setDate] = useState(''), [endDate, setEndDate] = useState('');
  const [from, setFrom] = useState(''), [to, setTo] = useState(''), [note, setNote] = useState('');
  const [past, setPast] = useState(false);
  const reviewed = useRef(0), sending = useRef(false);
  const version = current?.reminder_version ?? 0;
  const days = nextDays();
  function edit() {
    setDate(start?.date ?? ''); setEndDate(end && end.date !== start?.date ? end.date : ''); setFrom(start?.time ?? ''); setTo(end?.time ?? '');
    setNote(current?.note ?? ''); setError(null); setNotice(null); reviewed.current = version; setOpen(true);
  }
  /** Fixe l’heure de début et conserve la durée déjà saisie (2 h par défaut) dans la même journée. */
  function startAt(minutes: number) {
    const before = minutesOf(from), finish = minutesOf(to);
    const length = before !== null && finish !== null && finish > before ? finish - before : 120;
    const bounded = Math.min(Math.max(minutes, 0), 23 * 60);
    setFrom(clock(bounded)); setTo(clock(Math.min(bounded + length, 23 * 60 + 59))); setEndDate('');
  }
  function lasting(length: number) {
    const begin = minutesOf(from);
    if (begin === null) { setError('Indiquez d’abord l’heure de début (HH:MM).'); return; }
    setError(null); setTo(clock(Math.min(begin + length, 23 * 60 + 59))); setEndDate('');
  }
  function submit() {
    if (sending.current) return;
    if (reviewed.current !== version) {
      reviewed.current = version;
      setError('Le rendez-vous a été modifié. Vérifiez le créneau actuel et confirmez à nouveau pour appliquer votre saisie.');
      return;
    }
    const starts_at = appointmentTime(date.trim(), from.trim());
    const ends_at = appointmentTime((endDate || date).trim(), to.trim());
    if (!starts_at || !ends_at || Date.parse(starts_at) <= Date.now() || ends_at <= starts_at) {
      setError('Indiquez un créneau futur avec une heure de fin après l’heure de début.');
      return;
    }
    setError(null); sending.current = true;
    void save({ action: 'save_appointment', expected_version: version, starts_at, ends_at, note: note.trim() }).then(result => {
      if (result.ok) {
        setOpen(false);
        setNotice(`Créneau enregistré : ${timestamp(starts_at)} – ${timestamp(ends_at)}.` + (viewer === 'client'
          ? ' Il reste à convenir avec l’artisan, qui peut le modifier ; il ne constitue pas un engagement d’horaire.'
          : ' Le client le voit dans son dossier et peut proposer un autre créneau.'));
      } else setError(result.conflict
        ? 'Le rendez-vous a été modifié entre-temps : le créneau actuel est affiché ci-dessus. Votre saisie est conservée ; enregistrez à nouveau pour la confirmer.'
        : result.message);
    }).finally(() => { sending.current = false; });
  }
  const origin = current && appointmentOrigin(current.updated_by, viewerId, artisanId, clientId, true);
  const others = (history ?? []).filter(item => item.kind === 'appointment').flatMap(item => {
    const parsed = snapshot.safeParse(item.payload);
    return parsed.success && Number.isFinite(Date.parse(parsed.data.starts_at)) && Number.isFinite(Date.parse(parsed.data.ends_at)) ? [{ ...item, slot: parsed.data }] : [];
  });
  return <Card>
    <Copy kind="subtitle">Rendez-vous</Copy>
    <Copy selectable>{current ? `${timestamp(current.starts_at)} – ${timestamp(current.ends_at)}` : viewer === 'client' ? 'Aucun créneau proposé pour le moment.' : 'Aucun créneau enregistré.'}</Copy>
    {origin && <Copy kind="muted">{origin}</Copy>}
    {current?.note?.trim() && !open && <><Copy kind="label">{current.updated_by === viewerId ? 'Votre précision' : current.updated_by && current.updated_by === artisanId ? 'Note de l’artisan' : current.updated_by && current.updated_by === clientId ? 'Précision du client' : viewer === 'artisan' ? 'Note pour le client' : 'Note de l’artisan'}</Copy><Copy selectable>{current.note.trim()}</Copy></>}
    {current?.updated_at && !open && <Copy kind="muted">Mis à jour le {timestamp(current.updated_at)}</Copy>}
    {notice && !open && <View accessible accessibilityRole="alert" accessibilityLiveRegion="polite"><Copy>{notice}</Copy></View>}
    {open ? <>
      <Copy kind="muted">Heure locale des Antilles. Choisissez un jour et une heure ci-dessous, ou saisissez-les (date AAAA-MM-JJ, heure HH:MM).</Copy>
      <Copy kind="label">Jour</Copy>
      <View accessibilityRole="radiogroup" accessibilityLabel="Jour du rendez-vous" style={styles.choices}>
        {days.map(day => <Action key={day.date} secondary selected={date === day.date} disabled={busy} label={day.label} onPress={() => { setDate(day.date); setEndDate(''); setError(null); }} />)}
      </View>
      <Field label="Date de début" value={date} onChangeText={setDate} maxLength={10} editable={!busy} placeholder="AAAA-MM-JJ" keyboardType="numbers-and-punctuation" autoCorrect={false} />
      <Copy kind="label">Heure de début</Copy>
      <View accessibilityRole="radiogroup" accessibilityLabel="Heure de début du rendez-vous" style={styles.choices}>
        {STARTS.map(time => <Action key={time} secondary selected={from === time} disabled={busy} label={time} onPress={() => { setError(null); startAt(minutesOf(time)!); }} />)}
        <Action secondary disabled={busy || minutesOf(from) === null} label="− 30 min" onPress={() => startAt(minutesOf(from)! - 30)} />
        <Action secondary disabled={busy || minutesOf(from) === null} label="+ 30 min" onPress={() => startAt(minutesOf(from)! + 30)} />
      </View>
      <Field label="Heure de début" value={from} onChangeText={setFrom} maxLength={5} editable={!busy} placeholder="HH:MM" keyboardType="numbers-and-punctuation" autoCorrect={false} />
      <Copy kind="label">Durée</Copy>
      <View accessibilityRole="radiogroup" accessibilityLabel="Durée du rendez-vous" style={styles.choices}>
        {DURATIONS.map(([length, label]) => <Action key={length} secondary disabled={busy}
          selected={!endDate && minutesOf(from) !== null && minutesOf(to) === minutesOf(from)! + length} label={label} onPress={() => lasting(length)} />)}
      </View>
      <Field label="Heure de fin" value={to} onChangeText={setTo} maxLength={5} editable={!busy} placeholder="HH:MM" keyboardType="numbers-and-punctuation" autoCorrect={false} />
      <Field label="Date de fin (si différente)" value={endDate} onChangeText={setEndDate} maxLength={10} editable={!busy} placeholder="AAAA-MM-JJ" keyboardType="numbers-and-punctuation" autoCorrect={false} />
      <Field label={viewer === 'artisan' ? 'Note pour le client' : 'Précision pour l’artisan (facultatif)'} value={note} onChangeText={setNote} maxLength={2000} editable={!busy}
        placeholder={viewer === 'client' ? 'Code d’accès, étage, disponibilité…' : undefined} />
      {error && <Copy kind="error">{error}</Copy>}
      <Action label={busy ? 'Enregistrement…' : current ? 'Enregistrer le nouveau créneau' : viewer === 'client' ? 'Proposer ce créneau' : 'Enregistrer le rendez-vous'} disabled={busy} onPress={submit} />
      <Action secondary label="Fermer sans enregistrer" disabled={busy} onPress={() => { setOpen(false); setError(null); }} />
      {viewer === 'client' && <Copy kind="muted">Le créneau proposé doit être convenu avec l’artisan ; il ne constitue pas un engagement d’horaire.</Copy>}
    </> : <Action secondary disabled={busy} label={current ? (viewer === 'client' ? 'Proposer un autre créneau' : 'Modifier le rendez-vous') : viewer === 'client' ? 'Proposer un créneau' : 'Fixer le rendez-vous'} onPress={edit} />}
    {others.length > 1 && !open && <>
      <Action secondary label={past ? 'Masquer l’historique du créneau' : `Afficher l’historique du créneau (${others.length})`} onPress={() => setPast(value => !value)} />
      {past && others.map((item, index) => <Copy key={item.id} kind="muted" selectable>
        {timestamp(item.created_at)} · {author(item.actor_id, viewerId, artisanId, clientId)} · {timestamp(item.slot.starts_at)} – {timestamp(item.slot.ends_at)}{index === 0 ? ' (créneau actuel)' : ''}{item.slot.note?.trim() ? ` · « ${item.slot.note.trim()} »` : ''}
      </Copy>)}
      {past && <Copy kind="muted">Les créneaux remplacés sont conservés par le serveur ; les 100 derniers enregistrements du dossier sont consultables.</Copy>}
    </>}
  </Card>;
}
const styles = StyleSheet.create({ choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 } });

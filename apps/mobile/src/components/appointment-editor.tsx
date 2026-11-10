import { useRef, useState } from 'react';
import { Action, Card, Copy, Field } from './ui';
import { appointmentFields, appointmentTime } from '@/lib/appointment-time';
import { timestamp } from '@/lib/contracts';

// The server row names its slot revision `reminder_version` (same field as the Web client).
type Appointment = { reminder_version: number; starts_at: string; ends_at: string; note?: string };

export function AppointmentEditor({ current, busy, save }: {
  current: Appointment | null; busy: boolean;
  save: (value: { action: 'save_appointment'; expected_version: number; starts_at: string; ends_at: string; note: string }) => void;
}) {
  const start = current && appointmentFields(current.starts_at), end = current && appointmentFields(current.ends_at);
  const [open, setOpen] = useState(false), [error, setError] = useState<string | null>(null);
  const [date, setDate] = useState(''), [endDate, setEndDate] = useState('');
  const [from, setFrom] = useState(''), [to, setTo] = useState(''), [note, setNote] = useState('');
  const reviewed = useRef(0);
  const version = current?.reminder_version ?? 0;
  function edit() {
    setDate(start?.date ?? ''); setEndDate(end?.date ?? ''); setFrom(start?.time ?? ''); setTo(end?.time ?? '');
    setNote(current?.note ?? ''); setError(null); reviewed.current = version; setOpen(true);
  }
  function submit() {
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
    setError(null);
    save({ action: 'save_appointment', expected_version: version, starts_at, ends_at, note: note.trim() });
  }
  return <Card>
    <Copy kind="subtitle">Rendez-vous</Copy>
    <Copy>{current ? `${timestamp(current.starts_at)} – ${timestamp(current.ends_at)}` : 'Aucun créneau confirmé.'}</Copy>
    {open ? <>
      <Copy kind="muted">Heure locale des Antilles. Date au format AAAA-MM-JJ.</Copy>
      <Field label="Date de début" value={date} onChangeText={setDate} maxLength={10} editable={!busy} placeholder="AAAA-MM-JJ" />
      <Field label="Heure de début" value={from} onChangeText={setFrom} maxLength={5} editable={!busy} placeholder="HH:MM" />
      <Field label="Date de fin (si différente)" value={endDate} onChangeText={setEndDate} maxLength={10} editable={!busy} placeholder="AAAA-MM-JJ" />
      <Field label="Heure de fin" value={to} onChangeText={setTo} maxLength={5} editable={!busy} placeholder="HH:MM" />
      <Field label="Note pour le client" value={note} onChangeText={setNote} maxLength={2000} editable={!busy} />
      {error && <Copy kind="error">{error}</Copy>}
      <Action label="Enregistrer le rendez-vous" disabled={busy} onPress={submit} />
      <Action secondary label="Fermer" disabled={busy} onPress={() => setOpen(false)} />
    </> : <Action secondary disabled={busy} label={current ? 'Modifier le rendez-vous' : 'Fixer le rendez-vous'} onPress={edit} />}
  </Card>;
}

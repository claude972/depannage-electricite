import { useEffect, useRef, useState } from 'react';
import { Action, Card, Copy, Field, ReadState } from './ui';
import { useResource } from '@/lib/api';
import { normalizeInternationalPhone, phoneCode, phoneContact, requestPhoneCode, type PhoneContact, type PhonePurpose } from '@/lib/phone-client';
import { useSession } from '@/lib/session';
import { z } from 'zod';

const options = z.object({ phone_auth: z.object({ available: z.boolean().nullable() }) });

export function PhoneChallenge({ purpose, contact, beforeRequest }: {
  purpose: PhonePurpose;
  contact?: PhoneContact;
  beforeRequest?: (contact: PhoneContact) => Promise<void>;
}) {
  const auth = useSession();
  const service = useResource('/api/bookings/options', options);
  const [first, setFirst] = useState(''), [last, setLast] = useState(''), [phone, setPhone] = useState('');
  const [code, setCode] = useState(''), [requested, setRequested] = useState<PhoneContact | null>(null);
  const [retryAt, setRetryAt] = useState(0), [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const lock = useRef(false);
  const canRequest = service.data?.phone_auth.available === true;

  useEffect(() => {
    if (retryAt <= now) return;
    const timer = setTimeout(() => setNow(Date.now()), 1000);
    return () => clearTimeout(timer);
  }, [retryAt, now]);

  async function run(work: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    try { await work(); }
    catch (issue) { setError(issue instanceof Error ? issue.message : 'Vérification indisponible.'); }
    finally { lock.current = false; setBusy(false); }
  }

  function askForCode() {
    if (!canRequest || Date.now() < retryAt) return;
    const parsed = phoneContact.safeParse(contact ?? { first_name: first, last_name: last, phone: normalizeInternationalPhone(phone) });
    if (!parsed.success) { setError('Renseignez vos prénom, nom et numéro au format international.'); return; }
    void run(async () => {
      await beforeRequest?.(parsed.data);
      const response = await requestPhoneCode(parsed.data, purpose);
      const sentAt = Date.now();
      setNow(sentAt);
      setRetryAt(sentAt + response.retry_after * 1000);
      setRequested(parsed.data);
      setCode('');
    });
  }

  function verify() {
    if (!requested || !phoneCode.safeParse(code).success) { setError('Saisissez les six chiffres du code.'); return; }
    const target = requested;
    void run(() => auth.verifyPhone(target.phone, code, purpose));
  }

  return <Card>
    <Copy kind="subtitle">{requested ? 'Vérifiez votre téléphone' : 'Continuer avec mon téléphone'}</Copy>
    {!contact && !requested && <>
      <Field label="Prénom" value={first} onChangeText={setFirst} autoComplete="given-name" maxLength={60} editable={!busy} />
      <Field label="Nom" value={last} onChangeText={setLast} autoComplete="family-name" maxLength={60} editable={!busy} />
      <Field label="Numéro de téléphone" value={phone} onChangeText={setPhone} placeholder="+596 ou +590…" keyboardType="phone-pad" autoComplete="tel" maxLength={40} editable={!busy} />
    </>}
    <ReadState loading={service.loading} error={service.error} onRetry={service.reload} />
    {!service.loading && !service.error && !canRequest && <Copy kind="muted">La vérification par SMS est indisponible pour le moment.</Copy>}
    {requested && <>
      <Copy kind="muted">Saisissez le code correspondant au numéro qui se termine par {requested.phone.slice(-4)}.</Copy>
      <Field label="Code à six chiffres" value={code} onChangeText={value => setCode(value.replace(/\D/g, ''))} keyboardType="number-pad" autoComplete="one-time-code" maxLength={6} editable={!busy} />
      <Action label={busy ? 'Vérification…' : 'Vérifier le code'} disabled={busy || code.length !== 6} onPress={verify} />
      {!contact && <Action secondary disabled={busy} label="Modifier mon numéro" onPress={() => { setRequested(null); setCode(''); setError(null); }} />}
    </>}
    <Action secondary={Boolean(requested)} disabled={busy || !canRequest || retryAt > now} label={retryAt > now
      ? `Nouveau code dans ${Math.ceil((retryAt - now) / 1000)} s`
      : requested ? 'Demander un nouveau code' : 'Demander un code'} onPress={askForCode} />
    {error && <Copy kind="error">{error}</Copy>}
  </Card>;
}

import { useRef, useState } from 'react';
import { z } from 'zod';
import { Action, Card, Copy, Field } from './ui';
import { verifiedPhone } from '@/lib/phone-client';
import { useSession } from '@/lib/session';

const credentials = z.object({ email: z.email().max(254), password: z.string().min(10).max(128) });

export function OptionalEmailAccount() {
  const auth = useSession();
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [sent, setSent] = useState(false);
  const [email, setEmail] = useState(''), [password, setPassword] = useState(''), [error, setError] = useState<string | null>(null);
  const lock = useRef(false);
  if (!verifiedPhone(auth.session?.user) || auth.session?.user.email) return null;

  async function save() {
    if (lock.current) return;
    const valid = credentials.safeParse({ email: email.trim().toLowerCase(), password });
    if (!valid.success) { setError('Indiquez une adresse valide et un mot de passe de dix caractères minimum.'); return; }
    lock.current = true;
    setBusy(true); setError(null);
    try {
      await auth.addEmailAccount(valid.data.email, valid.data.password);
      setPassword('');
      setSent(true);
    } catch (issue) { setError(issue instanceof Error ? issue.message : 'Création du compte indisponible.'); }
    finally { lock.current = false; setBusy(false); }
  }

  return <Card>
    <Copy kind="subtitle">Accès par e-mail</Copy>
    <Copy>Ajoutez une adresse e-mail et un mot de passe à votre accès actuel pour retrouver vos interventions.</Copy>
    {sent ? <Copy>Confirmez l’adresse e-mail demandée. Vos interventions restent liées à votre accès actuel.</Copy>
      : open ? <>
        <Field label="Adresse e-mail" autoComplete="email" keyboardType="email-address" autoCapitalize="none" value={email} onChangeText={setEmail} maxLength={254} editable={!busy} />
        <Field label="Mot de passe" autoComplete="new-password" secureTextEntry value={password} onChangeText={setPassword} maxLength={128} editable={!busy} />
        {error && <Copy kind="error">{error}</Copy>}
        <Action label={busy ? 'Confirmation…' : 'Créer mon accès par e-mail'} disabled={busy} onPress={() => void save()} />
        <Action secondary label="Plus tard" disabled={busy} onPress={() => { setPassword(''); setError(null); setOpen(false); }} />
      </> : <Action secondary label="Ajouter un accès par e-mail" onPress={() => setOpen(true)} />}
  </Card>;
}

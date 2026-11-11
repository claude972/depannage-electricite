import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { z } from 'zod';
import { AccountEntry } from '@/components/account-entry';
import { PublicLink } from '@/components/mobile-public-content';
import { Action, Copy, Field } from '@/components/ui';
import { configured } from '@/lib/config';
import { useSession } from '@/lib/session';

const emailAddress = z.email();

export default function RecoverPassword() {
  const router = useRouter();
  const { session, resetPassword } = useSession();
  const [email, setEmail] = useState(session?.user.email ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const locked = useRef(false);

  async function submit() {
    if (locked.current || sent || !configured) return;
    if (!emailAddress.safeParse(email.trim()).success) {
      setError('Saisissez une adresse e-mail valide.');
      return;
    }
    locked.current = true;
    setBusy(true);
    setError(null);
    try {
      await resetPassword(email);
      setSent(true);
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : 'La demande de récupération est indisponible.');
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }

  return <AccountEntry title="Mot de passe oublié ?" description="Indiquez l’adresse e-mail associée à votre compte.">
    {sent ? <Copy>Si cette adresse correspond à un compte, vous recevrez un lien pour choisir un nouveau mot de passe.</Copy> : <>
      <Field label="Adresse e-mail" value={email} onChangeText={value => { setEmail(value); setError(null); }}
        placeholder="vous@exemple.fr" autoCapitalize="none" autoCorrect={false} autoComplete="email"
        keyboardType="email-address" returnKeyType="go" editable={!busy} onSubmitEditing={() => void submit()} />
      {(error || !configured) && <Copy kind="error">{error ?? 'L’environnement mobile n’est pas configuré.'}</Copy>}
      <Action label={busy ? 'Envoi…' : 'Envoyer le lien de récupération'} disabled={busy || !configured} onPress={() => void submit()} />
    </>}
    <PublicLink label={session ? 'Revenir à mon compte' : 'Revenir à la connexion'}
      onPress={() => router.navigate(session ? '/(espace)/profil' : '/connexion')} />
  </AccountEntry>;
}

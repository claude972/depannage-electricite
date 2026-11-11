import { useLocalSearchParams, useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { Keyboard } from 'react-native';
import { z } from 'zod';
import { AccountEntry } from '@/components/account-entry';
import { PublicLink } from '@/components/mobile-public-content';
import { Action, Copy, Field } from '@/components/ui';
import { configured } from '@/lib/config';
import { useSession } from '@/lib/session';

const signupInput = z.object({
  firstName: z.string().trim().min(1, 'Saisissez votre prénom.').max(60),
  lastName: z.string().trim().min(1, 'Saisissez votre nom.').max(60),
  email: z.string().trim().max(254).pipe(z.email({ error: 'Saisissez une adresse e-mail valide.' })),
  password: z.string().min(10, 'Choisissez un mot de passe d’au moins 10 caractères.').max(128),
});

export default function Signup() {
  const router = useRouter();
  const { retour } = useLocalSearchParams<{ retour?: string }>();
  const auth = useSession();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lock = useRef(false);
  const login = () => router.replace({ pathname: '/connexion', params: retour === 'interventions' ? { retour } : {} });

  async function submit() {
    if (lock.current || !configured) return;
    const input = signupInput.safeParse({ firstName, lastName, email, password });
    if (!input.success) {
      setError(input.error.issues[0].message);
      return;
    }
    lock.current = true;
    setBusy(true);
    setError(null);
    Keyboard.dismiss();
    try {
      const connected = await auth.signUp(input.data, retour === 'interventions' ? 'interventions' : 'profile');
      if (!connected) { setSent(true); setPassword(''); }
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : 'Inscription indisponible.');
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  return <AccountEntry title={sent ? 'Vérifiez votre boîte e-mail' : 'Créer un compte'}
    description={sent ? 'Ouvrez le lien de confirmation reçu, puis revenez vous connecter.' : 'Inscrivez-vous avec votre adresse e-mail pour retrouver vos commandes.'}>
    {sent ? <Action label="Me connecter" onPress={login} /> : <>
      <Field label="Prénom" value={firstName} onChangeText={setFirstName} autoComplete="given-name" maxLength={60} editable={!busy} />
      <Field label="Nom" value={lastName} onChangeText={setLastName} autoComplete="family-name" maxLength={60} editable={!busy} />
      <Field label="Adresse e-mail" value={email} onChangeText={setEmail} autoComplete="email" keyboardType="email-address"
        autoCapitalize="none" autoCorrect={false} maxLength={254} editable={!busy} />
      <Field label="Mot de passe" value={password} onChangeText={setPassword} autoComplete="new-password"
        secureTextEntry autoCapitalize="none" maxLength={128} editable={!busy} returnKeyType="done" onSubmitEditing={() => void submit()} />
      {(error || !configured) && <Copy kind="error">{error ?? 'L’environnement mobile n’est pas configuré.'}</Copy>}
      <Action label={busy ? 'Inscription…' : 'Créer mon compte'} disabled={busy || !configured} onPress={() => void submit()} />
      <PublicLink label="J’ai déjà un compte" onPress={login} />
    </>}
  </AccountEntry>;
}

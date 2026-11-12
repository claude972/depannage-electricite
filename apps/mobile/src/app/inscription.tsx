import { useLocalSearchParams, useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { Keyboard } from 'react-native';
import { AccountEntry } from '@/components/account-entry';
import { PublicLink } from '@/components/mobile-public-content';
import { Action, Copy, Field } from '@/components/ui';
import { api } from '@/lib/api';
import { configured } from '@/lib/config';
import { accountSignup, nativeSignupResult } from '@/lib/email-account';
import { useSession } from '@/lib/session';

export default function Signup() {
  const router = useRouter();
  const { retour } = useLocalSearchParams<{ retour?: string }>();
  const { bookingContact } = useSession();
  const prepared = retour === 'demande' ? bookingContact : null;
  const [firstName, setFirstName] = useState(prepared?.first_name ?? '');
  const [lastName, setLastName] = useState(prepared?.last_name ?? '');
  const [email, setEmail] = useState(prepared?.email ?? '');
  const [phone, setPhone] = useState(prepared?.phone ?? '');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<'confirmation_required' | 'sign_in_required' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lock = useRef(false);
  const login = () => router.replace({ pathname: '/connexion', params: retour === 'interventions' || retour === 'demande' ? { retour } : {} });

  async function submit() {
    if (lock.current || !configured) return;
    const input = accountSignup.safeParse({ first_name: firstName, last_name: lastName, email, phone, password });
    if (!input.success) {
      setError(input.error.issues[0].message);
      return;
    }
    if (prepared && input.data.email !== prepared.email) {
      setError('Utilisez l’adresse e-mail renseignée dans votre demande.');
      return;
    }
    lock.current = true;
    setBusy(true);
    setError(null);
    Keyboard.dismiss();
    try {
      const response = await api('/api/auth/native-signup', nativeSignupResult, {
        method: 'POST', body: { ...input.data, role: 'client' },
      });
      setStatus(response.status);
      setPassword('');
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : 'Inscription indisponible.');
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  return <AccountEntry title={status === 'confirmation_required' ? 'Vérifiez votre boîte e-mail' : status ? 'Connectez-vous' : 'Créer un compte'}
    description={status === 'confirmation_required'
      ? 'Ouvrez le lien de confirmation dans votre navigateur, puis revenez vous connecter dans l’application.'
      : status ? 'Votre accès est prêt. Connectez-vous dans l’application.'
      : 'Inscrivez-vous avec votre adresse e-mail pour retrouver vos commandes.'}>
    {status ? <Action label="Me connecter" onPress={login} /> : <>
      <Field label="Prénom" value={firstName} onChangeText={setFirstName} autoComplete="given-name" maxLength={60} editable={!busy} />
      <Field label="Nom" value={lastName} onChangeText={setLastName} autoComplete="family-name" maxLength={60} editable={!busy} />
      <Field label="Adresse e-mail" value={email} onChangeText={setEmail} autoComplete="email" keyboardType="email-address"
        autoCapitalize="none" autoCorrect={false} maxLength={254} editable={!busy && !prepared} />
      <Field label="Téléphone de contact (obligatoire)" value={phone} onChangeText={setPhone} autoComplete="tel"
        keyboardType="phone-pad" maxLength={40} editable={!busy} placeholder="+596 ou +590…" />
      <Field label="Mot de passe" value={password} onChangeText={setPassword} autoComplete="new-password"
        secureTextEntry autoCapitalize="none" maxLength={128} editable={!busy} returnKeyType="done" onSubmitEditing={() => void submit()} />
      {(error || !configured) && <Copy kind="error">{error ?? 'L’environnement mobile n’est pas configuré.'}</Copy>}
      <Action label={busy ? 'Inscription…' : 'Créer mon compte'} disabled={busy || !configured} onPress={() => void submit()} />
      <PublicLink label="J’ai déjà un compte" onPress={login} />
    </>}
  </AccountEntry>;
}

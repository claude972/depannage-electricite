import { useLocalSearchParams, useRouter } from 'expo-router';
import { useRef, useState, type ComponentRef } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { z } from 'zod';
import { AccountEntry } from '@/components/account-entry';
import { PublicLink } from '@/components/mobile-public-content';
import { Action, Copy, Field, usePalette } from '@/components/ui';
import { useSession } from '@/lib/session';
import { configured } from '@/lib/config';

const emailAddress = z.email();

export default function Login() {
  const router = useRouter();
  const { retour } = useLocalSearchParams<{ retour?: string }>();
  const auth = useSession();
  const palette = usePalette();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const passwordField = useRef<ComponentRef<typeof TextInput>>(null);

  async function submit() {
    if (locked.current || !configured) return;
    if (!emailAddress.safeParse(email.trim()).success) {
      setError('Saisissez une adresse e-mail valide.');
      return;
    }
    if (!password) {
      setError('Saisissez votre mot de passe.');
      passwordField.current?.focus();
      return;
    }
    locked.current = true;
    setBusy(true);
    setError(null);
    try { await auth.signIn(email, password, retour === 'interventions' ? 'interventions' : 'profile'); }
    catch (issue) { setError(issue instanceof Error ? issue.message : 'Connexion indisponible.'); }
    finally {
      locked.current = false;
      setBusy(false);
    }
  }

  return <AccountEntry title="Connectez-vous" description="Retrouvez vos interventions, vos devis et vos échanges.">
    <View style={styles.form}>
      <Field label="Adresse e-mail" value={email} onChangeText={value => { setEmail(value); setError(null); }}
        placeholder="vous@exemple.fr" autoCapitalize="none" autoCorrect={false} autoComplete="email"
        keyboardType="email-address" returnKeyType="next" editable={!busy} onSubmitEditing={() => passwordField.current?.focus()}
        style={{ backgroundColor: palette.subtle }} />
      <View style={styles.passwordGroup}>
        <Copy>Mot de passe</Copy>
        <View style={[styles.passwordField, { borderColor: palette.border, backgroundColor: palette.subtle }]}>
          <TextInput ref={passwordField} accessibilityLabel="Mot de passe" value={password}
            onChangeText={value => { setPassword(value); setError(null); }} secureTextEntry={!showPassword}
            autoComplete="current-password" autoCapitalize="none" autoCorrect={false} editable={!busy}
            returnKeyType="go" onSubmitEditing={() => void submit()} style={[styles.password, { color: palette.text }]} />
          <Pressable accessibilityRole="button" accessibilityLabel={showPassword ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
            disabled={busy} onPress={() => setShowPassword(value => !value)} style={styles.toggle}>
            <Text style={[styles.toggleLabel, { color: palette.blue }]}>{showPassword ? 'Masquer' : 'Afficher'}</Text>
          </Pressable>
        </View>
      </View>
      <PublicLink label="Mot de passe oublié ?" onPress={() => router.push('/mot-de-passe-oublie')} />
      {(error || auth.error || !configured) && <Copy kind="error">{error ?? auth.error ?? 'L’environnement mobile n’est pas configuré.'}</Copy>}
      <Action label={busy ? 'Connexion…' : 'Se connecter'} disabled={busy || !configured} onPress={() => void submit()} />
    </View>
    {retour !== 'interventions' && <View style={[styles.guest, { borderColor: palette.border }]}>
      <Copy kind="subtitle">Une intervention à demander ?</Copy>
      <Copy kind="muted">Vous pouvez commencer votre demande depuis l’accueil.</Copy>
      <PublicLink label="Continuer sans compte" onPress={() => router.navigate('/bienvenue')} />
    </View>}
    <PublicLink label="Créer un compte par e-mail" onPress={() => router.push({ pathname: '/inscription', params: retour === 'interventions' ? { retour } : {} })} />
  </AccountEntry>;
}

const styles = StyleSheet.create({
  form: { gap: 12 },
  passwordGroup: { gap: 5 },
  passwordField: { flexDirection: 'row', alignItems: 'center', minHeight: 52, borderWidth: 1, borderRadius: 13 },
  password: { flex: 1, minWidth: 0, minHeight: 50, paddingHorizontal: 13, fontFamily: 'JakartaRegular', fontSize: 16 },
  toggle: { minWidth: 76, minHeight: 48, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 8 },
  toggleLabel: { fontFamily: 'JakartaBold', fontSize: 13 },
  guest: { borderTopWidth: 1, paddingTop: 18, gap: 8 },
});

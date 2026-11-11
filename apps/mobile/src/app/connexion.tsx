import { PublicTabs } from '@/components/mobile-chrome';
import { useRef, useState } from 'react';
import { Action, Card, Copy, Field, Screen } from '@/components/ui';
import { useSession } from '@/lib/session';
import { apiOrigin, configured } from '@/lib/config';
import { openBrowserAsync } from 'expo-web-browser';

export default function Login() {
  const auth=useSession();
  const [email,setEmail]=useState('');
  const [password,setPassword]=useState('');
  const [error,setError]=useState<string|null>(null);
  const [busy,setBusy]=useState(false);
  const locked=useRef(false);
  async function submit() {
    if(locked.current) return;
    locked.current=true;setBusy(true);setError(null);
    try { await auth.signIn(email,password); }
    catch(issue) { setError(issue instanceof Error?issue.message:'Connexion indisponible.'); }
    finally { locked.current=false;setBusy(false); }
  }
  return <Screen footer={<PublicTabs />}>
    <Copy kind="title">Votre espace</Copy>
    <Copy kind="muted">Connectez-vous avec votre compte client ou artisan.</Copy>
    <Card>
      <Field label="Adresse e-mail" value={email} onChangeText={setEmail} autoCapitalize="none" autoCorrect={false} autoComplete="email" keyboardType="email-address"/>
      <Field label="Mot de passe" value={password} onChangeText={setPassword} secureTextEntry autoComplete="current-password" onSubmitEditing={()=>{ if(!busy&&configured&&email.trim()&&password) void submit(); }}/>
      {(error||auth.error||!configured)&&<Copy kind="error">{error??auth.error??'L’environnement mobile n’est pas configuré.'}</Copy>}
      <Action label={busy?'Connexion…':'Se connecter'} disabled={busy||!configured||!email.trim()||!password} onPress={()=>void submit()}/>
    </Card>
    {apiOrigin&&<Action secondary label="Créer ou récupérer un compte sur le site" onPress={()=>void openBrowserAsync(apiOrigin!)}/>}
  </Screen>;
}

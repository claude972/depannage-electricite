import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { AppSheet } from '@/components/app-sheet';
import { MobileIcon, type Glyph } from '@/components/mobile-chrome';
import { PublicLink, usePublicPortal } from '@/components/mobile-public-content';
import { z } from 'zod';
import { Action, Card, Copy, Field, ReadState, Screen, usePalette } from '@/components/ui';
import { ArtisanAvailability } from '@/components/artisan-availability';
import { api } from '@/lib/api';
import { useWorkspace } from '@/lib/use-workspace';
import { useSession } from '@/lib/session';

const roles = { client: 'Compte particulier', artisan: 'Compte électricien', manager: 'Compte entreprise', admin: 'Administration' };
type Section = 'identity' | 'addresses' | 'security' | 'privacy';
const updated=z.object({profile:z.object({id:z.uuid()})});
export default function Profile() {
  const state = useWorkspace();
  const auth = useSession();
  const router = useRouter();
  const palette = usePalette();
  const { openPortal, portalError } = usePublicPortal();
  useEffect(() => {
    if (auth.loginResume) auth.consumeLoginResume();
  }, [auth.loginResume, auth.consumeLoginResume]);
  const token=auth.session?.access_token;
  const profile=state.data?.profile;
  const [error,setError]=useState<string|null>(null);
  const [busy,setBusy]=useState(false);
  const [section, setSection] = useState<Section | null>(null);
  const [first,setFirst]=useState(''), [last,setLast]=useState('');
  const lock=useRef(false);
  async function run(work:()=>Promise<void>, refresh?:()=>void) {
    if(lock.current)return;
    lock.current=true;setBusy(true);setError(null);
    try{await work();}
    catch(issue){setError(issue instanceof Error?issue.message:'Action indisponible.');}
    finally{lock.current=false;setBusy(false);refresh?.();}
  }
  function saveName(){
    if(!token||!profile||!first.trim()||!last.trim())return;
    void run(async()=>{
      const response=await api('/api/profile',updated,{token,method:'PATCH',body:{
        first_name:first.trim(),last_name:last.trim(),full_name:`${first.trim()} ${last.trim()}`,phone:profile.phone??'',
      }});
      if(response.profile.id!==profile.id)throw Error('Le profil n’a pas pu être confirmé.');
      setSection(null);
    },state.reload);
  }
  const initials = profile?.full_name.trim().split(/\s+/).slice(0, 2).map(word => word[0]).join('').toLocaleUpperCase('fr');
  function openSection(next: Section) {
    if (next === 'identity') {
      setFirst(profile?.first_name ?? '');
      setLast(profile?.last_name ?? '');
    }
    setError(null);
    setSection(next);
  }
  const titles = { identity: 'Informations personnelles', addresses: 'Adresses enregistrées', security: 'Sécurité', privacy: 'Mes données' };
  return <Screen top>
    <ReadState loading={state.loading} error={state.error} onRetry={state.reload} />
    {error && !section && <Copy kind="error">{error}</Copy>}
    {!profile && <Copy kind="title">Votre compte</Copy>}
    {profile && <>
      <View style={styles.identity}>
        <View style={styles.grow}>
          <Copy kind="title">{profile.full_name || 'Votre compte'}</Copy>
          <Copy kind="muted">{roles[profile.role]}</Copy>
        </View>
        <View accessible={false} style={[styles.avatar, { backgroundColor: palette.subtle }]}>
          {initials ? <Text style={[styles.avatarText, { color: palette.blue }]}>{initials}</Text>
            : <MobileIcon name="account" color={palette.blue} size={25} />}
        </View>
      </View>
      <View style={styles.tiles}>
        <AccountTile icon="help" label="Aide" onPress={() => router.push('/aide-mobile')} />
        <AccountTile icon="messages" label="Messages" onPress={() => router.navigate('/(espace)/messages')} />
        <AccountTile icon="shield" label="Sécurité" onPress={() => openSection('security')} />
        <AccountTile icon="lock" label="Mes données" onPress={() => openSection('privacy')} />
      </View>
      <View>
        <AccountRow icon="activity" label="Notifications" hint="Actualités et suivi de votre espace" onPress={() => router.push('/notifications')} />
        <AccountRow icon="account" label="Informations personnelles" hint="Nom et coordonnées" onPress={() => openSection('identity')} />
        {profile.role === 'client' && <AccountRow icon="pin" label="Adresses enregistrées" hint="Adresses d’intervention" onPress={() => openSection('addresses')} />}
        <AccountRow icon="activity" label={profile.role === 'artisan' ? 'Mes missions' : 'Mes interventions'} hint="Historique et devis"
          onPress={() => router.navigate('/(espace)/interventions')} />
      </View>
    </>}
    {profile?.role==='artisan'&&<ArtisanAvailability approved={profile.artisan_approved} capacity />}
    <Pressable accessibilityRole="button" accessibilityState={{ disabled: busy }} disabled={busy}
      style={styles.signOut} onPress={() => void run(auth.signOut)}>
      <Text style={[styles.strong, { color: palette.danger }]}>{busy && !section ? 'Action en cours…' : 'Se déconnecter'}</Text>
    </Pressable>
    <AppSheet title={section ? titles[section] : ''} open={section !== null} onClose={() => setSection(null)}>
      {section === 'identity' && profile && <>
        <Field label="Prénom" value={first} onChangeText={setFirst} maxLength={60} editable={!busy} />
        <Field label="Nom" value={last} onChangeText={setLast} maxLength={60} editable={!busy} />
        {auth.session?.user.email && <Copy kind="muted">{auth.session.user.email}</Copy>}
        {error && <Copy kind="error">{error}</Copy>}
        <Action label={busy ? 'Enregistrement…' : 'Enregistrer'} onPress={saveName}
          disabled={busy || !first.trim() || !last.trim() || first.trim().length + last.trim().length + 1 > 120} />
      </>}
      {section === 'addresses' && <>
        <Copy>Vos adresses d’intervention sont disponibles dans votre espace sur le site.</Copy>
        <PublicLink label="Ouvrir mon carnet d’adresses" onPress={() => openPortal('/#profile')} />
        {portalError && <Copy kind="error">{portalError}</Copy>}
      </>}
      {section === 'security' && <>
        {auth.session?.user.email ? <>
          <Copy>Adresse e-mail de connexion</Copy>
          <Copy kind="muted">{auth.session.user.email}</Copy>
          <PublicLink label="Demander un lien pour mon mot de passe" onPress={() => {
            setSection(null);
            router.push('/mot-de-passe-oublie');
          }} />
        </> : <Copy>Vous vous connectez avec un code envoyé au numéro vérifié de votre compte.</Copy>}
      </>}
      {section === 'privacy' && <>
        <Copy>Consultez les informations sur l’utilisation de vos données et les moyens d’exercer vos droits.</Copy>
        <PublicLink label="Consulter la confidentialité" onPress={() => openPortal('/#privacy')} />
        <PublicLink label="Gérer mes données sur le site" onPress={() => openPortal('/#profile')} />
        {portalError && <Copy kind="error">{portalError}</Copy>}
      </>}
    </AppSheet>
  </Screen>;
}

function AccountTile({ icon, label, onPress }: { icon: Glyph; label: string; onPress: () => void }) {
  const palette = usePalette();
  return <Pressable accessibilityRole="button" style={[styles.tile, { backgroundColor: palette.subtle }]} onPress={onPress}>
    <MobileIcon name={icon} color={palette.blue} />
    <Text style={[styles.strong, styles.grow, { color: palette.text }]}>{label}</Text>
  </Pressable>;
}

function AccountRow({ icon, label, hint, onPress }: { icon: Glyph; label: string; hint: string; onPress: () => void }) {
  const palette = usePalette();
  return <Pressable accessibilityRole="button" onPress={onPress} style={[styles.row, { borderColor: palette.border }]}>
    <MobileIcon name={icon} color={palette.text} />
    <View style={styles.grow}>
      <Text style={[styles.strong, { color: palette.text }]}>{label}</Text>
      <Copy kind="muted">{hint}</Copy>
    </View>
    <MobileIcon name="next" color={palette.muted} size={16} />
  </Pressable>;
}

const styles = StyleSheet.create({
  identity: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 6, marginBottom: 8 },
  grow: { flex: 1, minWidth: 0 },
  avatar: { width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontFamily: 'JakartaBold', fontSize: 19 },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tile: { width: '48.5%', flexGrow: 1, minHeight: 61, padding: 10, gap: 8, flexDirection: 'row', alignItems: 'center', borderRadius: 13 },
  row: { minHeight: 62, flexDirection: 'row', alignItems: 'center', paddingVertical: 8, gap: 12, borderBottomWidth: 1 },
  strong: { fontFamily: 'JakartaBold', fontSize: 14, lineHeight: 20 },
  signOut: { minHeight: 44, justifyContent: 'center' },
});

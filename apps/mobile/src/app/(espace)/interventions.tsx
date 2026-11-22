import { FlatList, StyleSheet, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { orderReference } from '../../../../../shared/order-reference';
import { categories } from '@/lib/contracts';
import { jobStatus } from '@/lib/job-presentation';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Action, Card, Copy, Field, ReadState, usePalette } from '@/components/ui';
import { ArtisanAvailability } from '@/components/artisan-availability';
import { AdminNativeInterventions } from '@/components/admin-native-interventions';
import { JobCard } from '@/components/job-card';
import { useWorkspace } from '@/lib/use-workspace';
import { ArtisanOffers } from '@/components/artisan-offers';
import { OrderLookup } from '@/components/order-lookup';
import { useSession } from '@/lib/session';
import { closedStatus, useClientRequests, type RequestSegment } from '@/lib/client-requests';

export default function Interventions() {
  const [availabilityVersion, setAvailabilityVersion] = useState(0);
  const router=useRouter(), p=usePalette(), state=useWorkspace();
  const auth=useSession();
  const profile=state.data?.profile;
  const reload=state.reload;
  useFocusEffect(useCallback(()=>{reload();},[reload]));
  useEffect(() => {
    if (auth.loginResume === 'interventions') auth.consumeLoginResume();
  }, [auth.loginResume, auth.consumeLoginResume]);
  const [query, setQuery] = useState('');
  // CLI-08 : le particulier sépare ses dossiers en cours de ses dossiers clos (réglés ou annulés), page par page.
  const [segment, setSegment] = useState<RequestSegment>('active');
  const client = profile?.role === 'client';
  const requests = useClientRequests(client ? auth.session?.access_token : undefined, client ? profile?.id : undefined, segment);
  const reloadRequests = requests.reload;
  useFocusEffect(useCallback(()=>{reloadRequests();},[reloadRequests]));
  if (profile?.role === 'admin') return <AdminNativeInterventions />;
  const searchable = profile?.role === 'artisan' || profile?.role === 'manager';
  const noun = profile?.role === 'artisan' ? 'mission' : 'intervention';
  const own = (state.data?.interventions??[]).filter(job => profile?.role !== 'artisan' || job.artisan_id === profile.id);
  // Recherche locale sur les dossiers chargés : numéro de commande, ville, code postal, type et statut affichés.
  const words = searchable ? plain(query).split(/\s+/).filter(Boolean) : [];
  const shown = words.length ? own.filter(job => {
    const text = plain([orderReference(job.id), job.city, job.postal_code ?? '', categories[job.category], jobStatus(job.status, profile?.role)].join(' '));
    return words.every(word => text.includes(word));
  }) : own;
  // Sans réponse du service de recherche, la liste déjà chargée est filtrée localement et annoncée comme limitée.
  const local = own.filter(job => segment === 'all' || closedStatus(job.status) === (segment === 'past'));
  const listed = client ? requests.items ?? (requests.error ? local : []) : shown;
  const segmentNoun = { active: 'en cours', past: 'close(s)', all: 'au total' }[segment];
  const refreshAll = () => { state.reload(); if (client) requests.reload(); };
  return <SafeAreaView style={[styles.fill,{backgroundColor:p.background}]} edges={['top','left','right']}>
    <FlatList
      data={listed} keyExtractor={job=>job.id}
      refreshing={state.loading&&Boolean(state.data)} onRefresh={refreshAll}
      keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" automaticallyAdjustKeyboardInsets
      contentContainerStyle={styles.list}
      ListHeaderComponent={<View style={styles.list}>
        <Copy kind="title">{profile?.role==='artisan'?'Missions':profile?.role==='manager'?'Interventions':'Mes demandes'}</Copy>
        {profile?.role==='manager'&&<><Copy kind="subtitle">Recherche par organisation</Copy>{state.data?.organizations?.map(org=><Action key={org.id} secondary label={`Rechercher · ${org.name}`} onPress={()=>router.push({pathname:'/organisation/interventions',params:{organization_id:org.id}})}/>)}</>}
        {profile?.role==='client'&&<>
          <Action label="Nouvelle demande" onPress={()=>router.push('/demande')}/>
          <OrderLookup key={profile.id} />
          <View accessibilityRole="tablist" accessibilityLabel="Filtrer mes demandes" style={styles.segments}>
            {([['active','En cours'],['past','Dossiers clos'],['all','Toutes']] as const).map(([value,label])=>
              <View key={value} style={styles.segment}><Action secondary selected={segment===value} label={label} onPress={()=>setSegment(value)}/></View>)}
          </View>
          {requests.items && !requests.loading && <Copy kind="muted">{requests.total} demande(s) {segmentNoun}{requests.items.length<requests.total?` · ${requests.items.length} affichée(s)`:''}{segment==='past'?' — réglées ou annulées':segment==='active'?' — y compris celles qui restent à régler':''}</Copy>}
          {requests.loading && <Copy kind="muted">Chargement des demandes…</Copy>}
          {requests.error && <><Copy kind="error">{requests.error}</Copy><Copy kind="muted">Affichage limité aux dossiers déjà chargés sur cet appareil.</Copy><Action secondary label="Réessayer le chargement des demandes" onPress={requests.reload}/></>}
        </>}
        {profile?.role==='artisan'&&<ArtisanAvailability approved={profile.artisan_approved} onChanged={() => setAvailabilityVersion(value => value + 1)} />}
        {searchable&&state.data&&<>
          <Field label={`Rechercher une ${noun}`} placeholder="Numéro INT-…, ville, code postal, type ou statut" value={query} maxLength={80} onChangeText={setQuery}
            autoCorrect={false} autoCapitalize="none" returnKeyType="search" clearButtonMode="while-editing"/>
          <Copy kind="muted">{words.length?`${shown.length} ${noun}(s) sur ${own.length} pour « ${query.trim()} »`:`${own.length} ${noun}(s)`}</Copy>
          {words.length>0&&<Action secondary label="Réinitialiser la recherche" onPress={()=>setQuery('')}/>}
        </>}
        <ReadState loading={state.loading} error={state.error} onRetry={state.reload}/>
        {state.data?.limits?.interventions.limited&&<Copy kind="muted">Les 100 dossiers les plus récents sont affichés.</Copy>}
      </View>}
      // Missions attribuées d’abord ; les offres ouvertes suivent, dans leur ordre documenté (plus anciennes d’abord).
      ListFooterComponent={profile?.role==='artisan'?<View style={styles.footer}><ArtisanOffers key={availabilityVersion} /></View>
        :client&&requests.next?<View style={styles.footer}><Action secondary disabled={requests.loadingMore} label={requests.loadingMore?'Chargement…':'Afficher les demandes suivantes'} onPress={requests.more}/></View>:undefined}
      ListEmptyComponent={client ? (requests.loading ? undefined : <Card>
        <Copy kind="subtitle">{segment==='past'?'Aucun dossier clos':segment==='active'?'Aucune demande en cours':'Aucune demande'}</Copy>
        <Copy kind="muted">{segment==='past'?'Vos demandes réglées ou annulées apparaîtront ici, avec leurs devis et documents.':'Vos demandes apparaîtront ici dès leur envoi.'}</Copy>
      </Card>) : state.data && !state.loading && !state.error ? words.length ? <Card>
        <Copy kind="subtitle">Aucune {noun} ne correspond à cette recherche</Copy>
        <Copy kind="muted">Vérifiez le numéro, la ville ou le statut saisi, ou réinitialisez la recherche. Seuls les dossiers chargés dans cette liste sont examinés.</Copy>
      </Card> : <Card>
        <Copy kind="subtitle">{profile?.role === 'artisan' ? 'Aucune mission affectée' : 'Aucune intervention en cours'}</Copy>
        <Copy kind="muted">Les dossiers accessibles depuis votre compte apparaîtront ici.</Copy>
      </Card> : undefined}
      renderItem={({item})=><JobCard role={profile?.role} quotes={state.data?.quotes} payments={state.data?.payments} job={item} onOpen={()=>router.push({pathname:'/dossier/[id]',params:{id:item.id}})}/>}
    />
  </SafeAreaView>;
}
const plain=(value:string)=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('fr');
const styles=StyleSheet.create({fill:{flex:1},list:{gap:14,padding:14},footer:{paddingHorizontal:14,paddingBottom:14},segments:{flexDirection:'row',gap:8},segment:{flex:1,minWidth:0}});

import { useRef, useState } from 'react';
import { Alert, View } from 'react-native';
import { useRouter } from 'expo-router';
import { randomUUID } from 'expo-crypto';
import * as Location from 'expo-location';
import { Action, Card, Copy, Field, ReadState, Screen } from '@/components/ui';
import { ApiFailure, api, useResource } from '@/lib/api';
import { categories, creation, euros, prices, requestFields, type Category } from '@/lib/contracts';
import { useSession } from '@/lib/session';
import { useWorkspace } from '@/lib/use-workspace';

export default function RequestForm() {
  const router=useRouter(), account=useWorkspace(), token=useSession().session?.access_token;
  const catalogue=useResource('/api/public/indicative-prices',prices);
  const [category,setCategory]=useState<Category>('outage'), [description,setDescription]=useState('');
  const [address,setAddress]=useState(''), [postal,setPostal]=useState(''), [city,setCity]=useState('');
  const [urgency,setUrgency]=useState<'urgent'|'scheduled'|null>(null);
  const [error,setError]=useState<string|null>(null), [busy,setBusy]=useState(false), [locating,setLocating]=useState(false);
  const [uncertain,setUncertain]=useState(false);
  const [suggestion,setSuggestion]=useState<{address:string;postal:string;city:string}|null>(null);
  const lock=useRef(false);
  const intent=useRef<{fingerprint:string;id:string}|null>(null);
  async function locate() {
    setLocating(true);setError(null);setSuggestion(null);
    try {
      const permission=await Location.requestForegroundPermissionsAsync();
      if(!permission.granted) throw Error('Localisation refusée. Vous pouvez saisir votre adresse.');
      const {coords}=await Location.getCurrentPositionAsync({accuracy:Location.Accuracy.Balanced});
      const [place]=await Location.reverseGeocodeAsync(coords);
      const street=place?.street||place?.name;
      if(!street||!place?.postalCode||!(place.city||place.subregion))
        throw Error('Adresse introuvable à cette position. Saisissez-la manuellement.');
      setSuggestion({address:[place.streetNumber,street].filter(Boolean).join(' '),postal:place.postalCode,city:place.city||place.subregion||''});
    }catch(issue){setError(issue instanceof Error?issue.message:'Localisation indisponible.');}
    finally{setLocating(false);}
  }
  async function submit() {
    if(!token||!catalogue.data||lock.current||account.data?.profile.role!=='client')return;
    setError(null);
    if(!urgency){setError('Indiquez si l’intervention est urgente.');return;}
    const input=requestFields.safeParse({category,description,address,postal_code:postal,city,urgency});
    if(!input.success){setError(input.error.issues[0].message);return;}
    const payload={...input.data,reviewed_estimate_version:catalogue.data.version};
    const fingerprint=JSON.stringify(payload);
    if(intent.current?.fingerprint!==fingerprint)intent.current={fingerprint,id:randomUUID()};
    lock.current=true;setBusy(true);
    try {
      const result=await api('/api/interventions',creation,{token,method:'POST',body:{...payload,request_id:intent.current.id}});
      router.replace({pathname:'/dossier/[id]',params:{id:result.intervention.id}});
    }catch(issue){
      if(issue instanceof ApiFailure){
        if(issue.status===0||issue.status>=500)setUncertain(true);
        else { setUncertain(false);if(issue.status===409){intent.current=null;catalogue.reload();} }
      }
      setError(issue instanceof Error?issue.message:'Envoi indisponible.');
    }finally{lock.current=false;setBusy(false);}
  }
  const disabled=busy||uncertain;
  const range=catalogue.data?.ranges[category];
  if(account.data&&account.data.profile.role!=='client')return <Screen><Copy>Ce formulaire est réservé à l’espace client.</Copy></Screen>;
  return <Screen>
    <Copy kind="title">Décrivez votre panne</Copy>
    <ReadState loading={account.loading} error={account.error} onRetry={account.reload}/>
    <Card>
      <Copy kind="subtitle">Type de panne</Copy>
      {Object.entries(categories).map(([key,label])=><Action key={key} disabled={disabled} secondary={category!==key} label={label} onPress={()=>setCategory(key as Category)}/>)}
      <Field label="Description" value={description} onChangeText={setDescription} maxLength={4000} multiline editable={!disabled}/>
      <Copy kind="subtitle">Est-ce urgent ?</Copy>
      <Action label="Oui, c’est urgent" secondary={urgency!=='urgent'} disabled={disabled} onPress={()=>setUrgency('urgent')}/>
      <Action label="Non, je peux planifier" secondary={urgency!=='scheduled'} disabled={disabled} onPress={()=>setUrgency('scheduled')}/>
    </Card>
    <Card>
      <Copy kind="subtitle">Adresse d’intervention</Copy>
      <Action secondary label={locating?'Recherche…':'Utiliser ma position'} disabled={locating||disabled} onPress={()=>void locate()}/>
      {suggestion&&<View><Copy>{suggestion.address}, {suggestion.postal} {suggestion.city}</Copy>
        <Action secondary label="Utiliser l’adresse proposée" disabled={disabled} onPress={()=>{setAddress(suggestion.address);setPostal(suggestion.postal);setCity(suggestion.city);setSuggestion(null);}}/>
      </View>}
      <Field label="Adresse" value={address} onChangeText={setAddress} maxLength={500} editable={!disabled}/>
      <Field label="Code postal" value={postal} onChangeText={setPostal} keyboardType="numeric" maxLength={5} editable={!disabled}/>
      <Field label="Commune" value={city} onChangeText={setCity} maxLength={120} editable={!disabled}/>
    </Card>
    <Card>
      <Copy kind="subtitle">Estimation indicative</Copy>
      <ReadState loading={catalogue.loading} error={catalogue.error} onRetry={()=>{if(!uncertain)catalogue.reload();}}/>
      {range&&<Copy>{euros(range.min_cents)} à {euros(range.max_cents)}. Le devis fixe le prix final.</Copy>}
      {error&&<Copy kind="error">{error}</Copy>}
      {uncertain&&<Copy kind="muted">L’envoi n’a pas pu être confirmé. Le prochain essai réutilise la même référence.</Copy>}
      <Action label={busy?'Envoi…':uncertain?'Vérifier ou réessayer la même demande':'Confirmer la demande'}
        disabled={busy||!range||account.data?.profile.role!=='client'}
        onPress={()=>{if(uncertain){void submit();return;}Alert.alert('Confirmer la demande ?', 'Le montant affiché est une estimation. Vous pourrez examiner le devis avant les travaux.', [{text:'Revenir',style:'cancel'},{text:'Confirmer',onPress:()=>void submit()}]);}}/>
    </Card>
  </Screen>;
}

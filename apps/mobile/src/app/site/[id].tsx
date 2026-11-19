import { useEffect,useRef,useState,type ComponentRef } from 'react';
import { Alert,TextInput } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { randomUUID } from 'expo-crypto';
import { z } from 'zod';
import { ManagementAccess } from '@/components/management-access';
import { Action,Card,Copy,Field,ReadState,Screen } from '@/components/ui';
import { api,useResource } from '@/lib/api';
import { useSession } from '@/lib/session';
import { euros,timestamp } from '@/lib/contracts';
import { siteSettings,siteSaved,siteTypes,siteEditValues } from '@/lib/management-contracts';
export default function Site(){const {id}=useLocalSearchParams<{id:string}>();const auth=useSession().session;return <ManagementAccess>{auth&&z.uuid().safeParse(id).success?<Details key={auth.user.id+id} id={id} token={auth.access_token}/>:<Screen><Copy>Site introuvable.</Copy></Screen>}</ManagementAccess>;}
function Details({id,token}:{id:string;token:string}){
 const router=useRouter();
 const path=`/api/sites/${id}/settings`,state=useResource(path,siteSettings,token);
 const [edit,setEdit]=useState<null|{name:string;address:string;access_notes:string;version:number;hours:z.infer<typeof siteSettings>['site']['opening_hours']}>(null);
 const [error,setError]=useState<string|null>(null),[notice,setNotice]=useState<string|null>(null),[busy,setBusy]=useState(false);
 const request=useRef<AbortController|null>(null),command=useRef<{body:string;id:string}|null>(null);
 const nameRef=useRef<ComponentRef<typeof TextInput>>(null),addressRef=useRef<ComponentRef<typeof TextInput>>(null),notesRef=useRef<ComponentRef<typeof TextInput>>(null);
 useEffect(()=>{setBusy(false);return ()=>{request.current?.abort();request.current=null;};},[token]);
 const site=state.data?.site;
 function begin(){if(!site||!state.data?.can_write)return;setError(null);setNotice(null);command.current=null;setEdit({name:site.name,address:site.address,access_notes:site.access_notes,version:site.settings_version,hours:site.opening_hours});}
 function cancel(){if(busy)return;setEdit(null);setError(null);command.current=null;}
 async function save(){
  if(!edit||request.current||!state.data?.can_write)return;
  const parsed=siteEditValues(edit);
  if(!parsed.success){setError(parsed.error.issues[0].message);({name:nameRef,address:addressRef,access_notes:notesRef}[String(parsed.error.issues[0].path[0]) as 'name'])?.current?.focus();return;}
  const values={...parsed.data,opening_hours:edit.hours},body=JSON.stringify({values,expected_version:edit.version});
  if(command.current?.body!==body)command.current={body,id:randomUUID()};
  const controller=new AbortController();request.current=controller;setBusy(true);setError(null);
  try{
   await api(path,siteSaved,{token,method:'POST',signal:controller.signal,body:{action:'save',command_id:command.current.id,expected_version:edit.version,values}});
   if(!controller.signal.aborted){setEdit(null);command.current=null;setNotice('Les informations du site ont été enregistrées.');state.reload();}
  }catch(issue){if(!controller.signal.aborted)setError(issue instanceof Error?issue.message:'Enregistrement indisponible.');}
  finally{if(request.current===controller){request.current=null;setBusy(false);}}
 }
 return <Screen onRefresh={edit?undefined:state.reload}><ReadState loading={state.loading} error={state.error} onRetry={state.reload}/>{notice&&<Copy>{notice}</Copy>}{error&&<Copy kind="error">{error}</Copy>}
 {site&&<><Copy kind="title">{site.name}</Copy><Copy kind="label">{siteTypes[site.type]} · {site.archived_at?'Archivé':'Actif'}</Copy>
 {edit?<Card><Copy kind="subtitle">Modifier les informations</Copy>
 <Field inputRef={nameRef} autoFocus label="Nom du site" value={edit.name} maxLength={160} editable={!busy} onChangeText={name=>setEdit({...edit,name})}/>
 <Field inputRef={addressRef} label="Adresse" value={edit.address} maxLength={500} editable={!busy} onChangeText={address=>setEdit({...edit,address})}/>
 <Field inputRef={notesRef} label="Consignes d’accès" value={edit.access_notes} maxLength={2000} multiline editable={!busy} onChangeText={access_notes=>setEdit({...edit,access_notes})}/>
 <Copy kind="muted">Les horaires existants sont conservés. Vos modifications seront enregistrées si vous disposez toujours des droits nécessaires.</Copy>
 <Action label={busy?'Enregistrement…':'Enregistrer'} disabled={busy} onPress={()=>void save()}/><Action secondary label="Annuler" disabled={busy} onPress={cancel}/>
 {error&&<Action secondary label="Recharger la version du site" disabled={busy} onPress={()=>Alert.alert('Recharger le site ?', 'Les modifications de ce formulaire seront abandonnées.',[{text:'Conserver',style:'cancel'},{text:'Recharger',onPress:()=>{cancel();state.reload();}}])}/>}</Card>:<>
 {state.data?.can_write&&!site.archived_at&&<Action label="Nouvelle demande pour ce site" onPress={()=>router.push({pathname:"/organisation/demande",params:{site_id:site.id}})}/>}
 <Card><Copy kind="subtitle">Adresse et accès</Copy><Copy selectable>{site.address}</Copy><Copy>{site.access_notes||'Aucune consigne renseignée.'}</Copy></Card>
 <Card><Copy kind="subtitle">Budget du site</Copy><Copy>{euros(site.budget_cents)}</Copy><Copy kind="muted">Budget déclaré du site ; ce montant n’est ni une dépense constatée ni un règlement.</Copy></Card>
 <Card><Copy kind="subtitle">Horaires</Copy>{site.opening_hours.length?site.opening_hours.map((h,i)=><Copy key={i}>{['Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi','Dimanche'][h.day-1]} · {h.opens}–{h.closes}</Copy>):<Copy>Aucun horaire renseigné.</Copy>}</Card>
 {site.archived_at&&<Copy kind="muted">Archivé le {timestamp(site.archived_at)}.</Copy>}
 {state.data?.can_write?<Action label="Modifier les informations" onPress={begin}/>:<Copy kind="muted">Ce site est accessible en lecture seule pour votre compte.</Copy>}
 </>}</>}
 </Screen>;
}

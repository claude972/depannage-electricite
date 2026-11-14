import { useEffect,useRef,useState } from 'react';
import { randomUUID } from 'expo-crypto';
import { openBrowserAsync } from 'expo-web-browser';
import { Action,Card,Copy,ReadState } from './ui';
import { api,useResource } from '@/lib/api';
import { useSession } from '@/lib/session';
import { applicationActions,applicationActionLabels,applicationLabels,artisanApplication,calendarDate } from '@/lib/management-contracts';
import { categories,link,success } from '@/lib/contracts';
import { supabaseOrigin } from '@/lib/config';
type Decision=keyof typeof applicationActionLabels;
const credentialLabels={registration:'Immatriculation',liability:'Assurance responsabilité civile',qualification:'Qualification',other:'Autre justificatif'};
export function ArtisanApplicationReview({id,onChanged}:{id:string;onChanged:()=>void}){const auth=useSession().session;return auth?<Review key={auth.user.id+id} id={id} token={auth.access_token} onChanged={onChanged}/>:null;}
function Review({id,token,onChanged}:{id:string;token:string;onChanged:()=>void}){
 const state=useResource('/api/artisan?user_id='+id,artisanApplication,token),dossier=state.data?.artisan_profile;
 const [selected,setSelected]=useState<Decision|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),[notice,setNotice]=useState<string|null>(null);
 const request=useRef<AbortController|null>(null),command=useRef<{action:Decision;version:number;id:string}|null>(null);
 useEffect(()=>{setBusy(false);return()=>{request.current?.abort();request.current=null;};},[token]);
 async function decide(){
  if(!selected||!dossier||request.current)return;
  const action=selected,version=dossier.application_version;
  if(command.current?.action!==action||command.current.version!==version)command.current={action,version,id:randomUUID()};
  const controller=new AbortController();request.current=controller;setBusy(true);setError(null);
  try{await api('/api/admin/artisans',success,{token,method:'POST',signal:controller.signal,body:{user_id:id,action,expected_version:version,command_id:command.current.id}});
   if(!controller.signal.aborted){setNotice('La décision a été enregistrée.');setSelected(null);command.current=null;state.reload();onChanged();}
  }catch(issue){if(!controller.signal.aborted)setError(issue instanceof Error?issue.message:'La décision n’a pas pu être enregistrée.');}
  finally{if(request.current===controller){request.current=null;setBusy(false);}}
 }
 async function document(documentId:string){if(request.current)return;const controller=new AbortController();request.current=controller;setBusy(true);setError(null);
  try{const result=await api('/api/documents?id='+documentId,link,{token,signal:controller.signal});const url=new URL(result.url);if(url.origin!==supabaseOrigin||!url.pathname.startsWith('/storage/v1/object/sign/'))throw Error('Le lien du justificatif n’a pas pu être vérifié.');if(!controller.signal.aborted)await openBrowserAsync(url.toString());}
  catch(issue){if(!controller.signal.aborted)setError(issue instanceof Error?issue.message:'Justificatif indisponible.');}finally{if(request.current===controller){request.current=null;setBusy(false);}}
 }
 return <><ReadState loading={state.loading} error={state.error} onRetry={state.reload}/>{notice&&<Copy>{notice}</Copy>}{error&&<Copy kind="error">{error}</Copy>}
 {state.data&&!dossier&&<Copy kind="muted">Aucune candidature renseignée. Aucune approbation n’est proposée ici.</Copy>}
 {dossier&&<><Card><Copy kind="subtitle">Candidature {applicationLabels[dossier.application_status].toLocaleLowerCase('fr')}</Copy><Copy>{dossier.company_name||'Entreprise non renseignée'}</Copy><Copy>SIRET : {dossier.siret||'Non renseigné'}</Copy><Copy>{dossier.legal_status||'Forme juridique non renseignée'}</Copy><Copy>{dossier.address||'Adresse non renseignée'}</Copy><Copy kind="muted">Zones : {dossier.postal_codes.join(', ')||'Non renseignées'}</Copy><Copy kind="muted">Activités : {dossier.categories.map(value=>categories[value]).join(', ')||'Non renseignées'}</Copy></Card>
 <Card><Copy kind="subtitle">Justificatifs</Copy>{state.data?.credentials.length===0&&<Copy>Aucun justificatif renseigné.</Copy>}{state.data?.credentials.map(item=><Card key={item.id}><Copy>{credentialLabels[item.kind]}</Copy><Copy kind="muted">{item.expires_on?'Échéance : '+calendarDate(item.expires_on):'Aucune échéance renseignée'}</Copy><Action secondary label="Consulter le justificatif" disabled={busy} onPress={()=>void document(item.document_id)}/></Card>)}</Card>
 {selected?<Card><Copy kind="subtitle">{applicationActionLabels[selected]} ?</Copy><Copy>Vérifiez les informations et les justificatifs avant de confirmer cette décision.</Copy><Action label={busy?'Enregistrement…':'Confirmer la décision'} disabled={busy} onPress={()=>void decide()}/><Action secondary label="Revenir au dossier" disabled={busy} onPress={()=>{setSelected(null);setError(null);command.current=null;}}/>{error&&<Action secondary label="Actualiser le dossier" disabled={busy} onPress={()=>{setSelected(null);setError(null);command.current=null;state.reload();}}/>}</Card>:applicationActions(dossier.application_status).map(action=><Action key={action} secondary label={applicationActionLabels[action]} disabled={busy} onPress={()=>{setSelected(action);setError(null);setNotice(null);}}/>)}
 </>}
 </>;
}

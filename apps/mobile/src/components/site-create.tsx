import { useEffect,useRef,useState } from 'react';
import { View } from 'react-native';
import { Action,Card,Copy,Field } from './ui';
import { api } from '@/lib/api';
import { siteTypes } from '@/lib/management-contracts';
import { siteCreated } from '@/lib/enterprise-operations';
type SiteType=keyof typeof siteTypes;
/** Création d’un site par un membre autorisé à gérer l’organisation. Le serveur revalide les droits et les valeurs. */
export function SiteCreate({org,token,onCreated}:{org:string;token:string;onCreated:(name:string)=>void}){
 const [open,setOpen]=useState(false),[name,setName]=useState(''),[address,setAddress]=useState(''),[type,setType]=useState<SiteType|null>(null),[budget,setBudget]=useState('');
 const [busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null);
 const lock=useRef(false);useEffect(()=>{lock.current=false;setBusy(false);},[token]);
 async function save(){
  if(lock.current)return;
  const amount=budget.trim()===''?0:/^\d{1,6}([.,]\d{1,2})?$/.test(budget.trim())?Math.round(Number(budget.trim().replace(',','.'))*100):NaN;
  if(!name.trim()){setError('Renseignez le nom du site.');return;}
  if(!type){setError('Choisissez le type de site.');return;}
  if(address.trim().length<5){setError('Renseignez une adresse complète.');return;}
  if(Number.isNaN(amount)){setError('Indiquez le budget en euros, par exemple 3000 ou 3000,50, ou laissez le champ vide.');return;}
  lock.current=true;setBusy(true);setError(null);
  try{
   await api('/api/sites',siteCreated,{token,method:'POST',body:{name:name.trim(),type,address:address.trim(),budget_cents:amount,organization_id:org}});
   const created=name.trim();setOpen(false);setName('');setAddress('');setType(null);setBudget('');onCreated(created);
  }catch(issue){setError(issue instanceof Error?issue.message:'Création indisponible.');}
  finally{lock.current=false;setBusy(false);}
 }
 if(!open)return <Action label="Ajouter un site" onPress={()=>{setError(null);setOpen(true);}}/>;
 return <Card><Copy kind="subtitle">Nouveau site</Copy>
 <Field label="Nom du site" value={name} maxLength={160} editable={!busy} onChangeText={setName}/>
 <Copy>Type de site</Copy><View style={{flexDirection:'row',flexWrap:'wrap',gap:8}}>{(Object.keys(siteTypes) as SiteType[]).map(value=><Action key={value} label={siteTypes[value]} selected={type===value} secondary disabled={busy} onPress={()=>setType(value)}/>)}</View>
 <Field label="Adresse du site" value={address} maxLength={500} editable={!busy} onChangeText={setAddress}/>
 <Field label="Budget déclaré en euros (facultatif)" value={budget} maxLength={9} keyboardType="decimal-pad" editable={!busy} onChangeText={setBudget}/>
 <Copy kind="muted">Le budget est une référence déclarée par votre organisation : ce n’est ni une dépense ni un règlement.</Copy>
 {error&&<Copy kind="error">{error}</Copy>}
 <Action label={busy?'Création…':'Créer le site'} disabled={busy} onPress={()=>void save()}/><Action secondary label="Annuler" disabled={busy} onPress={()=>{setOpen(false);setError(null);}}/>
 </Card>;
}

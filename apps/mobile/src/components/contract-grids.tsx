import { useEffect,useRef,useState } from 'react';
import { Alert } from 'react-native';
import type { z } from 'zod';
import { Action,Card,Copy,ReadState } from './ui';
import { api,useResource } from '@/lib/api';
import { euros,timestamp } from '@/lib/contracts';
import { calendarDate,sitePage } from '@/lib/management-contracts';
import { contractGrid,gridStatus,gridUnit,operationsSaved,siteOperations } from '@/lib/enterprise-operations';
type Grid=z.infer<typeof contractGrid>;
/** Grilles tarifaires de l’organisation, par lignée et version. La lecture passe par un site actif de l’organisation. */
export function ContractGrids({org,contract,token}:{org:string;contract:string;token:string}){
 const sites=useResource(`/api/organizations/${org}/sites?state=active`,sitePage,token),site=sites.data?.sites[0]?.id;
 const state=useResource(site?'/api/site-operations?site_id='+site:null,siteOperations,token),snapshot=state.data?.snapshot;
 const [busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),[notice,setNotice]=useState<string|null>(null);
 const lock=useRef(false);useEffect(()=>{lock.current=false;setBusy(false);},[token]);
 async function send(body:object,done:string){
  if(lock.current)return;lock.current=true;setBusy(true);setError(null);setNotice(null);
  try{await api('/api/site-operations',operationsSaved,{token,method:'POST',body});setNotice(done);state.reload();}
  catch(issue){setError(issue instanceof Error?issue.message:'Enregistrement indisponible.');}
  finally{lock.current=false;setBusy(false);}
 }
 const publish=(grid:Grid)=>Alert.alert('Publier cette grille ?','Une grille publiée n’est plus modifiable. La version publiée précédente de la même grille est conservée et marquée « Remplacée ».',[{text:'Annuler',style:'cancel'},{text:'Publier',onPress:()=>void send({action:'publish_contract_grid',id:grid.id,expected_version:grid.version},`La version ${grid.version_number} est publiée.`)}]);
 const next=(grid:Grid)=>void send({action:'save_contract_grid',organization_id:org,payload:{label:grid.label,contract_id:grid.contract_id,effective_from:null,lines:grid.lines,from_grid_id:grid.id}},'Une nouvelle version en brouillon reprend les lignes de la version publiée.');
 const lineages=new Map<string,Grid[]>();for(const grid of snapshot?.contract_grids??[])lineages.set(grid.lineage_id,[...(lineages.get(grid.lineage_id)??[]),grid]);
 const write=snapshot?.limits.can_write_organization===true;
 return <Card><Copy kind="subtitle">Grilles tarifaires</Copy><Copy kind="muted">Tarifs convenus par l’organisation, par version. Une grille n’est ni un devis ni un montant facturé.</Copy>
 <ReadState loading={sites.loading||state.loading} error={sites.error??state.error} onRetry={()=>{sites.reload();state.reload();}}/>{notice&&<Copy>{notice}</Copy>}{error&&<Copy kind="error">{error}</Copy>}
 {sites.data&&!site&&<Copy>Les grilles se consultent depuis un site actif : cette organisation n’en a aucun.</Copy>}
 {snapshot&&snapshot.contract_grids===null&&<Copy>Les grilles tarifaires nécessitent un accès couvrant toute l’organisation.</Copy>}
 {snapshot?.contract_grids?.length===0&&<Copy>Aucune grille tarifaire enregistrée.</Copy>}
 {snapshot?.limits.contract_grids_limited&&<Copy kind="muted">Liste limitée : toutes les grilles ne sont pas affichées.</Copy>}
 {[...lineages.values()].map(versions=>{const sorted=[...versions].sort((a,b)=>b.version_number-a.version_number),draft=sorted.some(grid=>grid.status==='draft');
  return <Card key={sorted[0].lineage_id}><Copy kind="subtitle">{sorted[0].label}</Copy><Copy kind="muted">{sorted.length} version(s){sorted.some(grid=>grid.contract_id===contract)?' · rattachée à ce contrat':''}</Copy>
  {sorted.map(grid=><Card key={grid.id}><Copy kind="label">Version {grid.version_number} · {gridStatus[grid.status]}</Copy>
   <Copy kind="muted">{grid.published_at?'Publiée le '+timestamp(grid.published_at):'Non publiée'}{grid.effective_from?' · applicable à partir du '+calendarDate(grid.effective_from.slice(0,10)):''}</Copy>
   {grid.lines.length===0&&<Copy>Aucune ligne.</Copy>}
   {grid.lines.map((line,index)=><Copy key={index}>{line.label} · {euros(line.amount_cents)} {gridUnit[line.unit]}{line.note?' · '+line.note:''}</Copy>)}
   {write&&grid.status==='draft'&&<Action secondary disabled={busy} label={`Publier la version ${grid.version_number}`} onPress={()=>publish(grid)}/>}
   {write&&grid.status==='published'&&!draft&&<Action secondary disabled={busy} label="Préparer une nouvelle version" onPress={()=>next(grid)}/>}
  </Card>)}</Card>;})}
 {snapshot&&snapshot.contract_grids!==null&&<Copy kind="muted">La création d’une grille et la saisie de ses lignes se font sur le site web ; la publication et la préparation d’une nouvelle version sont possibles ici.</Copy>}
 </Card>;
}

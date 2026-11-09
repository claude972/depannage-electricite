import { useRef, useState } from 'react';
import { z } from 'zod';
import { Action, Card, Copy, Field, ReadState, Screen } from '@/components/ui';
import { api, useResource } from '@/lib/api';
import { useWorkspace } from '@/lib/use-workspace';
import { useSession } from '@/lib/session';

const roles={client:'Client',artisan:'Artisan',manager:'Entreprise',admin:'Administration'};
const updated=z.object({profile:z.object({id:z.uuid()})});
const artisan=z.object({artisan_profile:z.object({
  available:z.boolean(), capacity_limit:z.union([z.literal(3),z.literal(4)]).nullable(), capacity_version:z.number().int().nonnegative(),
}).nullable()});
export default function Profile() {
  const state=useWorkspace(), auth=useSession();
  const token=auth.session?.access_token;
  const profile=state.data?.profile;
  const dossier=useResource(profile?.role==='artisan'&&token?'/api/artisan':null,artisan,token);
  const [error,setError]=useState<string|null>(null);
  const [busy,setBusy]=useState(false);
  const [editing,setEditing]=useState(false);
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
      setEditing(false);
    },state.reload);
  }
  function updateArtisan(body:object) {
    if(!token)return;
    void run(async()=>{await api('/api/artisan',artisan,{token,method:'POST',body});},dossier.reload);
  }
  const current=dossier.data?.artisan_profile;
  return <Screen top>
    <Copy kind="title">Mon profil</Copy>
    <ReadState loading={state.loading} error={state.error} onRetry={state.reload}/>
    {error&&<Copy kind="error">{error}</Copy>}
    {profile&&<Card>
      <Copy kind="subtitle">{profile.full_name}</Copy><Copy>{roles[profile.role]}</Copy><Copy kind="muted">{auth.session?.user.email}</Copy>
      {editing?<>
        <Field label="Prénom" value={first} onChangeText={setFirst} maxLength={60} editable={!busy}/>
        <Field label="Nom" value={last} onChangeText={setLast} maxLength={60} editable={!busy}/>
        <Action disabled={busy||!first.trim()||!last.trim()||(first.trim().length+last.trim().length+1>120)} label="Enregistrer" onPress={saveName}/>
        <Action secondary disabled={busy} label="Annuler la modification" onPress={()=>setEditing(false)}/>
      </>:<Action secondary label="Modifier mon nom" disabled={busy} onPress={()=>{setFirst(profile.first_name??'');setLast(profile.last_name??'');setEditing(true);}}/>}
    </Card>}
    {profile?.role==='artisan'&&<Card>
      <Copy kind="subtitle">Disponibilité et missions</Copy>
      <ReadState loading={dossier.loading} error={dossier.error} onRetry={dossier.reload}/>
      {dossier.data&&current===null&&<Copy kind="muted">Complétez votre candidature sur le portail Web pour gérer votre disponibilité.</Copy>}
      {current&&<>
        <Copy>{current.available?'Vous recevez des offres.':'Vous êtes indisponible.'}</Copy>
        <Action secondary disabled={busy||!profile.artisan_approved} label={current.available?'Me rendre indisponible':'Me rendre disponible'} onPress={()=>updateArtisan({action:'set_availability',available:!current.available})}/>
        <Copy>Maximum actuel de missions actives : {current.capacity_limit??3}</Copy>
        {([3,4] as const).map(limit=><Action key={limit} secondary={(current.capacity_limit??3)!==limit} disabled={busy||(current.capacity_limit??3)===limit} label={`Limiter à ${limit} missions`} onPress={()=>updateArtisan({action:'set_capacity_limit',capacity_limit:limit,expected_version:current.capacity_version})}/>)}
      </>}
    </Card>}
    <Action secondary disabled={busy} label={busy?'Action en cours…':'Se déconnecter'} onPress={()=>void run(auth.signOut)}/>
  </Screen>;
}

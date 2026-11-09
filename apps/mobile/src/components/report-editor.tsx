import { useRef, useState } from 'react';
import { Alert } from 'react-native';
import { randomUUID } from 'expo-crypto';
import { File } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { Action, Card, Copy, Field } from './ui';
import { api } from '@/lib/api';
import { fileSaved, signature, success } from '@/lib/contracts';

type Existing={summary:string;signature_name:string;before_photo_id?:string|null;after_photo_id?:string|null};
export function ReportEditor({ token,id,report,required,onSaved }: {token:string;id:string;report:Existing|null;required:boolean;onSaved:()=>void}) {
  const [summary,setSummary]=useState(report?.summary??''), [name,setName]=useState(report?.signature_name??'');
  const [before,setBefore]=useState(report?.before_photo_id??null), [after,setAfter]=useState(report?.after_photo_id??null);
  const [error,setError]=useState<string|null>(null), [busy,setBusy]=useState(false);
  const lock=useRef(false);
  const intent=useRef<{payload:string;id:string}|null>(null);

  async function upload(side:'before'|'after', source:'camera'|'library') {
    if(lock.current) return;
    lock.current=true;setBusy(true);setError(null);
    let temporary:string|null=null;
    try {
      if(source==='camera'&&!(await ImagePicker.requestCameraPermissionsAsync()).granted)
        throw Error('Accès à l’appareil photo refusé.');
      const picked=source==='camera'
        ? await ImagePicker.launchCameraAsync({mediaTypes:['images'],quality:1})
        : await ImagePicker.launchImageLibraryAsync({mediaTypes:['images'],quality:1,allowsMultipleSelection:false});
      if(picked.canceled)return;
      const asset=picked.assets[0];
      const actions=asset.width>1600?[{resize:{width:1600}}]:[];
      const image=await ImageManipulator.manipulateAsync(asset.uri,actions,{compress:.74,format:ImageManipulator.SaveFormat.JPEG});
      if(image.uri!==asset.uri)temporary=image.uri;
      const size=new File(image.uri).size;
      if(!size||size>4194304)throw Error('Cette photo dépasse la limite de 4 Mo après conversion.');
      const data=new FormData();
      data.append('intervention_id',id);
      data.append('file',{uri:image.uri,name:side==='before'?'avant.jpg':'apres.jpg',type:'image/jpeg'} as unknown as Blob);
      const result=await api('/api/documents',fileSaved,{token,method:'POST',body:data});
      (side==='before'?setBefore:setAfter)(result.document.id);
    }catch(issue){setError(issue instanceof Error?issue.message:'Dépôt indisponible.');}
    finally{
      if(temporary){try{new File(temporary).delete();}catch{}}
      lock.current=false;setBusy(false);
    }
  }
  function choose(side:'before'|'after'){
    Alert.alert(side==='before'?'Photo avant intervention':'Photo après intervention','Choisissez une source.',[
      {text:'Annuler',style:'cancel'},
      {text:'Photothèque',onPress:()=>void upload(side,'library')},
      {text:'Appareil photo',onPress:()=>void upload(side,'camera')},
    ]);
  }
  async function save(){
    if(lock.current)return;
    setError(null);
    const signer=signature.safeParse(name);
    if(summary.trim().length<10||!signer.success){setError('Ajoutez un compte rendu détaillé et votre nom.');return;}
    if((required||before||after)&&(!before||!after||before===after)){setError('Ajoutez deux photos distinctes avant et après l’intervention.');return;}
    const body={action:'save_report',summary:summary.trim(),checks:[],signature_name:signer.data,before_photo_id:before,after_photo_id:after};
    const payload=JSON.stringify(body);
    if(intent.current?.payload!==payload)intent.current={payload,id:randomUUID()};
    lock.current=true;setBusy(true);
    try{await api(`/api/interventions/${id}/operations`,success,{token,method:'POST',body:{...body,command_id:intent.current.id}});onSaved();}
    catch(issue){setError(issue instanceof Error?issue.message:'Enregistrement indisponible.');}
    finally{lock.current=false;setBusy(false);}
  }
  return <Card>
    <Copy kind="subtitle">Compte rendu terrain</Copy>
    <Copy kind="muted">{required?'Les photos avant et après sont requises pour clôturer.':'Vous pouvez joindre des photos avant et après.'}</Copy>
    <Action secondary disabled={busy} label={before?'Remplacer la photo avant':'Ajouter la photo avant'} onPress={()=>choose('before')}/>
    <Action secondary disabled={busy} label={after?'Remplacer la photo après':'Ajouter la photo après'} onPress={()=>choose('after')}/>
    <Field label="Travaux réalisés" multiline maxLength={8000} value={summary} onChangeText={setSummary} editable={!busy}/>
    <Field label="Votre nom" value={name} onChangeText={setName} maxLength={120} editable={!busy}/>
    {error&&<Copy kind="error">{error}</Copy>}
    <Action disabled={busy} label={busy?'En cours…':'Enregistrer le compte rendu'} onPress={()=>void save()}/>
  </Card>;
}

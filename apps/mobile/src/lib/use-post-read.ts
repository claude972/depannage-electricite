import {useEffect,useState} from 'react';
import {AppState} from 'react-native';
import type {ZodType} from 'zod';
import {api} from './api';
// Read-only search endpoints use POST to keep the selected scope and search out of URLs.
export function usePostRead<T>(path:string,body:object,schema:ZodType<T>,token:string){
 const serialized=JSON.stringify(body),[revision,setRevision]=useState(0);
 const key=path+serialized+token+revision;
 const [result,setResult]=useState<{key:string,data:T|null,error:string|null}|null>(null);
 useEffect(()=>{const subscription=AppState.addEventListener('change',state=>{if(state==='active')setRevision(v=>v+1)});return()=>subscription.remove()},[]);
 useEffect(()=>{const controller=new AbortController();void api(path,schema,{token,method:'POST',body:JSON.parse(serialized),signal:controller.signal}).then(data=>{if(!controller.signal.aborted)setResult({key,data,error:null})},issue=>{if(!controller.signal.aborted)setResult({key,data:null,error:issue instanceof Error?issue.message:'Lecture indisponible.'})});return()=>controller.abort()},[path,serialized,schema,token,key]);
 return {data:result?.key===key?result.data:null,error:result?.key===key?result.error:null,loading:result?.key!==key,reload:()=>setRevision(v=>v+1)};
}

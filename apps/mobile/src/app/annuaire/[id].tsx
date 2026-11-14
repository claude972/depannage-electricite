import { useLocalSearchParams,useRouter } from 'expo-router';
import { z } from 'zod';
import { ArtisanApplicationReview } from '@/components/artisan-application-review';
import { ManagementAccess } from '@/components/management-access';
import { Action,Card,Copy,ReadState,Screen } from '@/components/ui';
import { useResource } from '@/lib/api';
import { useSession } from '@/lib/session';
import { directoryDetail,directoryKind } from '@/lib/management-contracts';
import { timestamp } from '@/lib/contracts';
export default function Entry(){const params=useLocalSearchParams<{id:string;kind:string}>(),auth=useSession().session;const id=z.uuid().safeParse(params.id).data,kind=directoryKind.safeParse(params.kind).data;return <ManagementAccess admin>{auth&&id&&kind?<Details id={id} kind={kind} token={auth.access_token} actor={auth.user.id}/>:<Screen><Copy>Fiche introuvable.</Copy></Screen>}</ManagementAccess>;}
function Details({id,kind,token,actor}:{id:string;kind:string;token:string;actor:string}){const router=useRouter(),state=useResource(`/api/admin/directory?kind=${kind}&id=${id}`,directoryDetail,token,actor),item=state.data?.item;return <Screen onRefresh={state.reload}><ReadState loading={state.loading} error={state.error} onRetry={state.reload}/>{item&&<><Copy kind="title">{item.full_name??item.name}</Copy><Card><Copy kind="label">Informations du compte</Copy>{item.phone&&<Copy selectable>{item.phone}</Copy>}{item.role&&<Copy>{item.role==='manager'?'Compte entreprise':'Compte particulier'}</Copy>}{item.company_name&&<Copy>{item.company_name}</Copy>}{item.artisan_approved!==undefined&&<Copy>{item.artisan_approved?'Artisan approuvé':'Artisan non approuvé'}</Copy>}<Copy kind="muted">Créé le {timestamp(item.created_at)}</Copy></Card>{kind==='artisans'&&<ArtisanApplicationReview id={id} onChanged={state.reload}/>}
{kind==='organizations'&&<Action label="Sites et accès de l’organisation" onPress={()=>router.push({pathname:'/organisation/[id]',params:{id}})}/>}</>}</Screen>;}

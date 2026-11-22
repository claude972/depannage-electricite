import { useLocalSearchParams } from 'expo-router';
import { z } from 'zod';
import { ManagementAccess } from '@/components/management-access';
import { Card,Copy,ReadState,Screen } from '@/components/ui';
import { useResource } from '@/lib/api';
import { useSession } from '@/lib/session';
import { ContractGrids } from '@/components/contract-grids';
import { contractDetail,contractLabels,calendarDate } from '@/lib/management-contracts';
export default function Contract(){const {id,organization_id}=useLocalSearchParams<{id:string;organization_id:string}>(),auth=useSession().session;return <ManagementAccess>{auth&&z.uuid().safeParse(id).success&&z.uuid().safeParse(organization_id).success?<Details id={id} org={organization_id} token={auth.access_token}/>:<Screen><Copy>Contrat introuvable.</Copy></Screen>}</ManagementAccess>;}
function Details({id,org,token}:{id:string;org:string;token:string}){const state=useResource(`/api/enterprise/contracts/${id}?organization_id=${org}`,contractDetail,token),contract=state.data?.contract;return <Screen onRefresh={state.reload}><ReadState loading={state.loading} error={state.error} onRetry={state.reload}/>{contract&&<><Copy kind="label">{contractLabels[contract.status]}</Copy><Copy kind="title">{contract.title}</Copy><Card><Copy>Référence : {contract.reference||'Non renseignée'}</Copy><Copy>Début : {calendarDate(contract.starts_on)}</Copy><Copy>Fin : {contract.ends_on?calendarDate(contract.ends_on):'Non renseignée'}</Copy></Card><Card><Copy kind="subtitle">Conditions du contrat</Copy><Copy selectable>{contract.terms||'Aucune condition renseignée.'}</Copy></Card><ContractGrids org={org} contract={id} token={token}/></>}</Screen>;}

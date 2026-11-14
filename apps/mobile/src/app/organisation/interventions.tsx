import {useState} from 'react';
import {FlatList,View} from 'react-native';
import {useLocalSearchParams,useRouter} from 'expo-router';
import {SafeAreaView} from 'react-native-safe-area-context';
import {z} from 'zod';
import {enterpriseInterventionPage,enterpriseInterventionRow} from '../../../../../shared/enterprise-interventions';
import {enterpriseOverviewSnapshot} from '../../../../../shared/enterprise-overview';
import {ManagementAccess} from '@/components/management-access';
import {Action,Card,Copy,Field,ReadState,usePalette} from '@/components/ui';
import {useSession} from '@/lib/session';
import {usePostRead} from '@/lib/use-post-read';
import {categories,statuses,euros,timestamp} from '@/lib/contracts';
type Row=z.infer<typeof enterpriseInterventionRow>;
export default function EnterpriseInterventions(){const {organization_id,site_id}=useLocalSearchParams<{organization_id:string;site_id?:string}>(),auth=useSession().session;return <ManagementAccess>{auth&&z.uuid().safeParse(organization_id).success&&(!site_id||z.uuid().safeParse(site_id).success)?<List key={auth.user.id+organization_id+site_id} org={organization_id} site={site_id??null} token={auth.access_token}/>:<Card><Copy>Périmètre introuvable.</Copy></Card>}</ManagementAccess>}
function List({org,site,token}:{org:string;site:string|null;token:string}){
 const router=useRouter(),palette=usePalette(),[text,setText]=useState(''),[search,setSearch]=useState(''),[status,setStatus]=useState<Row['status']|null>(null),[category,setCategory]=useState<Row['category']|null>(null),[sort,setSort]=useState<'recent'|'oldest'>('recent'),[page,setPage]=useState(1),[filters,setFilters]=useState(false);
 const data=usePostRead('/api/enterprise/interventions/search',{action:'list',organization_id:org,site_id:site,category,status,search,sort,page},enterpriseInterventionPage,token);
 const overview=usePostRead('/api/enterprise/overview',{organization_id:org,site_id:site},enterpriseOverviewSnapshot,token);
 const reload=()=>{data.reload();overview.reload()};
 return <SafeAreaView edges={['top','left','right']} style={{flex:1,backgroundColor:palette.background}}><FlatList data={data.data?.items??[]} keyExtractor={item=>item.id} refreshing={data.loading} onRefresh={reload} keyboardShouldPersistTaps="handled" contentContainerStyle={{padding:16,gap:14}}
 ListHeaderComponent={<View style={{gap:12}}><Copy kind="title">Interventions entreprise</Copy><Copy kind="muted">{site?'Site sélectionné':'Tous vos sites accessibles dans cette organisation'}</Copy>
 <ReadState loading={overview.loading} error={overview.error} onRetry={overview.reload}/>{overview.data&&<Card><Copy kind="subtitle">{overview.data.counts.open} en cours · {overview.data.counts.urgent} urgentes</Copy><Copy kind="muted">Périmètre autorisé, tous statuts actifs · actualisé le {timestamp(overview.data.captured_at)}. Ces compteurs ne dépendent pas des filtres ci-dessous.</Copy></Card>}
 <Field label="Rechercher une intervention ou un site" value={text} maxLength={120} onChangeText={setText} returnKeyType="search" onSubmitEditing={()=>{setSearch(text.trim());setPage(1)}}/><Action secondary label="Rechercher" onPress={()=>{setSearch(text.trim());setPage(1)}}/>
 <Action secondary label={`${filters?'Masquer':'Afficher'} les filtres (${[status,category,sort==='oldest'].filter(Boolean).length})`} onPress={()=>setFilters(!filters)}/>
 {filters&&<Card><Copy kind="subtitle">Statut</Copy><View style={{flexDirection:'row',flexWrap:'wrap',gap:8}}><Action label="Tous les statuts" selected={status===null} secondary={status!==null} onPress={()=>{setStatus(null);setPage(1)}}/>{Object.entries(statuses).map(([value,label])=><Action key={value} label={label} selected={status===value} secondary={status!==value} onPress={()=>{setStatus(value as Row['status']);setPage(1)}}/>)}</View><Copy kind="subtitle">Type de dépannage</Copy><View style={{flexDirection:'row',flexWrap:'wrap',gap:8}}><Action label="Tous les types" selected={category===null} secondary={category!==null} onPress={()=>{setCategory(null);setPage(1)}}/>{Object.entries(categories).map(([value,label])=><Action key={value} label={label} selected={category===value} secondary={category!==value} onPress={()=>{setCategory(value as Row['category']);setPage(1)}}/>)}</View><Action secondary label={sort==='recent'?'Trier du plus ancien au plus récent':'Trier du plus récent au plus ancien'} onPress={()=>{setSort(sort==='recent'?'oldest':'recent');setPage(1)}}/></Card>}
 {Boolean(search||status||category||sort==='oldest')&&<Action secondary label="Réinitialiser la recherche et les filtres" onPress={()=>{setText('');setSearch('');setStatus(null);setCategory(null);setSort('recent');setPage(1)}}/>}
 <ReadState loading={data.loading} error={data.error} onRetry={data.reload}/>{data.data&&<Copy>{data.data.total} résultat(s) · page {data.data.page.number} sur {data.data.page.pages}</Copy>}</View>}
 ListEmptyComponent={data.data&&!data.error?<Card><Copy>Aucune intervention ne correspond à cette sélection.</Copy></Card>:undefined}
 ListFooterComponent={<View style={{gap:10}}>{page>1&&<Action secondary label="Page précédente" disabled={data.loading} onPress={()=>setPage(v=>v-1)}/>}{data.data&&page<data.data.page.pages&&<Action secondary label="Page suivante" disabled={data.loading} onPress={()=>setPage(v=>v+1)}/>}</View>}
 renderItem={({item})=><Card><Copy kind="label">{statuses[item.status]}</Copy><Copy kind="subtitle">{item.site_name}</Copy><Copy>{categories[item.category]} · {item.urgency==='urgent'?'Urgent':'Planifié'}</Copy><Copy kind="muted">{item.address}, {item.postal_code} {item.city}</Copy><Copy>Estimation indicative : {euros(item.estimate_min_cents)} à {euros(item.estimate_max_cents)}</Copy><Copy kind="muted">Le montant accepté et les règlements sont suivis dans le dossier.</Copy><Action secondary label="Ouvrir le dossier" onPress={()=>router.push({pathname:'/dossier/[id]',params:{id:item.id}})}/></Card>}/></SafeAreaView>;
}

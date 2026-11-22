import { FlatList } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useWorkspace } from '@/lib/use-workspace';
import { ManagementAccess } from '@/components/management-access';
import { Action, Card, Copy, ReadState, usePalette } from '@/components/ui';
export default function Organizations(){return <ManagementAccess><List/></ManagementAccess>;}
function List(){
 const state=useWorkspace(),router=useRouter(),p=usePalette();
 return <SafeAreaView edges={['top','left','right']} style={{flex:1,backgroundColor:p.background}}><FlatList data={state.data?.organizations??[]} keyExtractor={item=>item.id} onRefresh={state.reload} refreshing={state.loading&&!!state.data} contentContainerStyle={{padding:16,gap:14}}
 ListHeaderComponent={<><Copy kind="title">Organisations</Copy><ReadState loading={state.loading} error={state.error} onRetry={state.reload}/><Copy kind="muted">Seules les organisations accessibles à votre compte apparaissent ici.</Copy>{state.data?.limits?.organizations?.limited&&<Copy kind="muted">Les 50 premières organisations sont chargées. La liste est partielle.</Copy>}</>}
 ListEmptyComponent={state.data&&!state.loading&&!state.error?<Card><Copy>Aucune organisation accessible.</Copy></Card>:undefined}
 renderItem={({item})=><Card><Copy kind="subtitle">{item.name}</Copy><Action secondary label="Sites et accès" onPress={()=>router.push({pathname:'/organisation/[id]',params:{id:item.id}})}/></Card>}/></SafeAreaView>;
}

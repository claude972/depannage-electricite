import { useRouter } from 'expo-router';
import { Action, Card, Copy, ReadState, Screen } from '@/components/ui';
import { useWorkspace } from '@/lib/use-workspace';
import { categories } from '@/lib/contracts';

export default function Threads() {
  const router=useRouter(), state=useWorkspace();
  const jobs=state.data?.interventions.filter(job=>job.artisan_id&&job.status!=='cancelled')??[];
  return <Screen top>
    <Copy kind="title">Messages</Copy>
    <ReadState loading={state.loading} error={state.error} onRetry={state.reload}/>
    {state.data&&jobs.length===0&&<Copy kind="muted">Les conversations apparaissent après l’attribution d’une intervention.</Copy>}
    {jobs.map(job=><Card key={job.id}>
      <Copy kind="subtitle">{categories[job.category]}</Copy><Copy kind="muted">{job.city}</Copy>
      <Action secondary label="Ouvrir la conversation" onPress={()=>router.push({pathname:'/dossier/messages',params:{id:job.id}})}/>
    </Card>)}
  </Screen>;
}

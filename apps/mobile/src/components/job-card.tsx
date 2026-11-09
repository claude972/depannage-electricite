import { Action, Card, Copy } from './ui';
import { categories, euros, statuses, type Job } from '@/lib/contracts';

export function JobCard({ job, onOpen, label='Ouvrir le dossier' }: {job:Job;onOpen:()=>void;label?:string}) {
  return <Card>
    <Copy kind="label">{statuses[job.status]}</Copy>
    <Copy kind="subtitle">{categories[job.category]}</Copy>
    <Copy>{job.city} · {job.urgency==='urgent'?'Urgent':'Planifiable'}</Copy>
    <Copy kind="muted">Estimation indicative {euros(job.estimate_min_cents)} à {euros(job.estimate_max_cents)}</Copy>
    <Action secondary label={label} onPress={onOpen}/>
  </Card>;
}

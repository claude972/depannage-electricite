import { Action, Card, Copy } from './ui';
import { categories, type Job, type Payment, type QuoteSummary } from '@/lib/contracts';
import { dossierAmount, jobStatus, type Role } from '@/lib/job-presentation';
export function JobCard({ job, onOpen, label='Ouvrir le dossier', role='client', quotes, payments }: {job:Job;onOpen:()=>void;label?:string;role?:Role;quotes?:QuoteSummary[];payments?:Payment[]}) {
  const amount = dossierAmount(job, quotes, payments);
  return <Card>
    <Copy kind="label">{jobStatus(job.status, role)}</Copy>
    <Copy kind="subtitle">{categories[job.category]}</Copy>
    <Copy>{job.city} · {job.urgency==='urgent'?'Urgent':'Planifiable'}</Copy>
    <Copy kind="muted">{role==='artisan' && amount.label==='Devis reçu' ? 'Devis envoyé' : role==='artisan' && amount.label==='À régler' ? 'Règlement attendu' : amount.label}</Copy>
    <Copy selectable>{amount.value}</Copy>
    <Action secondary label={label} onPress={onOpen}/>
  </Card>;
}

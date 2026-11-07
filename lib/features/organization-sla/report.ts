import {z}from 'zod';
import {calendarWindow}from '@/lib/features/site-operations/schemas';
import {evaluateSlaCase}from '@/lib/features/site-operations/sla';
import {summarize}from '@/lib/features/site-operations/report';
import type {SlaEvaluation}from '@/lib/features/site-operations/types';
const uuid=z.uuid();const instant=z.iso.datetime({offset:true});const count=z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const pause=z.object({id:uuid,case_id:uuid,site_id:uuid,started_at:instant,ended_at:instant.nullable()}).strict().refine(v=>v.ended_at===null||Date.parse(v.ended_at)>=Date.parse(v.started_at));
const slaCase=z.object({id:uuid,site_id:uuid,policy_id:uuid,opened_at:instant,responded_at:instant.nullable(),resolved_at:instant.nullable(),pauses_total:count,pauses:z.array(pause).max(20)}).strict().refine(v=>(v.responded_at===null||Date.parse(v.responded_at)>=Date.parse(v.opened_at))&&(v.resolved_at===null||Date.parse(v.resolved_at)>=Date.parse(v.responded_at??v.opened_at)));
const policy=z.object({id:uuid,site_id:uuid,calendar_id:uuid.nullable(),response_target_minutes:z.number().int().min(1).max(525600).nullable(),resolution_target_minutes:z.number().int().min(1).max(525600).nullable(),status:z.enum(['active','archived'])}).strict();
const calendar=z.object({id:uuid,organization_id:uuid,timezone:z.string().min(1).max(64),windows:z.array(calendarWindow).max(21),closed_dates:z.array(z.iso.date()).max(366)}).strict();
const snapshotSchema=z.object({organization_id:uuid,captured_at:instant,organization_wide:z.boolean(),visible_sites_total:count,remaining_sites_total:count,calendars_total:count,calendars:z.array(calendar).max(100),sites:z.array(z.object({id:uuid,organization_id:uuid,name:z.string().min(1).max(160),cases_total:count,cases:z.array(slaCase).max(100),policies:z.array(policy).max(100)}).strict()).max(20)}).strict();
const unique=(ids:string[])=>new Set(ids).size===ids.length;
export function buildOrganizationSla(value:unknown,organizationId:string,after:string|null){
 const snapshot=snapshotSchema.parse(value);
 if(snapshot.organization_id!==organizationId||snapshot.remaining_sites_total>snapshot.visible_sites_total||snapshot.sites.length!==Math.min(snapshot.remaining_sites_total,20)||(!after&&snapshot.remaining_sites_total!==snapshot.visible_sites_total)||snapshot.calendars.length!==Math.min(snapshot.calendars_total,100)||!unique(snapshot.calendars.map(c=>c.id))||snapshot.calendars.some(c=>c.organization_id!==organizationId)||!unique(snapshot.sites.map(s=>s.id)))throw Error('Invalid SLA scope/count');
 const allCaseIds=new Set<string>(),allPolicyIds=new Set<string>();
 const reasons=new Set<string>();if(after)reasons.add('paginated_subset');if(snapshot.remaining_sites_total>20)reasons.add('sites_limited');if(snapshot.calendars_total>100)reasons.add('calendars_limited');
 const calendars=new Map(snapshot.calendars.map(c=>[c.id,c]));const evaluated:SlaEvaluation[]=[];let unavailable=0;
 const sites=snapshot.sites.map((site,index)=>{
  if(site.organization_id!==organizationId||(after&&site.id<=after)||(index>0&&site.id<=snapshot.sites[index-1].id)||site.cases.length!==Math.min(site.cases_total,100)||!unique(site.policies.map(p=>p.id)))throw Error('Invalid site slice');
  const siteReasons=new Set<string>();if(site.cases_total>100)siteReasons.add('cases_limited');
  const policies=new Map(site.policies.map(p=>[p.id,p]));for(const p of site.policies){if(p.site_id!==site.id||allPolicyIds.has(p.id))throw Error('Foreign policy');allPolicyIds.add(p.id);}
  const cases=site.cases.map(c=>{
   if(c.site_id!==site.id||allCaseIds.has(c.id)||c.pauses.length!==Math.min(c.pauses_total,20)||!unique(c.pauses.map(p=>p.id))||c.pauses.some(p=>p.site_id!==site.id||p.case_id!==c.id))throw Error('Foreign or incomplete case');allCaseIds.add(c.id);
   const p=policies.get(c.policy_id);const cal=p?.calendar_id?calendars.get(p.calendar_id):null;
   if(!p||(p.calendar_id!==null&&!cal)){const reason=!p?'policy_unavailable':'calendar_unavailable';siteReasons.add(reason);unavailable++;return{case_id:c.id,evaluation:null,reason};}
   if(c.pauses_total>20)siteReasons.add('pauses_limited');
   const evaluation=evaluateSlaCase({case_id:c.id,policy_id:p.id},cal?{timezone:cal.timezone,windows:cal.windows,closed_dates:cal.closed_dates}:null,p,c,snapshot.captured_at);
   evaluated.push(evaluation);return{case_id:c.id,evaluation,reason:null};
  });
  for(const r of siteReasons)reasons.add(r);
  return{id:site.id,name:site.name,cases_total:site.cases_total,cases,complete:siteReasons.size===0,reasons:[...siteReasons]};
 });
 const raw=summarize(evaluated);
 // The legacy summary allows one measurable track. Never label such a mixed
 // met/unknown case "met" in this consolidated view.
 const indeterminate=evaluated.filter(c=>[c.response.status,c.resolution.status].includes('not_measurable')&&[c.response.status,c.resolution.status].includes('met')&&![c.response.status,c.resolution.status].some(s=>s==='breached'||s==='pending')).length;
 const hasMore=snapshot.remaining_sites_total>20,last=snapshot.sites.at(-1);const complete=reasons.size===0;
 return{organization_id:organizationId,captured_at:snapshot.captured_at,scope:{kind:snapshot.organization_wide?'organization':'visible_sites',visible_sites_total:snapshot.visible_sites_total,organization_wide:snapshot.organization_wide},
  state:complete?'complete':'partial',reasons:[...reasons],complete_for_visible_scope:complete,complete_for_organization:complete&&snapshot.organization_wide,
  page:{limit:20,has_more:hasMore,next_cursor:hasMore&&last?Buffer.from(JSON.stringify({organization_id:organizationId,after_site_id:last.id})).toString('base64url'):null,returned_sites:sites.length,remaining_sites_total:snapshot.remaining_sites_total},
  summary:{...raw,met:raw.met-indeterminate,indeterminate,cases_evaluated:raw.cases,cases_returned:sites.reduce((n,s)=>n+s.cases.length,0),partially_measurable:evaluated.filter(c=>c.measurable&&[c.response.status,c.resolution.status].includes('not_measurable')).length,unavailable,complete,basis:'returned_visible_sites' as const},sites};
}

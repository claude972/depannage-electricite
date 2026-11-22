import {z}from 'zod';
const text=(max:number,min=0)=>z.string().trim().min(min).max(max).regex(/^[^\u0000]*$/);
const instant=z.iso.datetime({offset:true});
export const meetingValues=z.object({title:text(200,1),starts_at:instant.nullable(),ends_at:instant.nullable(),location:text(300),agenda:text(6000),minutes:text(12000),decisions:z.array(text(1000,1)).max(20),status:z.enum(['draft','scheduled','held','cancelled'])}).strict().refine(v=>v.ends_at===null||(v.starts_at!==null&&Date.parse(v.ends_at)>=Date.parse(v.starts_at))).refine(v=>!['scheduled','held'].includes(v.status)||(v.starts_at!==null&&v.location.length>0));
export const fundCallValues=z.object({label:text(200,1),reference:text(100,1),due_on:z.iso.date(),amount_cents:z.number().int().min(1).max(2147483647),document_reference:text(240,1),issued_on:z.iso.date().nullable(),note:text(4000),meeting_id:z.uuid().nullable(),status:z.enum(['draft','issued','cancelled'])}).strict().refine(v=>v.status!=='issued'||v.issued_on!==null).refine(v=>v.issued_on===null||v.due_on>=v.issued_on);
const base={id:z.uuid(),command_id:z.uuid(),expected_version:z.number().int().min(1).max(2147483646).nullable()};
export const coOwnershipCommand=z.union([
 z.object({...base,kind:z.literal('meeting'),action:z.literal('save'),values:meetingValues}).strict(),
 z.object({...base,kind:z.literal('fund_call'),action:z.literal('save'),values:fundCallValues}).strict(),
 z.object({...base,expected_version:z.number().int().min(1).max(2147483646),kind:z.enum(['meeting','fund_call']),action:z.literal('archive')}).strict(),
]);
const record={id:z.uuid(),site_id:z.uuid(),version:z.number().int().min(1).max(2147483647),created_by:z.uuid(),updated_by:z.uuid(),created_at:instant,updated_at:instant,archived_at:instant.nullable()};
export const coOwnershipRecord=z.discriminatedUnion('kind',[z.object({...record,kind:z.literal('meeting'),values:meetingValues}).strict(),z.object({...record,kind:z.literal('fund_call'),values:fundCallValues}).strict()]);
export type CoOwnershipRecord=z.infer<typeof coOwnershipRecord>;

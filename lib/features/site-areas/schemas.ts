import {z}from 'zod';
const text=(max:number,min=1)=>z.string().trim().min(min).max(max).refine(v=>!/[\u0000-\u001f\u007f]/.test(v));
export const areaValues=z.object({label:text(160),kind:z.enum(['floor','zone','common_area']),reference:text(80,0),note:z.string().trim().max(2000).regex(/^[^\u0000]*$/),parent_id:z.uuid().nullable()}).strict();
export const areaCommand=z.discriminatedUnion('action',[
 z.object({action:z.literal('save'),id:z.uuid(),command_id:z.uuid(),expected_version:z.number().int().min(1).max(2147483646).nullable(),values:areaValues}).strict(),
 z.object({action:z.literal('archive'),id:z.uuid(),command_id:z.uuid(),expected_version:z.number().int().min(1).max(2147483646)}).strict(),
]);
export const areaRecord=z.object({id:z.uuid(),site_id:z.uuid(),label:text(160),kind:z.enum(['floor','zone','common_area']),reference:text(80,0),note:z.string().max(2000),parent_id:z.uuid().nullable(),depth:z.number().int().min(1).max(4),version:z.number().int().min(1).max(2147483647),created_by:z.uuid(),created_at:z.iso.datetime({offset:true}),updated_by:z.uuid(),updated_at:z.iso.datetime({offset:true}),archived_at:z.iso.datetime({offset:true}).nullable()}).strict().refine(v=>(v.parent_id===null)===(v.depth===1)&&v.parent_id!==v.id);
export type SiteArea=z.infer<typeof areaRecord>;

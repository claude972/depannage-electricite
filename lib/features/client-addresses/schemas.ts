import {z} from 'zod';
const text=(min:number,max:number)=>z.string().trim().min(min).max(max).refine(v=>!/[\u0000-\u001f\u007f]/.test(v));
const fields={label:text(1,100),first_name:text(1,100),last_name:text(1,100),address:text(5,500),postal_code:text(2,20).regex(/^[A-Z0-9][A-Z0-9 -]+$/),city:text(1,160),country_code:z.string().regex(/^[A-Z]{2}$/),latitude:z.number().min(-90).max(90).nullable(),longitude:z.number().min(-180).max(180).nullable(),geo_source:z.enum(['manual_pin','device_reported','geocoder_selected']).nullable(),is_preferred:z.boolean()};
function geo(v:{latitude:number|null;longitude:number|null;geo_source:string|null}){return(v.latitude===null&&v.longitude===null&&v.geo_source===null)||(v.latitude!==null&&v.longitude!==null&&v.geo_source!==null);}
export const POSTAL_CODE_MESSAGE='Le code postal doit comporter cinq chiffres.';
// CLI-09: a SAVED address needs a five-digit postal code (as the request form); stored rows keep the wider read shape.
export const addressValues=z.object({...fields,postal_code:z.string({error:POSTAL_CODE_MESSAGE}).trim().regex(/^[0-9]{5}$/,{error:POSTAL_CODE_MESSAGE})}).strict().refine(geo,{message:'Les coordonnées et leur provenance doivent être renseignées ensemble.'});
export const addressCommand=z.discriminatedUnion('action',[
 z.object({action:z.literal('save'),id:z.uuid(),command_id:z.uuid(),expected_version:z.number().int().min(1).max(2147483646).nullable(),values:addressValues}).strict(),
 z.object({action:z.literal('archive'),id:z.uuid(),command_id:z.uuid(),expected_version:z.number().int().min(1).max(2147483646)}).strict(),
]);
export const addressRecord=z.object({...fields,id:z.uuid(),user_id:z.uuid(),version:z.number().int().min(1).max(2147483647),created_at:z.iso.datetime({offset:true}),updated_at:z.iso.datetime({offset:true}),archived_at:z.iso.datetime({offset:true}).nullable()}).strict().refine(geo).refine(v=>v.archived_at===null||!v.is_preferred);
export type ClientAddress=z.infer<typeof addressRecord>;

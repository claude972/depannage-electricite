import {z} from 'zod';
import {ApiError} from '@/lib/supabase/server';
export const requestSchema=z.object({id:z.uuid(),account_id:z.uuid(),ticket_id:z.uuid(),state:z.enum(['requested','in_review','needs_information','approved','rejected']),execution_state:z.literal('not_started'),version:z.number().int().min(1).max(100),created_at:z.string().refine(x=>Number.isFinite(Date.parse(x))),updated_at:z.string().refine(x=>Number.isFinite(Date.parse(x)))});
export const pageSchema=z.object({rows:z.array(requestSchema).max(100),next_cursor:z.uuid().nullable()});
export const privateHeaders={'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'};
export function checked<T>(schema:z.ZodType<T>,value:unknown):T{const result=schema.safeParse(value);if(!result.success)throw new ApiError(503,'Le suivi de la demande est momentanément indisponible.');return result.data}
export function publicRequest(row:z.infer<typeof requestSchema>){const {account_id,...result}=row;void account_id;return result}
export function checkedPage(value:unknown,after:string|null,owner?:string){const page=checked(pageSchema,value);let previous=after?.toLowerCase()??'';for(const row of page.rows){if(row.id<=previous||(owner&&row.account_id!==owner))throw new ApiError(503,'La portée du suivi doit être vérifiée.');previous=row.id}if(page.next_cursor&&(page.rows.length===0||page.next_cursor!==previous))throw new ApiError(503,'Le suivi doit être relu.');return {rows:page.rows.map(publicRequest),next_cursor:page.next_cursor}}

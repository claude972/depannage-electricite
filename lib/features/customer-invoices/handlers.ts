import { taxRateSchema } from "@/lib/tax-rates";
import {createHash}from 'node:crypto';
import {z}from 'zod';
import {authenticatedClient,ApiError,dbError}from '@/lib/supabase/server';
import {renderedPdfLink}from '@/lib/features/documents/rendered-link';
import {invoiceDocumentInput}from '@/lib/features/platform-operations/invoice-document';
import {parseInvoicePdfInput,renderInvoicePdf,invoicePdfFileName}from '@/lib/features/platform-operations/invoice-pdf';
import type {Invoice}from '@/lib/features/platform-operations/types';
const HEADERS={'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'};
const uuid=z.uuid().transform(v=>v.toLowerCase()),cents=z.number().int().min(0).max(2147483647),count=z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const instant=z.iso.datetime({offset:true}).regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/);
const party=z.object({legal_name:z.string().max(160).optional(),name:z.string().max(160).optional(),address:z.string().min(1).max(500),siret:z.string().max(14).nullable().optional(),vat_number:z.string().max(80).nullable().optional(),legal_status:z.string().max(80).nullable().optional(),organization:z.string().max(160).nullable().optional(),subject_kind:z.enum(['profile','organization']).optional(),subject_id:uuid.optional(),profile_id:uuid.optional(),billing_version:z.number().int().positive().optional()}).strict();
const rowSchema=z.object({id:uuid,kind:z.enum(['invoice','credit_note']),basis:z.enum(['service','platform_commission']),number:z.string().min(1).max(40),issuer_key:z.string().min(1).max(80),issuer:party,recipient:party,payment_id:uuid,quote_id:uuid,intervention_id:uuid,related_invoice_id:uuid.nullable(),lines:z.array(z.object({label:z.string().min(1).max(160),quantity:z.number().int().min(1).max(1000),unit_price_cents:cents}).strict()).min(1).max(30),subtotal_cents:cents,tax_rate:taxRateSchema,tax_cents:cents,total_cents:cents.min(1),currency:z.literal('eur'),reason:z.string().max(1000),issued_at:instant}).strict().superRefine((r,c)=>{if(!r.issuer.legal_name?.trim()||!r.issuer.siret||!(/^[0-9]{14}$/).test(r.issuer.siret)||!(r.recipient.name??r.recipient.legal_name)?.trim()||r.subtotal_cents+r.tax_cents!==r.total_cents||r.lines.reduce((n,l)=>n+l.quantity*l.unit_price_cents,0)!==r.subtotal_cents||(r.kind==='invoice')!==(r.related_invoice_id===null))c.addIssue({code:'custom',message:'Invalid invoice snapshot'});});
type Row=z.infer<typeof rowSchema>;type Context={params:Promise<{id:string}>};
function canonical(v:unknown):string{if(v===null||typeof v!=='object')return JSON.stringify(v);if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';return '{'+Object.entries(v as Record<string,unknown>).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>JSON.stringify(k)+':'+canonical(x)).join(',')+'}';}
function version(row:Row){return{basis:'immutable_register_snapshot' as const,sha256:createHash('sha256').update(canonical(row)).digest('hex')};}
function links(id:string){return{detail:`/api/invoices/${id}`,open:`/api/invoices/${id}/pdf?inline=1`,download:`/api/invoices/${id}/pdf`};}
function summary(r:Row){return{id:r.id,kind:r.kind,basis:r.basis,number:r.number,issuer_name:r.issuer.legal_name??r.issuer.name??'',recipient_name:r.recipient.name??r.recipient.legal_name??'',intervention_id:r.intervention_id,quote_id:r.quote_id,related_invoice_id:r.related_invoice_id,total_cents:r.total_cents,tax_cents:r.tax_cents,currency:r.currency,issued_at:r.issued_at,document_state:'issued' as const,version:version(r),links:links(r.id)};}
function failed(e:unknown){const status=e instanceof ApiError?e.status:503;return Response.json({error:e instanceof ApiError?e.message:'Le document enregistré n’a pas pu être vérifié. Réessayez.'},{status,headers:{...HEADERS,...(status===503?{'Retry-After':'2'}:{})}});}
const cursorSchema=z.object({v:z.literal(1),id:uuid,issued_at:instant,filters:z.string().regex(/^[0-9a-f]{64}$/)}).strict();
const filtersSchema=z.object({organization_id:uuid.nullable(),site_id:uuid.nullable(),intervention_id:uuid.nullable(),kind:z.enum(['invoice','credit_note']).nullable(),basis:z.enum(['service','platform_commission']).nullable()}).strict();
function parameters(request:Request,user:string){
 const p=new URL(request.url).searchParams;const allowed=['organization_id','site_id','intervention_id','kind','basis','limit','cursor'];
 if(request.url.length>4096||[...p.keys()].some(k=>!allowed.includes(k)||p.getAll(k).length!==1))throw new ApiError(422,'Filtres de facture invalides.');
 const f=filtersSchema.safeParse(Object.fromEntries(['organization_id','site_id','intervention_id','kind','basis'].map(k=>[k,p.get(k)])));if(!f.success)throw new ApiError(422,'Filtres de facture invalides.');
 const limitText=p.get('limit')??'25';if(!/^(?:[1-9]|[1-4][0-9]|50)$/.test(limitText))throw new ApiError(422,'Limite de facture invalide.');const limit=Number(limitText);
 const fingerprint=createHash('sha256').update(canonical({user,filters:f.data,limit})).digest('hex');let cursor:z.infer<typeof cursorSchema>|null=null;const raw=p.get('cursor');
 if(raw!==null){try{if(raw.length>1024||!/^[-A-Za-z0-9_]+$/.test(raw))throw Error();const b=Buffer.from(raw,'base64url');if(b.toString('base64url')!==raw)throw Error();cursor=cursorSchema.parse(JSON.parse(b.toString('utf8')));if(cursor.filters!==fingerprint)throw Error();}catch{throw new ApiError(422,'Le curseur ne correspond pas à cette consultation. Rechargez les factures.');}}
 return{filters:f.data,limit,fingerprint,cursor};
}
function timeKey(s:string){const fraction=(s.match(/\.(\d+)(?:Z|[+-])/ )?.[1]??'').padEnd(6,'0');return BigInt(Date.parse(s))*1000n+BigInt(fraction.slice(3));}
export async function listInvoices(request:Request){try{
 const{db,user}=await authenticatedClient(request);const p=parameters(request,user.id);
 const result=await db.rpc('customer_invoice_page',{p_organization_id:p.filters.organization_id,p_site_id:p.filters.site_id,p_intervention_id:p.filters.intervention_id,p_kind:p.filters.kind,p_basis:p.filters.basis,p_limit:p.limit,p_after_at:p.cursor?.issued_at??null,p_after_id:p.cursor?.id??null});dbError(result.error);
 const page=z.object({captured_at:instant,total:count,remaining:count,invoices:z.array(rowSchema).max(50)}).strict().parse(result.data);
 if(page.remaining>page.total||(!p.cursor&&page.remaining!==page.total)||page.invoices.length!==Math.min(page.remaining,p.limit)||new Set(page.invoices.map(r=>r.id)).size!==page.invoices.length||page.invoices.some((r,index)=>
  (p.filters.kind&&r.kind!==p.filters.kind)||(p.filters.basis&&r.basis!==p.filters.basis)||(p.filters.intervention_id&&r.intervention_id!==p.filters.intervention_id)||
  (p.cursor&&(timeKey(r.issued_at)>timeKey(p.cursor.issued_at)||(timeKey(r.issued_at)===timeKey(p.cursor.issued_at)&&r.id>=p.cursor.id)))||
  (index>0&&(timeKey(r.issued_at)>timeKey(page.invoices[index-1].issued_at)||(timeKey(r.issued_at)===timeKey(page.invoices[index-1].issued_at)&&r.id>=page.invoices[index-1].id)))))throw Error('Invalid invoice page');
 for(const r of page.invoices)if(r.kind==='invoice')parseInvoicePdfInput({...invoiceDocumentInput(r as Invoice,null),basis:r.basis});
 const more=page.remaining>p.limit,last=page.invoices.at(-1);const next=more&&last?Buffer.from(JSON.stringify({v:1,id:last.id,issued_at:last.issued_at,filters:p.fingerprint})).toString('base64url'):null;
 return Response.json({invoices:page.invoices.map(summary),captured_at:page.captured_at,filters:p.filters,page:{limit:p.limit,total:page.total,remaining:page.remaining,has_more:more,next_cursor:next,complete:!p.cursor&&!more}},{headers:HEADERS});
}catch(e){return failed(e);}}
function relatedValid(i:Row,p:Row){return p.kind==='invoice'&&i.related_invoice_id===p.id&&i.basis===p.basis&&i.payment_id===p.payment_id&&i.quote_id===p.quote_id&&i.intervention_id===p.intervention_id&&i.issuer_key===p.issuer_key&&i.total_cents<=p.total_cents&&i.tax_cents<=p.tax_cents&&canonical(i.issuer)===canonical(p.issuer)&&canonical(i.recipient)===canonical(p.recipient);}
async function stored(db:Awaited<ReturnType<typeof authenticatedClient>>['db'],id:string){
 const result=await db.rpc('customer_invoice_document',{p_id:id});dbError(result.error);const data=z.object({invoice:rowSchema,related:rowSchema.nullable(),credit_notes:z.array(rowSchema).max(50),credit_notes_total:count}).strict().parse(result.data);
 if(data.invoice.id!==id||data.credit_notes.reduce((n,x)=>n+x.total_cents,0)>data.invoice.total_cents||data.credit_notes.reduce((n,x)=>n+x.tax_cents,0)>data.invoice.tax_cents||data.credit_notes.length!==Math.min(data.credit_notes_total,50)||new Set(data.credit_notes.map(n=>n.id)).size!==data.credit_notes.length||data.credit_notes.some(n=>n.kind!=='credit_note'||!relatedValid(n,data.invoice))||(data.invoice.kind==='credit_note'?!data.related||!relatedValid(data.invoice,data.related):data.related!==null))throw Error('Invoice relation unavailable');
 // Shared mapper intentionally receives its exact stored financial fields. The
 // omitted operator request_id/issued_by are neither consumed nor fabricated.
 const document=invoiceDocumentInput(data.invoice as Invoice,data.related?{number:data.related.number}:null);const input=parseInvoicePdfInput({...document,basis:data.invoice.basis});
 return{...data,document,input};
}
async function idFrom(context:Context){const id=z.uuid().safeParse((await context.params).id);if(!id.success)throw new ApiError(404,'Ce document est introuvable.');return id.data.toLowerCase();}
export async function readInvoice(request:Request,context:Context){try{const{db}=await authenticatedClient(request);const id=await idFrom(context);if(new URL(request.url).searchParams.size)throw new ApiError(422,'Paramètres de document invalides.');const d=await stored(db,id);return Response.json({invoice:d.invoice,document:d.document,version:version(d.invoice),links:links(id),related_invoice:d.related?summary(d.related):null,credit_notes:d.credit_notes.map(summary),credit_notes_page:{total:d.credit_notes_total,complete:d.credit_notes_total<=50}},{headers:HEADERS});}catch(e){return failed(e);}}
export async function readInvoicePdf(request:Request,context:Context){try{const{db,user}=await authenticatedClient(request);const id=await idFrom(context);const p=new URL(request.url).searchParams;if([...p.keys()].some(k=>(k!=='inline'&&k!=='link')||p.getAll(k).length!==1||p.get(k)!=='1')||p.size>1)throw new ApiError(422,'Paramètres de téléchargement invalides.');const d=await stored(db,id);const bytes=renderInvoicePdf(d.input);
 // `link=1` (application native) : même contrôle d’accès, réponse par lien signé de 60 secondes.
 if(p.get('link')==='1')return Response.json({url:await renderedPdfLink(user.id,`invoice-${id}`,bytes)},{headers:HEADERS});
 return new Response(bytes,{headers:{...HEADERS,'Content-Type':'application/pdf','Content-Length':String(bytes.byteLength),'Content-Disposition':`${p.get('inline')==='1'?'inline':'attachment'}; filename="${invoicePdfFileName(d.invoice)}"`,'X-Document-Version':version(d.invoice).sha256}});}catch(e){return failed(e);}}

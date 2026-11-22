import { ApiError, authenticatedClient, dbError } from '@/lib/supabase/server';
import { enterpriseOverviewInput as input, enterpriseOverviewSnapshot as snapshot } from '../../../shared/enterprise-overview';
const headers = {'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'};
export async function POST(request:Request) {
  try {
    const url = new URL(request.url);
    if (request.headers.get('origin') !== url.origin && (request.headers.has("origin") || !/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/i.test(request.headers.get('authorization') ?? ''))) throw new ApiError(403,'Origine de la requête non autorisée.');
    if (url.search || Number(request.headers.get('content-length') ?? 0) > 1024) throw new ApiError(422,'Périmètre invalide.');
    const {db} = await authenticatedClient(request);
    const body = await request.text();
    if (Buffer.byteLength(body,'utf8') > 1024) throw new ApiError(422,'Périmètre invalide.');
    let decoded:unknown;
    try { decoded = JSON.parse(body); } catch { throw new ApiError(422,'Périmètre invalide.'); }
    const parsed = input.safeParse(decoded);
    if (!parsed.success) throw new ApiError(422,'Périmètre invalide.');
    const result = await db.rpc('enterprise_overview_counts',{p_organization:parsed.data.organization_id,p_site:parsed.data.site_id});
    dbError(result.error);
    const data = snapshot.parse(result.data);
    if (data.organization_id !== parsed.data.organization_id || data.site_id !== parsed.data.site_id) throw Error('Inconsistent scope');
    return Response.json(data,{headers});
  } catch (error) {
    const status = error instanceof ApiError ? error.status : 503;
    return Response.json({error:error instanceof ApiError ? error.message : 'Les compteurs n’ont pas pu être vérifiés. Réessayez.'},
      {status,headers:{...headers,...(status === 503 ? {'Retry-After':'2'} : {})}});
  }
}

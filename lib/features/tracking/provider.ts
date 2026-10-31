import { z } from "zod";
import type { GeocodeCandidates, TrackingRoute, TrackingSnapshot } from "./types";
export type ProviderReason = "provider_quota" | "provider_timeout" | "provider_unavailable" | "route_unavailable" | "invalid_provider_response";
export class TrackingProviderError extends Error { constructor(public reason: ProviderReason, public retryAfter = 0) { super(reason); } }
const lat=z.number().finite().min(-90).max(90),lon=z.number().finite().min(-180).max(180);
const coordinate=z.tuple([lon,lat]);
const line=z.object({type:z.literal('LineString'),coordinates:z.array(coordinate).min(2).max(10000)}).strict();
const routeSchema=z.object({resource:z.literal('bdtopo-valhalla'),resourceVersion:z.string().regex(/^[\w.-]{1,80}$/),profile:z.literal('car'),optimization:z.literal('fastest'),crs:z.literal('EPSG:4326'),distanceUnit:z.literal('meter'),timeUnit:z.literal('second'),distance:z.number().finite().positive().max(1000000),duration:z.number().finite().positive().max(86400),start:z.string().max(100),end:z.string().max(100),geometry:line});
function snapped(value:string):[number,number]{const parts=value.split(',');if(parts.length!==2 || parts.some(x=>!/^[-+]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(x.trim())))throw new TrackingProviderError('invalid_provider_response');const p=coordinate.safeParse(parts.map(Number));if(!p.success)throw new TrackingProviderError('invalid_provider_response');return p.data;}
/** Great-circle distance is ONLY a snap-validation bound, never the route/ETA fallback. */
export function snapDistance(a:[number,number],b:[number,number]){const r=Math.PI/180,dlat=(b[1]-a[1])*r,dlon=(b[0]-a[0])*r;const h=Math.sin(dlat/2)**2+Math.cos(a[1]*r)*Math.cos(b[1]*r)*Math.sin(dlon/2)**2;return 6371000*2*Math.asin(Math.min(1,Math.sqrt(h)));}
export function parseRoute(value:unknown,s:TrackingSnapshot,at=new Date().toISOString()):TrackingRoute{
 const parsed=routeSchema.safeParse(value);if(!parsed.success)throw new TrackingProviderError('invalid_provider_response');
 const v=parsed.data,t=s.tracking;if(!t.position||!t.destination||!t.session_id)throw new TrackingProviderError('route_unavailable');
 const start=snapped(v.start),end=snapped(v.end);
 if(snapDistance(start,[t.position.longitude,t.position.latitude])>1000 || snapDistance(end,[t.destination.longitude,t.destination.latitude])>1000)throw new TrackingProviderError('route_unavailable');
 if(snapDistance(v.geometry.coordinates[0],start)>100 || snapDistance(v.geometry.coordinates.at(-1)!,end)>100)throw new TrackingProviderError('invalid_provider_response');
 return {state:'available',source:'IGN Géoplateforme / BD TOPO',resource:'bdtopo-valhalla',resource_version:v.resourceVersion,distance_m:v.distance,duration_s:v.duration,calculated_at:at,position_sampled_at:t.position.sampled_at,session_id:t.session_id,control_version:t.control_version,point_seq:t.last_seq,destination_version:t.destination_version,geometry:v.geometry,snapped_start:start,snapped_end:end,traffic:'not_available',attribution:'Itinéraire : IGN / BD TOPO — Licence Ouverte 2.0. Durée estimée hors trafic en temps réel.'};
}
const geocodeSchema=z.object({type:z.literal('FeatureCollection'),features:z.array(z.object({type:z.literal('Feature'),geometry:z.object({type:z.literal('Point'),coordinates:coordinate}),properties:z.object({label:z.string().trim().min(1).max(200),score:z.number().finite().min(0).max(1),type:z.string().regex(/^[\w-]{1,50}$/)})})).max(5)});
export function parseGeocode(value:unknown):GeocodeCandidates{const parsed=geocodeSchema.safeParse(value);if(!parsed.success)throw new TrackingProviderError('invalid_provider_response');return {source:'IGN / BAN',candidates:parsed.data.features.map(f=>({latitude:f.geometry.coordinates[1],longitude:f.geometry.coordinates[0],label:f.properties.label,score:f.properties.score,type:f.properties.type})),attribution:'Géocodage : IGN / BAN — Licence Ouverte 2.0. Point à confirmer.'};}
export async function providerJson(url:URL,fetcher:typeof fetch=fetch):Promise<unknown>{
 // Callers construct fixed endpoints; enforce again here, including no userinfo or arbitrary path.
 if(url.protocol!=='https:'||url.hostname!=='data.geopf.fr'||url.port||url.username||url.password||!['/navigation/itineraire','/geocodage/search'].includes(url.pathname))throw new TrackingProviderError('provider_unavailable');
 const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),5000);
 try{
  const response=await fetcher(url,{method:'GET',redirect:'error',signal:controller.signal,headers:{Accept:'application/json'},cache:'no-store'});
  if(response.status===429){const raw=response.headers.get('Retry-After');throw new TrackingProviderError('provider_quota',raw&&/^\d+$/.test(raw)?Math.min(60,Math.max(1,Number(raw))):30);}
  if(!response.ok)throw new TrackingProviderError(response.status===400||response.status===404?'route_unavailable':'provider_unavailable');
  if(!response.headers.get('Content-Type')?.toLowerCase().includes('application/json') || Number(response.headers.get('Content-Length')||0)>1048576)throw new TrackingProviderError('invalid_provider_response');
  if(!response.body)throw new TrackingProviderError('invalid_provider_response');
  const reader=response.body.getReader();const chunks:Uint8Array[]=[];let size=0;
  try{while(true){const item=await reader.read();if(item.done)break;size+=item.value.byteLength;if(size>1048576){await reader.cancel();throw new TrackingProviderError('invalid_provider_response');}chunks.push(item.value);}}
  finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw new TrackingProviderError('invalid_provider_response');}
 }catch(error){if(error instanceof TrackingProviderError)throw error;throw new TrackingProviderError(controller.signal.aborted?'provider_timeout':'provider_unavailable');}
 finally{clearTimeout(timer);}
}
export function routeUrl(s:TrackingSnapshot){const t=s.tracking;if(!t.position||!t.destination)throw new TrackingProviderError('route_unavailable');const url=new URL('https://data.geopf.fr/navigation/itineraire');url.search=new URLSearchParams({resource:'bdtopo-valhalla',profile:'car',optimization:'fastest',distanceUnit:'meter',timeUnit:'second',geometryFormat:'geojson',crs:'EPSG:4326',getSteps:'false',start:`${t.position.longitude},${t.position.latitude}`,end:`${t.destination.longitude},${t.destination.latitude}`}).toString();return url;}
export function geocodeUrl(query:string){const url=new URL('https://data.geopf.fr/geocodage/search');url.search=new URLSearchParams({q:query,limit:'5',index:'address'}).toString();return url;}

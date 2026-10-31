import { createHash } from "node:crypto";
import { z } from "zod";
import type { TrackingSnapshot } from "./types";
export const uuid = z.uuid();
const timestamp = z.iso.datetime({ offset: true });
const latitude = z.number().finite().min(-90).max(90), longitude = z.number().finite().min(-180).max(180);
const revision = z.number().int().min(0).max(2147483647);
const position = z.object({ latitude, longitude, accuracy_m: z.number().finite().min(1).max(250), sampled_at: timestamp, received_at: timestamp }).strict();
const destination = z.object({ latitude, longitude, label: z.string().min(1).max(200), source: z.enum(["manual", "ign"]), confirmed_by: uuid, confirmed_at: timestamp }).strict();
export const snapshotSchema = z.object({ server_time: timestamp, permissions: z.object({ can_share: z.boolean(), can_confirm_destination: z.boolean() }).strict(), tracking: z.object({ intervention_id: uuid, artisan_id: uuid.nullable(), travel_stage: z.enum(["planned", "en_route", "on_site"]), session_id: uuid.nullable(), control_version: revision, shared: z.boolean(), consent_at: timestamp.nullable(), last_seq: revision, destination_version: revision, position_state: z.enum(["no_position", "fresh", "stale", "stopped"]), position: position.nullable(), destination: destination.nullable() }).strict() }).strict().superRefine((s,ctx)=>{
 const t=s.tracking;
 if((t.position_state==='fresh')!==(t.position!==null) || (t.position && (!t.shared || !t.session_id || !t.artisan_id || !t.consent_at || t.last_seq<1 || t.travel_stage!=='en_route')) || (t.shared && (!t.session_id || !t.artisan_id || !t.consent_at)))ctx.addIssue({code:'custom',message:'Inconsistent tracking snapshot'});
});
const session = z.object({ session_id: uuid }).strict();
export const commandSchema = z.discriminatedUnion("action", [
 z.object({ action: z.literal("start"), expected_version: revision, payload: session.extend({ consent: z.literal(true), consent_policy: z.literal("tracking-v1") }).strict() }).strict(),
 z.object({ action: z.literal("point"), expected_version: revision, payload: session.extend({ seq: revision.min(1), latitude, longitude, accuracy_m: z.number().finite().min(1).max(250), sampled_at: timestamp }).strict() }).strict(),
 z.object({ action: z.literal("stop"), expected_version: revision, payload: session }).strict(),
 z.object({ action: z.literal("arrived"), expected_version: revision, payload: session }).strict(),
 z.object({ action: z.literal("destination"), expected_version: revision, payload: z.union([z.object({ clear: z.literal(true) }).strict(),z.object({ latitude, longitude, label: z.string().trim().min(1).max(200), source: z.enum(["manual","ign"]), candidate_label: z.string().max(200).optional() }).strict()]) }).strict(),
]);
/** Identity and job are essential: a caller can reuse its session UUID on two jobs. */
export function trackingKey(s: TrackingSnapshot, readerId: string, operation: "route" | "geocode", query = "") {
 const t=s.tracking;
 return createHash('sha256').update(JSON.stringify([t.intervention_id,readerId,t.artisan_id,t.session_id,t.control_version,t.last_seq,t.destination_version,operation,query])).digest('hex');
}
export function pointFresh(s: TrackingSnapshot, now=Date.now()) {
 const t=s.tracking,p=t.position;
 return !!(t.shared && t.position_state==='fresh' && t.travel_stage==='en_route' && t.session_id && p && [p.sampled_at,p.received_at].every(v=>{const delta=now-Date.parse(v);return Number.isFinite(delta)&&delta>=-5000&&delta<=60000;}));
}
export function sameRouteContext(a: TrackingSnapshot,b: TrackingSnapshot,reader: string) { return trackingKey(a,reader,'route')===trackingKey(b,reader,'route') && pointFresh(b); }
/** Bounded process cache is an optimisation only; SQL is the shared provider rate authority. */
export class TrackingCache<T> {
 private rows=new Map<string,{value:T;until:number}>();
 constructor(private readonly limit=100,private readonly ttl=30000){}
 get(key:string,now=Date.now()):T|null{const row=this.rows.get(key);if(!row)return null;if(row.until<=now){this.rows.delete(key);return null;}return row.value;}
 set(key:string,value:T,now=Date.now()){this.rows.delete(key);while(this.rows.size>=this.limit){const oldest=this.rows.keys().next().value;if(oldest===undefined)break;this.rows.delete(oldest);}this.rows.set(key,{value,until:now+this.ttl});}
}

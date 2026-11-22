import test from 'node:test';import assert from 'node:assert/strict';import{fakeServerHelpers,loadModule}from'./documents/harness';
const actor='10000000-0000-4000-8000-000000000009';const id=(n:number)=>`20000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const offer=(n:number)=>({id:id(n),category:'socket',city:'Ville QA',postal_code:'972**',urgency:'scheduled',status:'requested',estimate_min_cents:100,estimate_max_cents:200,created_at:'2026-11-06T12:00:00+00:00'});
function setup(data:unknown,error:null|{code:string}=null,authenticated=true){const calls:unknown[]=[];const db={rpc:async(name:string,args:unknown)=>{calls.push({name,args});return{data,error}}};const m=loadModule('app/api/artisan/missions/route.ts',{'@/lib/supabase/server':fakeServerHelpers({authenticated,db})});return{get:m.GET as(r:Request)=>Promise<Response>,calls};}
const req=(suffix='')=>new Request('https://app.test/api/artisan/missions'+suffix);
test('51 RPC rows become 50 anonymized offers and a current-identity cursor; next call passes exact tuple',async()=>{const a=setup({eligible:true,captured_at:'2026-11-06T12:30:00Z',items:Array.from({length:51},(_,i)=>offer(i+1))});let r=await a.get(req());assert.equal(r.status,200);assert.match(r.headers.get('cache-control')!,/private.*no-store/);const b=await r.json();assert.equal(b.items.length,50);assert.equal(b.page.has_more,true);assert.equal(b.items[0].address,undefined);const cursor=JSON.parse(Buffer.from(b.page.next_cursor,'base64url').toString());assert.deepEqual(cursor,{actor_id:actor,created_at:offer(50).created_at,id:id(50)});const next=setup({eligible:true,captured_at:'2026-11-06T12:30:00Z',items:[offer(51)]});r=await next.get(req('?cursor='+b.page.next_cursor));assert.equal(r.status,200);assert.deepEqual(JSON.parse(JSON.stringify(next.calls)),[{name:'available_missions_page',args:{p_after_at:offer(50).created_at,p_after_id:id(50),p_id:null}}]);assert.equal((await r.json()).page.has_more,false);});
test('foreign or malformed cursor and duplicate/unexpected queries refused before RPC',async()=>{for(const suffix of ['?cursor=bad','?cursor=','?x=1','?cursor=a&cursor=b','?cursor='+Buffer.from(JSON.stringify({actor_id:id(9),id:id(1),created_at:offer(1).created_at})).toString('base64url')]){const a=setup(null);assert.equal((await a.get(req(suffix))).status,422);assert.equal(a.calls.length,0);}});
test('malformed, excess, duplicate, out of order or private extra fields cannot become a feed',async()=>{for(const items of [null,Array.from({length:52},(_,i)=>offer(i+1)),[offer(1),offer(1)],[offer(2),offer(1)],[{...offer(1),address:'private'}],[{...offer(1),postal_code:'97200'}]]){const a=setup({eligible:true,captured_at:'2026-11-06T12:30:00Z',items});const r=await a.get(req());assert.equal(r.status,503);assert.equal(r.headers.get('retry-after'),'2');}const a=setup({eligible:false,captured_at:'2026-11-06T12:30:00Z',items:[offer(1)]});assert.equal((await a.get(req())).status,503);});
test('unavailable is explicit empty eligibility; auth and permission failures retain private headers',async()=>{const a=setup({eligible:false,captured_at:'2026-11-06T12:30:00Z',items:[]});const r=await a.get(req());assert.equal(r.status,200);const b=await r.json();assert.equal(b.eligible,false);assert.equal(b.page.has_more,false);for(const[auth,error,status]of [[false,null,401],[true,{code:'42501'},403]]as const){const x=setup(null,error,auth);const r=await x.get(req());assert.equal(r.status,status);assert.match(r.headers.get('cache-control')!,/private.*no-store/);}});

test('point read remains anonymized and unavailable is a nondisclosing404',async()=>{const a=setup({eligible:true,captured_at:'2026-11-06T12:30:00Z',items:[offer(111)]});assert.equal((await a.get(req('?id='+id(111)))).status,200);assert.equal((a.calls[0]as any).args.p_id,id(111));for(const data of [{eligible:true,captured_at:'2026-11-06T12:30:00Z',items:[]},{eligible:false,captured_at:'2026-11-06T12:30:00Z',items:[]}])assert.equal((await setup(data).get(req('?id='+id(111)))).status,404);assert.equal((await setup(null).get(req('?id='+id(111)+'&cursor=x'))).status,422);assert.equal((await setup(null).get(req('?id=invalid'))).status,422);assert.equal((await setup({eligible:true,captured_at:'2026-11-06T12:30:00Z',items:[offer(1)]}).get(req('?id='+id(111)))).status,503);});

test('cursor UUID casing is normalized before ordering and binding',async()=>{const cursor=Buffer.from(JSON.stringify({actor_id:actor.toUpperCase(),created_at:offer(1).created_at,id:id(1).toUpperCase()})).toString('base64url');const a=setup({eligible:true,captured_at:'2026-11-06T12:30:00Z',items:[offer(2)]});assert.equal((await a.get(req('?cursor='+cursor))).status,200);assert.equal((a.calls[0]as any).args.p_after_id,id(1));});

const rankedOffer = (n: number, band: number | null) => ({ ...offer(n), distance_band_km: band });
const rankedData = (items: unknown[]) => ({ eligible: true, captured_at: '2026-11-06T12:30:00Z', items, radius_version: 3 });

test('nearest feed pages within its radius version, including offers with unknown distance', async () => {
  const first = setup(rankedData(Array.from({ length: 51 }, (_, i) => rankedOffer(i + 1, i < 49 ? 5 : null))));
  const response = await first.get(req('?order=nearest'));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.order, 'nearest_first');
  assert.equal(body.distance, 'commune_centre_bands');
  assert.equal(body.radius_version, 3);
  assert.equal(body.items.length, 50);
  const cursor = body.page.next_cursor;
  assert.deepEqual(JSON.parse(Buffer.from(cursor, 'base64url').toString()), {
    actor_id: actor, created_at: offer(50).created_at, id: id(50), distance_band_km: null, radius_version: 3,
  });
  const next = setup(rankedData([rankedOffer(51, null)]));
  const second = await next.get(req(`?order=nearest&cursor=${cursor}`));
  assert.equal(second.status, 200);
  assert.equal((await second.json()).radius_version, 3);
  assert.deepEqual(JSON.parse(JSON.stringify(next.calls)), [{ name: 'available_missions_by_distance', args: {
    p_after_at: offer(50).created_at, p_after_id: id(50), p_after_km_band: null, p_radius_version: 3,
  } }]);
  assert.equal((await next.get(req(`?cursor=${cursor}`))).status, 422);
  assert.equal((await setup(null, { code: '22023' }).get(req(`?order=nearest&cursor=${cursor}`))).status, 422);
  const staleResult = setup({ ...rankedData([rankedOffer(51, null)]), radius_version: 4 });
  assert.equal((await staleResult.get(req(`?order=nearest&cursor=${cursor}`))).status, 503);
});

test('nearest feed rejects improper bands, private projection and reversed order', async () => {
  for (const items of [[rankedOffer(1, 6)], [rankedOffer(1, null), rankedOffer(2, 5)], [{ ...rankedOffer(1, 5), address: 'private' }]]) {
    assert.equal((await setup(rankedData(items)).get(req('?order=nearest'))).status, 503);
  }
  const ordered = [{ ...rankedOffer(2, 5), created_at: '2026-11-06T12:00:00.000001Z' }, { ...rankedOffer(1, 5), created_at: '2026-11-06T12:00:00.000002Z' }];
  assert.equal((await setup(rankedData(ordered)).get(req('?order=nearest'))).status, 200);
  assert.equal((await setup(rankedData(ordered.toReversed())).get(req('?order=nearest'))).status, 503);
  assert.equal((await setup(null).get(req(`?order=nearest&id=${id(1)}`))).status, 422);
});

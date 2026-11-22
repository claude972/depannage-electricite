import test from 'node:test';
import assert from 'node:assert/strict';
import { loadModule, ApiError } from './documents/harness';
const uid = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const actor = uid(1), org = uid(2), site = uid(3);
const row = (n: number) => ({
  id: uid(n), quote_id: uid(4), site_id: site, status: 'pending', note: '', decided_by: null,
  created_at: '2026-11-07T12:00:00.123456Z', decided_at: null, private_extra: 'PRIVATE',
  site: { id: site, name: 'QA', organization_id: org, address: 'PRIVATE' },
  quote: { id: uid(4), intervention_id: uid(5), total_cents: 10000, status: 'sent',
    intervention: { id: uid(5), site_id: site, category: 'panel', status: 'quoted', address: 'PRIVATE' } },
});
type Options = { rows?: unknown[]; rules?: unknown[]; role?: string; noMember?: boolean; hidden?: boolean; revoke?: boolean; roleRevoke?: boolean; failRule?: boolean; anonymous?: boolean };
function setup(o: Options = {}) {
  const calls: unknown[][] = []; let read = false;
  const db = { from(table: string) {
    calls.push(['from', table]); const chain: any = {};
    for (const method of ['select', 'eq', 'in', 'or', 'order']) chain[method] = (...args: unknown[]) => { calls.push([method, ...args]); return chain; };
    chain.maybeSingle = async () => ({ error: null, data: table === 'profiles' ? { role: o.roleRevoke && read ? 'client' : o.role ?? 'manager' } : o.noMember ? null : { organization_id: org, user_id: actor } });
    chain.limit = async (limit: number) => {
      calls.push(['limit', table, limit]);
      if (table === 'sites') return { error: null, data: o.hidden || (o.revoke && read) ? [] : [{ id: site, organization_id: org }] };
      if (table === 'approval_rules') return { error: o.failRule ? { code: 'XX000' } : null, data: o.rules ?? [] };
      read = true; return { error: null, data: o.rows ?? [] };
    };
    return chain;
  } };
  const stubs = { '@/lib/supabase/server': { ApiError, authenticatedClient: async () => { if (o.anonymous) throw new ApiError(401, 'Session'); return { db, user: { id: actor } }; }, dbError: (e: unknown) => { if (e) throw new ApiError(503, 'Indisponible'); } } };
  const list = loadModule('app/api/enterprise/approvals/route.ts', stubs) as any;
  const detail = loadModule('app/api/enterprise/approvals/[id]/route.ts', stubs) as any;
  return { calls,
    list: (query = '') => list.GET(new Request('https://example.test/api/enterprise/approvals?organization_id=' + org + query)),
    detail: (id = uid(9), query = '') => detail.GET(new Request('https://example.test/api/enterprise/approvals/' + id + '?organization_id=' + org + query), { params: Promise.resolve({ id }) }),
  };
}
test('list projection/keyset/filter, bound cursor, timestamps retain microseconds', async () => {
  const h = setup({ rows: Array.from({ length: 51 }, (_, n) => row(300 - n)) });
  const response = await h.list(); assert.equal(response.status, 200);
  const body = await response.json(); assert.equal(body.items.length, 50); assert.equal(body.page.has_more, true);
  assert.ok(!JSON.stringify(body).includes('PRIVATE'));
  assert.deepEqual(Object.keys(body.items[0]).sort(), ['id','quote_id','site_id','status','note','decided_by','created_at','decided_at','site','quote','intervention'].sort());
  assert.deepEqual(Object.keys(body.items[0].intervention).sort(), ['category','id','status']);
  const next = setup({ rows: [row(250)] }); assert.equal((await next.list('&cursor=' + body.page.next_cursor)).status, 200);
  assert.ok(next.calls.some(c => c[0] === 'or' && String(c[1]).includes('.123456Z')));
  for (const query of ['&status=approved', '&site_id='+site]) assert.equal((await setup().list(query + '&cursor=' + body.page.next_cursor)).status, 422);
  for (const patch of [{ actor: uid(8) }, { org: uid(8) }]) {
    const raw = JSON.parse(Buffer.from(body.page.next_cursor, 'base64url').toString());
    const cursor = Buffer.from(JSON.stringify({ ...raw, ...patch })).toString('base64url');
    assert.equal((await setup().list('&cursor='+cursor)).status,422);
  }
  assert.equal((await setup({rows:[{...row(9),created_at:'2026-11-07T12:00:00.123457Z'},row(10)]}).list()).status,200);
});
test('exact old approval/rule, proven absence only, wrong joins fail closed', async () => {
  const h = setup({ rows: [row(9)], rules: [{site_id:site,enabled:true,required_role:'owner',threshold_cents:10000,extra:'PRIVATE'}] });
  const response = await h.detail(); assert.equal(response.status,200);
  const b = await response.json(); assert.equal(b.approval.id,uid(9)); assert.deepEqual(b.rule,{enabled:true,required_role:'owner',threshold_cents:10000});
  assert.equal((await (await setup({rows:[row(9)]}).detail()).json()).rule,null);
  assert.equal((await setup({rows:[row(9)],failRule:true}).detail()).status,503);
  assert.equal((await setup({rows:[row(9)],rules:[{site_id:uid(20),enabled:true,required_role:'owner',threshold_cents:0}]}).detail()).status,503);
  assert.equal((await setup().detail()).status,404);
  assert.equal((await setup({rows:[row(10)]}).detail()).status,503);
  for (const rows of [[row(9),row(9)],[row(8),row(9)],[{...row(9),site_id:uid(99)}],[{...row(9),quote_id:uid(99)}]]) assert.equal((await setup({rows}).list()).status,503);
});
test('roles, current membership/site withdrawal, parameters and private empty responses', async () => {
  assert.equal((await setup({anonymous:true}).list()).status,401);
  for (const role of ['client','artisan','admin']) assert.equal((await setup({role}).list()).status,403);
  assert.equal((await setup({noMember:true}).list()).status,404);
  assert.equal((await setup({hidden:true}).list('&site_id='+site)).status,404);
  assert.equal((await setup({rows:[row(9)],revoke:true}).list()).status,404);
  assert.equal((await setup({rows:[row(9)],roleRevoke:true}).detail()).status,403);
  for(const query of ['&status=bad','&limit=50','&cursor=bad','&site_id=bad','&organization_id='+org]) assert.equal((await setup().list(query)).status,422);
  assert.equal((await setup().detail(uid(9),'&status=all')).status,422);
  const empty=await setup().list();assert.equal(empty.headers.get('cache-control'),'private, no-store');assert.deepEqual(await empty.json(),{items:[],page:{limit:50,has_more:false,next_cursor:null}});
  assert.equal((await setup({rows:[row(9)],failRule:true}).detail()).headers.get('retry-after'),'2');
});

test('approved and rejected filters preserve exact historical status',async()=>{
 for(const status of ['approved','rejected']){const h=setup({rows:[{...row(9),status,decided_by:actor,decided_at:'2026-11-07T12:01:00Z',note:'QA'}]});const r=await h.list('&status='+status);assert.equal(r.status,200);assert.equal((await r.json()).items[0].status,status);assert.ok(h.calls.some(c=>c[0]==='eq'&&c[1]==='status'&&c[2]===status));}
 assert.equal((await setup({rows:[row(9)]}).list('&status=approved')).status,503);
});

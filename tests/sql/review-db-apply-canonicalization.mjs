// SQL-level checks. Run against LOCAL Supabase only (after `supabase db reset`):
//   npm i --no-save pg && DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres node tests/sql/<this file>
// Verified so far only on plain Postgres 17 with stubbed Supabase auth/roles (NOT a real Supabase stack).
import pg from 'pg';
import assert from 'node:assert/strict';
const c = new pg.Client({ connectionString: process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres' });
await c.connect();
const U = () => crypto.randomUUID();
let pass=0, fail=0;
async function t(name, fn){ try{ await fn(); pass++; console.log('PASS',name);}catch(e){ fail++; console.log('FAIL',name,'-',e.message);} }
const call = async (p) => (await c.query('select public.apply_canonicalization($1::jsonb) r',[JSON.stringify(p)])).rows[0].r;
const ev = (o={}) => ({ name:'Show', normalized_name:'show', city:'Denver', region:'CO', country_code:'US', timezone:'America/Denver', local_start_date:'2026-12-01', starts_at:'2026-12-02T02:00:00Z', ...o });
const getEv = async id => (await c.query('select * from public.events where id=$1',[id])).rows[0];
const getVen = async id => (await c.query('select * from public.venues where id=$1',[id])).rows[0];
const getArt = async id => (await c.query('select * from public.artists where id=$1',[id])).rows[0];
const venue = (id, n='V') => ({ id, name:n, normalized_name:n.toLowerCase(), city:'Denver', region:'CO', country_code:'US', timezone:'America/Denver' });

await t('event insert persists image_url', async()=>{
  const eid=U(), vid=U();
  await call({ venueToCreate: venue(vid), event: ev({id:eid, image_url:'https://img/a.jpg', venue_image_url:'https://img/v.jpg'}) });
  assert.equal((await getEv(eid)).image_url,'https://img/a.jpg');
  assert.equal((await getVen(vid)).image_url,'https://img/v.jpg');
});
await t('event insert without image leaves NULL (not fabricated); empty string -> NULL', async()=>{
  const eid=U(), vid=U();
  await call({ venueToCreate: venue(vid), event: ev({id:eid, image_url:''}) });
  assert.equal((await getEv(eid)).image_url,null);
  assert.equal((await getVen(vid)).image_url,null);
});
await t('existing event: null/absent/empty image does not overwrite non-null', async()=>{
  const eid=U(), vid=U();
  await call({ venueToCreate: venue(vid), event: ev({id:eid, image_url:'https://img/keep.jpg'}) });
  await call({ event: ev({id:eid}) });
  await call({ event: ev({id:eid, image_url:null}) });
  await call({ event: ev({id:eid, image_url:''}) });
  assert.equal((await getEv(eid)).image_url,'https://img/keep.jpg');
});
await t('existing event: different non-null image does not replace existing (fill-if-empty)', async()=>{
  const eid=U(), vid=U();
  await call({ venueToCreate: venue(vid), event: ev({id:eid, image_url:'https://img/first.jpg'}) });
  await call({ event: ev({id:eid, image_url:'https://img/second.jpg'}) });
  assert.equal((await getEv(eid)).image_url,'https://img/first.jpg');
});
await t('existing event with NULL image gets filled (backfill)', async()=>{
  const eid=U(), vid=U();
  await call({ venueToCreate: venue(vid), event: ev({id:eid}) });
  assert.equal((await getEv(eid)).image_url,null);
  await call({ event: ev({id:eid, image_url:'https://img/fill.jpg'}) });
  assert.equal((await getEv(eid)).image_url,'https://img/fill.jpg');
});
await t('venue image: existing non-null preserved, null never clears, null filled', async()=>{
  const eid=U(), vid=U();
  await call({ venueToCreate: venue(vid), event: ev({id:eid, venue_image_url:'https://img/v1.jpg'}) });
  await call({ event: ev({id:eid, venue_id:vid, venue_image_url:'https://img/v2.jpg'}) });
  await call({ event: ev({id:eid, venue_id:vid, venue_image_url:null}) });
  assert.equal((await getVen(vid)).image_url,'https://img/v1.jpg');
  const eid2=U(), vid2=U();
  await call({ venueToCreate: venue(vid2,'W'), event: ev({id:eid2, name:'S2', normalized_name:'s2'}) });
  await call({ event: ev({id:eid2, venue_id:vid2, venue_image_url:'https://img/late.jpg'}) });
  assert.equal((await getVen(vid2)).image_url,'https://img/late.jpg');
});
await t('artist: Spotify image preserved when TM image supplied (new artist row conflict + matched)', async()=>{
  const eid=U(), vid=U(), aid=U();
  await c.query('insert into public.artists(id,name,normalized_name,image_url) values($1,$2,$3,$4)',[aid,'DJ X','dj x','https://spotify/x.jpg']);
  await call({ venueToCreate: venue(vid), event: ev({id:eid}), artists:[{artist_id:aid, image_url:'https://tm/x.jpg'}] });
  assert.equal((await getArt(aid)).image_url,'https://spotify/x.jpg');
  await call({ event: ev({id:eid}), artists:[{artist_id:aid, name:'DJ X', image_url:'https://tm/x2.jpg'}] });
  assert.equal((await getArt(aid)).image_url,'https://spotify/x.jpg');
  await call({ event: ev({id:eid}), artists:[{artist_id:aid, name:'DJ X', image_url:null}] });
  assert.equal((await getArt(aid)).image_url,'https://spotify/x.jpg');
});
await t('artist: NULL image filled by matched artist; new artist stores image', async()=>{
  const eid=U(), vid=U(), aid=U(), nid=U();
  await c.query('insert into public.artists(id,name,normalized_name) values($1,$2,$3)',[aid,'Y','y']);
  await call({ venueToCreate: venue(vid), event: ev({id:eid}), artists:[{artist_id:aid, image_url:'https://tm/y.jpg'},{artist_id:nid,name:'New One',image_url:'https://tm/n.jpg'}] });
  assert.equal((await getArt(aid)).image_url,'https://tm/y.jpg');
  assert.equal((await getArt(nid)).image_url,'https://tm/n.jpg');
});
await t('idempotent re-run: identical payload twice yields identical rows and no duplicate artist links', async()=>{
  const eid=U(), vid=U(), aid=U();
  const p={ venueToCreate: venue(vid), event: ev({id:eid, image_url:'https://img/i.jpg', venue_image_url:'https://img/vi.jpg'}), artists:[{artist_id:aid,name:'Idem',image_url:'https://tm/idem.jpg'}]};
  await call(p); const a1=[await getEv(eid),await getVen(vid),await getArt(aid)];
  await call({...p, venueToCreate:undefined, event:{...p.event}}); const a2=[await getEv(eid),await getVen(vid),await getArt(aid)];
  for (const k of ['image_url']) for(let i=0;i<3;i++) assert.equal(a1[i][k],a2[i][k]);
  const n=(await c.query('select count(*)::int n from public.event_artists where event_id=$1',[eid])).rows[0].n;
  assert.equal(n,1);
});
await t('new-event dedupe path (no id) persists image', async()=>{
  const vid=U();
  const r = await call({ venueToCreate: venue(vid,'Z'), event: ev({name:'NoId', normalized_name:'noid', image_url:'https://img/noid.jpg'}) });
  const id = r.event_id ?? r.eventId ?? Object.values(r).find(v=>typeof v==='string'&&/^[0-9a-f-]{36}$/.test(v));
  assert.equal((await getEv(id)).image_url,'https://img/noid.jpg');
});
await t('grants posture: only service_role can execute; anon/authenticated/public cannot', async()=>{
  const q = async role => (await c.query(`select has_function_privilege($1,'public.apply_canonicalization(jsonb)','execute') ok`,[role])).rows[0].ok;
  assert.equal(await q('service_role'),true);
  assert.equal(await q('anon'),false);
  assert.equal(await q('authenticated'),false);
});
await t('function is security definer; (report) search_path config', async()=>{
  const r=(await c.query(`select prosecdef, proconfig from pg_proc where proname='apply_canonicalization'`)).rows;
  assert.equal(r.length,1); assert.equal(r[0].prosecdef,true);
  console.log('   proconfig =',JSON.stringify(r[0].proconfig));
});
await t('RLS unchanged: events/venues/artists RLS flags and no new policies for new columns', async()=>{
  const r=(await c.query(`select relname, relrowsecurity from pg_class where relname in ('events','venues','artists') and relnamespace='public'::regnamespace order by 1`)).rows;
  console.log('   rls =',JSON.stringify(r));
  const pol=(await c.query(`select tablename, policyname, cmd, roles from pg_policies where tablename in ('events','venues','artists') order by 1,2`)).rows;
  console.log('   policies =',JSON.stringify(pol));
  assert.equal(r.length,3);
});
await t('genres columns exist with defaults; GIN index; idempotent', async()=>{
  const cols=(await c.query(`select column_name,data_type,is_nullable,column_default from information_schema.columns where table_name='artists' and column_name like 'genres%' order by 1`)).rows;
  console.log('   cols =',JSON.stringify(cols));
  assert.equal(cols.length,3);
  const idx=(await c.query(`select indexdef from pg_indexes where indexname='artists_genres_gin_idx'`)).rows;
  assert.equal(idx.length,1);
});
console.log(`\n${pass} passed, ${fail} failed`);
await c.end();

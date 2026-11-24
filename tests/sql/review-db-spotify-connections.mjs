// SQL-level checks. Run against LOCAL Supabase only (after `supabase db reset`):
//   npm i --no-save pg && DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres node tests/sql/<this file>
// Verified so far only on plain Postgres 17 with stubbed Supabase auth/roles (NOT a real Supabase stack).
import pg from 'pg';
import assert from 'node:assert/strict';
const c = new pg.Client({ connectionString: process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres' });
await c.connect();
let pass=0, fail=0;
async function t(n,f){ try{ await f(); pass++; console.log('PASS',n);}catch(e){ fail++; console.log('FAIL',n,'-',e.message);} }
const as = async (uid, role, sql, params=[]) => {
  await c.query('begin');
  try {
    await c.query(`set local role ${role}`);
    await c.query(`select set_config('request.jwt.claim.sub',$1,true), set_config('request.jwt.claim.role',$2,true)`,[uid??'',role]);
    const r = await c.query(sql, params);
    await c.query('commit');
    return r;
  } catch(e){ await c.query('rollback'); throw e; }
};
const U1=crypto.randomUUID(), U2=crypto.randomUUID(), A=crypto.randomUUID();
await c.query('insert into auth.users(id,email) values($1,$2),($3,$4)',[U1,'a@x.io',U2,'b@x.io']);
await c.query('insert into public.artists(id,name,normalized_name,genres,genres_source) values($1,$2,$3,$4,$5)',[A,'DJ','dj',['house'],'spotify']);
const conn = (u,acct)=>c.query(`insert into public.user_spotify_connections(user_id,spotify_account_id,encrypted_access_token,encrypted_refresh_token,token_expires_at,reauthorization_deadline,scopes) values($1,$2,'enc-a','enc-r',now()-interval '1 hour',now()+interval '30 days',array['user-top-read'])`,[u,acct]);
await conn(U1,'sp1'); await conn(U2,'sp2');
await c.query(`insert into public.user_artist_preferences(user_id,artist_id,artist_name,normalized_artist_name,preference_level) values($1,$2,'DJ','dj','favorite')`,[U1,A]);

await t('anon cannot read connections or preferences', async()=>{
  let denied=false; try{ const r=await as(null,'anon','select * from public.user_spotify_connections'); denied = r.rows.length===0; }catch{ denied=true; }
  assert.ok(denied);
  let d2=false; try{ const r=await as(null,'anon','select * from public.user_artist_preferences'); d2=r.rows.length===0; }catch{ d2=true; }
  assert.ok(d2);
});
await t('zero-client RLS: authenticated users cannot read ANY connection row (tokens never client-visible); preferences are own-only', async()=>{
  const r=await as(U2,'authenticated','select user_id from public.user_spotify_connections');
  assert.equal(r.rows.length,0);
  const p=await as(U2,'authenticated','select * from public.user_artist_preferences');
  assert.equal(p.rows.length,0);
  const own=await as(U1,'authenticated','select user_id from public.user_artist_preferences');
  assert.deepEqual(own.rows.map(x=>x.user_id),[U1]);
});
await t('expired token (token_expires_at in past) does not remove preferences or the row', async()=>{
  const r=await c.query(`select count(*)::int n from public.user_spotify_connections where user_id=$1 and token_expires_at<now()`,[U1]);
  assert.equal(r.rows[0].n,1);
  const p=await c.query('select count(*)::int n from public.user_artist_preferences where user_id=$1',[U1]);
  assert.equal(p.rows[0].n,1);
});
await t("authenticated client cannot delete a connection row (service-role only)", async()=>{
  let n=0; try{ n=(await as(U2,'authenticated',`delete from public.user_spotify_connections where user_id=$1`,[U1])).rowCount; }catch{ n=0; }
  assert.equal(n,0);
  assert.equal((await c.query('select 1 from public.user_spotify_connections where user_id=$1',[U1])).rowCount,1);
});
await t('disconnect (delete connection) removes the token row and keeps manual preferences + catalog genres', async()=>{
  await c.query('delete from public.user_spotify_connections where user_id=$1',[U1]);
  assert.equal((await c.query('select 1 from public.user_spotify_connections where user_id=$1',[U1])).rowCount,0);
  assert.equal((await c.query('select 1 from public.user_artist_preferences where user_id=$1',[U1])).rowCount,1);
  assert.deepEqual((await c.query('select genres from public.artists where id=$1',[A])).rows[0].genres,['house']);
});
await t('reconnect after disconnect works (no leftover unique violation)', async()=>{ await conn(U1,'sp1'); });
await t('deleting the auth user cascades connection+preferences (account deletion wipes tokens)', async()=>{
  await c.query('delete from auth.users where id=$1',[U1]);
  assert.equal((await c.query('select 1 from public.user_spotify_connections where user_id=$1',[U1])).rowCount,0);
  assert.equal((await c.query('select 1 from public.user_artist_preferences where user_id=$1',[U1])).rowCount,0);
});
console.log(`\n${pass} passed, ${fail} failed`);
await c.end();

import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { createRequestHash } from '../src/goals/store.ts';
import { setup, signedInClient } from './helpers/stack.ts';

const body = { title: '併用検証', unit: 'minutes', totalRequired: 3000, sessionAmount: 25, timezone: 'Asia/Tokyo' } as const;
const legacyHash = (input: typeof body) => createHash('sha256')
  .update(JSON.stringify({
    title: input.title,
    unit: input.unit,
    totalRequired: input.totalRequired,
    sessionAmount: input.sessionAmount,
    initialProgress: 0,
    timezone: input.timezone,
    questionPrior: { a: null, b: null },
  }))
  .digest('hex');
const NOW = new Date('2026-10-05T15:30:00Z');
const code = (r: {json: Record<string,unknown>|null}) => (r.json?.error as {code?:string}|undefined)?.code;

test('163+175: create hashは期限日を照合し、省略とnullだけを同値にする', () => {
  assert.equal(createRequestHash(body), createRequestHash({...body,targetDate:null}));
  assert.equal(createRequestHash(body),legacyHash(body),"175の既存成功台帳hashを保つ");
  assert.notEqual(createRequestHash({...body,targetDate:'2026-10-07'}),createRequestHash({...body,targetDate:'2026-10-08'}));
  assert.notEqual(createRequestHash(body),createRequestHash({...body,targetDate:'2026-10-07'}));
});

test('163+175: 同keyで期限日だけ違うbodyは409で、副作用を残さない', async t => {
  const {db,stack}=await setup(t,{now:()=>NOW});
  const a=await signedInClient(stack.app,'pair-key');
  const key=randomUUID();
  const h={'idempotency-key':key};
  const created=await a.rawCall('POST','/api/goals',{...body,targetDate:'2026-10-07'},h);
  assert.equal(created.status,201,created.body);
  const different=await a.rawCall('POST','/api/goals',{...body,targetDate:'2026-10-08'},h);
  assert.equal(different.status,409,different.body);
  assert.equal(code(different),'IDEMPOTENCY_CONFLICT');
  assert.equal((await db.pool.query('select count(*)::int as n from goal')).rows[0].n,1);
  assert.equal((await db.pool.query('select count(*)::int as n from goal_create_operation')).rows[0].n,1);
  const replay=await a.rawCall('POST','/api/goals',{...body,targetDate:'2026-10-07'},h);
  assert.equal(replay.status,200,replay.body);
  assert.equal(replay.json?.id,created.json?.id);
  assert.equal(replay.headers['idempotency-replayed'],'true');
});

test('163+175: 成功済み作成は日付跨ぎ後も元bodyで現在DTOをreplayし、新しい過去日作成は422', async t => {
  let now=new Date('2026-10-05T00:00:00Z');
  const {db,stack}=await setup(t,{now:()=>now});
  const a=await signedInClient(stack.app,'pair-replay');
  const h={'idempotency-key':randomUUID()};
  const original={...body,targetDate:'2026-10-06'};
  const created=await a.rawCall('POST','/api/goals',original,h);
  assert.equal(created.status,201,created.body);
  const id=created.json?.id;
  now=new Date('2026-10-07T00:00:00Z');
  const replay=await a.rawCall('POST','/api/goals',original,h);
  assert.equal(replay.status,200,replay.body);
  assert.equal(replay.json?.id,id);
  assert.equal(replay.json?.targetDate,original.targetDate);
  const changed=await a.rawCall('PATCH','/api/goals/'+id,{title:'期限経過後の名前',expectedGoalSettingsRevision:0});
  assert.equal(changed.status,200,changed.body);
  assert.equal(changed.json?.targetDate,original.targetDate);
  const replayEdited=await a.rawCall('POST','/api/goals',original,h);
  assert.equal(replayEdited.status,200,replayEdited.body);
  assert.equal(replayEdited.json?.title,'期限経過後の名前');
  assert.equal(replayEdited.json?.goalSettingsRevision,1);
  const invalid=await a.rawCall('POST','/api/goals',original,{'idempotency-key':randomUUID()});
  assert.equal(invalid.status,422,invalid.body);
  assert.equal((await db.pool.query('select count(*)::int as n from goal_create_operation')).rows[0].n,1);
});

test('163+175: POST省略/nullは同keyで同値。PATCH期限日変更/削除は版を増やし、省略/no-opは維持', async t => {
  const {db,stack}=await setup(t,{now:()=>NOW});
  const a=await signedInClient(stack.app,'pair-null');
  const h={'idempotency-key':randomUUID()};
  const created=await a.rawCall('POST','/api/goals',body,h);
  assert.equal(created.status,201,created.body);
  const id=created.json?.id;
  const url='/api/goals/'+id;
  const nullReplay=await a.rawCall('POST','/api/goals',{...body,targetDate:null},h);
  assert.equal(nullReplay.status,200,nullReplay.body);
  assert.equal(nullReplay.json?.id,id);
  assert.equal(nullReplay.json?.targetDate,null);
  const updated=await a.rawCall('PATCH',url,{targetDate:'2026-10-07',expectedGoalSettingsRevision:0});
  assert.equal(updated.status,200,updated.body);
  assert.equal(updated.json?.targetDate,'2026-10-07');
  assert.equal(updated.json?.goalSettingsRevision,1);
  const before=(await db.pool.query('select updated_at from goal where id=$1',[id])).rows[0].updated_at;
  const noop=await a.rawCall('PATCH',url,{targetDate:'2026-10-07',expectedGoalSettingsRevision:1});
  assert.equal(noop.status,200,noop.body);
  assert.equal(noop.json?.goalSettingsRevision,1);
  assert.deepEqual((await db.pool.query('select updated_at from goal where id=$1',[id])).rows[0].updated_at,before);
  const stale=await a.rawCall('PATCH',url,{targetDate:'2026-10-08',title:'stale',expectedGoalSettingsRevision:0});
  assert.equal(stale.status,409,stale.body);
  assert.equal(code(stale),'GOAL_SETTINGS_CONFLICT');
  const oldLog=await a.rawCall('PUT',url+'/logs/2026-10-06',{status:'DONE',amount:25,expectedGoalSettingsRevision:0});
  assert.equal(oldLog.status,409,oldLog.body);
  const retained=await a.rawCall('PATCH',url,{title:'名前だけ',expectedGoalSettingsRevision:1});
  assert.equal(retained.status,200,retained.body);
  assert.equal(retained.json?.targetDate,'2026-10-07');
  assert.equal(retained.json?.goalSettingsRevision,2);
  const cleared=await a.rawCall('PATCH',url,{targetDate:null,expectedGoalSettingsRevision:2});
  assert.equal(cleared.status,200,cleared.body);
  assert.equal(cleared.json?.targetDate,null);
  assert.equal(cleared.json?.goalSettingsRevision,3);
  const clearAgain=await a.rawCall('PATCH',url,{targetDate:null,expectedGoalSettingsRevision:3});
  assert.equal(clearAgain.status,200,clearAgain.body);
  assert.equal(clearAgain.json?.goalSettingsRevision,3);
});

test('163+175: timezone+期限日同時変更は新timezoneで検査し、409/422は全体不変', async t => {
  const {stack}=await setup(t,{now:()=>NOW});
  const a=await signedInClient(stack.app,'pair-zone');
  const created=await a.rawCall('POST','/api/goals',body,{'idempotency-key':randomUUID()});
  assert.equal(created.status,201,created.body);
  const url='/api/goals/'+created.json?.id;
  const accepted=await a.rawCall('PATCH',url,{timezone:'America/Los_Angeles',targetDate:'2026-10-06',expectedGoalSettingsRevision:0});
  assert.equal(accepted.status,200,accepted.body);
  assert.equal(accepted.json?.goalSettingsRevision,1);
  const before=(await a.rawCall('GET',url)).json;
  const stale=await a.rawCall('PATCH',url,{title:'古い設定',timezone:'Asia/Tokyo',targetDate:'2026-10-06',expectedGoalSettingsRevision:0});
  assert.equal(stale.status,409,stale.body);
  const invalid=await a.rawCall('PATCH',url,{title:'保存しない',timezone:'Asia/Tokyo',targetDate:'2026-10-06',expectedGoalSettingsRevision:1});
  assert.equal(invalid.status,422,invalid.body);
  assert.deepEqual((await a.rawCall('GET',url)).json,before);
});

test('163+175: 175で保存した未設定日の旧hash台帳は、期限日編集後も元bodyで同じGoalを返す', async t => {
 const {db,stack}=await setup(t,{now:()=>NOW});
  const a=await signedInClient(stack.app,'pair-legacy');
  const key=randomUUID(),h={'idempotency-key':key};
 const created=await a.rawCall('POST','/api/goals',body,h);
  assert.equal(created.status,201,created.body);
  const id=created.json?.id;
 await db.pool.query('update goal_create_operation set request_hash=$1 where idempotency_key=$2',[legacyHash(body),key]);
 const edited=await a.rawCall('PATCH','/api/goals/'+id,{targetDate:'2027-03-31',expectedGoalSettingsRevision:0});
  assert.equal(edited.status,200,edited.body);
 for (const replayBody of [body,{...body,targetDate:null}]) {
   const replay=await a.rawCall('POST','/api/goals',replayBody,h);
   assert.equal(replay.status,200,replay.body);
   assert.equal(replay.json?.id,id);
   assert.equal(replay.json?.targetDate,'2027-03-31');
   assert.equal(replay.headers['idempotency-replayed'],'true');
 }
 assert.equal((await db.pool.query('select count(*)::int as n from goal')).rows[0].n,1);
});

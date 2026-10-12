// Explicit local synthetic image acceptance runner; not part of node:test glob.
// Start the Issue148-only Compose fixture described in docs/operations/issue148-verification.md.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import pg from 'pg';
const require = createRequire(import.meta.url);
const missing = ['ISSUE148_PLAYWRIGHT_ROOT', 'ISSUE148_BROWSER_EXE'].filter(name => !process.env[name]?.trim());
if (missing.length) {
 console.error(`必要な環境変数が未設定: ${missing.join(', ')}。docs/operations/issue148-verification.md のbrowser実行手順を確認してください。`);
 process.exit(1);
}
const { chromium } = require(process.env.ISSUE148_PLAYWRIGHT_ROOT);
const origin = process.env.ISSUE148_ORIGIN ?? 'http://127.0.0.1:8097';
const selected = process.env.ISSUE148_CASES?.split(',');
const out = '.tools/issue148/browser'; mkdirSync(out, { recursive: true });
const pool = new pg.Pool({ host: '127.0.0.1', port: Number(process.env.ISSUE148_DB_PORT ?? 15488), database: 'futureroi_issue148', user: 'issue148_synthetic', password: 'issue148-synthetic-only', max: 1 });
assert.deepEqual((await pool.query('select current_database() db,current_user owner')).rows[0], { db: 'futureroi_issue148', owner: 'issue148_synthetic' });
const browser = await chromium.launch({ executablePath: process.env.ISSUE148_BROWSER_EXE, headless: true });
const cases = []; const contexts = [];
async function delivered(responsePromise, page) {
 const response=await responsePromise;await response.finished();
 // Transport completion followed by render turns; no Storage-read side effect is required.
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
}
// 初期質問は必須（#259）。両問で「回答しない」を選ぶ（回答欄を押せない間は何もしない）
const choosePrior = async page => { for (const radio of await page.locator('.r11-qp fieldset:not([disabled]) input[value=""]').all()) await radio.check(); };
const wait = async fn => { for(let i=0;i<100;i++){ if(await fn()) return; await new Promise(r=>setTimeout(r,50)); } throw Error('condition timeout'); };
async function fixture() {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'Asia/Tokyo', reducedMotion: 'reduce' }); contexts.push(context);
  const creds = { name: '合成ユーザー', email: `${randomUUID()}@example.test`, password: 'Synthetic-148-only-password!' };
  const request = async (method,path,data,extra={}) => {
    const response = await context.request.fetch(origin+path, { method, headers: { origin, ...extra }, ...(data ? { data } : {}) });
    const text = await response.text(); return { status: response.status(), json: text ? JSON.parse(text) : null };
  };
  assert.equal((await request('POST','/api/auth/sign-up/email',creds)).status,200);
  const sessionResponse = await request('GET','/api/auth/get-session'); assert.equal(sessionResponse.status,200,'合成fixtureのsession確認'); const session=sessionResponse.json;
  const page = await context.newPage(); page.setDefaultTimeout(15000);
  const requests=[];
  page.on('request', r=> { if (r.method() !== 'GET' && new URL(r.url()).pathname.startsWith('/api/goals')) requests.push({ method:r.method(),path:new URL(r.url()).pathname,body:r.postDataJSON(), key:r.headers()['idempotency-key'] }); });
  const create = async (extra={}) => { const body={ title:'合成Goal',unit:'minutes',totalRequired:1000,sessionAmount:10,timezone:'Asia/Tokyo',...extra }; const res=await request('POST','/api/goals',body,{'Idempotency-Key':randomUUID()}); assert.equal(res.status,201);return res.json; };
  const open = async g => { await page.goto(`${origin}/goals/${g.id}`); await page.getByRole('button',{name:/^やった/}).last().waitFor(); };
  const patch = async (g,extra) => { const res=await request('PATCH',`/api/goals/${g.id}`,{expectedGoalSettingsRevision:g.goalSettingsRevision,...extra});assert.equal(res.status,200);return res.json; };
  return { context,page,requests,request,create,open,patch,creds,owner:session.user.id };
}
async function run(id,fn) { if (selected && !selected.includes(id)) return; const start=Date.now(); try { const evidence=await fn(); cases.push({id,status:'PASS',milliseconds:Date.now()-start,evidence});console.log(`${id}: PASS`); } catch(error){ cases.push({id,status:'FAIL',milliseconds:Date.now()-start,error:String(error.stack)});console.log(`${id}: FAIL ${error.message}`); const p=contexts.at(-1)?.pages().at(-1); if(p) { writeFileSync(`${out}/${id}-failure.txt`,await p.locator('body').innerText().catch(()=>'')); await p.screenshot({path:`${out}/${id}-failure.png`,fullPage:true}).catch(()=>{}); } } finally { if(id !== 'F03') for(const c of contexts.splice(0)) await c.close();
  // 固定版のDB limiterは直前の許可要求から60秒無要求でresetする。制限行を変えず小さなbatch間で待つ。
  if(cases.length % 5 === 0) {
   console.log('合成認証の制限windowを待機');
   await new Promise(resolve=>setTimeout(resolve,31000));
   await new Promise(resolve=>setTimeout(resolve,31000));
  }
 } }
try {
 await run('F01',async()=>{
  const f=await fixture(),g=await f.create();
  // Synthetic recordStartDate fixture opens yesterday without claiming a real two-day trial.
  await pool.query("update goal set record_start_date=(record_start_date - interval '1 day')::date where id=$1 and user_id=$2",[g.id,f.owner]);
  await f.open(g);
  // 未記録の昨日の問いかけは開閉する欄の中にある（#202）。閉じていれば利用者と同じく見出しを押して開く。ボタン名は量を含む（#221）
  const details=f.page.locator('.fr-today__yesterday'); if(!(await details.evaluate(d=>d.open))) await details.locator(':scope > summary').click();
  const prompt=f.page.locator('.fr-yesterday'); await prompt.getByRole('button',{name:/^やった/}).click();
  await wait(()=>Promise.resolve(f.requests.length===1)); await f.page.getByRole('heading',{name:'昨日はどうでしたか？',exact:true}).waitFor({state:'hidden'});
  await f.page.getByRole('button',{name:/^やった/}).last().click();
  await f.page.getByText('今日は記録済みです',{exact:true}).waitFor();
  await f.page.getByRole('button',{name:/昨日.*の記録を変更/}).click();
  // 昨日の訂正は今日の選び直しと同じく、押した2択でそのまま上書き保存する（#221）
  await f.page.locator('.fr-yesterday').getByRole('button',{name:/^やった/}).click();
  await wait(()=>Promise.resolve(f.requests.length===3));
  for(const req of f.requests) assert.deepEqual(req.body,{status:'DONE',amount:10,expectedGoalSettingsRevision:0});
  assert.notEqual(f.requests[0].path,f.requests[1].path); assert.equal(f.requests[0].path,f.requests[2].path);
  return f.requests;
 });
 await run('F02',async()=>{
  const f=await fixture(),g=await f.create();await f.open(g);
  const pattern=`**/api/goals/${g.id}/logs/*`; let first=true;
  await f.page.route(pattern,async route=>{ if(first){first=false;await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{code:'UNAVAILABLE',message:'synthetic'}})});}else await route.continue(); });
  await f.page.getByRole('button',{name:/^やった/}).last().click();await f.page.getByRole('button',{name:'もう一度保存',exact:true}).waitFor();
  await f.patch(g,{sessionAmount:100});
  await f.page.getByRole('button',{name:'もう一度保存',exact:true}).click();
  await f.page.getByText('Goalの設定が変更されました',{exact:true}).waitFor();
  assert.equal(f.requests.length,2);assert.deepEqual(f.requests[0],f.requests[1]);
  assert.deepEqual((await f.request('GET',`/api/goals/${g.id}/logs`)).json,[]);return f.requests;
 });
 let recovery;
 await run('F03',async()=>{
  const f=await fixture(),g=await f.create();await f.open(g);await f.patch(g,{sessionAmount:100});
  await f.page.getByRole('button',{name:/^やった/}).last().click();await f.page.getByText('Goalの設定が変更されました',{exact:true}).waitFor();
  assert.equal(await f.page.getByRole('button',{name:'この量で再保存'}).isDisabled(),true);
  const pattern=`**/api/goals/${g.id}?view=r11`;
  await f.page.route(pattern,route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{code:'UNAVAILABLE',message:'synthetic'}})}));
  await f.page.getByRole('button',{name:'最新の設定を取得'}).click();await f.page.getByText('最新の取得に失敗しました。まだ再保存できません。',{exact:true}).waitFor();
  assert.equal(await f.page.getByRole('button',{name:'この量で再保存'}).isDisabled(),true);assert.equal(await f.page.getByRole('button',{name:'選び直す',exact:true}).isDisabled(),true);
  assert.ok((await f.page.locator('body').innerText()).includes('10分'));assert.equal(f.requests.length,1);
  await f.page.screenshot({path:`${out}/F03.png`,fullPage:true});recovery={f,g,pattern};return f.requests;
 });
 await run('F04',async()=>{
  assert.ok(recovery,'F03 fixture required');const {f,g,pattern}=recovery;await f.page.unroute(pattern);
  await f.page.getByRole('button',{name:'最新の設定を取得'}).click();await wait(async()=>!(await f.page.getByRole('button',{name:'この量で再保存'}).isDisabled()));
  assert.equal(f.requests.length,1);await f.page.getByRole('button',{name:'この量で再保存'}).click();await f.page.getByText('今日は記録済みです',{exact:true}).waitFor();
  assert.deepEqual(f.requests[1].body,{status:'DONE',amount:10,expectedGoalSettingsRevision:1});
  assert.equal((await f.request('GET',`/api/goals/${g.id}/logs`)).json[0].amount,10);await f.page.screenshot({path:`${out}/F04.png`,fullPage:true});return f.requests;
 });
 await run('F05',async()=>{
  const evidence=[];
  for(const change of [{unit:'sessions'},{timezone:'UTC'}]){
   const f=await fixture(),g=await f.create();await f.open(g);await f.patch(g,change);
   await f.page.getByRole('button',{name:/^やった/}).last().click();await f.page.getByRole('button',{name:'最新の設定を取得'}).click();
   await f.page.getByText('単位またはタイムゾーンが変わりました。同じ数字を自動で保存せず、量と対象日を選び直してください。',{exact:true}).waitFor();
   assert.equal(await f.page.getByRole('button',{name:'この量で再保存'}).isDisabled(),true);await wait(async()=>!(await f.page.getByRole('button',{name:'選び直す',exact:true}).isDisabled()));
   assert.equal(f.requests.length,1);assert.ok((await f.page.locator('body').innerText()).includes('10分'));evidence.push({change,requests:f.requests});
  }return evidence;
 });
 let uncertain;
 await run('F06',async()=>{
  const f=await fixture();await f.page.goto(`${origin}/goals/new`);
  await f.page.locator('#goal-title').fill('応答切断Goal');await f.page.locator('#goal-totalRequired').fill('100');await f.page.locator('#goal-sessionAmount').fill('10');await choosePrior(f.page);
  let committed;await f.page.route('**/api/goals',async route=>{ if(route.request().method()==='POST'){const response=await route.fetch();assert.equal(response.status(),201);committed=await response.json();await route.abort('failed');}else await route.continue(); });
  await f.page.getByRole('button',{name:'保存する',exact:true}).click();await f.page.getByRole('button',{name:'もう一度保存',exact:true}).waitFor();assert.ok(committed);
  assert.ok((await f.page.locator('body').innerText()).includes('作成結果を確認できませんでした'));
  await f.page.unroute('**/api/goals');await f.page.getByRole('link',{name:'閉じる',exact:true}).click();await f.page.goto(`${origin}/goals/new`);assert.equal(await f.page.locator('#goal-title').inputValue(),'応答切断Goal');
  await f.request('POST','/api/auth/sign-out',{});assert.equal((await f.request('POST','/api/auth/sign-in/email',f.creds)).status,200);
  await f.page.reload();assert.equal(await f.page.locator('#goal-title').inputValue(),'応答切断Goal');
  await f.page.screenshot({path:`${out}/F06.png`,fullPage:true});await f.page.getByRole('button',{name:'保存する',exact:true}).click();await f.page.waitForURL(`${origin}/goals`);
  assert.equal(f.requests.length,2);assert.deepEqual(f.requests[0],f.requests[1]);const list=(await f.request('GET','/api/goals')).json;assert.equal(list.length,1);assert.equal(list[0].id,committed.id);
  uncertain=f;return {requests:f.requests,goalId:committed.id};
 });
 await run('F06-late-operation',async()=>{
  const f=await fixture();await f.page.goto(`${origin}/goals/new`);await f.page.locator('#goal-title').waitFor();
  let releaseOld;const oldBarrier=new Promise(r=>releaseOld=r);let committed=false;let count=0;
  await f.page.route('**/api/goals',async route=>{
    if(route.request().method()!=='POST'){await route.continue();return;}
    count++;
    if(count===1){const response=await route.fetch();assert.equal(response.status(),201);committed=true;await oldBarrier;await route.fulfill({response});}
    else if(count===3){const response=await route.fetch();assert.equal(response.status(),201);await route.abort('failed');}
    else await route.continue();
  });
  const fill=async title=>{await f.page.locator('#goal-title').fill(title);await f.page.locator('#goal-totalRequired').fill('100');await f.page.locator('#goal-sessionAmount').fill('10');await choosePrior(f.page);};
  await fill('K1 遅延成功');await f.page.getByRole('button',{name:'保存する',exact:true}).click();await wait(()=>Promise.resolve(committed));
  await f.page.getByRole('link',{name:'閉じる',exact:true}).click();await f.page.getByRole('link',{name:'Goalを追加',exact:true}).click();
  assert.equal(await f.page.locator('#goal-title').inputValue(),'K1 遅延成功');await f.page.getByRole('button',{name:'保存する',exact:true}).click();await f.page.waitForURL(`${origin}/goals`);
  await f.page.getByRole('link',{name:'Goalを追加',exact:true}).click();await fill('K2 応答不明');await f.page.getByRole('button',{name:'保存する',exact:true}).click();await f.page.getByRole('button',{name:'もう一度保存',exact:true}).waitFor();
  const secondKey=f.requests[2].key;
  const oldResponse=f.page.waitForResponse(r=>r.request().method()==='POST' && r.status()===201 && r.request().headers()['idempotency-key']===f.requests[0].key);
  releaseOld();await delivered(oldResponse,f.page);
  assert.equal(await f.page.evaluate(owner=>JSON.parse(sessionStorage.getItem(`future-roi:create-attempt:${owner}`)).key,f.owner),secondKey);
  await f.page.reload();assert.equal(await f.page.locator('#goal-title').inputValue(),'K2 応答不明');await f.page.getByRole('button',{name:'保存する',exact:true}).click();await f.page.waitForURL(`${origin}/goals`);
  assert.deepEqual(f.requests[0],f.requests[1]);assert.deepEqual(f.requests[2],f.requests[3]);assert.equal((await f.request('GET','/api/goals')).json.length,2);return f.requests;
 });
 await run('F07',async()=>{
  const f=await fixture();await f.page.goto(`${origin}/goals/new`);await f.page.locator('#goal-title').fill('Aの不明操作');await f.page.locator('#goal-totalRequired').fill('100');await f.page.locator('#goal-sessionAmount').fill('10');await choosePrior(f.page);
  await f.page.route('**/api/goals',async route=>{if(route.request().method()==='POST'){await route.fetch();await route.abort('failed');}else await route.continue();});await f.page.getByRole('button',{name:'保存する',exact:true}).click();await f.page.getByRole('button',{name:'もう一度保存',exact:true}).waitFor();await f.page.unroute('**/api/goals');
  const old=f.requests[0];await f.request('POST','/api/auth/sign-out',{});assert.equal((await f.request('POST','/api/auth/sign-up/email',{name:'B',email:`${randomUUID()}@example.test`,password:'Synthetic-148-only-password!'})).status,200);
  await f.page.reload();await f.page.locator('#goal-title').waitFor();assert.equal(await f.page.locator('#goal-title').inputValue(),'');assert.equal(f.requests.length,1);
  const response=await f.request('POST','/api/goals',old.body,{'Idempotency-Key':old.key,'X-Create-Owner':f.owner});assert.equal(response.status,409);assert.equal(response.json.error.code,'CREATE_OWNER_CHANGED');assert.deepEqual((await f.request('GET','/api/goals')).json,[]);return {guardStatus:409,browserPostCount:f.requests.length};
 });
 await run('F08',async()=>{
  const f=await fixture();await f.page.goto(`${origin}/goals/new`);await f.page.locator('#goal-title').fill('422訂正');await f.page.locator('#goal-totalRequired').fill('100');await f.page.locator('#goal-sessionAmount').fill('10');await choosePrior(f.page);
  await f.page.route('**/api/goals',route=>route.request().method()==='POST'?route.fulfill({status:422,contentType:'application/json',body:JSON.stringify({error:{code:'VALIDATION_ERROR',message:'synthetic',fields:[{path:'body/title',message:'synthetic'}]}})}):route.continue());
  await f.page.getByRole('button',{name:'保存する',exact:true}).click();await wait(async()=>!(await f.page.locator('#goal-title').isDisabled()));assert.equal(f.requests.length,1);await f.page.unroute('**/api/goals');await f.page.locator('#goal-title').fill('訂正済み');await f.page.getByRole('button',{name:'保存する',exact:true}).click();await f.page.waitForURL(`${origin}/goals`);assert.notEqual(f.requests[0].key,f.requests[1].key);assert.equal((await f.request('GET','/api/goals')).json.length,1);return f.requests;
 });
 await run('F09',async()=>{
  const f=await fixture(),g=await f.create({initialProgress:10});await f.page.goto(`${origin}/goals/${g.id}/edit`);await f.page.locator('#goal-title').waitFor();assert.equal(await f.page.getByRole('button',{name:'回',exact:true}).isDisabled(),true);await f.page.getByText('過去の量や現在の初期量の意味を保つため、単位を変更できません。別単位は新しいGoalで始めてください。',{exact:true}).waitFor();assert.ok(await f.page.getByRole('link',{name:'新しいGoalを作成'}).count());return {unitDisabled:true,reasonAndNewGoal:true};
 });
 await run('F10',async()=>{
  const f=await fixture(),g=await f.create();await f.open(g);await f.page.route(`**/api/goals/${g.id}/today?view=r11`,route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{code:'UNAVAILABLE',message:'synthetic'}})}));
  await f.page.getByRole('button',{name:/^やった/}).last().click();await f.page.getByText('記録は保存しました',{exact:true}).waitFor();assert.equal(f.requests.length,1);assert.equal((await f.request('GET',`/api/goals/${g.id}/logs`)).json[0].amount,10);return f.requests;
 });
 await run('F11',async()=>{
  const f=await fixture();await f.page.goto(`${origin}/goals/new`);await f.page.locator('#goal-title').fill('削除結果から明示新規');await f.page.locator('#goal-totalRequired').fill('100');await f.page.locator('#goal-sessionAmount').fill('10');await choosePrior(f.page);
  let created;await f.page.route('**/api/goals',async route=>{if(route.request().method()==='POST'){created=await (await route.fetch()).json();await route.abort('failed');}else await route.continue();});
  await f.page.getByRole('button',{name:'保存する',exact:true}).click();await f.page.getByRole('button',{name:'もう一度保存',exact:true}).waitFor();
  const old=f.requests[0];await f.page.unroute('**/api/goals');assert.equal((await f.request('DELETE',`/api/goals/${created.id}`)).status,204);await f.page.getByRole('button',{name:'もう一度保存',exact:true}).click();
  const restart=f.page.getByRole('button',{name:'新しいGoalとして作成',exact:true});await restart.waitFor();assert.equal(f.requests.length,2);assert.equal(await f.page.locator('#goal-title').isDisabled(),true);
  await restart.click();assert.equal(f.requests.length,2);assert.equal(await f.page.locator('#goal-title').inputValue(),'削除結果から明示新規');assert.equal(await f.page.locator('#goal-title').isDisabled(),false);
  await f.page.getByRole('button',{name:'保存する',exact:true}).click();await f.page.waitForURL(`${origin}/goals`);assert.notEqual(f.requests[2].key,old.key);assert.equal(f.requests[1].key,old.key);
  const goals=(await f.request('GET','/api/goals')).json;assert.equal(goals.length,1);assert.notEqual(goals[0].id,created.id);return {oldKeyRetried:true,newKeyOnlyAfterExplicitAction:true,deletedIdNotRevived:true};
 });
 await run('F12',async()=>{
  const f=await fixture(),g=await f.create();await f.page.goto(`${origin}/goals/${g.id}/edit`);await f.page.locator('#goal-title').waitFor();await f.page.locator('#goal-title').fill('残した編集名');await f.page.getByRole('button',{name:'回',exact:true}).click();
  const latest=await f.patch(g,{title:'別画面の編集'});assert.equal((await f.request('PUT',`/api/goals/${g.id}/logs/${g.today}`,{status:'DONE',amount:10,expectedGoalSettingsRevision:latest.goalSettingsRevision})).status,200);
  await f.page.getByRole('button',{name:'変更を保存',exact:true}).click();await f.page.getByRole('button',{name:'最新の内容を読み込む',exact:true}).click();
  const restore=f.page.getByRole('button',{name:'保存済みの単位に戻す',exact:true});await restore.waitFor();assert.equal(await f.page.getByRole('button',{name:'回',exact:true}).isDisabled(),true);await restore.click();
  assert.equal(await f.page.locator('#goal-title').inputValue(),'残した編集名');assert.equal(await f.page.locator('#goal-sessionAmount').inputValue(),'10');assert.equal(f.requests.length,1);
  await f.page.getByRole('button',{name:'変更を保存',exact:true}).click();await f.page.waitForURL(`${origin}/goals`);const saved=(await f.request('GET',`/api/goals/${g.id}`)).json;assert.equal(saved.title,'残した編集名');assert.equal(saved.unit,'minutes');assert.equal((await f.request('GET',`/api/goals/${g.id}/logs`)).json[0].amount,10);return {otherInputPreserved:true,noAutomaticSave:true,unitAndLogMeaningPreserved:true};
 });


 await run('F13',async()=>{
  for(const kind of ['malformed','legacy']) {
   const f=await fixture();const raw=kind==='malformed'?'{':JSON.stringify({owner:f.owner,key:randomUUID(),body:{title:'旧形式',unit:'legacy',totalRequired:100,sessionAmount:10,timezone:'Asia/Tokyo'}});const errors=[];f.page.on('pageerror',error=>errors.push(String(error)));
   await f.page.goto(`${origin}/goals`);await f.page.evaluate(({owner,raw})=>sessionStorage.setItem(`future-roi:create-attempt:${owner}`,raw),{owner:f.owner,raw});
   await f.page.goto(`${origin}/goals/new`);await f.page.getByRole('alert').getByText('作成の回復情報を確認できません',{exact:true}).waitFor();
   assert.equal(await f.page.getByRole('button',{name:'保存する',exact:true}).isDisabled(),true);
   await f.page.locator('form').evaluate(form=>form.requestSubmit());await f.page.reload();await f.page.getByRole('alert').getByText('作成の回復情報を確認できません',{exact:true}).waitFor();
   assert.equal(await f.page.evaluate(owner=>sessionStorage.getItem(`future-roi:create-attempt:${owner}`),f.owner),raw);assert.equal(f.requests.length,0);assert.deepEqual(errors,[]);
   await f.page.getByRole('link',{name:'Goal一覧で確認する',exact:true}).click();await f.page.waitForURL(`${origin}/goals`);assert.deepEqual((await f.request('GET','/api/goals')).json,[]);
  }
  return {malformedAndLegacyRender:true,rawPreserved:true,noPostOrNewKey:true};
 });
 await run('F14',async()=>{
  const f=await fixture(),key=randomUUID(),body={title:'元のGoal',unit:'minutes',totalRequired:100,sessionAmount:10,timezone:'Asia/Tokyo'};
  const created=await f.request('POST','/api/goals',body,{'Idempotency-Key':key});assert.equal(created.status,201);
  const raw=JSON.stringify({owner:f.owner,key,body:{...body,title:'違う入力'}});await f.page.goto(`${origin}/goals`);await f.page.evaluate(({owner,raw})=>sessionStorage.setItem(`future-roi:create-attempt:${owner}`,raw),{owner:f.owner,raw});
  await f.page.goto(`${origin}/goals/new`);await f.page.getByRole('button',{name:'保存する',exact:true}).click();await f.page.getByRole('alert').getByText('作成操作の入力が一致しません',{exact:true}).waitFor();
  assert.equal(await f.page.getByRole('button',{name:'保存する',exact:true}).isDisabled(),true);assert.equal(await f.page.getByRole('button',{name:'もう一度保存',exact:true}).count(),0);
  await f.page.locator('form').evaluate(form=>form.requestSubmit());assert.equal(f.requests.length,1);assert.equal(f.requests[0].key,key);
  assert.equal(await f.page.evaluate(owner=>sessionStorage.getItem(`future-roi:create-attempt:${owner}`),f.owner),raw);assert.equal((await f.request('GET','/api/goals')).json.length,1);
  return {real409:true,rawPreserved:true,noBlindRetry:true};
 });
 await run('F15',async()=>{
  const f=await fixture();await f.page.goto(`${origin}/goals/new`);await f.page.locator('#goal-title').fill('owner競合から回復');await f.page.locator('#goal-totalRequired').fill('100');await f.page.locator('#goal-sessionAmount').fill('10');await choosePrior(f.page);
  let guarded;await f.page.route('**/api/goals',async route=>{
   if(route.request().method()!=='POST')return route.continue();
   await f.request('POST','/api/auth/sign-out',{});assert.equal((await f.request('POST','/api/auth/sign-up/email',{name:'B',email:`${randomUUID()}@example.test`,password:'Synthetic-148-only-password!'})).status,200);
   const cookie=(await f.context.cookies(origin)).map(({name,value})=>`${name}=${value}`).join('; ');
   const response=await route.fetch({headers:{...route.request().headers(),cookie}});guarded={status:response.status(),body:await response.json()};await route.fulfill({response});
  });
  await f.page.getByRole('button',{name:'保存する',exact:true}).click();await f.page.getByText(/作成時のアカウントと現在のアカウントが違います/).waitFor();assert.equal(guarded.status,409);assert.equal(guarded.body.error.code,'CREATE_OWNER_CHANGED');
  const checked=f.page.waitForResponse(response=>new URL(response.url()).pathname==='/api/auth/get-session');await f.page.getByRole('button',{name:'作成時のアカウントで再確認',exact:true}).click();await checked;await wait(()=>f.page.getByRole('button',{name:'作成時のアカウントで再確認',exact:true}).isEnabled());assert.equal(f.requests.length,1,'非cache session確認で別ownerへのPOSTを止める');assert.deepEqual((await f.request('GET','/api/goals')).json,[]);
  const original=f.requests[0];assert.equal(await f.page.evaluate(owner=>JSON.parse(sessionStorage.getItem(`future-roi:create-attempt:${owner}`)).key,f.owner),original.key);
  await f.page.unroute('**/api/goals');await f.request('POST','/api/auth/sign-out',{});assert.equal((await f.request('POST','/api/auth/sign-in/email',f.creds)).status,200);
  await f.page.reload();await f.page.getByRole('button',{name:'保存する',exact:true}).click();await f.page.waitForURL(`${origin}/goals`);assert.deepEqual(f.requests[1],original);assert.equal((await f.request('GET','/api/goals')).json.length,1);
  return {real409OwnerRace:true,preflightStopsWrongOwner:true,sameKeyAndBodyAfterReauth:true};
 });
 await run('F16',async()=>{
  const f=await fixture(),g=await f.create({initialProgress:10,totalRequired:100});assert.equal((await f.request('PUT',`/api/goals/${g.id}/logs/${g.today}`,{status:'DONE',amount:20,expectedGoalSettingsRevision:g.goalSettingsRevision})).status,200);
  await f.page.setViewportSize({width:1280,height:900});await f.page.goto(`${origin}/goals`);await f.page.getByRole('progressbar').waitFor();assert.equal(await f.page.getByRole('progressbar').getAttribute('aria-valuenow'),'30');
  await f.page.screenshot({path:`${out}/F16-desktop-list.png`,fullPage:true});await f.page.goto(`${origin}/goals/${g.id}/edit`);await f.page.locator('#goal-title').waitFor();
  const total=await f.page.locator('#goal-totalRequired').boundingBox(),session=await f.page.locator('#goal-sessionAmount').boundingBox();assert.ok(session.y>total.y && Math.abs(session.x-total.x)<2,'#259のdesktop配置（総量→1回の量の縦並び）');
  assert.equal(await f.page.getByRole('button',{name:'回',exact:true}).isDisabled(),true);await f.page.screenshot({path:`${out}/F16-desktop-edit.png`,fullPage:true});
  await f.page.setViewportSize({width:390,height:844});await f.page.screenshot({path:`${out}/F16-mobile-edit.png`,fullPage:true});return {progressDone30:true,desktopAmountsStacked:true,unitLocked:true};
 });

 await run('F17-real-nul-422',async()=>{
  const f=await fixture(),errors=[];f.page.on('pageerror',error=>errors.push(String(error)));
  await f.page.goto(`${origin}/goals/new`);await f.page.locator('#goal-title').fill('NUL\u0000拒否');await f.page.locator('#goal-totalRequired').fill('100');await f.page.locator('#goal-sessionAmount').fill('10');await choosePrior(f.page);
  const rejected=f.page.waitForResponse(r=>new URL(r.url()).pathname==='/api/goals' && r.request().method()==='POST');
  await f.page.getByRole('button',{name:'保存する',exact:true}).click();const response=await rejected;assert.equal(response.status(),422);assert.equal((await response.json()).error.code,'VALIDATION_ERROR');
  await wait(async()=>!(await f.page.locator('#goal-title').isDisabled()));
  assert.equal(await f.page.locator('#goal-title').getAttribute('aria-invalid'),'true');assert.equal(await f.page.locator('#goal-title').evaluate(el=>el===document.activeElement),true);
  assert.equal(await f.page.evaluate(owner=>sessionStorage.getItem(`future-roi:create-attempt:${owner}`),f.owner),null);assert.deepEqual((await f.request('GET','/api/goals')).json,[]);
  await f.page.screenshot({path:`${out}/F17-422-correctable.png`,fullPage:true});await f.page.locator('#goal-title').fill('NUL訂正済み');await f.page.getByRole('button',{name:'保存する',exact:true}).click();await f.page.waitForURL(`${origin}/goals`);
  assert.equal(f.requests.length,2);assert.notEqual(f.requests[0].key,f.requests[1].key);assert.equal((await f.request('GET','/api/goals')).json.length,1);assert.deepEqual(errors,[]);
  return {realApi422:true,fieldErrorAndFocus:true,editableAfter422:true,newKeyAfterExplicitCorrection:true,requests:f.requests};
 });
 await run('F18-late-422',async()=>{
  const f=await fixture();await f.page.goto(`${origin}/goals/new`);await f.page.locator('#goal-title').waitFor();
  let releaseOld,firstSent=false,count=0;const barrier=new Promise(r=>releaseOld=r);
  await f.page.route('**/api/goals',async route=>{
   if(route.request().method()!=='POST')return route.continue();count++;
   if(count===1){firstSent=true;await barrier;await route.fulfill({status:422,contentType:'application/json',body:JSON.stringify({error:{code:'VALIDATION_ERROR',message:'synthetic late 422',fields:[{path:'body/title',message:'synthetic'}]}})});}
   else if(count===3){const response=await route.fetch();assert.equal(response.status(),201);await route.abort('failed');}
   else await route.continue();
  });
  const fill=async title=>{await f.page.locator('#goal-title').fill(title);await f.page.locator('#goal-totalRequired').fill('100');await f.page.locator('#goal-sessionAmount').fill('10');await choosePrior(f.page);};
  await fill('K1 人工遅延422');await f.page.getByRole('button',{name:'保存する',exact:true}).click();await wait(()=>Promise.resolve(firstSent));
  await f.page.getByRole('link',{name:'閉じる',exact:true}).click();await f.page.getByRole('link',{name:'最初のGoalをつくる',exact:true}).click();await f.page.getByRole('button',{name:'保存する',exact:true}).click();await f.page.waitForURL(`${origin}/goals`);
  await f.page.getByRole('link',{name:'Goalを追加',exact:true}).click();await fill('K2 422逆対');await f.page.getByRole('button',{name:'保存する',exact:true}).click();await f.page.getByRole('button',{name:'もう一度保存',exact:true}).waitFor();
  const raw=await f.page.evaluate(owner=>sessionStorage.getItem(`future-roi:create-attempt:${owner}`),f.owner);
  const oldResponse=f.page.waitForResponse(r=>r.request().method()==='POST' && r.status()===422 && r.request().headers()['idempotency-key']===f.requests[0].key);
  releaseOld();await delivered(oldResponse,f.page);
  assert.equal(await f.page.evaluate(owner=>sessionStorage.getItem(`future-roi:create-attempt:${owner}`),f.owner),raw);assert.equal(await f.page.locator('#goal-title').inputValue(),'K2 422逆対');assert.equal(await f.page.locator('#goal-title').isDisabled(),true);
  await f.page.reload();await f.page.getByRole('button',{name:'保存する',exact:true}).click();await f.page.waitForURL(`${origin}/goals`);assert.deepEqual(f.requests[0],f.requests[1]);assert.deepEqual(f.requests[2],f.requests[3]);assert.equal((await f.request('GET','/api/goals')).json.length,2);
  return {artificialLate422:true,k2RawPreserved:true,sameKeyAndBodyRecovery:true,requests:f.requests};
 });
 await run('F19-unknown-503',async()=>{
  const f=await fixture();await f.page.goto(`${origin}/goals/new`);await f.page.locator('#goal-title').fill('503不明操作');await f.page.locator('#goal-totalRequired').fill('100');await f.page.locator('#goal-sessionAmount').fill('10');await choosePrior(f.page);
  await f.page.route('**/api/goals',route=>route.request().method()==='POST'?route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{code:'UNAVAILABLE',message:'synthetic uncertain'}})}):route.continue());
  await f.page.getByRole('button',{name:'保存する',exact:true}).click();await f.page.getByRole('button',{name:'もう一度保存',exact:true}).waitFor();const raw=await f.page.evaluate(owner=>sessionStorage.getItem(`future-roi:create-attempt:${owner}`),f.owner);
  assert.equal(await f.page.locator('#goal-title').isDisabled(),true);await f.page.getByRole('button',{name:'もう一度保存',exact:true}).click();await wait(()=>Promise.resolve(f.requests.length===2));await f.page.getByRole('button',{name:'もう一度保存',exact:true}).waitFor();assert.deepEqual(f.requests[0],f.requests[1]);
  await f.page.reload();await f.page.locator('#goal-title').waitFor();assert.equal(f.requests.length,2);assert.equal(await f.page.locator('#goal-title').inputValue(),'503不明操作');assert.equal(await f.page.locator('#goal-title').isDisabled(),true);assert.equal(await f.page.evaluate(owner=>sessionStorage.getItem(`future-roi:create-attempt:${owner}`),f.owner),raw);
  await f.page.unroute('**/api/goals');await f.page.getByRole('button',{name:'保存する',exact:true}).click();await f.page.waitForURL(`${origin}/goals`);assert.deepEqual(f.requests[1],f.requests[2]);assert.equal((await f.request('GET','/api/goals')).json.length,1);
  return {artificial503:true,noAutomaticPost:true,rawAndKeyAndBodyPreserved:true,requests:f.requests};
 });
 for(const method of ['getItem','removeItem'])await run(`F20-storage-${method}`,async()=>{
  const f=await fixture(),errors=[];f.page.on('pageerror',error=>errors.push(String(error)));await f.page.goto(`${origin}/goals/new`);await f.page.locator('#goal-title').fill(`NUL\u0000${method}`);await f.page.locator('#goal-totalRequired').fill('100');await f.page.locator('#goal-sessionAmount').fill('10');await choosePrior(f.page);
  let release,received=false;const barrier=new Promise(r=>release=r);await f.page.route('**/api/goals',async route=>{if(route.request().method()!=='POST')return route.continue();const response=await route.fetch();assert.equal(response.status(),422);received=true;await barrier;await route.fulfill({response});});
  await f.page.getByRole('button',{name:'保存する',exact:true}).click();await wait(()=>Promise.resolve(received));const raw=await f.page.evaluate(owner=>sessionStorage.getItem(`future-roi:create-attempt:${owner}`),f.owner);
  await f.page.evaluate(({owner,method})=>{window.__originalStorage=Storage.prototype[method];Storage.prototype[method]=function(key,...args){if(this===sessionStorage && key===`future-roi:create-attempt:${owner}`)throw Error('synthetic storage failure');return window.__originalStorage.call(this,key,...args);};},{owner:f.owner,method});release();
  await f.page.getByRole('alert').getByText('作成の回復情報を確認できません',{exact:true}).waitFor();assert.equal(await f.page.locator('#goal-title').getAttribute('aria-invalid'),'true');assert.equal(await f.page.locator('#goal-title').isDisabled(),true);assert.equal(await f.page.getByRole('button',{name:'保存する',exact:true}).isDisabled(),true);
  await f.page.evaluate(method=>{Storage.prototype[method]=window.__originalStorage;},method);assert.equal(await f.page.evaluate(owner=>sessionStorage.getItem(`future-roi:create-attempt:${owner}`),f.owner),raw);await f.page.locator('form').evaluate(form=>form.requestSubmit());assert.equal(f.requests.length,1);assert.deepEqual((await f.request('GET','/api/goals')).json,[]);assert.deepEqual(errors,[]);
  return {realApi422:true,artificialStorageFailure:method,rawPreserved:true,fieldErrorAndRecoveryAlert:true,noAutomaticPost:true};
 });
 await run('F21-remount-before-late-success',async()=>{
  const f=await fixture();let releaseOld,created;
  const held=new Promise(resolve=>{releaseOld=resolve;});let first=true;
  await f.page.route('**/api/goals',async route=>{
   if(route.request().method() !== 'POST' || !first) return route.continue();
   first=false;const response=await route.fetch();assert.equal(response.status(),201);created=await response.json();
   await held;await route.fulfill({response});
  });
  await f.page.goto(`${origin}/goals/new`);await f.page.locator('#goal-title').fill('再表示と遅延成功');
  await f.page.locator('#goal-totalRequired').fill('100');await f.page.locator('#goal-sessionAmount').fill('10');await choosePrior(f.page);
  await f.page.getByRole('button',{name:'保存する',exact:true}).click();await wait(()=>Promise.resolve(Boolean(created)));
  await f.page.getByRole('link',{name:'閉じる',exact:true}).click();
  await f.page.getByRole('link',{name:'Goalを追加',exact:true}).click();await f.page.locator('#goal-title').waitFor();
  assert.equal(await f.page.locator('#goal-title').inputValue(),'再表示と遅延成功');
  assert.equal(await f.page.locator('#goal-title').isDisabled(),true);
  const raw=await f.page.evaluate(owner=>sessionStorage.getItem(`future-roi:create-attempt:${owner}`),f.owner);assert.ok(raw);
  const oldResponse=f.page.waitForResponse(r=>r.request().method()==='POST' && r.status()===201 && r.request().headers()['idempotency-key']===f.requests[0].key);
  releaseOld();await delivered(oldResponse,f.page);
  assert.equal(await f.page.evaluate(owner=>sessionStorage.getItem(`future-roi:create-attempt:${owner}`),f.owner),raw);
  assert.equal(await f.page.locator('#goal-title').isDisabled(),true);
  await f.page.getByRole('button',{name:'保存する',exact:true}).click();await f.page.waitForURL(`${origin}/goals`);
  assert.equal(f.requests.length,2);assert.deepEqual(f.requests[1],f.requests[0]);
  const goals=(await f.request('GET','/api/goals')).json;assert.equal(goals.length,1);assert.equal(goals[0].id,created.id);
  return {restoredBeforeOldResponse:true,rawPreserved:true,heldK1Retried:true,oneGoal:true,requests:f.requests};
 });
 await run('F22-remount-unknown-result-both-orders',async()=>{
  const evidence=[];
  for(const oldFirst of [true,false]) {
   const f=await fixture();let releaseOld,releaseRetry,created,count=0,retrySent=false;
   const heldOld=new Promise(resolve=>{releaseOld=resolve;});const heldRetry=new Promise(resolve=>{releaseRetry=resolve;});
   await f.page.route('**/api/goals',async route=>{
    if(route.request().method() !== 'POST') return route.continue();count++;
    if(count===1){const response=await route.fetch();assert.equal(response.status(),201);created=await response.json();await heldOld;await route.fulfill({response});}
    else if(count===2){retrySent=true;await heldRetry;await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{code:'UNAVAILABLE',message:'synthetic retry unknown'}})});}
    else await route.continue();
   });
   await f.page.goto(`${origin}/goals/new`);await f.page.locator('#goal-title').fill('再表示・再送不明');
   await f.page.locator('#goal-totalRequired').fill('100');await f.page.locator('#goal-sessionAmount').fill('10');await choosePrior(f.page);
   await f.page.getByRole('button',{name:'保存する',exact:true}).click();await wait(()=>Promise.resolve(Boolean(created)));
   await f.page.getByRole('link',{name:'閉じる',exact:true}).click();await f.page.getByRole('link',{name:'Goalを追加',exact:true}).click();await f.page.locator('#goal-title').waitFor();
   const raw=await f.page.evaluate(owner=>sessionStorage.getItem(`future-roi:create-attempt:${owner}`),f.owner);assert.ok(raw);
   const oldResponse=f.page.waitForResponse(r=>r.request().method()==='POST' && r.status()===201 && r.request().headers()['idempotency-key']===f.requests[0].key);
   if(oldFirst){releaseOld();await delivered(oldResponse,f.page);}
   await f.page.getByRole('button',{name:'保存する',exact:true}).click();await wait(()=>Promise.resolve(retrySent));
   if(!oldFirst){releaseOld();await delivered(oldResponse,f.page);}
   releaseRetry();await f.page.getByRole('button',{name:'もう一度保存',exact:true}).waitFor();
   assert.equal(await f.page.evaluate(owner=>sessionStorage.getItem(`future-roi:create-attempt:${owner}`),f.owner),raw);
   await f.page.reload();await f.page.locator('#goal-title').waitFor();assert.equal(await f.page.locator('#goal-title').isDisabled(),true);
   assert.equal(await f.page.locator('#goal-title').inputValue(),'再表示・再送不明');assert.equal(f.requests.length,2);
   await f.page.getByRole('button',{name:'保存する',exact:true}).click();await f.page.waitForURL(`${origin}/goals`);
   assert.equal(f.requests.length,3);assert.deepEqual(f.requests[1],f.requests[0]);assert.deepEqual(f.requests[2],f.requests[0]);
   const goals=(await f.request('GET','/api/goals')).json;assert.equal(goals.length,1);assert.equal(goals[0].id,created.id);
   evidence.push({oldFirst,unknown503:true,rawPreserved:true,sameOperationAfterReload:true,oneGoal:true,requests:f.requests});
   await f.context.close();contexts.splice(contexts.indexOf(f.context),1);
  }
  return evidence;
 });
 await run('F23-session-success-next-create-continuous',async()=>{
  const f=await fixture();let releaseWrite,releaseSession,committed=false,sessionHeld=false,holdSession=false;
  const writeBarrier=new Promise(resolve=>{releaseWrite=resolve;});const sessionBarrier=new Promise(resolve=>{releaseSession=resolve;});
  let first=true;
  await f.page.route('**/api/goals',async route=>{
   if(route.request().method()!=='POST'||!first)return route.continue();first=false;
   const response=await route.fetch();assert.equal(response.status(),201);committed=true;await writeBarrier;await route.fulfill({response});
  });
  await f.page.route('**/api/auth/get-session*',async route=>{
   if(!holdSession)return route.continue();holdSession=false;const response=await route.fetch();sessionHeld=true;await sessionBarrier;await route.fulfill({response});
  });
  await f.page.goto(`${origin}/goals/new`);await f.page.locator('#goal-title').fill('確認中保存・次の新規');
  await f.page.locator('#goal-totalRequired').fill('100');await f.page.locator('#goal-sessionAmount').fill('10');await choosePrior(f.page);
  await f.page.getByRole('button',{name:'保存する',exact:true}).click();await wait(()=>Promise.resolve(committed));
  holdSession=true;
  await f.page.evaluate(()=>{const now=Date.now;Date.now=()=>now()+6000;let visible='hidden';Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>visible});document.dispatchEvent(new Event('visibilitychange'));visible='visible';document.dispatchEvent(new Event('visibilitychange'));});
  await wait(()=>Promise.resolve(sessionHeld));await wait(async()=>(await f.page.locator('#goal-title').count())===0);
  const writeResponse=f.page.waitForResponse(r=>r.request().method()==='POST'&&r.status()===201);
  releaseWrite();await delivered(writeResponse,f.page);assert.equal(new URL(f.page.url()).pathname,'/goals/new');assert.equal(await f.page.locator('#goal-title').count(),0);
  releaseSession();await f.page.waitForURL(`${origin}/goals`);
  assert.equal(await f.page.evaluate(owner=>sessionStorage.getItem(`future-roi:create-attempt:${owner}`),f.owner),null);
  await f.page.getByRole('link',{name:'Goalを追加',exact:true}).click();await f.page.locator('#goal-title').waitFor();
  assert.equal(await f.page.locator('#goal-title').inputValue(),'');assert.equal(await f.page.locator('#goal-title').isDisabled(),false);assert.equal(f.requests.length,1);
  // Continue from the fresh form, without clearing recovery storage between cases.
  await f.page.locator('#goal-title').fill('次のNUL\u0000拒否');await f.page.locator('#goal-totalRequired').fill('100');await f.page.locator('#goal-sessionAmount').fill('10');await choosePrior(f.page);
  const rejected=f.page.waitForResponse(r=>r.request().method()==='POST'&&r.status()===422);
  await f.page.getByRole('button',{name:'保存する',exact:true}).click();await delivered(rejected,f.page);
  await wait(async()=>!(await f.page.locator('#goal-title').isDisabled()));assert.equal(await f.page.evaluate(owner=>sessionStorage.getItem(`future-roi:create-attempt:${owner}`),f.owner),null);
  await f.page.locator('#goal-title').fill('次の訂正Goal');await f.page.getByRole('button',{name:'保存する',exact:true}).click();await f.page.waitForURL(`${origin}/goals`);
  assert.equal(f.requests.length,3);assert.notEqual(f.requests[0].key,f.requests[1].key);assert.notEqual(f.requests[1].key,f.requests[2].key);
  assert.deepEqual((await f.request('GET','/api/goals')).json.map(g=>g.title).sort(),['次の訂正Goal','確認中保存・次の新規'].sort());
  return {sameVisitConfirmedSuccess:true,nextCreateEditable:true,realNul422:true,correctionNewKey:true,noStorageReset:true,goalCount:2,requests:f.requests};
 });
} finally {
 writeFileSync(`${out}/results.json`,JSON.stringify({level:'REAL_CHROME_SYNTHETIC_IMAGE',source:'Docker image ID and source revision in verification log',cases},null,2));
 for(const context of contexts)await context.close();await browser.close();await pool.end();
}
if(cases.some(c=>c.status!=='PASS'))process.exitCode=1;

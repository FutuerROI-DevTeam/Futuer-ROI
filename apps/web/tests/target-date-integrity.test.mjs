import assert from 'node:assert/strict';
import {test} from 'node:test';
import {emptyValues,valuesFromGoal,valuesFromCreateBody,validateGoalForm,rebaseValues,toPatchBody,reloadLatestGoal} from '../src/features/goals/goal-form.ts';
import {prepareCreateAttempt,loadCreateAttempt,clearCreateAttempt} from '../src/features/goals/create-attempt.ts';
const create={title:'併用検証',unit:'minutes',totalRequired:3000,sessionAmount:25,timezone:'Asia/Tokyo',targetDate:'2026-10-07'};
const goal={id:'g1',...create,initialProgress:0,hasLogs:false,unitLocked:false,goalSettingsRevision:0,today:'2026-10-06',todayStatus:'UNRECORDED',recordStartDate:'2026-10-06',progressDone:0};
const storage=()=>{const data=new Map();return {getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)}};
test('163+175: 回復bodyの期限日を固定し、再準備やcleanupで別操作へ置き換えない',()=>{
  const s=storage(), key='00000000-0000-4000-8000-000000000175'; const original=prepareCreateAttempt('A',create,s,()=>key);
  const same=prepareCreateAttempt('A',{...create,targetDate:'2027-03-31'},s,()=>assert.fail('新keyは禁止'));
  assert.equal(same.key,key);
  assert.equal(same.body.targetDate,create.targetDate);
  assert.equal(loadCreateAttempt('A',s).body.targetDate,create.targetDate);
  assert.equal(clearCreateAttempt({...original,raw:original.raw+' '},s),false); assert.equal(loadCreateAttempt('A',s).key,key);
});
test('163+175: 保持済み作成の期限経過はreplayを妨げず、新規設定は過去日を拒否する',()=>{
  const values={...emptyValues(create.timezone),...create,totalRequired:'3000',sessionAmount:'25'}; const now=new Date('2026-10-09T00:00:00Z');
  assert.equal(validateGoalForm(values,{now}).targetDate, '到達予定日は、今日より後の日付を選んでください');
  assert.deepEqual(validateGoalForm(values,{now,recoveryBody:create}),{});
});
test('163+175: 日付用baselineとは別に最新unitLockを共通検査へ渡す',()=>{
  const latest={...goal,unitLocked:true,goalSettingsRevision:1}; const values={...valuesFromGoal(goal),unit:'sessions'};
  assert.ok(validateGoalForm(values,{baseline:goal,goal:latest,now:new Date('2026-10-06T00:00:00Z')}).unit);
});
test('163+175: 409後は触った期限日を保持し、触っていない期限日は最新へ合わせ、最新設定版を送る',async()=>{
  const latest={...goal,targetDate:'2027-06-30',goalSettingsRevision:1}; const edited={...valuesFromGoal(goal),targetDate:'2027-08-31'};
  assert.deepEqual(toPatchBody(rebaseValues(edited,goal,latest),latest),{targetDate:'2027-08-31',expectedGoalSettingsRevision:1});
  const titleOnly={...valuesFromGoal(goal),title:'自分の名前'}; const rebased=rebaseValues(titleOnly,goal,latest);
  assert.equal(rebased.targetDate,latest.targetDate);
  assert.equal(rebased.title,'自分の名前');
  assert.deepEqual(toPatchBody(rebased,latest),{title:'自分の名前',expectedGoalSettingsRevision:1});
  assert.equal(await reloadLatestGoal(async()=>({isSuccess:false,data:latest})),undefined);
});

test('163+175: 回復bodyのnull/省略日付は空文字、1240分は文字列1240へ戻し元bodyを変えない',()=>{
 for (const targetDate of [undefined,null,'2027-03-31']) {
   const body={...create,targetDate,initialProgress:1240};
   const before=JSON.stringify(body);
   const values=valuesFromCreateBody(body);
   assert.equal(values.targetDate,targetDate??'');
   assert.equal(values.initialProgress,'1240');
   assert.equal(values.totalRequired,'3000');
   assert.equal(JSON.stringify(body),before);
 }
});

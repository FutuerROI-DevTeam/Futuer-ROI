import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AmountEditor } from '../src/features/logs/AmountEditor.tsx';
import { RecordChoiceBar } from '../src/features/logs/RecordChoiceBar.tsx';
import { amountFormat, RECORD_AMOUNT_MAX } from '../src/copy/amount.ts';
import { todayCopy } from '../src/copy/today.ts';

// 実Reactコンポーネントの入力・連打・境界・未保存draftを実Chrome DOMで検査。
// save callbackを観測する合成transport。実API/DB保存の証跡とは区別する。
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const host = document.getElementById('app')!;
const root = createRoot(host);
const results: string[] = [];
const writes: any[] = [];
let cancels = 0;
const ensure = (value: unknown, message: string) => { if (!value) throw new Error(message); };
const tick = () => new Promise(resolve => setTimeout(resolve, 1));
const render = async (node: React.ReactNode) => {
  await act(async () => { root.render(null); await tick(); });
  await act(async () => { root.render(node); await tick(); });
};
const input = () => host.querySelector<HTMLInputElement>('input')!;
const button = (text: string) => [...host.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent?.trim() === text)!;
const plus = () => host.querySelector<HTMLButtonElement>('button[aria-label^="量を増やす"]')!;
const minus = () => host.querySelector<HTMLButtonElement>('button[aria-label^="量を減らす"]')!;
const click = async (target: HTMLButtonElement) => act(async () => { ensure(target, 'button absent'); target.click(); await tick(); });
const enter = async (text: string) => act(async () => {
  const target = input(); ensure(target, 'input absent');
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(target, text);
  target.dispatchEvent(new Event('input', {bubbles: true})); await tick();
});
const key = async (key: string, init: KeyboardEventInit = {}) => act(async () => { input().dispatchEvent(new KeyboardEvent('keydown', {key, bubbles: true, ...init})); await tick(); });
const editor = (initial = 20, busy = false, unit: 'minutes' | 'sessions' = 'minutes', sessionAmount = 20) => <AmountEditor label="量のテスト" initial={initial} sessionAmount={sessionAmount} fmt={amountFormat({unit})} busy={busy} onSubmit={amount => writes.push({amount})} onCancel={() => { cancels++; }} />;
const failure = {vars: {localDate: '2026-10-10', unit: 'minutes', choice: {status: 'DONE', amount: 20}}, error: new Error('network')};
const saver = (busy = false, failed = false) => ({isSaving: busy, saving: busy ? {choice: {status: 'DONE'}} : null, failure: failed ? failure : null, settingsReady: true, meaningChanged: false, reloadingSettings: false, settingsReloadFailed: false, reloadSettings: () => {}, retry: () => {}, reset: () => {}, isStaleDate: () => false, save: (vars: unknown) => writes.push(vars)} as any);
function Dock({initial = 20, amount = null, busy = false, locked = false, failed = false, onCancel}: {initial?: number; amount?: number | null; busy?: boolean; locked?: boolean; failed?: boolean; onCancel?: () => void}) {
  const [editing, setEditing] = useState(false);
  return <RecordChoiceBar today="2026-10-10" sessionAmount={initial} fmt={amountFormat({unit: 'minutes'})} current={amount === null ? null : {localDate: '2026-10-10', status: 'DONE', amount}} saver={saver(busy, failed)} locked={locked} editingAmount={editing} onEditingAmountChange={setEditing} onRefresh={() => {}} {...(onCancel ? {onCancelChange: onCancel} : {})} />;
}

async function run() {
  await render(editor());
  ensure(!host.querySelector('.fr-amount__prediction-note'), 'configured amount shows unnecessary draft note');
  ensure(input().getAttribute('aria-describedby')?.split(' ').every(id => document.getElementById(id)), 'configured amount has dangling description');
  await click(plus());
  const note = todayCopy.amountPredictionNote('20分');
  ensure(host.textContent?.includes(note), 'different amount does not explain configured forecast basis');
  ensure(input().getAttribute('aria-describedby')?.split(' ').some(id => document.getElementById(id)?.textContent === note), 'prediction note is not connected to input');
  ensure(writes.length === 0, 'draft note caused a save');
  await click(minus());
  ensure(!host.querySelector('.fr-amount__prediction-note'), 'returning to configured amount retains draft note');
  ensure(input().getAttribute('aria-describedby')?.split(' ').every(id => document.getElementById(id)), 'returning to configured amount has dangling description');
  results.push('different draft amount explains configured forecast basis and removes note on return without saving');
  await act(async () => { plus().click(); plus().click(); plus().click(); await tick(); });
  ensure(input().value === '35', 'batched increases lost a step');
  ensure(writes.length === 0, 'step changed persisted data');
  results.push('same-batch repeated increases use successive state without saving');

  // 1回の量20分の刻みは5分（#199：1回の量に合わせたきりのよい刻み）
  await key('ArrowDown'); ensure(input().value === '30', 'ArrowDown step');
  await key('ArrowUp'); ensure(input().value === '35', 'ArrowUp step');
  ensure(input().getAttribute('role') === 'spinbutton' && input().getAttribute('aria-valuenow') === '35', 'spinbutton value absent');
  ensure(plus().getAttribute('aria-label')?.includes('5分ずつ'), 'accessible step amount absent');
  results.push('keyboard arrows and spinbutton semantics use the Goal step');

  await enter('6'); await click(minus()); ensure(input().value === '5' && minus().disabled, 'minimum boundary (one step)');
  await enter('2'); ensure(minus().disabled, 'below one step can still decrease');
  await enter(String(RECORD_AMOUNT_MAX - 1)); await click(plus()); ensure(input().value === String(RECORD_AMOUNT_MAX) && plus().disabled, 'maximum boundary');
  results.push('min one step / max clamp and direction-specific disabled states');

  for (const text of ['', '0', '1.5', String(RECORD_AMOUNT_MAX + 1), 'abc']) {
    await enter(text); ensure(plus().disabled && minus().disabled, 'invalid value enabled step: ' + text);
    const count = writes.length; await key('Enter'); ensure(writes.length === count, 'invalid Enter saved');
    ensure(input().getAttribute('aria-invalid') === 'true', 'invalid input error not connected');
  }
  results.push('empty/zero/fraction/overflow/text remain invalid without silent substitution or save');
  // 刻みの倍数へそろえる（123分で＋なら125分、1,000分で↓なら995分）
  await enter('１２３'); await click(plus()); ensure(input().value === '125', 'fullwidth integers lost or not snapped');
  await enter('1,000'); await key('ArrowDown'); ensure(input().value === '995', 'comma integers lost');
  results.push('existing fullwidth/comma direct-input contract retained and snapped to the step');

  await key('Enter', {repeat: true}); await key('Enter', {isComposing: true}); ensure(writes.length === 0, 'repeat/IME Enter submitted');
  await key('Enter'); ensure(writes.length === 1 && writes[0].amount === 995, 'explicit Enter amount');
  results.push('only explicit non-IME non-repeated Enter submits entered integer');
  await render(editor(7, true)); ensure(input().disabled && plus().disabled && minus().disabled, 'busy controls enabled');
  await key('Enter'); ensure(writes.length === 1, 'busy Enter submitted');
  results.push('busy blocks both buttons, input, Enter and submit');

  await render(editor(3, false, 'sessions', 2)); await click(plus()); ensure(input().value === '4', 'session-unit step changed');
  ensure(plus().getAttribute('aria-label')?.includes('1回ずつ'), 'session-unit label changed');
  results.push('count Goal remains integer count using its own step');

  // 下の帯の−／＋は、入力欄を開かずにその場で量を変え、保存は「やった」を押したときだけ（#199）
  writes.length = 0;
  const done = () => [...host.querySelectorAll<HTMLButtonElement>('.fr-choice')].find(b => b.textContent?.includes(todayCopy.choiceDone))!;
  const shown = () => host.querySelector('.fr-record__amount-text')?.textContent ?? '';
  await render(<Dock />); await click(plus());
  ensure(!input() && writes.length === 0, 'dock increase opened editor or saved');
  ensure(shown().includes('25分') && done().textContent?.includes('25分'), 'dock increase did not change the amount in place');
  const dockNote = todayCopy.amountPredictionNote('20分');
  ensure(done().getAttribute('aria-describedby')?.split(' ').some(id => document.getElementById(id)?.textContent === dockNote), 'different dock amount is not explained on done');
  await click(minus());
  ensure(shown().includes('20分') && !host.querySelector('.fr-amount__prediction-note') && !done().getAttribute('aria-describedby'), 'returning to configured amount kept draft note');
  await click(plus()); await click(button(todayCopy.changeAmount)); ensure(input().value === '25', 'editor did not start from the stepped amount');
  ensure(document.activeElement === host.querySelector('.fr-amount'), 'opened amount editor did not receive group focus');
  ensure(document.activeElement?.getAttribute('role') === 'group' && document.activeElement?.getAttribute('aria-label') === todayCopy.amountTodayLabel, 'editor group is unnamed');
  await click(button(todayCopy.back)); ensure(!input() && writes.length === 0, 'cancel persisted or did not close');
  ensure(document.activeElement === button(todayCopy.changeAmount), 'cancel did not return focus to change amount');
  await click(done());
  ensure(writes.length === 1 && writes[0].choice.status === 'DONE' && writes[0].choice.amount === 25, 'done did not save the stepped amount');
  results.push('dock +/- changes the amount in place without saving; done saves it; change amount starts from it');

  writes.length = 0;
  await render(<Dock amount={37} />); await click(plus()); ensure(shown().includes('40分'), 'correction ignored current amount or did not snap');
  await click(done());
  ensure(writes.length === 1 && writes[0].localDate === '2026-10-10' && writes[0].choice.amount === 40, 'correction changed save date/amount');
  results.push('correction starts from saved amount and done preserves bound date');
  await render(<Dock initial={1} />); ensure(minus().disabled, 'dock minimum enabled');
  await render(<Dock amount={RECORD_AMOUNT_MAX} />); ensure(plus().disabled, 'dock maximum enabled');
  await render(<Dock busy />); ensure(!plus() && !minus(), 'busy dock exposed +/-');
  await render(<Dock locked />); ensure(!plus() && !minus(), 'locked dock exposed +/-');
  results.push('dock min/max and existing busy/locked visibility retained');

  writes.length = 0; await render(<Dock />);
  const rest = [...host.querySelectorAll<HTMLButtonElement>('.fr-choice')].find(b => b.textContent?.includes(todayCopy.choiceRest))!;
  await click(rest); ensure(writes.length === 1 && writes[0].choice.status === 'SKIPPED' && writes[0].choice.amount === null, 'rest contract altered');
  results.push('rest remains SKIPPED/null with no zero amount');
  ensure(host.textContent?.includes(todayCopy.choiceRest), 'rest label lost');

  // 選び直し中の「変更をやめる」は下の欄にあり、保存失敗後・昨日の訂正中もやめられる。保存中は押せない（#221）
  let cancelled = 0;
  const onCancel = () => { cancelled++; };
  const cancelButton = () => button(todayCopy.cancelChange);
  await render(<Dock onCancel={onCancel} />); ensure(!cancelButton(), 'cancel shown outside change mode');
  await render(<Dock amount={20} onCancel={onCancel} />); await click(cancelButton()); ensure(cancelled === 1, 'cancel in the dock did not stop the change');
  await render(<Dock amount={20} locked onCancel={onCancel} />); await click(cancelButton()); ensure(cancelled === 2, 'cancel absent while yesterday is being corrected');
  await render(<Dock amount={20} failed onCancel={onCancel} />); await click(cancelButton()); ensure(cancelled === 3, 'cancel absent after a failed save');
  // 保存中は欄が「保存中」の案内だけになり、やめる入口を出さない（押して保存の状態を消さない）
  await render(<Dock amount={20} busy onCancel={onCancel} />); ensure(!cancelButton() && cancelled === 3, 'cancel offered while saving');
  results.push('change-mode cancel lives in the dock, survives locked/failed states and is not offered while saving');
  document.getElementById('result')!.textContent = JSON.stringify({ok: true, results, writes});
}
run().catch(error => { document.getElementById('result')!.textContent = JSON.stringify({ok: false, error: String(error), results, writes}); });

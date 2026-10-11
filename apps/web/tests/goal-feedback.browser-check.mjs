import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import { build } from 'vite';
import react from '@vitejs/plugin-react';
import { launchBrowser } from './browser-startup.mjs';

test('#244: real form/Today at 320/390/768/1440, native input, confirmed feedback and failure suppression', { timeout: 240000 }, async t => {
  const browser = process.env.TEST_BROWSER ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  await access(browser);
  const dir = await mkdtemp(join(tmpdir(), 'futureroi-goal-feedback-'));
  let server, session;
  t.after(async () => {
    try { if (session) await session.stop(); }
    finally { if (server) await new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }); }
    if (!dir.startsWith(join(tmpdir(), 'futureroi-goal-feedback-'))) throw new Error('refusing unrelated cleanup');
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });
  const bundle = await build({ configFile: false, logLevel: 'silent', define: { 'process.env.NODE_ENV': '"development"' },
    resolve: { alias: { '@contracts': fileURLToPath(new URL('../../api/src/contracts/index.ts', import.meta.url)), '@tanstack/react-router': 'test:router' } },
    plugins: [react(), { name: 'qa-router', enforce: 'pre',
      resolveId: id => id === 'test:router' ? '\0test:router' : id.endsWith('/auth/client.ts') ? '\0test:auth' : null,
      load: id => id === '\0test:auth' ? 'export const authClient={};export const describeAuthError=(_code,fallback)=>fallback;' : id === '\0test:router' ? `import {createElement} from 'react';
        export const Link=({to,params,search,hash,children,...props})=>createElement('a',{href:to+(hash?'#'+hash:''),...props},children);
        export const useNavigate=()=>()=>{};export const useRouter=()=>({subscribe:()=>()=>{}});export const useLocation=()=>({href:location.pathname});` : null,
    }], build: { write: false, minify: false, lib: { entry: fileURLToPath(new URL('./goal-feedback.browser.tsx', import.meta.url)), formats: ['iife'], name: 'GoalQA' } } });
  t.signal.throwIfAborted();
  const outputs = (Array.isArray(bundle) ? bundle : [bundle]).flatMap(b => b.output);
  const code = outputs.filter(o => o.type === 'chunk').map(o => o.code).join('\n');
  const assets = new Map(outputs.filter(o => o.type === 'asset').map(o => ['/' + o.fileName, o.source]));
  const css = outputs.filter(o => o.type === 'asset' && o.fileName.endsWith('.css')).map(o => o.source).join('\n');
  const html = '<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>' + css + '</style><div id="app"></div><script>' + code.replaceAll('</script', '<\\/script') + '</script>';
  server = createServer((req, res) => {
    if (req.url === '/peer') {
      res.setHeader('Content-Type', 'text/html');
      res.end('<script>const channel=new BroadcastChannel("future-roi:save:qa-goal");channel.postMessage({sender:"synthetic-second-tab",type:"start"});</script>'); return;
    }
    if (assets.has(req.url)) { res.end(assets.get(req.url)); return; }
    res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(html);
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  session = launchBrowser({ browser, profile: join(dir, 'profile'), signal: t.signal,
    args: ['--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--remote-debugging-port=0', '--user-data-dir=' + join(dir, 'profile'), 'about:blank'],
    diagnostic: value => t.diagnostic(JSON.stringify(value)) });
  const cdp = await session.ready();
  const evaluate = async expression => {
    const r = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
    return r.result.value;
  };
  const until = async (expression, accept, message) => {
    let value;
    for (let i = 0; i < 300; i++) { value = await evaluate(expression); if (accept(value)) return value; await delay(20); }
    throw new Error(message + ': ' + JSON.stringify(value));
  };
  const state = 'window.__goalQA?.state()';
  const key = async (key, code, virtualKey) => {
    await cdp.send('Input.dispatchKeyEvent', { type: key === 'Enter' ? 'keyDown' : 'rawKeyDown', key, code, windowsVirtualKeyCode: virtualKey,
      ...(key === 'Enter' ? { text: '\r', unmodifiedText: '\r' } : {}) });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: virtualKey });
  };
  const activate = async selector => {
    await until(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});return !!e&&!e.disabled})()`, Boolean, 'native target disabled ' + selector);
    const focused = await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.focus();return document.activeElement===e})()`);
    assert.equal(focused, true, 'native target did not receive focus');
    await key('Enter', 'Enter', 13);
  };
  const input = async (selector, value) => {
    await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.focus();e.select()})()`);
    await cdp.send('Input.insertText', { text: value });
    await delay(30);
  };
  const click = async expression => {
    const box = await evaluate(`(()=>{const e=${expression};e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    for (const type of ['mousePressed', 'mouseReleased']) await cdp.send('Input.dispatchMouseEvent', { type, button: 'left', clickCount: 1, ...box });
    await delay(50);
  };
  const resize = async width => { await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false }); await delay(70); };
  await resize(390);
  await cdp.send('Page.navigate', { url: 'http://127.0.0.1:' + server.address().port });
  await until(state, v => v?.text?.includes('ゴールが遠ざかる'), 'Today did not mount');
  const evidence = [];
  const mount = async mode => {
    await evaluate(`window.__goalQA.mount(${JSON.stringify(mode)})`);
    await until(state, v => mode === 'list' ? v?.text?.includes('読み終えた本') : mode === 'create' || mode === 'edit' ? true : v?.text?.includes('ゴールが遠ざかる'), 'mount ' + mode);
    await until(mode === 'create' || mode === 'edit' ? '!!document.querySelector("#goal-totalRequired")' : 'true', Boolean, 'form absent');
    await delay(100);
  };
  const artifacts = process.env.FEQA_ARTIFACT_DIR;
  if (artifacts) await mkdir(artifacts, { recursive: true });
  const screenshot = async name => {
    if (!artifacts) return;
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    await writeFile(join(artifacts, name + '.png'), Buffer.from(shot.data, 'base64'));
  };
  for (const width of [320, 390, 768, 1440]) {
    await resize(width);
    for (const mode of ['list', 'create', 'edit', 'today']) {
      await mount(mode);
      await evaluate('document.fonts.ready');
      const layout = await evaluate(`(()=>{
        const visible=e=>e.getBoundingClientRect().width>0&&e.getBoundingClientRect().height>0;
        const root=document.querySelector('.fr-page');const chart=document.querySelector('.fr-today__history-chart');const right=document.querySelector('.fr-today__right');const records=document.querySelector('.fr-today__records');
        return {width:innerWidth,scroll:document.documentElement.scrollWidth,order:[...document.querySelector('.fr-today__scroll')?.children??[]].map(e=>e.className),
          chart:chart?.getBoundingClientRect().toJSON(),right:right?.getBoundingClientRect().toJSON(),records:records?.getBoundingClientRect().toJSON(),
          checked:[...document.querySelectorAll('input[name="goal-unit"]:checked')].map(e=>e.value),priorOpen:document.querySelector('#fr-goalform-prior')?.open,
          bodySize:getComputedStyle(root).fontSize, headings:[...document.querySelectorAll('h1,h2')].filter(visible).map(e=>e.textContent)}
      })()`);
      assert.ok(layout.scroll <= width, mode + ' horizontal overflow at ' + width);
      if (mode === 'create' || mode === 'edit') assert.equal(layout.checked.length, 1);
      if (mode === 'create') assert.equal(layout.priorOpen, true);
      if (mode === 'today') {
        assert.equal(layout.order.filter(n => n === 'fr-today__history-chart').length, 1);
        assert.ok(layout.chart.y >= (width >= 960 ? layout.records.bottom : layout.right.bottom) - 1, 'chart reading/layout order');
        if (width >= 960) assert.ok(layout.chart.right < layout.right.x);
      }
      if (mode === 'list') {
        const text = (await evaluate(state)).text;
        assert.ok(text.includes('決めた総量に届きました') && text.includes('積み上げを見る'));
      }
      await screenshot(mode + '-' + width);
      if (mode === 'today' && artifacts) {
        await evaluate('document.querySelector(".fr-today__history-chart").scrollIntoView({block:"start"})');
        await delay(70);
        await screenshot('today-chart-' + width);
      }
      evidence.push({ mode, ...layout });
    }
  }
  await resize(390); await mount('edit');
  assert.equal(await evaluate('document.querySelector("#goal-initialProgress").value'), '20');
  assert.equal(await evaluate('document.querySelector("#goal-initialProgress-minutes").value'), '40');
  await click('document.querySelectorAll("input[name=goal-initialProgress-mode]")[1]');
  assert.equal(await evaluate('document.querySelector("#goal-initialProgress").value'), '1240');
  await click('document.querySelectorAll("input[name=goal-initialProgress-mode]")[0]');
  await input('#goal-initialProgress-minutes', '60');
  assert.equal(await evaluate('document.querySelectorAll("input[name=goal-initialProgress-mode]")[1].disabled'), true);
  assert.equal(await evaluate('document.querySelector("#goal-initialProgress-minutes").value'), '60');
  await input('#goal-initialProgress-minutes', '40');
  assert.equal((await evaluate(state)).patches.length, 0, 'editing alone saved');
  await mount('create');
  await evaluate('document.querySelector("input[name=goal-unit][value=minutes]").focus()');
  await key('ArrowRight', 'ArrowRight', 39);
  assert.equal(await evaluate('document.querySelector("input[name=goal-unit]:checked").value'), 'sessions', 'native radio keyboard selection');
  await key('ArrowLeft', 'ArrowLeft', 37);
  assert.equal(await evaluate('document.querySelector("input[name=goal-unit]:checked").value'), 'minutes');
  await input('#goal-title', '200時間の合成Goal');
  await input('#goal-totalRequired', '200');
  await input('#goal-sessionAmount', '30');
  await click('[...document.querySelectorAll("button")].find(e=>e.textContent.trim()==="回答せずに進む")');
  assert.equal(await evaluate('document.querySelector("#fr-goalform-prior").open'), false);
  assert.equal(await evaluate('document.activeElement.id'), 'fr-goalform-prior-summary');
  await activate('button[type="submit"]');
  const created = await until(state, v => v?.creates?.length === 1, 'create absent');
  assert.equal(created.creates[0][0].totalRequired, 12000);
  assert.equal(created.creates[0][0].initialProgress, 0);
  assert.deepEqual(created.creates[0][0].questionPrior, { a: null, b: null }, 'optional questions must not be filled by default');
  evidence.push({ mode: '200 hour create body', ...created });
  await mount('create');
  await input('#goal-title', '回答を保持する合成Goal');
  await input('#goal-totalRequired', '200'); await input('#goal-sessionAmount', '30');
  await click('document.querySelector(".r11-qp input[value=HIGH]")');
  assert.equal(await evaluate('[...document.querySelectorAll("button")].some(e=>e.textContent.trim()==="回答せずに進む")'), false);
  await click('[...document.querySelectorAll("button")].find(e=>e.textContent.trim()==="回答欄を閉じる")');
  assert.equal(await evaluate('document.querySelector("#fr-goalform-prior").open'), false);
  await activate('button[type="submit"]');
  const partial = await until(state, v => v?.creates?.length === 1, 'partial answer create absent');
  assert.deepEqual(partial.creates[0][0].questionPrior, { a: 'HIGH', b: null });
  evidence.push({ mode: 'close selected answers preserves explicitly described body', ...partial });
  await mount('today');
  const feedbackHeight = await evaluate('document.querySelector(".fr-save-feedback").getBoundingClientRect().height');
  await activate('.fr-today__dock .fr-choice');
  const saved = await until(state, v => v?.feedback?.includes('+0.25パーセントポイント'), 'confirmed +0.25 points absent');
  assert.equal(saved.puts.length, 1);
  assert.ok(saved.feedback.includes('+30分'));
  assert.ok(saved.feedback.includes('保存前の表示との差'));
  assert.equal(await evaluate('document.querySelector(".fr-save-feedback").getBoundingClientRect().height'), feedbackHeight, 'feedback must not shift the layout');
  assert.equal(saved.active, 'fr-recorded-title', 'save must restore the recorded heading focus');
  await delay(400); // .35sの登場アニメーション終了後の色をレビューPNGに残す。
  await screenshot('today-save-390');
  evidence.push({ mode: 'save', ...saved });
  await click('[...document.querySelectorAll("button")].find(e=>e.textContent.trim()==="記録を変更")');
  for (let i = 0; i < 2; i++) await click('document.querySelector(".fr-today__dock button[aria-label^=量を減らす]")');
  await activate('.fr-today__dock .fr-choice');
  const corrected = await until(state, v => v?.feedback?.includes('−10分'), 'correction net delta absent');
  assert.equal(corrected.puts.length, 2);
  assert.equal(await evaluate('!!document.querySelector(".fr-save-feedback__increase")'), false);
  await screenshot('today-correction-390');
  evidence.push({ mode: 'correction', ...corrected });
  await mount('today'); await evaluate('window.__goalQA.failure("offline")');
  await activate('.fr-today__dock .fr-choice');
  const failed = await until(state, v => v?.puts?.length === 1 && v?.text?.includes('もう一度'), 'failure absent');
  assert.equal(failed.feedback, '');
  await evaluate('window.__goalQA.failure(null)');
  await click('[...document.querySelectorAll("button")].find(e=>e.textContent.includes("もう一度"))');
  const retried = await until(state, v => v?.puts?.length === 2 && v?.active === 'fr-recorded-title', 'retry absent');
  assert.equal(retried.feedback, '', 'retry must not celebrate uncertain baseline');
  assert.deepEqual(retried.puts[0], retried.puts[1], 'retry preserves the original body');
  await mount('today'); await evaluate('window.__goalQA.hold()');
  await activate('.fr-today__dock .fr-choice');
  await until(state, v => v?.puts?.length === 1, 'held save did not start');
  const otherTab = await cdp.send('Target.createTarget', { url: 'http://127.0.0.1:' + server.address().port + '/peer' });
  await delay(300);
  await evaluate('window.__goalQA.release()');
  const peerSave = await until(state, v => v?.active === 'fr-recorded-title', 'peer save did not finish');
  assert.equal(peerSave.feedback, '', 'detected same-origin tab activity must suppress uncertain increment');
  await cdp.send('Target.closeTarget', { targetId: otherTab.targetId });
  await cdp.send('Page.bringToFront');
  evidence.push({ mode: 'second native tab signal during held PUT', ...peerSave });
  await mount('today'); await evaluate('window.__goalQA.failure("409")');
  await activate('.fr-today__dock .fr-choice');
  const conflict = await until(state, v => v?.puts?.length === 1 && v?.text?.includes('最新'), '409 absent');
  assert.equal(conflict.feedback, '');
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await mount('today'); await activate('.fr-today__dock .fr-choice');
  await until(state, v => v?.feedback?.includes('+0.25'), 'reduced motion save absent');
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".fr-save-feedback__increase")).animationName'), 'none');
  assert.equal(await evaluate('document.querySelectorAll(".fr-save-feedback[aria-live=polite]").length'), 1);
  evidence.push({ mode: 'failure/retry/409/reduced-motion', failed, retried, conflict });
  if (artifacts) await writeFile(join(artifacts, 'browser-evidence.json'), JSON.stringify(evidence, null, 2));
  t.diagnostic(JSON.stringify({ scenarios: evidence.length, screenshots: artifacts ? 22 : 0, widths: [320,390,768,1440] }));
});

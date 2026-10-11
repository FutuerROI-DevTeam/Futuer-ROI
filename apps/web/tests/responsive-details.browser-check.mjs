import assert from 'node:assert/strict';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { build } from 'vite';
import react from '@vitejs/plugin-react';
import { launchBrowser } from './browser-startup.mjs';

// 既存Vite/React + Node24標準WebSocketのみ。実viewport/native入力を使い、matchMediaやclickをmockしない。
async function browserPath() {
  const candidates = [process.env.TEST_BROWSER, ...(process.platform === 'win32' ? [
    join(process.env.PROGRAMFILES ?? 'C:\\Program Files', 'Google/Chrome/Application/chrome.exe'),
    join(process.env['PROGRAMFILES(X86)'] ?? 'C:\\Program Files (x86)', 'Microsoft/Edge/Application/msedge.exe'),
  ] : process.platform === 'darwin' ? [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  ] : ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'])].filter(Boolean);
  for (const path of candidates) { try { await access(path); return path; } catch {} }
  throw new Error('Chromium not found: set TEST_BROWSER to an installed Chrome/Edge/Chromium executable (not a skipped PASS)');
}
async function until(read, accept, message, timeout = 10000) {
  const deadline = Date.now() + timeout;
  let value;
  while (Date.now() < deadline) { value = await read(); if (accept(value)) return value; await delay(20); }
  throw new Error(message + ': ' + JSON.stringify(value));
}
test('Today responsive details: real viewport, native keyboard and preserved user choice', { timeout: 180000 }, async (t) => {
  const browser = await browserPath(), dir = await mkdtemp(join(tmpdir(), 'futureroi-responsive-details-'));
  let server, session, cdp;
  t.after(async () => {
    let cleanupError;
    try { if (session) await session.stop(); } catch (error) { cleanupError = error; }
    finally { if (server) await new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }); }
    // 終了確認できないprofileは残す。cleanup失敗を元のtest結果とともに報告する。
    if (cleanupError) throw cleanupError;
    if (!dir.startsWith(join(tmpdir(), 'futureroi-responsive-details-'))) throw new Error('refusing cleanup outside test temp directory');
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });
  const bundle = await build({
    configFile: false, logLevel: 'silent', define: { 'process.env.NODE_ENV': '"development"' },
    resolve: { alias: { '@contracts': fileURLToPath(new URL('../../api/src/contracts/index.ts', import.meta.url)), '@tanstack/react-router': 'test:router' } },
    plugins: [react(), { name: 'native-correction-router', enforce: 'pre',
      resolveId: id => id === 'test:router' ? '\0test:router' : id.endsWith('/auth/client.ts') ? '\0test:auth' : null,
      load: id => id === '\0test:auth' ? 'export const authClient = {}; export const describeAuthError = (_code, fallback) => fallback;' : id === '\0test:router' ? `import {createElement} from 'react';
        export const Link=({to,params,search,children,...props})=>createElement('a',{href:to,...props},children);
        export const useNavigate=()=>()=>{}; export const useRouter=()=>({subscribe:()=>()=>{}}); export const useLocation=()=>({href:'/goals'});` : null,
    }],
    build: { write: false, minify: false, lib: {
      entry: fileURLToPath(new URL('./responsive-details.browser.tsx', import.meta.url)), formats: ['iife'], name: 'ResponsiveDetailsTests',
    } },
  });
  // build中のtimeoutではafterが先行する。終了済みtestの継続からHTTP/Chromeを起動しない。
  t.signal.throwIfAborted();
  const code = (Array.isArray(bundle) ? bundle : [bundle]).flatMap(b => b.output)
    .filter(out => out.type === 'chunk').map(out => out.code).join('\n');
  const html = '<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="app"></div><script>'
    + code.replaceAll('</script', '<\\/script') + '</script>';
  server = createServer((_, res) => { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(html); });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const url = 'http://127.0.0.1:' + server.address().port + '/';
  // loopback fixtureに不要なChrome自身の背景通信を抑える（Puppeteer標準起動と同じflag）。
  // sandbox/権限/描画/実入力/assertを保持。単一起動の10秒診断と30秒hard deadlineを分ける。
  const launchArgs = ['--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-background-networking',
    '--remote-debugging-port=0', '--user-data-dir=' + join(dir, 'profile'), 'about:blank'];
  session = launchBrowser({ browser, args: launchArgs, profile: join(dir, 'profile'), signal: t.signal,
    diagnostic: value => t.diagnostic(JSON.stringify(value)) });
  cdp = await session.ready();
  const evaluate = async expression => {
    const result = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const view = () => evaluate('window.__responsiveFixture?.view()');
  const resize = async width => {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
    await until(view, value => value?.width === width && value.desktop === (width >= 960), 'viewport/media did not update');
  };
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 900, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Page.navigate', { url });
  await until(view, value => !!value, 'React fixture did not mount');
  const state = async (open, message) => {
    await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    const value = await until(view, value => value?.open === open && value.contentVisible === open, message);
    assert.equal(value.open, open, message); assert.equal(value.contentVisible, open, message);
    return value;
  };
  const fresh = async width => {
    await resize(width); await evaluate('window.__responsiveFixture.mountDetails()');
    return state(width >= 960, 'fresh initial open state');
  };
  const click = async () => {
    const { x, y } = await evaluate('(() => { const r=document.querySelector("summary").getBoundingClientRect(); return {x:r.x+Math.min(30,r.width/2),y:r.y+r.height/2}; })()');
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  };
  const press = async (key, code, windowsVirtualKeyCode) => {
    // Enterはtextを伴うkeyDownでnative keypress/default actionまで送る。rawKeyDownだけではsummaryが作動しない。
    await cdp.send('Input.dispatchKeyEvent', { type: key === 'Enter' ? 'keyDown' : 'rawKeyDown', key, code, windowsVirtualKeyCode,
      ...(key === 'Enter' ? { text: '\r', unmodifiedText: '\r' } : {}) });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode });
  };
  const evidence = [];
  await t.test('fresh 959 closes / 960 opens and untouched details follow the media boundary', async () => {
    await fresh(959);
    for (const width of [960, 959, 1440, 320]) {
      await resize(width); evidence.push({ scenario: 'untouched', ...(await state(width >= 960, 'untouched width ' + width)) });
    }
    await fresh(960); await fresh(390);
  });
  await t.test('native click closes desktop and subsequent mobile/desktop resize keeps it closed', async () => {
    await fresh(960); await click(); await state(false, 'desktop click must close');
    for (const width of [959, 1440, 320, 960]) { await resize(width); await state(false, 'explicit closed at ' + width); }
    const value = await view(); assert.ok(value.inputs.some(event => event.type === 'click' && event.trusted));
    evidence.push({ scenario: 'explicit desktop closed', ...value });
  });
  await t.test('native click opens mobile and desktop/mobile resize keeps it open', async () => {
    await fresh(390); await click(); await state(true, 'mobile click must open');
    for (const width of [960, 1440, 320, 959]) { await resize(width); await state(true, 'explicit open at ' + width); }
    evidence.push({ scenario: 'explicit mobile open', ...(await view()) });
  });
  await t.test('Tab reaches native summary, Enter toggles and explicit closed survives resize', async () => {
    await fresh(390); await evaluate('document.activeElement?.blur()'); await press('Tab', 'Tab', 9);
    assert.equal((await view()).focusedSummary, true, 'native summary must receive keyboard focus');
    await press('Enter', 'Enter', 13); await state(true, 'Enter opens');
    await press('Enter', 'Enter', 13); await state(false, 'Enter closes');
    await resize(1440); const value = await state(false, 'keyboard choice survives desktop');
    assert.ok(value.inputs.some(event => event.type === 'keydown' && event.key === 'Enter' && event.trusted));
    assert.equal(value.focusedSummary, true, 'resize must preserve summary focus');
    evidence.push({ scenario: 'native Enter', ...value });
  });
  await t.test('native Space toggles desktop and preserves the chosen open state across boundaries', async () => {
    await fresh(960); await evaluate('document.querySelector("summary").focus()');
    await press(' ', 'Space', 32); await state(false, 'Space closes');
    await press(' ', 'Space', 32); await state(true, 'Space opens');
    for (const width of [959, 320, 1440]) { await resize(width); await state(true, 'Space open survives at ' + width); }
    const value = await view(); assert.ok(value.inputs.some(event => event.type === 'keyup' && event.key === ' ' && event.trusted));
    evidence.push({ scenario: 'native Space', ...value });
  });
  await t.test('actual cumulative quantity stays exact while percent/remaining cap at the goal', async () => {
    const cases = [
      { unit: 'sessions', done: 125, total: 100, percent: '100%', amount: '累計 125回', balances: { '目標量': '100回', '残り': '0回', '目標を超えた量': '25回' } },
      { unit: 'sessions', done: 100, total: 100, percent: '100%', amount: '累計 100回', balances: { '目標量': '100回', '残り': '0回' } },
      { unit: 'sessions', done: 99, total: 100, percent: '99%', amount: '累計 99回', balances: { '目標量': '100回', '残り': '1回' } },
      { unit: 'sessions', done: 999, total: 1000, percent: '99%', amount: '累計 999回', balances: { '目標量': '1,000回', '残り': '1回' } },
      { unit: 'minutes', done: 125, total: 100, percent: '100%', amount: '累計 2時間5分', balances: { '目標量': '1時間40分', '残り': '0時間0分', '目標を超えた量': '0時間25分' } },
      { unit: 'minutes', done: 100, total: 100, percent: '100%', amount: '累計 1時間40分', balances: { '目標量': '1時間40分', '残り': '0時間0分' } },
      { unit: 'minutes', done: 25, total: 100, percent: '25%', amount: '累計 0時間25分', balances: { '目標量': '1時間40分', '残り': '1時間15分' } },
    ];
    for (const expected of cases) {
      await evaluate('window.__responsiveFixture.mountProgress(' + JSON.stringify(expected.unit) + ',' + expected.done + ',' + expected.total + ')');
      const value = await until(view, value => value?.amount === expected.amount, 'progress did not mount');
      assert.equal(value.amount, expected.amount); assert.equal(value.percent, expected.percent);
      assert.equal(value.ariaPercent, expected.percent.replace('%', '')); assert.deepEqual(value.balances, expected.balances);
      evidence.push({ scenario: 'actual quantity', unit: expected.unit, done: expected.done, total: expected.total, amount: value.amount, percent: value.percent, balances: value.balances });
    }
  });
  await t.test('native Enter on dock plus changes amount in place; change amount enters named group, reaches input without autoFocus and cancel restores entry', async () => {
    await resize(390); await evaluate('window.__responsiveFixture.mountDock()');
    const plus = 'document.querySelector(".fr-record__amount-controls button[aria-label^=量を増やす]")';
    const shown = 'document.querySelector(".fr-record__amount-text")?.textContent';
    const before = await evaluate(shown);
    await evaluate(plus + '.focus()'); await press('Enter', 'Enter', 13);
    // −／＋はその場で量を変え、入力欄は開かない。フォーカスも＋に残る（#199）
    const after = await until(() => evaluate(shown), value => value && value !== before, 'dock plus did not change the amount in place');
    assert.ok(!(await evaluate('!!document.querySelector(".fr-amount")')), 'dock plus must not open the editor');
    assert.ok((await view()).focused.name?.startsWith('量を増やす'), 'focus must stay on plus');
    evidence.push({ scenario: 'native dock plus in place', before, after });
    await evaluate('[...document.querySelectorAll(".fr-record__amount-controls button")].find(b => b.textContent.trim() === "量を変更").focus()');
    await press('Enter', 'Enter', 13);
    const group = await until(view, value => value?.focused?.role === 'group', 'amount group did not receive focus');
    assert.equal(group.focused.name, '今日記録する量');
    assert.notEqual(group.focused.tag, 'INPUT', 'mount must not focus the numeric field');
    await press('Tab', 'Tab', 9); assert.ok((await view()).focused.name?.startsWith('量を減らす'));
    await press('Tab', 'Tab', 9); assert.equal((await view()).focused.tag, 'INPUT');
    await evaluate('[...document.querySelectorAll("button")].find(b => b.textContent.trim() === "戻る").focus()');
    await press('Enter', 'Enter', 13);
    assert.ok((await view()).focused.text?.trim().startsWith('量を変更') || (await view()).focused.name?.startsWith('量を変更'), 'cancel must restore the change amount trigger');
    evidence.push({ scenario: 'native amount group / Tab / cancel', ...(await view()) });
  });
  await t.test('yesterday stays closed initially and preserves open state on same-day render; saving/failure reveal', async () => {
    await evaluate('window.__responsiveFixture.mountYesterday(false, true)'); await state(false, 'initial yesterday must close');
    await evaluate('document.querySelector("summary").focus()'); await press('Enter', 'Enter', 13); await state(true, 'yesterday Enter opens');
    await evaluate('window.__responsiveFixture.mountYesterday(false)'); await state(true, 'same-day render must preserve open');
    await evaluate('window.__responsiveFixture.mountYesterday("saving")'); await state(true, 'saving reveals');
    await press('Enter', 'Enter', 13); await state(false, 'user can collapse while saving');
    await evaluate('window.__responsiveFixture.mountYesterday("failed")'); await state(true, 'failure must reveal after a collapsed save');
    await evaluate('window.__responsiveFixture.mountYesterday("failed", true)'); await state(true, 'failure remount must reveal');
    evidence.push({ scenario: 'native yesterday save/failure visibility', ...(await view()) });
  });
  await t.test('actual Today hooks: native yesterday DONE/SKIPPED cancellation restores its entry with no save', async () => {
    for (const width of [390, 1440]) for (const status of ['DONE', 'SKIPPED']) {
      await resize(width); await evaluate('window.__responsiveFixture.mountCorrection(' + JSON.stringify(status) + ')');
      await until(view, value => value?.correctionSummary, 'recorded yesterday did not mount');
      await evaluate('document.querySelector(".fr-yesterday--summary button").focus()');
      await press('Enter', 'Enter', 13);
      await until(view, value => value?.correctionVisible, 'native edit entry did not open');
      // 今日の「記録を変更」と同じ形（#221）：訂正の見出しへフォーカスを移し、量は−／＋でその場で変える（保存しない）
      const opened = await until(view, value => value?.focused?.text?.startsWith('昨日（'), 'correction heading did not receive focus');
      if (status === 'DONE') {
        await evaluate('document.querySelector(".fr-yesterday button[aria-label^=\\"量を増やす\\"]").focus()');
        await press('Enter', 'Enter', 13);
        await until(view, value => !!value?.correctionAmount && value.correctionAmount !== opened.correctionAmount, 'native correction draft did not change');
      }
      await evaluate('[...document.querySelectorAll(".fr-yesterday button")].find(b => b.textContent.trim() === "変更をやめる").focus()');
      await press('Enter', 'Enter', 13);
      const value = await until(view, value => value?.correctionSummary, 'cancel did not restore recorded summary');
      assert.equal(value.focused.tag, 'BUTTON', 'cancel lost focus to BODY');
      assert.equal(await evaluate('document.activeElement === document.querySelector(".fr-yesterday--summary button")'), true, 'cancel did not return to remounted original entry');
      assert.equal(value.puts, 0, 'cancellation sent a PUT');
      evidence.push({ scenario: 'actual Today native yesterday cancel', status, ...value });
    }
  });
  await t.test('actual outlook SVG: cut dates stay ordered, bounded and separated at narrow/PC widths (PR212)', async () => {
    const cases = [[3, 3, 10], [0, 0, 1], [30, 30, 91], [3, 3, 12], [5, 8, 365], [200, null, 1500], [30, 45, 135], [null, null, 365]];
    for (const width of [252, 322, 581, 600]) {
      await resize(width === 252 ? 320 : width === 322 ? 390 : 1280);
      for (const [p50, p80, targetDays] of cases) {
        const label = `${width}px ${p50}/${p80}/${targetDays}`;
        await evaluate('window.__responsiveFixture.mountOutlook("2026-10-20",' + [p50, p80, targetDays, width].map(value => JSON.stringify(value)).join(',') + ')');
        const value = await until(() => evaluate('window.__responsiveFixture.outlookState()'), v => v?.width === (p50 === null ? null : width), 'axis width ' + label);
        if (p50 === null) { assert.equal(value.texts.length, 0); continue; }
        assert.equal(value.visible, true, label); assert.equal(value.fontLoaded, true, label);
        const points = [{ x: 20, day: 0 }, ...value.markers.map((x, i) => ({ x, day: i === 0 ? p50 : p80 })), { x: value.target, day: targetDays }];
        let year = 2026;
        for (const tick of value.ticks) {
          if (tick.year) year = Number(tick.year.slice(0, -1));
          const day = (Date.UTC(year, Number(tick.label.slice(0, -1)) - 1, 1) - Date.parse('2026-10-20T00:00:00Z')) / 86400000;
          if (value.cut) assert.ok(day < targetDays, label + ': month must precede target');
          points.push({ x: tick.x, day });
        }
        points.sort((a, b) => a.x - b.x);
        for (let i = 1; i < points.length; i++) assert.ok(points[i].day >= points[i - 1].day, label + ': date order');
        for (const text of value.texts) {
          assert.ok(text.font.includes('Zen Maru Gothic') && text.size === '11px', label + ': actual chart font ' + JSON.stringify(text));
          assert.ok(text.x >= -0.25 && text.x + text.width <= width + 0.25, label + ': text bounds ' + text.label);
          // SVGは製品CSSでoverflow:visible。baseline近くのglyphをSVGの130pxで切らず、実際の親領域内に収まることを検査する。
          assert.ok(text.paintedTop >= 0 && text.paintedBottom <= value.frameHeight, label + ': vertical paint bounds ' + JSON.stringify(text));
        }
        for (let i = 0; i < value.texts.length; i++) for (let j = i + 1; j < value.texts.length; j++) {
          const a = value.texts[i], b = value.texts[j];
          const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
          const overlapY = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
          assert.ok(overlapX <= 0.25 || overlapY <= 0.25, label + ': overlapping labels ' + a.label + '/' + b.label);
        }
        evidence.push({ scenario: 'actual outlook SVG', width, p50, p80, targetDays, ...value });
      }
    }
  });
  t.diagnostic(JSON.stringify({ browserEndpointSource: session.diagnostics().endpointSource, results: evidence }));
});

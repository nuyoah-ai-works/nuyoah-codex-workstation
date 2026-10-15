import assert from 'node:assert/strict';
import test from 'node:test';
import { projectMagpieQuotas, selectCodexQuota, createMagpieQuotaService } from '../nuyoah/workstation/magpie-quota.mjs';
import { createMagpieQuotaUI } from '../nuyoah/workstation/magpie-quota-ui.mjs';

const payload = { data: [{ provider: 'codex', user: 'demo@example.invalid', plan: 'pro', token: 'not-forwarded',
  windows: [{ name: '7 days', used: 46, remaining: 54, resetsAt: '2030-01-01T00:00:00Z' }] }] };
test('quota projection preserves actual windows and zero, omits credentials and raw identities', () => {
  const accounts = projectMagpieQuotas(payload);
  assert.equal(accounts[0].windows.length, 1); assert.equal(accounts[0].windows[0].name, '本周');
  assert.equal(accounts[0].windows[0].used, 46);
  assert.ok(!JSON.stringify(accounts).includes('demo@example.invalid'));
  assert.ok(!JSON.stringify(accounts).includes('not-forwarded'));
  const windows = projectMagpieQuotas({ data: [{ windows: [{ name: 'zero', used: 0 }, { name: 'missing', used: null }, { name: 'bad', used: 110 }, { name: 'remaining', remaining: 75 }] }] })[0].windows;
  assert.deepEqual(windows.map(w => w.used), [0, null, null, 25]);
  assert.equal(projectMagpieQuotas({ data: [] }).length, 0);
  assert.throws(() => projectMagpieQuotas({}));
});
test('multiple Codex accounts require selection or actual recent usage; identifiers survive reorder', () => {
  const second = { ...payload.data[0], user: 'other@example.invalid' };
  const a = projectMagpieQuotas({ data: [...payload.data, second] });
  assert.equal(selectCodexQuota(a), null); assert.equal(selectCodexQuota(a, a[1].id), a[1]);
  assert.equal(selectCodexQuota([a[0]]), a[0]);
  assert.equal(projectMagpieQuotas({ data: [second, ...payload.data] })[1].id, a[0].id);
  a[0].lastServedAt = '2030-01-01T00:00:00Z'; assert.equal(selectCodexQuota(a), a[0]);
});
test('local reads coalesce, throttle, retain marked stale data and bound response size', async () => {
  let calls = 0, now = 0, fail = false;
  const service = createMagpieQuotaService({ now: () => now, fetchImpl: async (url, options) => {
    assert.equal(url, 'http://127.0.0.1:3425/v1/magpie/quotas'); assert.equal(options.redirect, 'error');
    calls++; if (fail) throw new Error('private detail'); return new Response(JSON.stringify(payload));
  } });
  const [a,b] = await Promise.all([service.read(), service.read()]); assert.equal(calls, 1); assert.equal(a,b);
  await service.read(); assert.equal(calls, 1); now = 60_001; fail = true;
  const stale = await service.read(); assert.equal(stale.status, 'unavailable'); assert.equal(stale.accounts.length, 1);
  assert.ok(!JSON.stringify(stale).includes('private detail'));
  const huge = createMagpieQuotaService({ fetchImpl: async () => new Response('x'.repeat(300_000)) });
  assert.equal((await huge.read()).status, 'unavailable');
});
test('management only opens the fixed installed application; launch errors are bounded', async () => {
  let invocation;
  const service = createMagpieQuotaService({ executeImpl: async (...args) => { invocation = args; } });
  assert.equal((await service.open()).status, 'opened');
  assert.deepEqual(invocation.slice(0,2), ['/usr/bin/open', ['-b', 'com.yetone.magpie']]);
  assert.equal((await createMagpieQuotaService({ executeImpl: async () => { throw new Error('private'); } }).open()).status, 'open-failed');
});
test('quota UI handles actual windows, keyboard, lifecycle, narrow layout and errors', {
  skip: !process.env.NUYOAH_PLAYWRIGHT_MODULE, timeout: 60000,
}, async () => {
  const { chromium } = await import(process.env.NUYOAH_PLAYWRIGHT_MODULE);
  const browser = await chromium.launch({ headless: true, ...(process.env.NUYOAH_PLAYWRIGHT_EXECUTABLE ? { executablePath: process.env.NUYOAH_PLAYWRIGHT_EXECUTABLE } : {}) });
  const page = await browser.newPage({ viewport: { width: 900, height: 800 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  try {
    await page.setContent('<style>body{margin:0}aside{width:440px}header{display:flex;align-items:center;height:42px}header>button{flex-shrink:0} .native{margin-left:auto}</style><aside><header><button aria-haspopup="menu">Codex</button><div class="native"><button>通知</button><button>搜索</button></div></header></aside><input id="draft" value="preserved">');
    await page.evaluate(`window.ui=(${createMagpieQuotaUI.toString()})({window,selectCodex:${selectCodexQuota.toString()}})`);
    const data = { status: 'ok', accounts: projectMagpieQuotas(payload) };
    await page.evaluate(data => { const r = window.ui.takeRequest(); window.ui.receive({ id: r.id, data }); }, data);
    const trigger = page.locator('#nuyoah-magpie-quota'), panel = page.locator('#nuyoah-magpie-quota-panel');
    assert.match(await trigger.innerText(), /本周/); assert.doesNotMatch(await trigger.innerText(), /5 小时/);
    assert.equal(await panel.isVisible(), false); await trigger.click(); assert.equal(await panel.isVisible(), true);
    assert.match(await panel.innerText(), /已用 46%/);
    await page.keyboard.press('Escape'); await panel.waitFor({ state: 'hidden' }); assert.equal(await panel.isVisible(), false); assert.equal(await trigger.evaluate(n => n === document.activeElement), true);
    await trigger.click();
    // Refresh keeps the clicked button, account nodes alive.
    await page.evaluate(() => { window.cardBefore = document.querySelector('.mq-card'); window.refreshBefore = document.querySelector('.mq-actions button'); });
    await page.getByRole('button', { name: '刷新额度', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: '刷新额度', exact: true }).getAttribute('aria-disabled'), 'true');
    await page.evaluate(data => { const r = window.ui.takeRequest(); window.ui.receive({ id: r.id, data }); }, data);
    assert.equal(await page.evaluate(() => window.cardBefore === document.querySelector('.mq-card') && window.refreshBefore === document.activeElement), true);
    // A new open cancels an in-flight close; its old completion must not hide it.
    await page.evaluate(() => { const t=document.querySelector('#nuyoah-magpie-quota'); t.click(); t.click(); });
    await page.waitForTimeout(380); assert.equal(await panel.isVisible(), true);
    assert.equal(await trigger.getAttribute('aria-expanded'), 'true');
    await page.getByRole('button', {name:'账号管理 ↗',exact:true}).click();
    assert.equal(await page.evaluate(() => window.ui.takeRequest().action), 'open');
    await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 320, height: 700 }); await page.evaluate(() => document.querySelector('aside').style.width='300px');
    await page.waitForTimeout(1100); const bounds = await trigger.boundingBox(); assert.ok(bounds.x + bounds.width <= 300);
    await trigger.click(); const box = await panel.boundingBox(); assert.ok(box.x >= 0 && box.x + box.width <= 320);
    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
    await page.keyboard.press('Escape'); assert.equal(await panel.isVisible(), false);
    await trigger.click(); assert.equal(await panel.evaluate(n => n.getAnimations().length), 0);
    assert.equal(await trigger.evaluate(n => getComputedStyle(n).transitionDuration), '0s');
    await page.evaluate(() => window.ui.destroy()); assert.equal(await trigger.count(),0); assert.equal(await panel.count(),0);
    assert.equal(await page.locator('#draft').inputValue(), 'preserved');
    await page.evaluate(`window.ui=(${createMagpieQuotaUI.toString()})({window,selectCodex:${selectCodexQuota.toString()}})`);
    await page.evaluate(data => { const r=window.ui.takeRequest(); window.ui.receive({id:r.id,data:{...data,status:'unavailable'}}); },data);
    assert.match(await trigger.innerText(),/额度暂不可用/); assert.doesNotMatch(await trigger.innerText(),/46%/);
    assert.deepEqual(errors,[]);
  } finally { await browser.close(); }
});

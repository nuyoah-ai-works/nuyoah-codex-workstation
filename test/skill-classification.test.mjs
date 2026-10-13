import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createSkillClassification } from '../nuyoah/skills/classification.mjs';

test('single primary categories follow names, not generated copy or source paths', () => {
  const taxonomy = createSkillClassification();
  assert.equal(taxonomy.labels.length, 8);
  for (const [name, expected] of [
    ['director-seedance-prompt', '视频创作'],
    ['nuyoah-character-asset-generator', '图像生成与视觉设计'],
    ['nuyoah-cover-image', '自媒体运营与写作'],
    ['nuyoah-director-david-fincher', '图像生成与视觉设计'],
    ['nuyoah-director-skill-builder', 'Skill创建与治理'],
    ['nuyoah-codex-image-to-eagle', '知识管理与素材归档'],
    ['fact-claim-audit', '研究分析与思维方法'],
    ['figma:figma-use', '软件开发与工作效率'],
    ['spreadsheets:Spreadsheets', '办公文档与协作'],
    ['adobe:adobe-edit-quick-cut', '视频创作'],
  ]) {
    assert.equal(taxonomy.categoryFor({ name, title: '生成工具', description: '生成图片和视频', path: '/fixture/video' }), expected);
  }
  assert.equal(taxonomy.categoryFor({ name: 'brand-new', description: '生成' }), '未分类');
  assert.equal(taxonomy.categoryFor({ name: 'instructions' }), '未分类', 'ambiguous plugin names are not guessed');
  assert.equal(taxonomy.categoryFor(null), '未分类');
});

test('classification factory serializes into a renderer without module dependencies', () => {
  const taxonomy = vm.runInNewContext(`(${createSkillClassification.toString()})()`);
  assert.equal(taxonomy.categoryFor({ name: 'nuyoah-writer' }), '自媒体运营与写作');
  assert.equal(new Set(taxonomy.labels).size, 8);
});

test('Skills UI filters by category and search, refreshes counts and preserves selection and draft', {
  skip: !process.env.NUYOAH_PLAYWRIGHT_MODULE, timeout: 60000,
}, async () => {
  const { chromium } = await import(process.env.NUYOAH_PLAYWRIGHT_MODULE);
  const source = await readFile(new URL('../inject/conversation-preview.user.js', import.meta.url), 'utf8');
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    :root{color-scheme:light dark;--color-token-bg-primary:Canvas;--color-token-text-primary:CanvasText}*{box-sizing:border-box}body{background:Canvas;color:CanvasText;margin:0;height:900px;display:flex;font:14px system-ui}[hidden]{display:none!important}
    aside{width:220px}main{flex:1;min-width:0;display:flex;flex-direction:column;padding-top:48px}
    header[data-app-shell-titlebar]{position:fixed;top:0;left:220px;right:0;height:48px;display:flex;justify-content:flex-end}
    #workspace{position:relative;display:flex;flex:1;min-height:0;overflow:hidden}[data-app-shell-main-content-layout]{flex:1;min-width:0}.native-frame{height:100%;width:100%}
    </style></head><body><aside>验收导航</aside><main><header data-app-shell-titlebar><div data-app-shell-header-slot="end"><div data-app-shell-header-slot-content><button>新建标签页</button></div></div></header>
    <div id="workspace"><div data-app-shell-main-content-layout><div class="native-frame"><div data-codex-composer="true" contenteditable="true">保留验收草稿</div></div></div></div></main></body></html>`;
  const server = createServer((req, res) => { res.setHeader('content-type', 'text/html;charset=utf-8'); res.end(html); });
  let browser;
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    browser = await chromium.launch({ executablePath: process.env.NUYOAH_TEST_BROWSER, headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.setDefaultTimeout(5000);
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.evaluate(factory => {
      window.__nuyoahSkillClassification__ = (0, eval)(`(${factory})`)();
      window.__NUYOAH_WORKSTATION_CONFIG__ = { skills: { categories: [{ label: '自定义', keywords: ['验收'] }] } };
      window.electronBridge = { getSharedObjectSnapshotValue: () => [], getInitialSidebarBootstrap: () => ({ catalogEntries: [] }), sendMessageFromView: () => {} };
    }, createSkillClassification.toString());
    await page.addScriptTag({ content: source });
    const entries = ['director-seedance-prompt', 'nuyoah-character-asset-generator', 'nuyoah-cover-image', 'nuyoah-meta-skill', 'documents', 'unknown-skill'].map(name => ({
      name, title: name, description: name, summary: '验收用途', labelStatus: 'ready', sourceDescription: '图片视频生成',
    }));
    await page.evaluate(entries => {
      window.__codexConversationPreviewInjection__.setSkillCatalog(entries);
      window.__codexConversationPreviewInjection__.openWorkstationPanel('skills');
    }, entries);
    const filter = label => page.locator(`[data-codex-skill-filter="${label}"]`);
    const cards = page.locator('.codex-skill-row');
    const visibleNames = () => page.locator('.codex-skill-callable').allTextContents();
    await cards.first().waitFor({ state: 'visible' });
    assert.equal(await cards.count(), 6);
    assert.equal(await filter('视频创作').textContent(), '视频创作 1');
    await filter('视频创作').click();
    await page.waitForFunction(() => document.querySelector('.codex-skill-result-count')?.textContent === '1 / 6');
    assert.deepEqual(await visibleNames(), ['director-seedance-prompt']);
    await filter('图像生成与视觉设计').focus(); await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('.codex-skill-callable')?.textContent === 'nuyoah-character-asset-generator');
    const search = page.getByRole('searchbox');
    await search.fill('cover'); assert.equal(await cards.count(), 0);
    await search.fill('character'); assert.equal(await cards.count(), 1);
    await page.evaluate(entries => window.__codexConversationPreviewInjection__.setSkillCatalog([...entries, { ...entries[0], name: 'brand-new' }]), entries);
    assert.equal(await filter('未分类').textContent(), '未分类 2');
    assert.equal(await filter('图像生成与视觉设计').getAttribute('aria-pressed'), 'true');
    await page.evaluate(() => { window.__codexConversationPreviewInjection__.openWorkstationPanel('project'); window.__codexConversationPreviewInjection__.openWorkstationPanel('skills'); });
    assert.equal(await search.inputValue(), 'character');
    assert.equal(await filter('图像生成与视觉设计').getAttribute('aria-pressed'), 'true');
    await search.fill(''); await filter('未分类').click();
    await page.waitForFunction(() => document.querySelectorAll('.codex-skill-row').length === 2);
    assert.deepEqual((await visibleNames()).sort(), ['brand-new', 'unknown-skill']);
    await filter('自定义').click();
    await page.waitForFunction(() => document.querySelectorAll('.codex-skill-row').length === 7);
    await filter('软件开发与工作效率').click();
    await page.waitForFunction(() => !!document.querySelector('.codex-skill-empty'));
    await filter('全部').click(); await page.waitForFunction(() => document.querySelectorAll('.codex-skill-row').length === 7);
    await page.setViewportSize({ width: 1200, height: 900 });
    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
    assert.equal(await cards.first().locator('.codex-skill-category').textContent(), '视频创作');
    await cards.first().waitFor({ state: 'visible' });
    await page.waitForFunction(() => { const p = document.querySelector('[data-nuyoah-workstation-panel-frame=skills]') || document.querySelector('.codex-skill-filter-list')?.closest('section'); return p?.getBoundingClientRect().width >= 419; });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const fits = await page.locator('.codex-skill-filter-list').evaluate(e => e.scrollWidth <= e.clientWidth + 1);
    assert.equal(fits, true);
    assert.equal(await page.locator('.codex-skill-filter-list').evaluate(e => { const p=e.closest('section'),r=p.getBoundingClientRect(); return p.parentElement.id==='workspace' && r.right<=innerWidth+1 && r.bottom<=innerHeight+1; }), true);
    assert.equal(await cards.evaluateAll(rows => rows.every(row => row.querySelector('.codex-skill-category').getBoundingClientRect().bottom <= row.getBoundingClientRect().bottom - 1)), true, 'category badges stay inside their cards');
    assert.equal(await page.locator('[data-codex-composer]').textContent(), '保留验收草稿');
    assert.deepEqual(errors, []);
    if (process.env.NUYOAH_SKILL_SCREENSHOT) await page.screenshot({ path: process.env.NUYOAH_SKILL_SCREENSHOT });
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
});

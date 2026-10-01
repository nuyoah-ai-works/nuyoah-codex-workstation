import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

// Execute the production host function without starting the resident injector.
const source = await readFile(new URL('../vendor/codex-taskboard/scripts/codex-injector.mjs', import.meta.url), 'utf8');
const functionText = source.slice(source.indexOf('async function prefillTaskComposerViaCdp('), source.indexOf('\nasync function submitTaskComposerViaCdp('));
const prefill = vm.runInNewContext(`(${functionText})`, { setTimeout });

test('Skill insertion preserves rich drafts in an isolated browser', { skip: !process.env.NUYOAH_PLAYWRIGHT_MODULE }, async () => {
  const { chromium } = await import(process.env.NUYOAH_PLAYWRIGHT_MODULE);
  const browser = await chromium.launch({ executablePath: process.env.NUYOAH_TEST_BROWSER, headless: true });
  try {
    const page = await browser.newPage();
    const request = { instruction: ' ', skillDisplayName: 'Example', skillName: 'example', skillPath: '/fixture/example/SKILL.md', preserveDraft: true };
    const cdp = { send: async (method, params) => {
      if (method === 'Runtime.evaluate') return { result: { value: await page.evaluate(params.expression) } };
      assert.equal(method, 'Input.insertText');
      await page.keyboard.insertText(params.text);
      if (params.text === '$example') await page.evaluate(() => {
        const overlay = document.createElement('div'); overlay.dataset.composerOverlayFloatingUi = 'true';
        const button = document.createElement('button'); button.dataset.listNavigationItem = 'true'; button.innerHTML = '<span>Example</span>';
        button.onclick = () => {
          const selection = getSelection(); const range = selection.getRangeAt(0);
          range.setStart(range.endContainer, range.endOffset - '$example'.length); range.deleteContents();
          const chip = document.createElement('span'); chip.contentEditable = 'false'; chip.setAttribute('skill-mention-name', 'example'); chip.setAttribute('skill-mention-path', '/fixture/example/SKILL.md'); chip.textContent = '$example';
          range.insertNode(chip); range.setStartAfter(chip); range.collapse(true); selection.removeAllRanges(); selection.addRange(range); overlay.remove();
        };
        overlay.append(button); document.body.append(overlay);
      });
      return {};
    } };
    const drafts = ['', '已经写好的中文需求\n第二行', '<p>第一段</p><p>第二段 <span contenteditable="false" skill-mention-name="old" skill-mention-path="/fixture/old">$old</span></p>'];
    for (const draft of drafts) {
      await page.setContent(`<form><div data-codex-composer="true" contenteditable="true">${draft}</div><button type="button" onclick="window.sent=true">发送</button></form>`);
      const original = await page.locator('[contenteditable=true]').textContent();
      await page.evaluate(() => { const r = document.createRange(); r.selectNodeContents(document.querySelector('[contenteditable=true]')); getSelection().removeAllRanges(); getSelection().addRange(r); });
      assert.equal((await prefill(cdp, undefined, request)).prefilled, true);
      assert.ok((await page.locator('[contenteditable=true]').textContent()).startsWith(original));
      assert.equal(await page.locator('[skill-mention-name=example]').count(), 1);
      if (draft.includes('$old')) assert.equal(await page.locator('[skill-mention-name=old]').count(), 1);
      const after = await page.locator('[contenteditable=true]').innerHTML();
      await prefill(cdp, undefined, request);
      assert.equal(await page.locator('[contenteditable=true]').innerHTML(), after, 'duplicate click leaves draft unchanged');
      assert.equal(await page.evaluate(() => Boolean(window.sent)), false);
    }
    await page.setContent('<div data-codex-composer="true" contenteditable="true">new-task placeholder</div>');
    await prefill(cdp, undefined, { ...request, instruction: "new task instruction", preserveDraft: false });
    assert.equal((await page.locator('[contenteditable=true]').textContent()).includes('placeholder'), false);
  } finally { await browser.close(); }
});

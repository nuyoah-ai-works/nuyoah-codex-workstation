#!/usr/bin/env node

import { connectMainCodex } from "./cdp-client.mjs";

const port = Number(process.env.CODEX_SIDEBAR_PORT || 9231);
const client = await connectMainCodex(port);

async function waitFor(expression, timeoutMs = 6_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const value = await client.evaluate(expression).catch(() => null);
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return null;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function dispatchRealMouseClick({ x, y }) {
  await client.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 2, y: 2 });
  await sleep(30);
  await client.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  // Cross the sidebar's 80 ms sync boundary while the pointer is pressed. A
  // filter control that gets replaced during this gesture will lose `click`.
  await sleep(55);
  await client.send("Input.dispatchMouseEvent", {
    type: "mousePressed", x, y, button: "left", clickCount: 1,
  });
  await sleep(55);
  await client.send("Input.dispatchMouseEvent", {
    type: "mouseReleased", x, y, button: "left", clickCount: 1,
  });
}

async function verifyRealSkillFilter(label) {
  const target = await client.evaluate(`(() => {
    const organizer = document.getElementById('codex-skill-organizer');
    const button = Array.from(organizer?.querySelectorAll('[data-codex-skill-filter]') || [])
      .find((candidate) => candidate.textContent.trim() === ${JSON.stringify(label)});
    if (!organizer || !button) return null;
    window.__codexSkillFilterGestureTarget = button;
    const rect = button.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, label: button.textContent.trim() };
  })()`);
  if (!target) throw new Error(`Skills 分组缺少真实鼠标回归目标：${label}`);
  await dispatchRealMouseClick(target);
  const immediate = await client.evaluate(`(() => {
    const organizer = document.getElementById('codex-skill-organizer');
    const button = window.__codexSkillFilterGestureTarget;
    return {
      label: ${JSON.stringify(label)},
      selectedImmediately: button?.getAttribute('aria-pressed') === 'true',
      remainedConnected: button?.isConnected === true,
      activeFilter: organizer?.querySelector('[data-codex-skill-filter][aria-pressed="true"]')?.textContent?.trim() || '',
    };
  })()`);
  if (!immediate?.selectedImmediately || !immediate.remainedConnected || immediate.activeFilter !== label) {
    throw new Error(`Skills 分组 Tab 没有在真实单击后提交选中态：${JSON.stringify(immediate)}`);
  }
  const settledRows = await waitFor(`(() => {
    const organizer = document.getElementById('codex-skill-organizer');
    const active = organizer?.querySelector('[data-codex-skill-filter][aria-pressed="true"]')?.textContent?.trim();
    const count = organizer?.querySelectorAll('.codex-skill-row').length || 0;
    return active === ${JSON.stringify(label)} && !organizer?.hasAttribute('aria-busy') && count > 0 ? count : null;
  })()`, 8_000);
  if (!settledRows) throw new Error(`Skills 分组 Tab “${label}”没有更新卡片内容`);
  return { ...immediate, settledRows };
}

try {
  const shortcuts = await waitFor(`(() => {
    const names = Array.from(document.querySelectorAll('[data-codex-sidebar-shortcut-card]')).map((button) => button.dataset.codexSidebarShortcutName);
    return names.includes('Skills 分组') && names.includes('资产控制台') ? names : null;
  })()`);
  if (!shortcuts) throw new Error("两个增强入口没有同时显示");

  const settings = await client.evaluate(`(() => {
    document.getElementById('codex-sidebar-shortcut-settings-button')?.click();
    const dialog = document.getElementById('codex-sidebar-shortcut-settings-dialog');
    const labels = Array.from(dialog?.querySelectorAll('.codex-shortcut-settings-row > span') || []).map((node) => node.textContent.trim());
    const checked = Object.fromEntries(Array.from(dialog?.querySelectorAll('[data-codex-shortcut-visible]') || []).map((input) => [input.getAttribute('aria-label'), input.checked]));
    dialog?.close();
    return { labels, checked };
  })()`);
  if (!settings.labels.includes("Skills 分组") || !settings.labels.includes("资产控制台")) {
    throw new Error("快捷入口设置缺少增强项");
  }

  await client.evaluate(`(() => {
    document.getElementById('codex-sidebar-shortcut-settings-button')?.click();
    const input = document.querySelector('[data-codex-shortcut-visible="enhancement:asset-console"]');
    if (!input) return false;
    input.checked = false;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    document.getElementById('codex-sidebar-shortcut-settings-dialog')?.close();
    return true;
  })()`);
  const hidden = await waitFor(`!Array.from(document.querySelectorAll('[data-codex-sidebar-shortcut-card]')).some((button) => button.dataset.codexSidebarShortcutName === '资产控制台')`);
  if (!hidden) throw new Error("资产控制台入口无法隐藏");
  await client.evaluate(`(() => {
    document.getElementById('codex-sidebar-shortcut-settings-button')?.click();
    const input = document.querySelector('[data-codex-shortcut-visible="enhancement:asset-console"]');
    if (!input) return false;
    input.checked = true;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    document.getElementById('codex-sidebar-shortcut-settings-dialog')?.close();
    return true;
  })()`);
  const restored = await waitFor(`Array.from(document.querySelectorAll('[data-codex-sidebar-shortcut-card]')).some((button) => button.dataset.codexSidebarShortcutName === '资产控制台')`);
  if (!restored) throw new Error("资产控制台入口隐藏后无法恢复");

  await client.evaluate(`(() => {
    const button = Array.from(document.querySelectorAll('button')).find((candidate) =>
      !candidate.closest('#codex-sidebar-shortcut-grid')
        && (candidate.querySelector('.text-fade-truncate')?.textContent?.trim()
          || candidate.getAttribute('title') || candidate.getAttribute('aria-label')) === '新对话');
    button?.click();
  })()`);
  if (!await waitFor(`!document.getElementById('codex-skill-organizer')`)) {
    throw new Error("验收前无法离开 Skills 分组页");
  }
  const skillsClickStartedAt = Date.now();
  const immediateSkillsActivation = await client.evaluate(`(() => {
    const button = Array.from(document.querySelectorAll('[data-codex-sidebar-shortcut-card]'))
      .find((candidate) => candidate.dataset.codexSidebarShortcutName === 'Skills 分组');
    if (!button) return null;
    button.click();
    return {
      active: button.dataset.active,
      current: button.getAttribute('aria-current'),
      busy: button.getAttribute('aria-busy'),
      label: button.querySelector('.codex-sidebar-shortcut-label')?.textContent?.trim() || '',
    };
  })()`);
  if (immediateSkillsActivation?.active !== "true"
    || immediateSkillsActivation.current !== "true"
    || immediateSkillsActivation.busy !== "true"
    || immediateSkillsActivation.label !== "正在打开…") {
    throw new Error(`Skills 分组首次点击没有立即提交激活状态：${JSON.stringify(immediateSkillsActivation)}`);
  }
  const skills = await waitFor(`(() => {
    const organizer = document.getElementById('codex-skill-organizer');
    if (!organizer) return null;
    const value = {
      title: organizer.querySelector('h2')?.textContent?.trim(),
      filters: Array.from(organizer.querySelectorAll('[data-codex-skill-filter]')).map((button) => button.textContent.trim()),
      count: organizer.querySelectorAll('.codex-skill-row').length,
      resultCount: organizer.querySelector('.codex-skill-result-count')?.textContent?.trim() || '',
    };
    return value.count > 0 && value.filters.includes('资产工作台') ? value : null;
  })()`, 10_000);
  if (!skills || skills.count < 1 || !skills.filters.includes("资产工作台")) {
    throw new Error("Skills 分组没有加载实际 Skill 内容");
  }
  const skillsOpenElapsedMs = Date.now() - skillsClickStartedAt;

  const skillFilterSequence = [];
  for (const label of ["视频创作", "导演镜头", "画面风格", "资产工作台", "写作研究", "工具管理", "全部", "常用"]) {
    skillFilterSequence.push(await verifyRealSkillFilter(label));
  }
  const skillFilterInteraction = skillFilterSequence[0];
  const skillRowsAfterFilter = skillFilterInteraction.settledRows;

  const skillDescriptionLayout = await client.evaluate(`(() => {
    const description = document.querySelector('#codex-skill-organizer .codex-skill-description');
    if (!description) return null;
    const style = getComputedStyle(description);
    return { lineClamp: style.webkitLineClamp, whiteSpace: style.whiteSpace };
  })()`);
  if (skillDescriptionLayout?.lineClamp !== "2" || skillDescriptionLayout.whiteSpace === "nowrap") {
    throw new Error(`Skill 介绍未保留两行：${JSON.stringify(skillDescriptionLayout)}`);
  }

  await client.evaluate(`(() => {
    window.__codexAssetConsoleVerifierLoaded = false;
    window.__codexAssetConsoleVerifierObserver?.disconnect?.();
    const watch = (frame) => {
      if (!frame || frame.dataset.codexVerifierWatching === 'true') return;
      frame.dataset.codexVerifierWatching = 'true';
      frame.addEventListener('load', () => { window.__codexAssetConsoleVerifierLoaded = true; }, { once: true });
    };
    const observer = new MutationObserver(() => watch(document.getElementById('codex-asset-console-frame')));
    observer.observe(document.documentElement, { childList: true, subtree: true });
    window.__codexAssetConsoleVerifierObserver = observer;
    watch(document.getElementById('codex-asset-console-frame'));
    Array.from(document.querySelectorAll('[data-codex-sidebar-shortcut-card]')).find((button) => button.dataset.codexSidebarShortcutName === '资产控制台')?.click();
  })()`);
  const assetConsole = await waitFor(`(() => {
    const page = document.getElementById('codex-asset-console-page');
    const frame = document.getElementById('codex-asset-console-frame');
    return page && !page.hidden && page.dataset.state === 'ready' && frame?.src ? { state: page.dataset.state, frameUrl: frame.src } : null;
  })()`, 10_000);
  if (!assetConsole?.frameUrl.startsWith("https://web-sandbox.oaiusercontent.com/__codex_asset_console__/")) {
    throw new Error("资产控制台没有通过私有内嵌通道加载");
  }
  const assetFrameLoaded = await waitFor(`window.__codexAssetConsoleVerifierLoaded === true`, 10_000);
  await client.evaluate(`window.__codexAssetConsoleVerifierObserver?.disconnect?.()`);
  if (!assetFrameLoaded) throw new Error("资产控制台 iframe 未触发真实 load 事件");

  const assetFrameHitTest = await client.evaluate(`(() => {
    const frame = document.getElementById('codex-asset-console-frame');
    const page = document.getElementById('codex-asset-console-page');
    const close = page?.querySelector('.codex-asset-console-close');
    if (!frame || !page || !close) return null;
    const frameRect = frame.getBoundingClientRect();
    const closeRect = close.getBoundingClientRect();
    const frameX = frameRect.x + Math.min(100, frameRect.width / 2);
    const frameY = frameRect.y + Math.min(100, frameRect.height / 2);
    const closeX = closeRect.x + closeRect.width / 2;
    const closeY = closeRect.y + closeRect.height / 2;
    return {
      closeX,
      closeY,
      pagePointerEvents: getComputedStyle(page).pointerEvents,
      framePointerEvents: getComputedStyle(frame).pointerEvents,
      hitFrame: document.elementFromPoint(frameX, frameY) === frame,
      hitClose: document.elementFromPoint(closeX, closeY) === close,
    };
  })()`);
  if (assetFrameHitTest?.pagePointerEvents !== "auto" || assetFrameHitTest.framePointerEvents !== "auto" || !assetFrameHitTest.hitFrame || !assetFrameHitTest.hitClose) {
    throw new Error(`资产控制台鼠标事件未命中可交互层：${JSON.stringify(assetFrameHitTest)}`);
  }
  await client.evaluate(`document.querySelector('#codex-asset-console-page .codex-asset-console-close')?.click()`);
  const assetClosedByClick = await waitFor(`document.getElementById('codex-asset-console-page')?.hidden === true`);
  if (!assetClosedByClick) throw new Error("资产控制台关闭按钮没有响应点击");
  process.stdout.write(`${JSON.stringify({
    shortcuts,
    settings,
    visibilityRoundTrip: true,
    skills,
    skillsOpenElapsedMs,
    skillFilterInteraction,
    skillFilterSequence,
    skillRowsAfterFilter,
    skillDescriptionLayout,
    assetConsole,
    assetFrameHitTest,
    assetClosedByClick,
  }, null, 2)}\n`);
} finally {
  client.close();
}

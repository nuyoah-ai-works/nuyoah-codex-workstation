#!/usr/bin/env node

import { connectMainCodex } from "./cdp-client.mjs";

const port = Number(process.env.CODEX_SIDEBAR_PORT || 9231);
const client = await connectMainCodex(port);

async function waitFor(expression, timeoutMs = 10_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const value = await client.evaluate(expression).catch(() => null);
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return null;
}

try {
  const shortcut = await waitFor(`(() => {
    const workstation = document.getElementById('nuyoah-workstation-entry');
    const legacy = document.querySelectorAll('#codex-sidebar-shortcut-grid, #codex-sidebar-section-tabs, #codex-sidebar-folder-switcher, #codex-taskboard-entry, [data-codex-conversation-preview-enhanced]');
    const active = document.querySelector('[data-app-action-sidebar-thread-active="true"], [data-app-action-sidebar-thread-selected="true"], [data-app-action-sidebar-thread-row][aria-current="page"]');
    const activeThreadId = active?.getAttribute('data-app-action-sidebar-thread-id')?.replace(/^(?:local|cloud):/i, '') || '';
    const mode = window.__codexConversationPreviewInjection__?.sidebarMode;
    const sidebarReady = mode === 'native' || (mode === 'capsules' && window.__nuyoahCapsuleSidebar__?.visible?.());
    return workstation && legacy.length === 0 && sidebarReady
      ? { label: workstation.textContent.trim(), legacyCount: legacy.length, activeThreadId }
      : null;
  })()`);
  if (!shortcut) throw new Error("单一工作站入口没有就绪，或旧入口仍然可见");

  await client.evaluate(`if (!window.__codexConversationPreviewInjection__?.isWorkstationVisible?.()) document.getElementById('nuyoah-workstation-entry')?.click()`);
  const restoredPanel = await waitFor(`(() => {
    const button = Array.from(document.querySelectorAll('.nuyoah-workstation-header [data-nuyoah-workstation-panel="project"]'))
      .find((candidate) => candidate.getClientRects().length > 0);
    return button ? true : null;
  })()`);
  if (!restoredPanel) throw new Error("工作站没有恢复上次打开的模块");
  await client.evaluate(`Array.from(document.querySelectorAll('.nuyoah-workstation-header [data-nuyoah-workstation-panel="project"]')).find((button) => button.getClientRects().length > 0)?.click()`);
  const project = await waitFor(`(() => {
    const page = document.getElementById('nuyoah-workstation-project-page');
    const header = page?.querySelector('.nuyoah-workstation-header');
    const tabs = Array.from(header?.querySelectorAll('[data-nuyoah-workstation-panel]') || []).map((button) => ({
      id: button.dataset.nuyoahWorkstationPanel,
      label: Array.from(button.childNodes).filter(node => node.nodeType === 3).map(node => node.textContent).join('').trim(),
      selected: button.getAttribute('aria-selected'),
    }));
    page?.querySelector('[data-project-subview="tasks"]')?.click();
    const title = page?.querySelector('[data-nuyoah-project-name]')?.textContent?.trim() || '';
    return page && !page.hidden && tabs.length === 4 ? {
      title,
      tabs,
    } : null;
  })()`);
  if (!project || project.tabs.map((tab) => tab.label).join("/") !== "项目/任务/技能/资产") {
    throw new Error(`项目面板或四模块导航不完整：${JSON.stringify(project)}`);
  }

  await client.evaluate(`document.querySelector('#nuyoah-workstation-project-page [data-nuyoah-workstation-panel="skills"]')?.click()`);
  const skills = await waitFor(`(() => {
    const page = document.getElementById('codex-skill-organizer');
    const header = page?.querySelector('.nuyoah-workstation-header[data-nuyoah-workstation-header="skills"]');
    const selected = header?.querySelector('[data-nuyoah-workstation-panel="skills"]')?.getAttribute('aria-selected');
    const rows = Array.from(page?.querySelectorAll('.codex-skill-row') || []);
    const ready = rows.filter((row) => row.dataset.labelStatus === 'ready');
    const chineseReady = ready.filter((row) => /[\\u3400-\\u9fff]/u.test(row.querySelector('.codex-skill-name')?.textContent || ''));
    const descriptions = rows.filter((row) => row.querySelector('.codex-skill-description')?.textContent?.trim());
    const callableNames = rows.filter((row) => row.querySelector('.codex-skill-callable')?.textContent?.trim());
    const refreshButton = page?.querySelector('.codex-skill-refresh[aria-label="刷新当前可调用 Skills"]');
    return page && !page.hidden && selected === 'true' && rows.length > 0 ? {
      count: rows.length,
      readyCount: ready.length,
      chineseReadyCount: chineseReady.length,
      descriptionCount: descriptions.length,
      callableNameCount: callableNames.length,
      refreshButton: Boolean(refreshButton),
    } : null;
  })()`);
  if (!skills) throw new Error("Skills 模块没有展示当前可调用 Skill");
  if (skills.readyCount !== skills.chineseReadyCount || skills.descriptionCount !== skills.count
    || skills.callableNameCount !== skills.count || !skills.refreshButton) {
    throw new Error(`Skills 中文标题、用途说明、调用名或刷新按钮展示不完整：${JSON.stringify(skills)}`);
  }

  await client.evaluate(`document.querySelector('#codex-skill-organizer [data-nuyoah-workstation-panel="taskboard"]')?.click()`);
  const taskboard = await waitFor(`(() => {
    const page = document.getElementById('codex-taskboard-page');
    const selected = page?.querySelector('[data-nuyoah-workstation-panel="taskboard"]')?.getAttribute('aria-selected');
    const frame = page?.querySelector('#codex-taskboard-frame');
    return page && !page.hidden && selected === 'true' && frame?.src
      ? { state: page.dataset.state || 'ready', frameLoaded: true }
      : null;
  })()`, 15_000);
  if (!taskboard) throw new Error("Taskboard 没有在统一工作站中打开");

  await client.evaluate(`document.querySelector('#codex-taskboard-page [data-nuyoah-workstation-panel="asset"]')?.click()`);
  const asset = await waitFor(`(() => {
    const page = document.getElementById('codex-asset-console-page');
    const selected = page?.querySelector('[data-nuyoah-workstation-panel="asset"]')?.getAttribute('aria-selected');
    const frame = page?.querySelector('#codex-asset-console-frame');
    return page && !page.hidden && selected === 'true' && page.dataset.state === 'ready' && frame?.src
      && (!${JSON.stringify(shortcut.activeThreadId)} || frame.src.includes(${JSON.stringify(shortcut.activeThreadId)}))
      ? { state: page.dataset.state, frameLoaded: true }
      : null;
  })()`, 15_000);
  if (!asset) throw new Error("资产模块没有在统一工作站中打开");

  await client.evaluate(`document.querySelector('#codex-asset-console-page .nuyoah-workstation-close')?.click()`);
  const closed = await waitFor(`document.getElementById('codex-asset-console-page')?.hidden === true`);
  if (!closed) throw new Error("统一关闭按钮没有关闭工作站");

  process.stdout.write(`${JSON.stringify({ status: "PASS", shortcut, project, skills, taskboard, asset, closed }, null, 2)}\n`);
} finally {
  client.close();
}

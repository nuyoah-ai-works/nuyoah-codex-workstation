#!/usr/bin/env node

import assert from "node:assert/strict";

import { connectMainCodex } from "./cdp-client.mjs";

function parseArgs(argv) {
  const options = {
    port: Number(process.env.CODEX_SIDEBAR_PORT || 9231),
    threadId: "",
    minTotal: 1,
    minUsers: 1,
    minAssistants: 0,
    expected: [],
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--port") options.port = Number(argv[++index]);
    else if (argument === "--thread-id") options.threadId = String(argv[++index] || "");
    else if (argument === "--min-total") options.minTotal = Number(argv[++index]);
    else if (argument === "--min-users") options.minUsers = Number(argv[++index]);
    else if (argument === "--min-assistants") options.minAssistants = Number(argv[++index]);
    else if (argument === "--expect") options.expected.push(String(argv[++index] || "").trim());
    else throw new Error(`Unknown option: ${argument}`);
  }
  if (!options.threadId) throw new Error("--thread-id is required");
  for (const key of ["minTotal", "minUsers", "minAssistants"]) {
    if (!Number.isInteger(options[key]) || options[key] < 0) throw new Error(`--${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)} must be a non-negative integer`);
  }
  options.expected = options.expected.filter(Boolean);
  return options;
}

const options = parseArgs(process.argv.slice(2));
const normalizedTarget = options.threadId.replace(/^(?:local|cloud):/i, "").toLowerCase();
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const client = await connectMainCodex(options.port);

async function waitFor(expression, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await client.evaluate(expression).catch(() => null);
    if (result) return result;
    await wait(100);
  }
  return null;
}

async function navigate(threadId) {
  const expression = `(() => {
    const row = document.querySelector('[data-app-action-sidebar-thread-active="true"], [data-app-action-sidebar-thread-selected="true"], [data-app-action-sidebar-thread-row][aria-current="page"]');
    const id = (row?.getAttribute('data-app-action-sidebar-thread-id') || '').replace(/^(?:local|cloud):/i, '').toLowerCase();
    return id === ${JSON.stringify(threadId)} && document.querySelector('[data-thread-find-target="conversation"]') ? true : null;
  })()`;
  if (await waitFor(expression, 500)) return true;
  await client.evaluate(`(() => {
    const rows = Array.from(document.querySelectorAll('[data-app-action-sidebar-thread-row]'));
    const row = rows.find((candidate) => {
      const id = (candidate.getAttribute('data-app-action-sidebar-thread-id') || '').replace(/^(?:local|cloud):/i, '').toLowerCase();
      return id === ${JSON.stringify(threadId)} && !candidate.closest('[hidden]');
    }) || rows.find((candidate) => {
      const id = (candidate.getAttribute('data-app-action-sidebar-thread-id') || '').replace(/^(?:local|cloud):/i, '').toLowerCase();
      return id === ${JSON.stringify(threadId)};
    });
    row?.click();
    return Boolean(row);
  })()`);
  return waitFor(expression, 15_000);
}

const stateExpression = `(() => {
  const conversation = document.querySelector('[data-thread-find-target="conversation"]');
  const recovered = conversation?.querySelector('[data-codex-recovered-history-flow="true"]');
  const recoveredMessages = Array.from(recovered?.querySelectorAll('[data-codex-recovered-history-message="true"]') || []);
  const recoveredText = recoveredMessages.map((message) => message.textContent || '').join('\\n');
  const nativeUsers = Array.from(conversation?.querySelectorAll('[data-user-message-bubble="true"]') || [])
    .filter((message) => !message.closest('[data-codex-recovered-history-flow="true"]'));
  const scroll = conversation?.closest('.thread-scroll-container');
  const fullText = conversation?.textContent || '';
  const expectedPhrases = ${JSON.stringify(options.expected)};
  return {
    hasConversation: Boolean(conversation),
    recoveredTotal: recoveredMessages.length,
    recoveredUsers: recoveredMessages.filter((message) => message.dataset.role === 'user').length,
    recoveredAssistants: recoveredMessages.filter((message) => message.dataset.role === 'assistant').length,
    totalUsers: nativeUsers.length + recoveredMessages.filter((message) => message.dataset.role === 'user').length,
    expectedMatches: expectedPhrases.map((phrase) => ({ phrase, present: fullText.includes(phrase) })),
    noOverlay: !document.getElementById('codex-complete-history-page')
      && !document.getElementById('codex-complete-history-toggle')
      && !document.body.textContent.includes('搜索这次任务的全部对话')
      && !document.body.textContent.includes('返回实时对话'),
    hiddenLeak: /<environment_context>|recommended_plugins|AGENTS\\.md instructions|custom_tool_call/.test(recoveredText),
    hasScroll: Boolean(scroll),
    scrollable: Boolean(scroll && scroll.scrollHeight > scroll.clientHeight * 2),
    hasFooter: Boolean(document.querySelector('[data-thread-scroll-footer="true"]')),
    hasComposer: Boolean(document.querySelector('[data-thread-find-composer="true"], [data-codex-composer-root]')),
  };
})()`;

function assertNativeRecovery(state, label) {
  assert.ok(state.hasConversation && state.hasScroll && state.scrollable && state.hasFooter && state.hasComposer,
    `${label}: native conversation controls are missing: ${JSON.stringify(state)}`);
  assert.ok(state.recoveredTotal >= options.minTotal
      && state.recoveredUsers >= options.minUsers
      && state.recoveredAssistants >= options.minAssistants,
    `${label}: too few messages were restored in the native flow: ${JSON.stringify(state)}`);
  assert.ok(state.totalUsers >= options.minUsers, `${label}: user history is incomplete: ${JSON.stringify(state)}`);
  assert.ok(state.expectedMatches.every((item) => item.present),
    `${label}: expected public verifier phrases are missing: ${JSON.stringify(state.expectedMatches)}`);
  assert.ok(state.noOverlay && !state.hiddenLeak,
    `${label}: rejected overlay or internal transport content is visible: ${JSON.stringify(state)}`);
}

const original = await client.evaluate(`(() => {
  const row = document.querySelector('[data-app-action-sidebar-thread-active="true"], [data-app-action-sidebar-thread-selected="true"], [data-app-action-sidebar-thread-row][aria-current="page"]');
  return (row?.getAttribute('data-app-action-sidebar-thread-id') || '').replace(/^(?:local|cloud):/i, '').toLowerCase();
})()`);

try {
  assert.equal(await navigate(normalizedTarget), true, "target conversation did not become active");
  const firstPass = await waitFor(`(() => {
    const state = ${stateExpression};
    return state.recoveredTotal >= ${options.minTotal}
      && state.recoveredUsers >= ${options.minUsers}
      && state.recoveredAssistants >= ${options.minAssistants}
      && state.expectedMatches.every((item) => item.present) ? state : null;
  })()`, 25_000);
  assert.ok(firstPass, "recovered messages did not appear inside the native conversation");
  assertNativeRecovery(firstPass, "first pass");

  const alternate = await client.evaluate(`(() => {
    const target = ${JSON.stringify(normalizedTarget)};
    for (const row of document.querySelectorAll('[data-app-action-sidebar-thread-row]')) {
      const id = (row.getAttribute('data-app-action-sidebar-thread-id') || '').replace(/^(?:local|cloud):/i, '').toLowerCase();
      if (id && id !== target && !row.closest('[hidden]')) return id;
    }
    return '';
  })()`);
  let reopened = null;
  if (alternate) {
    assert.equal(await navigate(alternate), true, "could not navigate away before reopen verification");
    assert.equal(await navigate(normalizedTarget), true, "could not reopen target conversation");
    reopened = await waitFor(`(() => {
      const state = ${stateExpression};
      return state.recoveredTotal >= ${options.minTotal}
        && state.recoveredUsers >= ${options.minUsers}
        && state.recoveredAssistants >= ${options.minAssistants}
        && state.expectedMatches.every((item) => item.present) ? state : null;
    })()`, 25_000);
    assert.ok(reopened, "native-flow recovery did not return after reopening the conversation");
    assertNativeRecovery(reopened, "reopened pass");
  }

  process.stdout.write(`${JSON.stringify({ threadId: normalizedTarget, firstPass, reopened: reopened || "no alternate visible task" }, null, 2)}\n`);
} finally {
  if (original && original !== normalizedTarget) await navigate(original).catch(() => null);
  client.close();
}

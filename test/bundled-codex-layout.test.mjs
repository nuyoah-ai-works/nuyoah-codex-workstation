import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import test from 'node:test';

import { readUnarchivedCodexThreads } from '../lib/codex-thread-catalog.mjs';
import { readArchivedThreadIds } from '../lib/thread-archive-state.mjs';

const applications = ['ChatGPT', 'Codex'];
const bundledPath = (name, modern) => `/Applications/${name}.app/Contents/Resources/${modern
  ? 'codex-cli/CodexCLI.app/Contents/MacOS/codex' : 'codex'}`;

async function executable(path) {
  try { await access(path, fsConstants.X_OK); return true; }
  catch { return false; }
}

async function hasModernOnlyLayout() {
  if (process.platform !== 'darwin') return false;
  const modern = await Promise.all(applications.map(name => executable(bundledPath(name, true))));
  const legacy = await Promise.all(applications.map(name => executable(bundledPath(name, false))));
  return modern.some(Boolean) && !legacy.some(Boolean);
}

test('default unarchived thread discovery reads the current bundled Codex layout', { timeout: 20_000 }, async t => {
  if (!await hasModernOnlyLayout()) return t.skip('Current macOS bundled layout is unavailable');
  assert.ok(Array.isArray(await readUnarchivedCodexThreads()));
});

test('default archived thread discovery reads the current bundled Codex layout', { timeout: 20_000 }, async t => {
  if (!await hasModernOnlyLayout()) return t.skip('Current macOS bundled layout is unavailable');
  assert.ok(Array.isArray(await readArchivedThreadIds()));
});

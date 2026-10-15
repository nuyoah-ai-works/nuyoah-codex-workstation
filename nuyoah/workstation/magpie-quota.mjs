import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';

const execute = promisify(execFile);
const clean = (value, max = 100) => typeof value === 'string' ? value.replace(/[\x00-\x1f\x7f]/g, '').slice(0, max) : '';
const percent = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
const date = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : '';
export function quotaLabel(value) {
  return clean(value).replace(/7 days/gi, '本周').replace(/5 hours/gi, '5 小时').replace(/^Credits$/i, '点数');
}
export function projectMagpieQuotas(payload) {
  if (!payload || !Array.isArray(payload.data)) throw new Error('Invalid quota response');
  return payload.data.slice(0, 64).map((account, index) => {
    const user = clean(account.user);
    const label = user.includes('@') ? `${user.slice(0, 2)}…@${user.split('@').pop()}` : user ? `${user.slice(0, 2)}…` : `账号 ${index + 1}`;
    const windows = (Array.isArray(account.windows) ? account.windows : []).slice(0, 32).flatMap(w => {
      if (!w || typeof w !== 'object') return [];
      const used = percent(w.used) ?? (percent(w.remaining) === null ? null : 100 - w.remaining);
      const name = quotaLabel(w.name);
      return name ? [{ name, used, resetsAt: date(w.resetsAt), display: clean(w.display) }] : [];
    });
    return { id: createHash('sha256').update(JSON.stringify([account.provider, account.user || account.name || index])).digest('hex').slice(0, 20), provider: clean(account.provider, 60),
      name: clean(account.name) || clean(account.provider), label, plan: clean(account.plan),
      windows, balance: clean(account.balance), readAt: date(account.readAt),
      lastServedAt: date(account.lastServedAt), unavailable: Boolean(account.error) };
  });
}
export function selectCodexQuota(accounts, selected = '') {
  const codex = accounts.filter(a => a.provider === 'codex');
  if (selected && codex.some(a => a.id === selected)) return codex.find(a => a.id === selected);
  if (codex.length === 1) return codex[0];
  const recent = codex.filter(a => a.lastServedAt).sort((a, b) => Date.parse(b.lastServedAt) - Date.parse(a.lastServedAt));
  return recent[0] || null;
}
export function createMagpieQuotaService({ fetchImpl = fetch, executeImpl = execute, now = Date.now } = {}) {
  let pending, cached, nextRead = 0;
  return {
    async read() {
      if (pending) return pending;
      if (cached && now() < nextRead) return cached;
      pending = (async () => {
        try {
          const response = await fetchImpl('http://127.0.0.1:3425/v1/magpie/quotas', {
            signal: AbortSignal.timeout(10_000), redirect: 'error', headers: { Accept: 'application/json' },
          });
          if (!response.ok) throw new Error('Quota unavailable');
          const reader = response.body.getReader(); let size = 0; const chunks = [];
          try {
            while (true) { const { done, value } = await reader.read(); if (done) break;
              size += value.byteLength; if (size > 256 * 1024) throw new Error('Quota response too large'); chunks.push(value); }
          } finally { await reader.cancel().catch(() => {}); }
          const accounts = projectMagpieQuotas(JSON.parse(Buffer.concat(chunks).toString('utf8')));
          cached = { status: 'ok', accounts, checkedAt: new Date(now()).toISOString() };
        } catch { cached = { status: 'unavailable', accounts: cached?.accounts || [], checkedAt: cached?.checkedAt || '' }; }
        nextRead = now() + 60_000;
        return cached;
      })().finally(() => { pending = null; });
      return pending;
    },
    async open() {
      try { await executeImpl('/usr/bin/open', ['-b', 'com.yetone.magpie'], { timeout: 5000, maxBuffer: 4096 }); return { status: 'opened' }; }
      catch { return { status: 'open-failed' }; }
    },
  };
}

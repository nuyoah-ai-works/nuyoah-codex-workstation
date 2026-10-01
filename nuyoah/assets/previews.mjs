import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, stat, readFile, readdir, rm, rename } from 'node:fs/promises';
import path from 'node:path';
import { regularFile } from './catalog.mjs';
import { readImageDimensions } from '../../vendor/codex-workspace-enhancer/asset-browser/image-dimensions.js';

export const MEDIA_CHUNK = 1024 * 1024;
export function byteRange(value, size) {
  if (!size) return { start: 0, end: -1, length: 0 };
  let start = 0, end = size - 1;
  if (value) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(value);
    if (!m || (!m[1] && !m[2])) throw new Error('range');
    if (!m[1]) { if (!(Number(m[2]) > 0)) throw new Error('range'); start = Math.max(0, size - Number(m[2])); }
    else { start = Number(m[1]); if (m[2]) end = Math.min(end, Number(m[2])); }
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || end < start) throw new Error('range');
  }
  end = Math.min(end, start + MEDIA_CHUNK - 1);
  return { start, end, length: end - start + 1 };
}
const placeholder = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="480" height="320" viewBox="0 0 480 320"><rect width="480" height="320" fill="#e9e9e7"/><path d="M172 210l45-54 34 35 29-27 38 46z" fill="#999"/><circle cx="278" cy="116" r="18" fill="#999"/></svg>');

export class PreviewCache {
  constructor(root, { platform = process.platform } = {}) { this.root = root; this.platform = platform; this.running = 0; this.waiters = []; }
  async slot(signal) {
    signal?.throwIfAborted();
    if (this.running < 2) { this.running++; return; }
    if (this.waiters.length >= 30) throw new Error('预览繁忙，请稍后重试');
    await new Promise((resolve, reject) => {
      const item = { resolve, reject, signal };
      item.abort = () => { this.waiters = this.waiters.filter(w => w !== item); reject(new Error('cancelled')); };
      signal?.addEventListener('abort', item.abort, { once: true }); this.waiters.push(item);
    });
  }
  release() { const next = this.waiters.shift(); if (next) { next.signal?.removeEventListener('abort', next.abort); next.resolve(); } else this.running--; }
  async image(asset, { detail = false, signal } = {}) {
    await this.slot(signal);
    try {
      const source = !detail && asset.thumbnail ? asset.thumbnail : asset.sourcePath;
      const info = await regularFile(source);
      if (this.platform !== 'darwin' || info.size > 128 * 1024 * 1024 || /\.svg$/i.test(source)) return { body: placeholder, type: 'image/svg+xml', unavailable: true };
      const dimensions = await readImageDimensions(source).catch(() => null);
      if (dimensions && dimensions.width * dimensions.height > 60_000_000) return { body: placeholder, type: 'image/svg+xml', unavailable: true };
      const key = createHash('sha256').update(`${source}:${info.size}:${info.mtimeMs}:${detail}`).digest('hex');
      await mkdir(this.root, { recursive: true });
      const target = path.join(this.root, `${key}.jpg`);
      if (!await stat(target).catch(() => null)) {
        const temp = `${target}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
        try {
          await new Promise((resolve, reject) => {
            const child = spawn('/usr/bin/sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '65', '-Z', detail ? '1600' : '480', source, '--out', temp], { stdio: 'ignore' });
            const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('预览超时')); }, 8000);
            const abort = () => { child.kill('SIGKILL'); reject(new Error('cancelled')); };
            signal?.addEventListener('abort', abort, { once: true });
            child.once('error', reject);
            child.once('close', code => { clearTimeout(timer); signal?.removeEventListener('abort', abort); code === 0 ? resolve() : reject(new Error('此格式暂时无法预览')); });
          });
          if ((await stat(temp)).size > (detail ? 2 : 0.5) * 1024 * 1024) throw new Error('预览超过大小限制');
          await rename(temp, target);
        } finally { await rm(temp, { force: true }); }
      }
      const body = await readFile(target);
      return { body, type: 'image/jpeg' };
    } catch (error) {
      if (signal?.aborted) throw error;
      return { body: placeholder, type: 'image/svg+xml', unavailable: true };
    } finally { this.release(); }
  }
  async prune() {
    const entries = await readdir(this.root).catch(() => []); const files = [];
    for (const name of entries) {
      if (!/^[a-f0-9]{64}\.jpg$/.test(name)) continue;
      const file = path.join(this.root, name), info = await stat(file).catch(() => null);
      if (info) files.push({ file, size: info.size, time: info.mtimeMs });
    }
    let bytes = files.reduce((n,f) => n + f.size, 0);
    for (const file of files.sort((a,b) => a.time - b.time)) { if (bytes <= 128 * 1024 * 1024) break; await rm(file.file, { force: true }); bytes -= file.size; }
  }
}

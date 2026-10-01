import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { workstationDataRoot } from '../workstation/task-context-store.mjs';
export async function readSkillConfiguration(file = path.join(workstationDataRoot(), 'preferences.json')) {
  let raw;
  try { raw = JSON.parse(await readFile(file, 'utf8')).skills; }
  catch (error) { if (error.code === 'ENOENT') return {}; throw new Error('工作站偏好配置无法读取'); }
  if (!raw) return {};
  const result = {};
  if (raw.categories !== undefined) {
    if (!Array.isArray(raw.categories) || raw.categories.length > 30) throw new Error('Skill 分类配置无效');
    const labels = new Set(['当前任务', '常用', '全部']);
    result.categories = raw.categories.map(item => {
      if (!item || typeof item.label !== 'string' || !item.label.trim() || item.label.length > 40 || labels.has(item.label)
        || !Array.isArray(item.keywords) || !item.keywords.length || item.keywords.length > 60
        || item.keywords.some(k => typeof k !== 'string' || !k.trim() || k.length > 100)) throw new Error('Skill 分类名称或关键词无效');
      labels.add(item.label); return { label: item.label, keywords: item.keywords };
    });
  }
  if (raw.defaultFavorites !== undefined) {
    if (!Array.isArray(raw.defaultFavorites) || raw.defaultFavorites.some(v => typeof v !== 'string' || v.length > 240)) throw new Error('Skill 初始收藏配置无效');
    result.defaultFavorites = [...new Set(raw.defaultFavorites)];
  }
  return result;
}

#!/usr/bin/env node
import { readFile, stat } from 'node:fs/promises';
import { WorkItemsStore, WORK_ITEMS_LIMITS } from '../nuyoah/workstation/work-items-store.mjs';

const help = `工作事项：读取计划、记录进展和恢复归档

用法：
  node scripts/work-items.mjs read [itemId]
  node scripts/work-items.mjs save <JSON文件> <revision>
  node scripts/work-items.mjs archive <itemId> <revision>
  node scripts/work-items.mjs restore <itemId> <revision>
  node scripts/work-items.mjs export [itemId]

read / export 输出 JSON。无事项时返回 items: []；指定不存在的 ID 返回错误。
保存前先 read：save 完整替换该事项，用最新 revision 防止覆盖别处修改。
read <itemId> 返回 { revision, item }；保存及归档返回完整记录。
新事项的 id 留空后生成 UUID；已有事项保留 id，计划节点保留稳定短 ID。
manualStatus 为 null 时跟随 status；手动标记时填状态，恢复时改回 null。
来源 source 和 updatedAt 记录事实出处与时间，不表示用户验收或执行授权。
仅维护工作事项，不发送消息，不更改 Codex 任务或自动完成事项。

完整事项 JSON 示例（请替换为本次真实内容）：
${JSON.stringify({ id: '', title: '整理项目方案', direction: '产品开发', nextStep: '核对原型', note: '', status: 'todo', focus: false, archived: false,
  threadLinks: [{ hostId: 'local', threadId: '11111111-1111-4111-8111-111111111111' }],
  nodes: [{ id: 'goal', parentId: '', title: '确认项目方案', kind: 'goal', status: 'todo', source: '任务记录', updatedAt: null, manualStatus: null },
    { id: 'review', parentId: 'goal', title: '核对原型', kind: 'next', status: 'todo', source: '', updatedAt: null, manualStatus: null }] }, null, 2)}

事项 status：idea / todo / doing / waiting / done / paused。
节点 kind：goal / milestone / next / blocker / note。
节点 status / manualStatus：todo / doing / waiting / done；manualStatus 另可为 null。
updatedAt：ISO 时间（如 2026-09-21T08:00:00.000Z）或 null。
threadLinks 只保存 hostId 与 threadId，同身份自动去重。
限制：5000 事项；每事项 200 节点、20 层、100 个关联任务；超限报错，不截断。
文字上限：事项标题 240、方向 120、下一步 2000、笔记 16000、节点标题 500、来源 240 字符。
导出不删除内容；归档后仍可 read/export，restore 可恢复。
冲突时保留输入文件，重新 read 后合并，再用新 revision 保存。
`;

const args = process.argv.slice(2);
if (!args.length || (args.length === 1 && ['--help', '-h'].includes(args[0]))) {
  console.log(help);
} else {
  const store = new WorkItemsStore();
  try {
    const [action, value, rawRevision] = args;
    let data;
    if (['read', 'export'].includes(action) && args.length <= 2) {
      const current = await store.read();
      if (value) {
        const target = current.items.find(item => item.id === value.toLowerCase());
        if (!target) throw new Error('没有找到该事项，请先 read 查看列表。');
        data = { revision: current.revision, item: target };
      } else data = current;
    } else if (['save', 'archive', 'restore'].includes(action) && args.length === 3 && /^(?:0|[1-9]\d*)$/u.test(rawRevision)) {
      const revision = Number(rawRevision);
      if (!Number.isSafeInteger(revision)) throw new Error('revision 无效，请先 read 获取当前版本。');
      if (action === 'save') {
        let input;
        try {
          const info = await stat(value);
          if (!info.isFile() || info.size > WORK_ITEMS_LIMITS.bytes) throw new Error('size');
          input = JSON.parse(await readFile(value, 'utf8'));
        } catch { throw new Error('无法读取事项 JSON，请检查文件内容与大小；本次未保存。'); }
        data = await store.save(input, revision);
      } else data = await store.archive(value, action === 'archive', revision);
    } else throw new Error('命令或参数无效；运行 --help 查看用法。');
    console.log(JSON.stringify(data, null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}

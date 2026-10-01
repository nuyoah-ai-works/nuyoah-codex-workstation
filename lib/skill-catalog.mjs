import { readdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const SKIP_DIRECTORIES = new Set([".git", "node_modules", "dist", "build"]);

function frontmatterValue(source, key) {
  const block = String(source || "").match(/^---\s*\n([\s\S]*?)\n---(?:\s*\n|$)/u)?.[1] || "";
  const match = block.match(new RegExp(`^${key}:\\s*(.+)$`, "mu"));
  return match?.[1]?.trim().replace(/^(["'])([\s\S]*)\1$/u, "$2") || "";
}

function yamlDisplayName(source) {
  return String(source || "").match(/^\s*display_name:\s*(.+)$/mu)?.[1]?.trim()
    .replace(/^(["'])([\s\S]*)\1$/u, "$2") || "";
}

async function findSkillFiles(root, output = []) {
  let entries = [];
  try { entries = await readdir(root, { withFileTypes: true }); } catch { return output; }
  for (const entry of entries) {
    if (entry.isSymbolicLink() || SKIP_DIRECTORIES.has(entry.name)) continue;
    const entryPath = path.join(root, entry.name);
    if (entry.isFile() && entry.name === "SKILL.md") output.push(entryPath);
    else if (entry.isDirectory()) await findSkillFiles(entryPath, output);
  }
  return output;
}

async function readSkill(skillPath, priority) {
  let source = "";
  try { source = await readFile(skillPath, "utf8"); } catch { return null; }
  const directory = path.dirname(skillPath);
  const name = frontmatterValue(source, "name") || path.basename(directory);
  const description = frontmatterValue(source, "description") || "打开查看 Skill 详情";
  let displayName = "";
  try { displayName = yamlDisplayName(await readFile(path.join(directory, "agents", "openai.yaml"), "utf8")); } catch {}
  return {
    name,
    title: displayName || name,
    description,
    path: directory,
    mentionPath: skillPath,
    priority,
  };
}

export async function readInstalledSkillCatalog({ homeDir = os.homedir(), roots } = {}) {
  const candidates = roots || [
    path.join(homeDir, ".codex", "skills"),
    path.join(homeDir, ".agents", "skills"),
    path.join(homeDir, ".codex", "plugins", "cache"),
  ];
  const filesByRoot = await Promise.all(candidates.map((root) => findSkillFiles(root)));
  const skills = (await Promise.all(filesByRoot.flatMap((files, priority) => (
    files.map((skillPath) => readSkill(skillPath, priority))
  )))).filter(Boolean);
  const deduped = new Map();
  for (const skill of skills.sort((left, right) => left.priority - right.priority || left.path.localeCompare(right.path))) {
    if (!deduped.has(skill.name)) deduped.set(skill.name, skill);
  }
  return [...deduped.values()]
    .map(({ priority: _priority, ...skill }) => skill)
    .sort((left, right) => left.title.localeCompare(right.title, "zh-CN"));
}

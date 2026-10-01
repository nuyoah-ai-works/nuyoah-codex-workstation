import { promises as fs } from "node:fs";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const STAGES = ["intake", "assessment", "spec", "blockout", "structure", "form", "material", "surface", "lighting", "interaction", "optimization"];

function now() {
  return new Date().toISOString();
}

function normalizeText(value) {
  return String(value || "").trim();
}

function slug(value) {
  return normalizeText(value)
    .normalize("NFKC")
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64) || "three-d-rebuild";
}

function isInside(root, target) {
  const base = path.resolve(root);
  const resolved = path.resolve(target);
  return resolved === base || resolved.startsWith(base + path.sep);
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.rename(temp, filePath);
}

function relPath(projectRoot, absolutePath) {
  return path.relative(projectRoot, absolutePath).split(path.sep).join("/");
}

export class ThreeDWorkbench {
  constructor({ registryPath, skillRoot, pythonPath = "python" }) {
    this.registryPath = path.resolve(registryPath);
    this.skillRoot = path.resolve(skillRoot || path.join(os.homedir(), ".codex", "skills", "img2threejs"));
    this.pythonPath = pythonPath;
  }

  async read() {
    try {
      const data = JSON.parse((await fs.readFile(this.registryPath, "utf8")).replace(/^\uFEFF/, ""));
      return Array.isArray(data.tasks) ? data : { version: 1, tasks: [] };
    } catch {
      return { version: 1, tasks: [] };
    }
  }

  async write(registry) {
    registry.updatedAt = now();
    await writeJson(this.registryPath, registry);
  }

  async skillStatus() {
    const skillPath = path.join(this.skillRoot, "SKILL.md");
    const required = [
      skillPath,
      path.join(this.skillRoot, "forge", "stage1_intake", "probe_image.py"),
      path.join(this.skillRoot, "forge", "stage2_spec", "new_pre_spec_assessment.py"),
      path.join(this.skillRoot, "forge", "next.py")
    ];
    const ready = (await Promise.all(required.map(exists))).every(Boolean);
    let version = "";
    if (await exists(skillPath)) {
      const text = await fs.readFile(skillPath, "utf8");
      version = text.match(/^version:\s*(.+)$/m)?.[1]?.trim() || "";
    }
    return { ready, version, root: this.skillRoot, required };
  }

  async status() {
    const [registry, skill] = await Promise.all([this.read(), this.skillStatus()]);
    const counts = { total: registry.tasks.length, active: 0, needsAttention: 0, completed: 0 };
    for (const task of registry.tasks) {
      if (task.status === "completed") counts.completed += 1;
      else if (task.status === "needs-attention") counts.needsAttention += 1;
      else counts.active += 1;
    }
    return { ok: true, skill, counts, stages: STAGES };
  }

  async list({ projectId = "", limit = 100 } = {}) {
    const registry = await this.read();
    return registry.tasks
      .filter((task) => !projectId || task.projectId === projectId)
      .sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)))
      .slice(0, Math.max(1, Math.min(500, Number(limit) || 100)));
  }

  async get(id) {
    const registry = await this.read();
    const task = registry.tasks.find((item) => item.id === id);
    if (!task) throw new Error("3D 重建任务不存在");
    return { registry, task };
  }

  async runPython(args, options = {}) {
    return execFileAsync(this.pythonPath, ["-X", "utf8", ...args], {
      cwd: options.cwd,
      windowsHide: true,
      timeout: options.timeout || 120000,
      maxBuffer: 4 * 1024 * 1024,
      encoding: "utf8"
    });
  }

  buildInstruction(task) {
    return [
      "使用已安装的 img2threejs 技能继续这个 3D 重建任务。",
      `参考图：${task.assetPath}`,
      `工作目录：${task.workspacePath}`,
      `目标：${task.targetName}`,
      `用途：${task.intendedUseLabel}`,
      `主体类型：${task.subjectType}`,
      `质量级别：${task.complexity}`,
      "先读取工作目录中的 pre-spec-assessment.json、reference-probe.json 和 3d-task.json。",
      "严格按 intake → assessment → spec → blockout → structure → form → material → surface → lighting → interaction → optimization 推进；每一阶段都保存对比截图和未通过原因。"
    ].join("\n");
  }

  async create(input, projects) {
    const skill = await this.skillStatus();
    if (!skill.ready) throw new Error("img2threejs 技能未完整安装");
    const project = projects.find((item) => item.id === normalizeText(input.projectId));
    if (!project) throw new Error("没有找到目标项目");

    const assetPath = path.resolve(normalizeText(input.assetPath));
    if (!isInside(project.path, assetPath)) throw new Error("参考图不在目标项目内");
    if (!IMAGE_EXTS.has(path.extname(assetPath).toLowerCase())) throw new Error("3D 重建目前需要 PNG、JPG 或 WEBP 参考图");
    if (!await exists(assetPath)) throw new Error("参考图不存在");

    const id = `3d-${Date.now()}-${randomUUID().slice(0, 8)}`;
    const targetName = normalizeText(input.targetName) || path.basename(assetPath, path.extname(assetPath));
    const complexity = ["simple", "moderate", "complex", "ultra-complex"].includes(input.complexity) ? input.complexity : "moderate";
    const subjectType = ["object", "character", "hybrid"].includes(input.subjectType) ? input.subjectType : "object";
    const intendedUse = normalizeText(input.intendedUse) || "browser-prop";
    const intendedUseLabel = normalizeText(input.intendedUseLabel) || intendedUse;
    const workspacePath = path.join(path.dirname(assetPath), "3D重建", `${slug(targetName)}-${id.slice(-8)}`);
    if (!isInside(project.path, workspacePath)) throw new Error("3D 工作目录越出项目范围");
    await fs.mkdir(workspacePath, { recursive: true });

    const task = {
      id,
      projectId: project.id,
      projectName: project.name,
      assetPath,
      assetRelPath: relPath(project.path, assetPath),
      workspacePath,
      workspaceRelPath: relPath(project.path, workspacePath),
      targetName,
      subjectType,
      intendedUse,
      intendedUseLabel,
      complexity,
      status: "initializing",
      currentStage: "intake",
      stageIndex: 0,
      stages: STAGES.map((name, index) => ({ name, status: index === 0 ? "in-progress" : "pending" })),
      skillVersion: skill.version,
      promptLibraryItemIds: Array.isArray(input.promptLibraryItemIds) ? input.promptLibraryItemIds.map(String) : [],
      notes: normalizeText(input.notes),
      createdAt: now(),
      updatedAt: now(),
      errors: []
    };

    const registry = await this.read();
    registry.tasks.push(task);
    await this.write(registry);

    try {
      const probe = await this.runPython([
        path.join(this.skillRoot, "forge", "stage1_intake", "probe_image.py"),
        assetPath
      ], { cwd: workspacePath });
      await fs.writeFile(path.join(workspacePath, "reference-probe.json"), probe.stdout.trim() + "\n", "utf8");
      task.stages[0].status = "completed";
      task.stages[1].status = "in-progress";
      task.currentStage = "assessment";
      task.stageIndex = 1;

      await this.runPython([
        path.join(this.skillRoot, "forge", "stage2_spec", "new_pre_spec_assessment.py"),
        targetName,
        "--image", assetPath,
        "--complexity", complexity,
        "--out", path.join(workspacePath, "pre-spec-assessment.json"),
        "--force"
      ], { cwd: workspacePath });

      task.status = "ready-for-agent";
      task.stages[1].status = "ready-for-review";
    } catch (error) {
      task.status = "needs-attention";
      task.errors.push({ at: now(), message: error.stderr?.trim() || error.message });
      task.stages[task.stageIndex].status = "failed";
    }

    task.instruction = this.buildInstruction(task);
    task.updatedAt = now();
    await writeJson(path.join(workspacePath, "3d-task.json"), task);
    await fs.writeFile(path.join(workspacePath, "START-HERE.md"), `# ${targetName} · 3D 重建\n\n${task.instruction}\n`, "utf8");
    await this.write(registry);
    return task;
  }

  async refresh(id) {
    const { registry, task } = await this.get(id);
    const checks = [
      ["assessment", "pre-spec-assessment.json"],
      ["spec", "object-sculpt-spec.json"],
      ["blockout", "src/createObjectModel.ts"]
    ];
    for (const [stage, relativePath] of checks) {
      if (!await exists(path.join(task.workspacePath, relativePath))) continue;
      const index = STAGES.indexOf(stage);
      task.stageIndex = Math.max(task.stageIndex, index);
      task.currentStage = STAGES[task.stageIndex];
      for (let i = 0; i < task.stages.length; i += 1) {
        if (i < task.stageIndex) task.stages[i].status = "completed";
        else if (i === task.stageIndex && task.stages[i].status === "pending") task.stages[i].status = "in-progress";
      }
    }
    task.updatedAt = now();
    await writeJson(path.join(task.workspacePath, "3d-task.json"), task);
    await this.write(registry);
    return task;
  }

  async remove(id) {
    const registry = await this.read();
    const index = registry.tasks.findIndex((item) => item.id === id);
    if (index < 0) throw new Error("3D 重建任务不存在");
    const [task] = registry.tasks.splice(index, 1);
    await this.write(registry);
    return { removed: true, task, workspacePreserved: true };
  }
}

export { STAGES as THREE_D_STAGES };

import { promises as fs } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";

const KINDS = new Set(["capture", "term", "recipe", "prompt"]);
const FILES = {
  capture: "captures.jsonl",
  term: "terms.json",
  recipe: "recipes.json",
  prompt: "prompts.json"
};

function now() {
  return new Date().toISOString();
}

function cleanText(value, limit = 20000) {
  return String(value || "").replace(/\0/g, "").trim().slice(0, limit);
}

function cleanList(value, limit = 40) {
  const values = Array.isArray(value) ? value : String(value || "").split(/[，,\n]/);
  return [...new Set(values.map((item) => cleanText(item, 120)).filter(Boolean))].slice(0, limit);
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export class PromptLibrary {
  constructor({ root }) {
    this.root = path.resolve(root);
    this.runtimeRoot = path.join(this.root, "runtime");
  }

  file(kind) {
    if (!KINDS.has(kind)) throw new Error(`不支持的词库类型：${kind}`);
    return path.join(this.root, FILES[kind]);
  }

  async ensure() {
    await fs.mkdir(this.runtimeRoot, { recursive: true });
    if (!await pathExists(this.file("capture"))) await fs.writeFile(this.file("capture"), "", "utf8");
    for (const kind of ["term", "recipe", "prompt"]) {
      const filePath = this.file(kind);
      if (!await pathExists(filePath)) await fs.writeFile(filePath, "[]\n", "utf8");
    }
    const runtimePath = path.join(this.runtimeRoot, "library.json");
    if (!await pathExists(runtimePath)) {
      await fs.writeFile(runtimePath, JSON.stringify({ schemaVersion: 1, generatedAt: null, terms: [], recipes: [], prompts: [] }, null, 2) + "\n", "utf8");
    }
  }

  async read(kind) {
    await this.ensure();
    const raw = await fs.readFile(this.file(kind), "utf8");
    if (kind === "capture") {
      return raw.split(/\r?\n/).filter(Boolean).map((line) => {
        try { return JSON.parse(line); } catch { return null; }
      }).filter(Boolean);
    }
    const parsed = JSON.parse(raw.replace(/^\uFEFF/, "") || "[]");
    return Array.isArray(parsed) ? parsed : [];
  }

  async write(kind, items) {
    await this.ensure();
    const filePath = this.file(kind);
    const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    const content = kind === "capture"
      ? items.map((item) => JSON.stringify(item)).join("\n") + (items.length ? "\n" : "")
      : JSON.stringify(items, null, 2) + "\n";
    await fs.writeFile(tempPath, content, "utf8");
    await fs.rename(tempPath, filePath);
  }

  normalize(kind, input, existing = null) {
    const text = cleanText(input.text ?? input.content ?? existing?.text);
    const title = cleanText(input.title ?? input.name ?? existing?.title ?? (kind === "term" ? text : ""), 120);
    if (!text && !title) throw new Error("内容不能为空");

    const createdAt = existing?.createdAt || now();
    const base = {
      id: existing?.id || randomUUID(),
      kind,
      title: title || text.slice(0, 32),
      text: text || title,
      category: cleanText(input.category ?? existing?.category, 40),
      visualRole: cleanText(input.visualRole ?? existing?.visualRole, 60),
      tags: cleanList(input.tags ?? existing?.tags),
      aliases: cleanList(input.aliases ?? existing?.aliases),
      projectId: cleanText(input.projectId ?? existing?.projectId, 120),
      assetPath: cleanText(input.assetPath ?? existing?.assetPath, 1000),
      sourceType: cleanText(input.sourceType ?? existing?.sourceType ?? "manual", 40),
      sourceUrl: cleanText(input.sourceUrl ?? existing?.sourceUrl, 2000),
      sourceTitle: cleanText(input.sourceTitle ?? existing?.sourceTitle, 300),
      reviewStatus: cleanText(input.reviewStatus ?? existing?.reviewStatus ?? (kind === "capture" ? "needs-review" : "approved"), 40),
      note: cleanText(input.note ?? existing?.note, 2000),
      createdAt,
      updatedAt: now()
    };

    if (kind === "capture") {
      return {
        ...base,
        processingStatus: cleanText(input.processingStatus ?? existing?.processingStatus ?? "unprocessed", 40),
        derivedTerms: cleanList(input.derivedTerms ?? existing?.derivedTerms, 200),
        derivedRecipes: cleanList(input.derivedRecipes ?? existing?.derivedRecipes, 100)
      };
    }
    if (kind === "recipe") {
      return {
        ...base,
        memberTermIds: cleanList(input.memberTermIds ?? existing?.memberTermIds, 200)
      };
    }
    return base;
  }

  async create(kind, input) {
    const items = await this.read(kind);
    const item = this.normalize(kind, input);
    if (kind === "term") {
      const duplicate = items.find((candidate) => candidate.text.toLocaleLowerCase() === item.text.toLocaleLowerCase());
      if (duplicate) return { item: duplicate, duplicate: true };
    }
    items.unshift(item);
    await this.write(kind, items);
    return { item, duplicate: false };
  }

  async update(kind, id, input) {
    const items = await this.read(kind);
    const index = items.findIndex((item) => item.id === id);
    if (index < 0) throw new Error("没有找到要修改的词库内容");
    items[index] = this.normalize(kind, input, items[index]);
    await this.write(kind, items);
    return items[index];
  }

  async remove(kind, id) {
    const items = await this.read(kind);
    const next = items.filter((item) => item.id !== id);
    if (next.length === items.length) throw new Error("没有找到要删除的词库内容");
    await this.write(kind, next);
    return { id, kind };
  }

  async list({ kind = "", query = "", category = "", projectId = "", reviewStatus = "" } = {}) {
    const kinds = kind ? [kind] : [...KINDS];
    const groups = await Promise.all(kinds.map(async (itemKind) => (await this.read(itemKind)).map((item) => ({ ...item, kind: itemKind }))));
    const needle = cleanText(query, 200).toLocaleLowerCase();
    const items = groups.flat().filter((item) => {
      if (category && item.category !== category) return false;
      if (projectId && item.projectId !== projectId) return false;
      if (reviewStatus && item.reviewStatus !== reviewStatus) return false;
      if (!needle) return true;
      return [item.title, item.text, item.category, item.visualRole, ...(item.tags || []), ...(item.aliases || [])]
        .join(" ").toLocaleLowerCase().includes(needle);
    }).sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)));
    return { items, counts: await this.counts() };
  }

  async counts() {
    const [captures, terms, recipes, prompts] = await Promise.all([
      this.read("capture"), this.read("term"), this.read("recipe"), this.read("prompt")
    ]);
    return {
      captures: captures.length,
      unprocessed: captures.filter((item) => item.processingStatus !== "processed").length,
      terms: terms.length,
      recipes: recipes.length,
      prompts: prompts.length,
      needsReview: [...captures, ...terms, ...recipes, ...prompts].filter((item) => item.reviewStatus === "needs-review").length
    };
  }

  async compile() {
    const [captures, terms, recipes, prompts] = await Promise.all([
      this.read("capture"), this.read("term"), this.read("recipe"), this.read("prompt")
    ]);
    const approvedTerms = terms.filter((item) => item.reviewStatus === "approved");
    const termIds = new Set(approvedTerms.map((item) => item.id));
    const danglingRecipes = [];
    const approvedRecipes = recipes.filter((item) => {
      if (item.reviewStatus !== "approved") return false;
      const missing = (item.memberTermIds || []).filter((id) => !termIds.has(id));
      if (missing.length) danglingRecipes.push({ id: item.id, title: item.title, missing });
      return missing.length === 0;
    });
    const runtime = {
      schemaVersion: 1,
      generatedAt: now(),
      terms: approvedTerms,
      recipes: approvedRecipes,
      prompts: prompts.filter((item) => item.reviewStatus === "approved"),
      stats: {
        captures: captures.length,
        terms: approvedTerms.length,
        recipes: approvedRecipes.length,
        prompts: prompts.filter((item) => item.reviewStatus === "approved").length,
        danglingRecipeReferences: danglingRecipes.length
      }
    };
    const runtimePath = path.join(this.runtimeRoot, "library.json");
    const tempPath = `${runtimePath}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tempPath, JSON.stringify(runtime, null, 2) + "\n", "utf8");
    await fs.rename(tempPath, runtimePath);
    return { runtime, danglingRecipes, runtimePath };
  }

  async health() {
    await this.ensure();
    const counts = await this.counts();
    let runtime = null;
    try {
      runtime = JSON.parse(await fs.readFile(path.join(this.runtimeRoot, "library.json"), "utf8"));
    } catch {}
    return {
      ok: true,
      root: this.root,
      ...counts,
      runtimeGeneratedAt: runtime?.generatedAt || null,
      runtimeTerms: runtime?.terms?.length || 0,
      runtimeRecipes: runtime?.recipes?.length || 0
    };
  }
}

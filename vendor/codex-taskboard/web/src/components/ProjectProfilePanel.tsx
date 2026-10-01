import { useEffect, useMemo, useState, type FormEvent } from "react";
// @ts-expect-error Shared runtime utilities are covered by focused node tests.
import { projectProgress, projectUrgency } from "../../../shared/project-metadata.mjs";
import type { Project, ProjectProfile, Task, TaskPriority } from "../types";
import { LinearIcon, LinearPriorityIcon } from "./LinearIcon";

const URGENCY_LABELS: Record<TaskPriority, string> = {
  none: "无紧急标记",
  urgent: "紧急",
  high: "高优先级",
  medium: "中优先级",
  low: "低优先级",
};

interface CodexProjectOption {
  id: string;
  name: string;
  workspacePath?: string;
}

interface ProjectProfilePanelProps {
  project: Project;
  profile: ProjectProfile | null;
  tasks: Task[];
  codexProjects: CodexProjectOption[];
  workspacePaths: Record<string, string>;
  saving: boolean;
  onSave: (input: Pick<
    ProjectProfile,
    "displayName" | "codexProjectId" | "workspacePath" | "description" | "nextPlan" | "urgencyOverride"
  >) => Promise<void>;
}

function fallbackCodexProjectId(
  project: Project,
  codexProjects: CodexProjectOption[],
  workspacePaths: Record<string, string>,
) {
  if (codexProjects.some((candidate) => candidate.id === project.id)) return project.id;
  return codexProjects.find((candidate) => (
    workspacePaths[candidate.id] && workspacePaths[candidate.id] === project.workspacePath
  ))?.id ?? null;
}

export function ProjectProfilePanel({
  project,
  profile,
  tasks,
  codexProjects,
  workspacePaths,
  saving,
  onSave,
}: ProjectProfilePanelProps) {
  const [editing, setEditing] = useState(false);
  const inferredCodexProjectId = fallbackCodexProjectId(project, codexProjects, workspacePaths);
  const [displayName, setDisplayName] = useState(profile?.displayName ?? project.name);
  const [codexProjectId, setCodexProjectId] = useState(profile?.codexProjectId ?? inferredCodexProjectId ?? "");
  const [workspacePath, setWorkspacePath] = useState(
    profile?.workspacePath
      ?? (profile?.codexProjectId ? workspacePaths[profile.codexProjectId] : undefined)
      ?? (inferredCodexProjectId ? workspacePaths[inferredCodexProjectId] : undefined)
      ?? project.workspacePath
      ?? "",
  );
  const [description, setDescription] = useState(profile?.description ?? "");
  const [nextPlan, setNextPlan] = useState(profile?.nextPlan ?? "");
  const [urgencyOverride, setUrgencyOverride] = useState<TaskPriority | "auto">(
    profile?.urgencyOverride ?? "auto",
  );

  useEffect(() => {
    if (editing) return;
    const nextCodexId = profile?.codexProjectId ?? inferredCodexProjectId ?? "";
    setDisplayName(profile?.displayName ?? project.name);
    setCodexProjectId(nextCodexId);
    setWorkspacePath(
      profile?.workspacePath
        ?? (nextCodexId ? workspacePaths[nextCodexId] : undefined)
        ?? project.workspacePath
        ?? "",
    );
    setDescription(profile?.description ?? "");
    setNextPlan(profile?.nextPlan ?? "");
    setUrgencyOverride(profile?.urgencyOverride ?? "auto");
  }, [editing, inferredCodexProjectId, profile, project.name, project.workspacePath, workspacePaths]);

  const urgency = useMemo(
    () => projectUrgency(tasks, profile?.urgencyOverride ?? null) as {
      value: TaskPriority;
      source: "manual" | "issues" | "none";
    },
    [profile?.urgencyOverride, tasks],
  );
  const progress = useMemo(() => projectProgress(tasks) as {
    total: number;
    done: number;
    percent: number;
    inProgress: number;
    inReview: number;
    blocked: number;
  }, [tasks]);
  const matchedCodexProject = codexProjects.find((candidate) => candidate.id === (
    profile?.codexProjectId ?? inferredCodexProjectId
  ));
  const resolvedWorkspacePath = profile?.workspacePath
    ?? (matchedCodexProject ? workspacePaths[matchedCodexProject.id] : undefined)
    ?? project.workspacePath;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      await onSave({
        displayName: displayName.trim() || null,
        codexProjectId: codexProjectId || null,
        workspacePath: workspacePath.trim() || null,
        description: description.trim(),
        nextPlan: nextPlan.trim(),
        urgencyOverride: urgencyOverride === "auto" ? null : urgencyOverride,
      });
      setEditing(false);
    } catch {
      // The parent renders the API error banner and keeps the form open for correction.
    }
  }

  return (
    <section className="project-profile-panel" aria-label="当前项目概况">
      <div className="project-profile-summary">
        <div className="project-profile-heading">
          <div>
            <span className="project-profile-eyebrow">当前项目</span>
            <h2>{profile?.displayName || project.name}</h2>
          </div>
          <button className="project-profile-edit" type="button" onClick={() => setEditing(true)}>
            <LinearIcon name="createIssue" />
            修改项目
          </button>
        </div>
        <div className="project-profile-meta">
          <span className={`project-urgency-badge urgency-${urgency.value}`}>
            <LinearPriorityIcon priority={urgency.value} />
            {URGENCY_LABELS[urgency.value]}
            <small>{urgency.source === "manual" ? "手动" : urgency.source === "issues" ? "议题同步" : "自动"}</small>
          </span>
          <span title={matchedCodexProject?.name ?? "尚未匹配 Codex 项目"}>
            Codex：{matchedCodexProject?.name ?? "未匹配"}
          </span>
          <span className="project-profile-path" title={resolvedWorkspacePath ?? "尚未设置项目文件夹"}>
            <LinearIcon name="folder" />
            {resolvedWorkspacePath ?? "未设置项目文件夹"}
          </span>
        </div>
        <div className="project-profile-copy">
          <div><span>项目描述</span><p>{profile?.description || "尚未填写项目描述"}</p></div>
          <div><span>下一步规划</span><p>{profile?.nextPlan || "尚未填写下一步规划"}</p></div>
        </div>
      </div>
      <div className="project-progress-card">
        <div><span>项目进度</span><strong>{progress.percent}%</strong></div>
        <div className="project-progress-track" aria-label={`项目进度 ${progress.percent}%`}>
          <span style={{ width: `${progress.percent}%` }} />
        </div>
        <p>{progress.done}/{progress.total} 已完成 · {progress.inProgress} 执行中 · {progress.inReview} 待查看 · {progress.blocked} 阻塞</p>
      </div>

      {editing && (
        <div className="project-profile-modal-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget && !saving) setEditing(false);
        }}>
          <form className="project-profile-modal" onSubmit={(event) => void submit(event)}>
            <div className="project-profile-modal-header">
              <div><span>项目设置</span><h2>匹配 Codex 与项目档案</h2></div>
              <button type="button" aria-label="关闭项目设置" disabled={saving} onClick={() => setEditing(false)}>
                <LinearIcon name="close" />
              </button>
            </div>
            <label>项目名称<input value={displayName} maxLength={120} onChange={(event) => setDisplayName(event.target.value)} /></label>
            <label>匹配 Codex 项目
              <select value={codexProjectId} onChange={(event) => {
                const nextId = event.target.value;
                setCodexProjectId(nextId);
                if (nextId && workspacePaths[nextId]) setWorkspacePath(workspacePaths[nextId]);
              }}>
                <option value="">不匹配</option>
                {codexProjects.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}
              </select>
            </label>
            <label>项目文件夹<input value={workspacePath} maxLength={4096} placeholder="/Users/name/project 或 C:\\Projects\\project" onChange={(event) => setWorkspacePath(event.target.value)} /></label>
            <label>紧急状态
              <select value={urgencyOverride} onChange={(event) => setUrgencyOverride(event.target.value as TaskPriority | "auto")}>
                <option value="auto">自动同步未完成议题的最高优先级</option>
                <option value="urgent">紧急</option>
                <option value="high">高优先级</option>
                <option value="medium">中优先级</option>
                <option value="low">低优先级</option>
                <option value="none">无紧急标记</option>
              </select>
            </label>
            <label>项目描述<textarea value={description} maxLength={20000} rows={4} onChange={(event) => setDescription(event.target.value)} /></label>
            <label>下一步规划<textarea value={nextPlan} maxLength={20000} rows={4} onChange={(event) => setNextPlan(event.target.value)} /></label>
            <div className="project-profile-modal-actions">
              <button type="button" disabled={saving} onClick={() => setEditing(false)}>取消</button>
              <button type="submit" className="primary" disabled={saving}>{saving ? "保存中…" : "保存项目"}</button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}

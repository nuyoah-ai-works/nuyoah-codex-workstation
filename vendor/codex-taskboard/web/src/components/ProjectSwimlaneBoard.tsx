import { useMemo, useState, type CSSProperties, type DragEvent, type PointerEvent } from "react";
import type { Task, TaskPriority, TaskStatus } from "../types";
import { ActorAvatar } from "./ActorAvatar";
import { LinearIcon, LinearPriorityIcon, LinearStatusIcon } from "./LinearIcon";
import { taskGuidance } from "../../../shared/task-guidance.mjs";

export type ProjectSwimlaneId = "ready" | "active" | "review" | "advance" | "done" | "canceled";

interface ProjectSwimlane {
  id: ProjectSwimlaneId;
  label: string;
  statuses: TaskStatus[];
  targetStatus: TaskStatus;
  iconStatus: TaskStatus;
}

const SWIMLANES: ProjectSwimlane[] = [
  { id: "ready", label: "待执行", statuses: ["backlog", "todo"], targetStatus: "todo", iconStatus: "todo" },
  { id: "active", label: "执行中", statuses: ["in_progress"], targetStatus: "in_progress", iconStatus: "in_progress" },
  { id: "review", label: "待查看", statuses: ["in_review"], targetStatus: "in_review", iconStatus: "in_review" },
  { id: "advance", label: "待推进", statuses: ["blocked"], targetStatus: "blocked", iconStatus: "blocked" },
  { id: "done", label: "已完成", statuses: ["done"], targetStatus: "done", iconStatus: "done" },
  { id: "canceled", label: "已废弃", statuses: ["canceled"], targetStatus: "canceled", iconStatus: "canceled" },
];

const PRIORITY_LABELS: Record<TaskPriority, string> = {
  none: "无优先级",
  urgent: "紧急",
  high: "高优先级",
  medium: "中优先级",
  low: "低优先级",
};

const DEFAULT_LANE_WIDTH = 280;
const MIN_LANE_WIDTH = 160;
const MAX_LANE_WIDTH = 480;

interface LaneResizeState {
  laneId: ProjectSwimlaneId;
  pointerId: number;
  startX: number;
  startWidth: number;
}

function laneForStatus(status: TaskStatus): ProjectSwimlane {
  return SWIMLANES.find((lane) => lane.statuses.includes(status)) ?? SWIMLANES[0];
}

interface ProjectSwimlaneBoardProps {
  tasks: Task[];
  projectNames: Map<string, string>;
  projectUrgencies: Map<string, TaskPriority>;
  loading: boolean;
  movingTaskId: string | null;
  onOpenTask: (task: Task) => void;
  onOpenThread: (threadId: string) => void;
  onMoveTask: (task: Task, status: TaskStatus) => void;
}

export function ProjectSwimlaneBoard({
  tasks,
  projectNames,
  projectUrgencies,
  loading,
  movingTaskId,
  onOpenTask,
  onOpenThread,
  onMoveTask,
}: ProjectSwimlaneBoardProps) {
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);
  const [dropLaneId, setDropLaneId] = useState<ProjectSwimlaneId | null>(null);
  const [laneWidths, setLaneWidths] = useState<Record<ProjectSwimlaneId, number>>(() => Object.fromEntries(
    SWIMLANES.map((lane) => [lane.id, DEFAULT_LANE_WIDTH]),
  ) as Record<ProjectSwimlaneId, number>);
  const [laneResize, setLaneResize] = useState<LaneResizeState | null>(null);
  const tasksByLane = useMemo(() => new Map(SWIMLANES.map((lane) => [
    lane.id,
    tasks.filter((task) => lane.statuses.includes(task.status)),
  ])), [tasks]);

  function finishDrag() {
    setDraggedTaskId(null);
    setDropLaneId(null);
  }

  function dropTask(event: DragEvent<HTMLElement>, lane: ProjectSwimlane) {
    event.preventDefault();
    const taskId = event.dataTransfer.getData("application/x-taskboard-task")
      || event.dataTransfer.getData("text/plain");
    const task = tasks.find((candidate) => candidate.id === taskId);
    finishDrag();
    if (task) onMoveTask(task, lane.targetStatus);
  }

  function beginLaneResize(event: PointerEvent<HTMLButtonElement>, laneId: ProjectSwimlaneId) {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    setLaneResize({
      laneId,
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: laneWidths[laneId],
    });
  }

  function continueLaneResize(event: PointerEvent<HTMLButtonElement>) {
    if (!laneResize || event.pointerId !== laneResize.pointerId) return;
    const nextWidth = Math.min(
      MAX_LANE_WIDTH,
      Math.max(MIN_LANE_WIDTH, laneResize.startWidth + event.clientX - laneResize.startX),
    );
    setLaneWidths((current) => current[laneResize.laneId] === nextWidth
      ? current
      : { ...current, [laneResize.laneId]: nextWidth });
  }

  function finishLaneResize(event: PointerEvent<HTMLButtonElement>) {
    if (!laneResize || event.pointerId !== laneResize.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setLaneResize(null);
  }

  const boardStyle = {
    gridTemplateColumns: SWIMLANES.map((lane) => `${laneWidths[lane.id]}px`).join(" "),
  } satisfies CSSProperties;

  return (
    <div className="project-swimlane-scroll" role="region" aria-label="跨项目六泳道看板" tabIndex={0}>
      <div className="project-swimlane-board" style={boardStyle}>
        {SWIMLANES.map((lane) => {
          const laneTasks = tasksByLane.get(lane.id) ?? [];
          return (
            <section
              className={`project-swimlane lane-${lane.id}${dropLaneId === lane.id ? " is-drop-target" : ""}${laneResize?.laneId === lane.id ? " is-resizing" : ""}`}
              key={lane.id}
              aria-labelledby={`project-swimlane-${lane.id}`}
              onDragEnter={() => setDropLaneId(lane.id)}
              onDragOver={(event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                setDropLaneId(lane.id);
              }}
              onDragLeave={(event) => {
                if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) {
                  setDropLaneId((current) => current === lane.id ? null : current);
                }
              }}
              onDrop={(event) => dropTask(event, lane)}
            >
              <header className="project-swimlane-header">
                <span className={`project-swimlane-status lane-${lane.id}`} aria-hidden="true">
                  <LinearStatusIcon status={lane.iconStatus} />
                </span>
                <h2 id={`project-swimlane-${lane.id}`}>{lane.label}</h2>
                <span aria-label={`${laneTasks.length} 个议题`}>{laneTasks.length}</span>
              </header>

              <div className="project-swimlane-list">
                {loading ? (
                  <div className="project-swimlane-skeleton" aria-label={`正在加载${lane.label}`} aria-busy="true">
                    <span /><span />
                  </div>
                ) : laneTasks.length > 0 ? laneTasks.map((task) => {
                  const currentLane = laneForStatus(task.status);
                  const projectName = task.sourceProjectName ?? projectNames.get(task.projectId) ?? task.projectId;
                  const projectUrgency = projectUrgencies.get(task.projectId) ?? "none";
                  const moving = movingTaskId === task.id;
                  const guidance = taskGuidance(task);
                  return (
                    <article
                      className={`project-swimlane-card priority-${task.priority}${draggedTaskId === task.id ? " is-dragging" : ""}${moving ? " is-moving" : ""}`}
                      key={task.id}
                      draggable={!moving}
                      data-task-id={task.id}
                      onDragStart={(event) => {
                        event.dataTransfer.effectAllowed = "move";
                        event.dataTransfer.setData("text/plain", task.id);
                        event.dataTransfer.setData("application/x-taskboard-task", task.id);
                        setDraggedTaskId(task.id);
                      }}
                      onDragEnd={finishDrag}
                    >
                      <button
                        className="project-swimlane-card-open"
                        type="button"
                        aria-label={`打开 ${projectName} 的 ${task.identifier}: ${task.title}`}
                        onClick={() => onOpenTask(task)}
                      />
                      <div className="project-swimlane-card-project">
                        <span className="project-swimlane-project-avatar" aria-hidden="true">
                          {projectName.slice(0, 1).toUpperCase()}
                        </span>
                        <strong title={projectName}>{projectName}</strong>
                        <span
                          className={`project-card-urgency urgency-${projectUrgency}`}
                          title={`项目紧急状态：${PRIORITY_LABELS[projectUrgency]}`}
                        >
                          <LinearPriorityIcon priority={projectUrgency} />
                          {PRIORITY_LABELS[projectUrgency]}
                        </span>
                        <ActorAvatar actor={task.assignee} className="project-swimlane-assignee" />
                      </div>
                      <span className="project-swimlane-identifier">{task.identifier}</span>
                      <h3>{task.title}</h3>
                      <div className="project-swimlane-guidance">
                        <div className="project-swimlane-description">
                          <span>任务描述</span>
                          <p>{guidance.description}</p>
                        </div>
                        <div className="project-swimlane-next">
                          <span className="project-swimlane-stage">{guidance.stage}</span>
                          <p><strong>下一步</strong>{guidance.nextAction}</p>
                        </div>
                        <div className="project-swimlane-suggestions" aria-label="建议方向">
                          {guidance.suggestions.slice(0, 2).map((suggestion: string) => (
                            <span key={suggestion} title={suggestion}>{suggestion}</span>
                          ))}
                        </div>
                      </div>
                      <div className="project-swimlane-card-footer">
                        <span className={`priority-icon priority-icon-${task.priority}`} title={PRIORITY_LABELS[task.priority]}>
                          <LinearPriorityIcon priority={task.priority} />
                        </span>
                        {task.labels.slice(0, 1).map((label) => <span className="label-chip" key={label}>{label}</span>)}
                        <span className="project-swimlane-spacer" />
                        {task.threadId && (
                          <button
                            className="project-swimlane-thread"
                            type="button"
                            aria-label={`查看对话 ${task.threadId}`}
                            title="查看关联对话"
                            onClick={(event) => {
                              event.stopPropagation();
                              onOpenThread(task.threadId!);
                            }}
                          >
                            <LinearIcon name="conversation" />
                          </button>
                        )}
                        <label className="project-swimlane-move" title="移动到其他泳道">
                          <LinearIcon name="chevronDown" />
                          <select
                            value={currentLane.id}
                            disabled={moving}
                            aria-label={`移动 ${task.identifier} 到泳道`}
                            onClick={(event) => event.stopPropagation()}
                            onChange={(event) => {
                              const nextLane = SWIMLANES.find((candidate) => candidate.id === event.currentTarget.value);
                              if (nextLane) onMoveTask(task, nextLane.targetStatus);
                            }}
                          >
                            {SWIMLANES.map((candidate) => (
                              <option key={candidate.id} value={candidate.id}>{candidate.label}</option>
                            ))}
                          </select>
                        </label>
                      </div>
                    </article>
                  );
                }) : (
                  <p className="project-swimlane-empty">暂无议题</p>
                )}
              </div>
              <button
                className="project-swimlane-resize-handle"
                type="button"
                aria-label={`调整${lane.label}泳道宽度`}
                title={`拖动调整${lane.label}宽度`}
                onPointerDown={(event) => beginLaneResize(event, lane.id)}
                onPointerMove={continueLaneResize}
                onPointerUp={finishLaneResize}
                onPointerCancel={finishLaneResize}
              />
            </section>
          );
        })}
      </div>
    </div>
  );
}

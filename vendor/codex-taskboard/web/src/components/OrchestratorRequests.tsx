import { useEffect, useMemo, useRef, useState } from "react";

import {
  getOrchestratorRequest,
  listOrchestratorRequests,
} from "../api";
import type {
  OrchestratorRequest,
  OrchestratorRequestDetailResponse,
  OrchestratorRequestListResponse,
} from "../types";
// @ts-expect-error Shared ESM merge logic is covered by a focused node:test.
import { mergeOrchestratorRequestSnapshot } from "../../../../../nuyoah/taskboard/orchestrator-view.mjs";

export type CodexTaskboardView = "orchestrator" | "all";

export const ORCHESTRATOR_VIEW_KEY = "taskboard.codex-live-view.v1";

const REQUEST_STATUS_LABELS: Record<OrchestratorRequest["status"], string> = {
  planning: "规划中",
  running: "执行中",
  verifying: "验证中",
  waiting_user: "等待南鸢",
  done: "已完成",
  failed: "失败",
  cancelled: "已取消",
};

const DISPATCH_STATUS_LABELS = {
  registered: "已登记",
  running: "执行中",
  waiting_user: "等待南鸢",
  done: "已完成",
  failed: "失败",
  cancelled: "已取消",
  unknown: "状态待处理",
} as const;

const CANDIDATE_STATUS_LABELS = {
  draft: "候选草稿",
  queued: "候选排队中",
  evaluating: "候选评估中",
  accepted: "候选已通过评估",
  revalidation_required: "候选待复验",
  rejected: "候选已拒绝",
  held: "候选已搁置",
  expired: "候选已过期",
} as const;

const LOCAL_RECORD_LABELS = {
  not_recorded: "本地未固化",
  approved: "本地固化已批准",
  recorded: "本地已固化",
  rolled_back: "本地固化已回滚",
} as const;

const ENABLE_LABELS = {
  not_enabled: "未启用",
  enabled: "已启用",
  suspended: "已暂停启用",
  rolled_back: "启用已回滚",
} as const;

const PUBLISH_LABELS = {
  not_published: "未发布",
  published: "已发布",
  rolled_back: "发布已回滚",
} as const;

const EVIDENCE_LEVELS = ["static", "test", "runtime", "gui", "external", "publish"] as const;
const THREAD_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RECENT_FINISHED_COUNT = 4;

type RequestGroup = "attention" | "active" | "finished";

export function requestNeedsAttention(request: OrchestratorRequest) {
  if (request.needsUser || request.status === "failed") return true;
  if (request.status === "done" || request.status === "cancelled") return false;
  return request.dispatches.some((dispatch) => dispatch.needsAttention || dispatch.status === "unknown");
}

function requestGroup(request: OrchestratorRequest): RequestGroup {
  if (requestNeedsAttention(request)) return "attention";
  if (request.status === "done" || request.status === "cancelled") return "finished";
  return "active";
}

function newestFirst(left: { updatedAt: string }, right: { updatedAt: string }) {
  const leftTime = Date.parse(left.updatedAt);
  const rightTime = Date.parse(right.updatedAt);
  return (Number.isFinite(rightTime) ? rightTime : 0) - (Number.isFinite(leftTime) ? leftTime : 0);
}

function realThreadId(value: string | null | undefined): value is string {
  return typeof value === "string" && THREAD_ID_PATTERN.test(value);
}

function shortSummary(value: string) {
  const summary = value.trim();
  return summary.length > 90 ? `${summary.slice(0, 90).trimEnd()}…` : summary;
}

function trustedTime(value: string | null | undefined) {
  if (!value) return "时间未知";
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toLocaleString("zh-CN") : "时间未知";
}

export function readSavedTaskboardView(): CodexTaskboardView | null {
  try {
    const value = window.localStorage.getItem(ORCHESTRATOR_VIEW_KEY);
    return value === "orchestrator" || value === "all" ? value : null;
  } catch {
    return null;
  }
}

export function saveTaskboardView(value: CodexTaskboardView) {
  try { window.localStorage.setItem(ORCHESTRATOR_VIEW_KEY, value); } catch {}
}

export function useOrchestratorRequests() {
  const [snapshot, setSnapshot] = useState<OrchestratorRequestListResponse | null>(null);

  useEffect(() => {
    let active = true;
    let controller: AbortController | null = null;
    const load = async () => {
      controller?.abort();
      controller = new AbortController();
      try {
        const next = await listOrchestratorRequests(controller.signal);
        if (active) setSnapshot(next);
      } catch (error) {
        if (!active || (error instanceof Error && error.name === "AbortError")) return;
        setSnapshot((current) => ({
          status: "reconnecting",
          reconnect: true,
          snapshotAt: current?.snapshotAt ?? null,
          schemaVersion: current?.schemaVersion ?? null,
          schemaStatus: current?.schemaStatus ?? "unavailable",
          requests: current?.requests ?? null,
          message: current?.requests
            ? "总管账本暂时无法读取，当前显示上次可信结果。"
            : "总管账本暂时无法读取，请稍后重试。",
        }));
      }
    };
    void load();
    const timer = window.setInterval(load, 4_000);
    return () => {
      active = false;
      controller?.abort();
      window.clearInterval(timer);
    };
  }, []);

  return snapshot;
}

function requestProgress(request: OrchestratorRequest) {
  if (request.progress.total > 0) return request.progress;
  return {
    completed: request.dispatches.filter((dispatch) => dispatch.status === "done").length,
    total: request.dispatches.length,
  };
}

function shortModel(model: string) {
  return model.replace(/^gpt-5\.6-/, "");
}

interface OrchestratorRequestViewProps {
  snapshot: OrchestratorRequestListResponse | null;
  resolveThreadHost: (threadId: string) => string | null;
  onOpenThread: (threadId: string, hostId: string) => void;
}

export function OrchestratorRequestView({ snapshot, resolveThreadHost, onOpenThread }: OrchestratorRequestViewProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showFinishedHistory, setShowFinishedHistory] = useState(false);
  const [details, setDetails] = useState<Record<string, OrchestratorRequestDetailResponse>>({});
  const [detailErrors, setDetailErrors] = useState<Record<string, string>>({});
  const detailLoadSequence = useRef<Record<string, number>>({});
  const requests = useMemo(() => snapshot?.requests ?? [], [snapshot?.requests]);
  const grouped = useMemo(() => {
    const result: Record<RequestGroup, OrchestratorRequest[]> = { attention: [], active: [], finished: [] };
    for (const request of requests) result[requestGroup(request)].push(request);
    for (const group of Object.values(result)) group.sort(newestFirst);
    return result;
  }, [requests]);

  async function toggleDetails(requestId: string) {
    if (expandedId === requestId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(requestId);
    setDetailErrors((current) => ({ ...current, [requestId]: "" }));
    const sequence = (detailLoadSequence.current[requestId] ?? 0) + 1;
    detailLoadSequence.current[requestId] = sequence;
    try {
      const detail = await getOrchestratorRequest(requestId);
      if (detailLoadSequence.current[requestId] !== sequence) return;
      setDetails((current) => ({ ...current, [requestId]: detail }));
    } catch (error) {
      if (detailLoadSequence.current[requestId] !== sequence) return;
      setDetailErrors((current) => ({
        ...current,
        [requestId]: error instanceof Error ? error.message : "委托详情读取失败，请重试。",
      }));
    }
  }

  function renderRequestCard(request: OrchestratorRequest) {
    const detail = details[request.id];
    const shown = mergeOrchestratorRequestSnapshot(request, detail) as OrchestratorRequest;
    const progress = requestProgress(shown);
    const expanded = expandedId === request.id;
    const sourceThreadId = shown.lineageStatus === "known" && realThreadId(shown.rootSessionId)
      ? shown.rootSessionId : null;
    const sourceHostId = sourceThreadId ? resolveThreadHost(sourceThreadId) : null;
    const activeDispatch = [...shown.dispatches]
      .filter((dispatch) => realThreadId(dispatch.threadId)
        && (dispatch.status === "running" || dispatch.status === "waiting_user"))
      .sort(newestFirst)[0];
    const recentDispatch = [...shown.dispatches]
      .filter((dispatch) => realThreadId(dispatch.threadId))
      .sort(newestFirst)[0];
    const linkedDispatch = activeDispatch ?? recentDispatch;
    const linkedThreadId = linkedDispatch && realThreadId(linkedDispatch.threadId)
      ? linkedDispatch.threadId : null;
    const linkedHostId = linkedThreadId ? resolveThreadHost(linkedThreadId) : null;
    const workerDone = shown.dispatches.filter((dispatch) => dispatch.role === "worker" && dispatch.status === "done").length;
    const workerTotal = shown.dispatches.filter((dispatch) => dispatch.role === "worker").length;
    const candidate = shown.candidateRefs[0];
    const childNeedsAttention = shown.status !== "done" && shown.status !== "cancelled"
      && shown.dispatches.some((dispatch) => dispatch.needsAttention || dispatch.status === "unknown");
    const highestEvidence = [...shown.evidenceRefs]
      .filter((entry) => entry.verification === "PASS")
      .sort((left, right) => EVIDENCE_LEVELS.indexOf(right.level) - EVIDENCE_LEVELS.indexOf(left.level))[0];
    return (
      <article className={`codex-orchestrator-card is-${request.status}`} key={request.id}>
        <header>
          <div>
            <span>{request.projectId || "未绑定项目"}</span>
            <h2>{request.goal}</h2>
          </div>
          <div className="codex-orchestrator-badges">
            {request.needsUser && <span className="needs-user">需要南鸢</span>}
            {!request.needsUser && childNeedsAttention && <span className="needs-user">子任务待核对</span>}
            <span>{request.status === "waiting_user" && !request.needsUser
              ? "等待中" : REQUEST_STATUS_LABELS[request.status]}</span>
          </div>
        </header>
        <div className="codex-orchestrator-summary">
          <span>{progress.total > 0 ? <>进度 {progress.completed}/{progress.total}</> : "尚未派发"}</span>
          {request.verification !== "UNVERIFIED" && (
            <span className={`verification is-${request.verification.toLowerCase()}`}>
              验证 {request.verification}
            </span>
          )}
        </div>
        {request.summary && <p title={request.summary}>{shortSummary(request.summary)}</p>}
        <div className="codex-orchestrator-primary-action">
          {sourceThreadId && sourceHostId && (
            <button type="button" onClick={() => onOpenThread(sourceThreadId, sourceHostId)}>打开来源会话</button>
          )}
          {linkedThreadId && linkedHostId && linkedThreadId !== sourceThreadId && (
            <button type="button" onClick={() => onOpenThread(linkedThreadId, linkedHostId)}>
              {activeDispatch
                ? linkedDispatch.role === "verifier" ? "打开验证任务" : "打开执行任务"
                : linkedDispatch.status === "registered" ? "打开已登记任务" : "打开最近任务"}
            </button>
          )}
        </div>
        {expanded && (
          <div className="codex-orchestrator-detail">
            {detailErrors[request.id] && <span role="alert">{detailErrors[request.id]}</span>}
            {!detail && !detailErrors[request.id] && <span>正在读取详情…</span>}
            {detail?.status !== "connected" && detail?.message && (
              <span>委托详情暂时无法读取，当前卡片仍显示已读取的状态。</span>
            )}
            {request.summary && <p><strong>当前摘要</strong>{request.summary}</p>}
            <div className="codex-orchestrator-detail-group">
              <strong>执行与验证</strong>
              <p><span>工人完成 {workerDone}/{workerTotal}</span>
                {highestEvidence ? `最高证据 ${highestEvidence.level}` : "尚无分层证据"} ·
                {request.sessions.length > 1 ? `${request.sessions.length - 1} 次恢复` : "未恢复"} ·
                尝试 {request.attemptCount} 次
              </p>
            </div>
            {candidate && <div className="codex-orchestrator-candidate-summary">
              <span>{CANDIDATE_STATUS_LABELS[candidate.candidateStatus]}</span>
              <span>独立验证 {candidate.validationStatus}</span>
              <span>{LOCAL_RECORD_LABELS[candidate.localRecordStatus]}</span>
              <span>{ENABLE_LABELS[candidate.enableStatus]}</span>
              <span>{PUBLISH_LABELS[candidate.publishStatus]}</span>
              {candidate.sourceStatus !== "connected" && (
                <span className="is-stale">治理真源读取失败 · 上次可信 {trustedTime(candidate.lastTrustedAt)}</span>
              )}
            </div>}
            {shown.dispatches.length > 0 && <div className="codex-orchestrator-dispatches">
              {shown.dispatches.map((dispatch) => (
                <div className={`codex-orchestrator-dispatch is-${dispatch.status}`} key={dispatch.id}>
                  <div>
                    <strong>{dispatch.role === "verifier" ? "验证" : "执行"} · {shortModel(dispatch.model)}</strong>
                    <span>{dispatch.effort} · {dispatch.status === "registered" && dispatch.runGate && !dispatch.runGate.ready
                      ? "等待依赖"
                      : DISPATCH_STATUS_LABELS[dispatch.status]} · {dispatch.verification}</span>
                  </div>
                  {realThreadId(dispatch.threadId) && resolveThreadHost(dispatch.threadId) ? (
                    <button type="button" onClick={() => onOpenThread(dispatch.threadId!, resolveThreadHost(dispatch.threadId!)!)}>打开任务</button>
                  ) : (
                    <span className="codex-orchestrator-not-ready">
                      {dispatch.clientThreadId && dispatch.status === "registered" ? "任务正在建立" : "当前任务目录无法定位"}
                    </span>
                  )}
                </div>
              ))}
            </div>}
            {shown.evidence && <p><strong>验证证据</strong>{shown.evidence}</p>}
            <p><strong>会话血缘</strong>
              {shown.lineageStatus === "known"
                ? `固定来源 ${shown.rootSessionId}；关联 ${shown.sessions.length} 个会话`
                : "旧记录没有可靠来源会话，不能按标题或目录补猜。"}
            </p>
            {shown.dispatches.some((dispatch) => dispatch.ownership.length > 0 || dispatch.dependencies.length > 0) && (
              <div className="codex-orchestrator-detail-group">
                <strong>子任务所有权与依赖</strong>
                {shown.dispatches.map((dispatch) => (
                  <p key={`ownership-${dispatch.id}`}>
                    <span>{dispatch.id}</span>
                    {dispatch.ownership.length > 0
                      ? dispatch.ownership.map((claim) => `${claim.accessMode} ${claim.objectKey} (${claim.phase})`).join("；")
                      : "未登记对象"}
                    {dispatch.dependencies.length > 0 ? `；依赖 ${dispatch.dependencies.join("、")}` : ""}
                  </p>
                ))}
              </div>
            )}
            {shown.routeDecisions.length > 0 && (
              <div className="codex-orchestrator-detail-group">
                <strong>为什么这样派</strong>
                {shown.routeDecisions.map((route) => (
                  <p key={route.id}>
                    <span>{route.ruleOutcome === "selected" ? "规则允许" : route.ruleOutcome === "blocked" ? "规则阻止" : "规则冲突"}</span>
                    {route.reasonSummary}
                    <small>
                      规则：{route.ruleMatches.filter((match) => match.selected).map((match) => match.id).join("、") || "无"}
                      ；Skill：{route.skillMatches.filter((match) => match.selected).map((match) => match.id).join("、") || "无"}
                      ；工具：{route.toolMatches.filter((match) => match.selected).map((match) => match.id).join("、") || "无"}
                    </small>
                  </p>
                ))}
              </div>
            )}
            {shown.evidenceRefs.length > 0 && (
              <div className="codex-orchestrator-detail-group">
                <strong>验证证据</strong>
                {shown.evidenceRefs.map((evidence) => (
                  <p key={evidence.id}><span>{evidence.level} · {evidence.verification}</span>{evidence.summary || evidence.reference}</p>
                ))}
              </div>
            )}
            {shown.candidateRefs.map((entry) => (
              <div className="codex-orchestrator-detail-group" key={entry.id}>
                <strong>候选经验</strong>
                <p><span>{entry.candidateRef}</span>{entry.summary || "治理真源未提供摘要"}</p>
                <p><span>资格与价值门</span>
                  {entry.qualificationStatus} · {entry.valueGateStage} {entry.valueGateDecision} ·
                  容量{entry.capacityStatus === "available" ? "可用" : entry.capacityStatus === "full" ? "已满" : "未知"} ·
                  {entry.routingEligible ? "可参与路由" : "不参与路由"}
                </p>
                <p><span>固化 / 启用 / 发布</span>
                  {LOCAL_RECORD_LABELS[entry.localRecordStatus]} · {ENABLE_LABELS[entry.enableStatus]} · {PUBLISH_LABELS[entry.publishStatus]}
                </p>
                {entry.activationMode === "write_is_activation" && <p><span>写入即启用回滚</span>
                  总管路由{entry.rollback.orchestratorRouteBlockedAt ? "已阻断" : "未阻断"} ·
                  正式真源{entry.rollback.canonicalSourceRolledBackAt ? "已回滚" : "未回滚"} ·
                  新会话{entry.rollback.freshSessionNoLoadVerifiedAt ? "已确认不再加载" : "未确认"}
                </p>}
              </div>
            ))}
            {shown.events && shown.events.length > 0 && (
              <ol>
                {shown.events.map((event) => (
                  <li key={event.id}><span>{event.type}</span>{event.summary}</li>
                ))}
              </ol>
            )}
          </div>
        )}
        <footer>
          <button type="button" aria-expanded={expanded} onClick={() => void toggleDetails(request.id)}>
            {expanded ? "收起详情" : "查看详情"}
          </button>
        </footer>
      </article>
    );
  }

  if (!snapshot) {
    return <div className="codex-orchestrator-empty" aria-busy="true">正在读取委托账本…</div>;
  }

  if (!snapshot.requests) {
    const unsupported = snapshot.status === "unsupported_newer_schema"
      || snapshot.status === "unsupported_older_schema";
    return (
      <div className="codex-orchestrator-state" role="status">
        <strong>{snapshot.status === "unconfigured"
          ? "委托账本尚未连接"
          : unsupported
            ? "当前工作站不支持这个账本版本"
            : "委托账本正在重连"}</strong>
        <span>{snapshot.status === "unconfigured"
          ? "当前设备无法读取已有委托；连接总管账本后会显示真实记录。"
          : snapshot.message}</span>
      </div>
    );
  }

  return (
    <section className="codex-orchestrator-view" aria-label="委托任务">
      {snapshot.status !== "connected" && (
        <div className="codex-live-connection" role="status">
          {snapshot.message} 上次可信时间：{trustedTime(snapshot.snapshotAt)}
        </div>
      )}
      {snapshot.schemaStatus === "read_only_degraded" && (
        <div className="codex-live-connection" role="status">{snapshot.message}</div>
      )}
      {requests.length === 0 ? (
        <div className="codex-orchestrator-empty">
          <strong>暂无委托</strong>
          <span>账本中还没有委托记录。</span>
        </div>
      ) : (
        <div className="codex-orchestrator-sections">
          {([
            { key: "attention", label: "需要关注", requests: grouped.attention },
            { key: "active", label: "进行中", requests: grouped.active },
            { key: "finished", label: "最近结束", requests: grouped.finished },
          ] as const).filter((section) => section.requests.length > 0).map((section) => (
            <section className={`codex-orchestrator-section is-${section.key}`} key={section.key} aria-label={section.label}>
              <header className="codex-orchestrator-section-header">
                <h2>{section.label}</h2>
                <span>{section.requests.length}</span>
              </header>
              <div className="codex-orchestrator-list">
                {(section.key === "finished" && !showFinishedHistory
                  ? section.requests.slice(0, RECENT_FINISHED_COUNT)
                  : section.requests).map(renderRequestCard)}
              </div>
              {section.key === "finished" && section.requests.length > RECENT_FINISHED_COUNT && (
                <button
                  className="codex-orchestrator-history-toggle"
                  type="button"
                  aria-expanded={showFinishedHistory}
                  onClick={() => setShowFinishedHistory((current) => !current)}
                >
                  {showFinishedHistory
                    ? "收起更早记录"
                    : `查看更早记录（${section.requests.length - RECENT_FINISHED_COUNT}）`}
                </button>
              )}
            </section>
          ))}
        </div>
      )}
    </section>
  );
}

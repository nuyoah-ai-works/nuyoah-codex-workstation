import { defaultManualSmartGroup, mergeManualTags } from "./asset-metadata-ui.js";

const initialParams = new URLSearchParams(window.location.search);

const state = {
  system: { platform: "", name: "", pathSeparator: "/" },
  projects: [],
  selectedProject: localStorage.getItem("asset-library:selected-project") || "",
  assets: [],
  counts: { all: 0, text: 0, image: 0, audio: 0, video: 0 },
  smartCounts: { asset: 0, review: 0, noise: 0 },
  settings: { columns: 4, tags: [], taxonomy: {} },
  smartGroup: "asset",
  kind: "all",
  category: "",
  query: "",
  sort: "newest",
  busy: false,
  editingProject: null,
  action: null,
  actionAsset: null,
  textAsset: null,
  previewAsset: null,
  refreshTimer: null,
  visibleLimit: 120,
  contextOnly: false,
  context: {
    threadId: initialParams.get("threadId") || "",
    threadTitle: initialParams.get("threadTitle") || "",
    projectId: initialParams.get("projectId") || "",
    projectName: initialParams.get("projectName") || "",
  },
};

const els = Object.fromEntries([
  "localProjectList", "projectCount", "projectFoldersPanel", "projectFolderList", "newProjectButton",
  "editProjectButton", "workspaceTitle", "workspaceSubtitle", "scanState", "refreshLibraryButton", "settingsButton",
  "smartGroupTabs", "assetKindTabs", "librarySearchInput", "librarySortSelect", "assetColumnRange", "assetColumnOutput",
  "categoryChips", "assetGrid", "emptyLibraryState", "emptyCreateProjectButton", "projectDialog", "projectForm",
  "projectDialogTitle", "projectNameInput", "codexNewProjectScanRoots", "projectFormError", "saveProjectButton",
  "textViewerDialog", "textViewerTitle", "textViewerFormat", "textViewerPreview", "textViewerEditor",
  "toggleTextEditButton", "saveTextButton", "textSaveState", "assetActionDialog", "assetActionForm",
  "assetActionTitle", "assetActionFields", "assetActionError", "confirmAssetAction", "settingsDialog",
  "settingsForm", "tagManager", "newTagInput", "addTagButton", "taxonomyManager", "toastRegion",
  "mediaPreviewDialog", "mediaPreviewTitle", "mediaPreviewFormat", "mediaPreviewLayout", "mediaPreviewStage",
  "mediaPromptPanel", "mediaPromptMeta", "mediaPromptText", "mediaNegativePromptGroup", "mediaNegativePromptText", "mediaPromptReferences",
  "taskContextBar", "taskContextLabel", "taskContextToggle",
].map((id) => [id, document.getElementById(id)]));

function readDisplayPreferences() {
  try { const value = JSON.parse(localStorage.getItem('nuyoah-assets-display-v1') || '{}');
    return { layout: value.layout === 'list' ? 'list' : 'grid', excluded: Array.isArray(value.excluded) ? value.excluded : [], mjOnly: false }; }
  catch { return { layout: 'grid', excluded: [], mjOnly: false }; }
}
const displayPreferences = readDisplayPreferences();
let taskReferences = [], libraryRequest = 0;
function assetRelation(asset) {
  const ref = taskReferences.find(ref => ref.path === asset.sourcePath);
  if (ref?.relation === 'output') return '本任务产出';
  if (ref) return '工作参考';
  if (state.context.threadId && asset.promptAssociation?.threadId === state.context.threadId) return '本任务产出';
  return '项目其他文件';
}
async function refreshTaskReferences() {
  const threadId = state.context.threadId;
  taskReferences = [];
  if (!/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(threadId)) return;
  try {
    const result = await api(`/api/task-references?threadId=${encodeURIComponent(threadId)}`);
    if (state.context.threadId === threadId) taskReferences = result.references || [];
  } catch { if (state.context.threadId === threadId) showToast('任务引用暂不可读取', 'error'); }
}
function initializeDisplayPreferences() {
  const host = document.createElement('details'); host.className = 'asset-display-preferences';
  const heading = document.createElement('summary'); heading.textContent = '显示偏好'; host.append(heading);
  const layout = document.createElement('select'); layout.setAttribute('aria-label', '资产视图');
  for (const [value, text] of [['grid', '网格'], ['list', '列表']]) { const option = document.createElement('option'); option.value = value; option.textContent = text; layout.append(option); }
  layout.value = displayPreferences.layout;
  const save = () => { try { localStorage.setItem('nuyoah-assets-display-v1', JSON.stringify(displayPreferences)); } catch { showToast('显示偏好未能保存', 'error'); } resetAssetWindow(); };
  layout.onchange = () => { displayPreferences.layout = layout.value; save(); }; host.append(layout);
  for (const [value, text] of [['code', '代码'], ['html', '网页'], ['office', 'Office'], ['archive', '压缩包'], ['pdf', 'PDF'], ['image', '图片'], ['video', '视频'], ['audio', '音频'], ['markdown', 'Markdown'], ['document', '文本']]) {
    const label = document.createElement('label'), check = document.createElement('input'); check.type = 'checkbox'; check.checked = displayPreferences.excluded.includes(value);
    check.onchange = () => { displayPreferences.excluded = check.checked ? [...displayPreferences.excluded, value] : displayPreferences.excluded.filter(k => k !== value); save(); };
    label.append(check, document.createTextNode(`隐藏${text}`)); host.append(label);
  }
  const mj = document.createElement('label'), check = document.createElement('input'); check.type = 'checkbox';
  check.onchange = () => { displayPreferences.mjOnly = check.checked; resetAssetWindow(); };
  mj.append(check, document.createTextNode('按 MJ P 值组合分组')); host.append(mj);
  document.querySelector('.toolbar-row').after(host);
}
async function openReadOnlyPreview(asset) {
  state.previewAsset = asset;
  els.mediaPreviewTitle.textContent = asset.title;
  els.mediaPreviewFormat.textContent = asset.extension || '';
  els.mediaPromptPanel.hidden = true; els.mediaPreviewLayout.classList.remove('has-prompt');
  els.mediaPreviewStage.textContent = '正在读取…'; els.mediaPreviewDialog.showModal();
  try {
    const result = await api(`/api/preview?id=${encodeURIComponent(asset.id)}`);
    if (state.previewAsset?.id !== asset.id || !els.mediaPreviewDialog.open) return;
    const pre = document.createElement('pre'); pre.className = 'asset-readonly-preview'; pre.textContent = result.text + (result.truncated ? '\n…内容已截断' : '');
    els.mediaPreviewStage.replaceChildren(pre);
  } catch (error) { if (state.previewAsset?.id === asset.id) els.mediaPreviewStage.textContent = error.message; }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function isAbsoluteProjectPath(value, platform = state.system.platform) {
  const normalized = String(value || "").trim().replace(/\\/g, "/");
  if (platform === "win32") return /^[a-z]:\//i.test(normalized) || /^\/\/[a-z0-9._-]+\//i.test(normalized);
  return normalized.startsWith("/");
}

function parseScanRoots(value) {
  return [...new Set(String(value || "").split(/\r?\n|[,;]+/u).map((item) => item.trim()).filter(Boolean))];
}

function applyPlatformProjectUi(data = { system: state.system }) {
  const platform = data.system?.platform || state.system.platform;
  const copy = document.querySelector("[data-codex-project-platform-copy]");
  const example = platform === "win32" ? "D:\\Projects\\Assets" : "/Users/your-name/Projects/assets";
  els.codexNewProjectScanRoots.placeholder = `${example}\n${platform === "win32" ? "E:\\Media\\References" : "/Volumes/Media/References"}`;
  if (copy) copy.textContent = `已识别 ${data.system?.name || "当前系统"}；每行填写一个绝对路径，文件只在本机扫描。`;
}

async function api(route, options = {}) {
  const response = await fetch(route, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers || {}) },
  });
  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { error: text }; }
  if (!response.ok) throw new Error(data.error || `请求失败：${response.status}`);
  return data;
}

function showToast(message, tone = "") {
  const toast = document.createElement("div");
  toast.className = `toast ${tone}`;
  toast.textContent = String(message || "操作完成");
  els.toastRegion.append(toast);
  requestAnimationFrame(() => toast.classList.add("visible"));
  setTimeout(() => {
    toast.classList.remove("visible");
    setTimeout(() => toast.remove(), 180);
  }, 2600);
}

function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`;
  return `${(value / 1024 ** 3).toFixed(1)} GB`;
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds)) return "--:--";
  const total = Math.max(0, Math.round(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function formatDate(timestamp) {
  const date = new Date(timestamp);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  return date.toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
}

function selectedProject() {
  return state.projects.find((project) => project.id === state.selectedProject) || null;
}

function contextualProjectId() {
  if (!state.context.projectId) return "";
  return state.projects.find((project) => project.codexSync?.projectId === state.context.projectId)?.id || "";
}

function renderTaskContext() {
  const available = Boolean(state.context.threadId || state.context.threadTitle || state.context.projectName);
  els.taskContextBar.hidden = !available;
  if (!available) return;
  const task = state.context.threadTitle || "当前任务";
  const project = state.context.projectName ? ` · ${state.context.projectName}` : "";
  els.taskContextLabel.textContent = `${task}${project}`;
  els.taskContextToggle.disabled = !state.context.threadId;
  els.taskContextToggle.setAttribute("aria-pressed", String(state.contextOnly));
  els.taskContextToggle.textContent = state.contextOnly ? "查看项目全部" : "只看当前任务";
}

async function applyTaskContext(context = {}) {
  state.context = {
    threadId: typeof context.threadId === "string" ? context.threadId.trim() : "",
    threadTitle: typeof context.threadTitle === "string" ? context.threadTitle.trim() : "",
    projectId: typeof context.projectId === "string" ? context.projectId.trim() : "",
    projectName: typeof context.projectName === "string" ? context.projectName.trim() : "",
  };
  state.contextOnly = false;
  await refreshTaskReferences();
  renderTaskContext();
  const projectId = contextualProjectId();
  if (projectId && projectId !== state.selectedProject) await selectProject(projectId);
  else resetAssetWindow();
}

function setColumns(value, persist = false) {
  const columns = Math.max(1, Math.min(8, Number(value) || 4));
  state.settings.columns = columns;
  els.assetColumnRange.value = String(columns);
  els.assetColumnOutput.value = String(columns);
  document.documentElement.style.setProperty("--asset-columns", String(columns));
  if (persist) {
    clearTimeout(setColumns.timer);
    setColumns.timer = setTimeout(() => api("/api/settings", {
      method: "PATCH",
      body: JSON.stringify({ columns }),
    }).catch((error) => showToast(error.message, "error")), 250);
  }
}

function renderProjects() {
  els.projectCount.textContent = String(state.projects.length);
  els.localProjectList.replaceChildren();
  for (const project of state.projects) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `project-item ${project.id === state.selectedProject ? "active" : ""}`;
    button.dataset.projectId = project.id;
    const initial = [...String(project.name || "项")][0] || "项";
    const syncBadge = project.codexSync?.projectId ? `<em class="project-sync-badge" title="由 Codex 制作型项目自动同步">Codex 同步</em>` : "";
    button.innerHTML = `<span class="project-avatar">${escapeHtml(initial)}</span><span class="project-copy"><strong>${escapeHtml(project.name)}</strong><small><span>${project.folders?.length || 0} 个文件夹</span>${syncBadge}</small></span><span class="project-chevron">›</span>`;
    button.addEventListener("click", () => selectProject(project.id));
    els.localProjectList.append(button);
  }
  const project = selectedProject();
  els.projectFoldersPanel.hidden = !project;
  els.projectFolderList.replaceChildren();
  for (const folder of project?.folders || []) {
    const row = document.createElement("div");
    row.className = "folder-row";
    row.innerHTML = `<span aria-hidden="true">⌑</span><span title="${escapeHtml(folder)}">${escapeHtml(folder)}</span>`;
    els.projectFolderList.append(row);
  }
}

function updateKindCounts() {
  const counts = { all: 0, text: 0, image: 0, audio: 0, video: 0 };
  state.assets.filter((asset) => asset.smartGroup === state.smartGroup).forEach((asset) => {
    counts.all += 1;
    counts[asset.kind] = (counts[asset.kind] || 0) + 1;
  });
  document.querySelectorAll("[data-kind-count]").forEach((item) => {
    item.textContent = String(counts[item.dataset.kindCount] || 0);
  });
}

function renderSmartGroupTabs() {
  els.smartGroupTabs.querySelectorAll("[data-smart-group]").forEach((button) => {
    const active = button.dataset.smartGroup === state.smartGroup;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
  document.querySelectorAll("[data-smart-count]").forEach((item) => {
    item.textContent = String(state.smartCounts[item.dataset.smartCount] || 0);
  });
}

function renderCategoryChips() {
  const kind = state.kind === "all" ? "" : state.kind;
  const groupedAssets = state.assets.filter((asset) => asset.smartGroup === state.smartGroup);
  const categories = kind
    ? state.settings.taxonomy?.[kind] || []
    : [...new Set(groupedAssets.map((asset) => asset.category).filter(Boolean))];
  els.categoryChips.replaceChildren();
  const all = document.createElement("button");
  all.type = "button";
  all.textContent = "全部分类";
  all.className = state.category ? "" : "active";
  all.addEventListener("click", () => { state.category = ""; renderCategoryChips(); resetAssetWindow(); });
  els.categoryChips.append(all);
  for (const category of categories) {
    const count = groupedAssets.filter((asset) => (!kind || asset.kind === kind) && asset.category === category).length;
    if (!count) continue;
    const button = document.createElement("button");
    button.type = "button";
    button.className = state.category === category ? "active" : "";
    button.innerHTML = `<span>${escapeHtml(category)}</span><small>${count}</small>`;
    button.addEventListener("click", () => { state.category = category; renderCategoryChips(); resetAssetWindow(); });
    els.categoryChips.append(button);
  }
}

function commonCardMarkup(asset, typeLabel) {
  const manualTags = (asset.tags || []).map((tag) => `<span class="asset-tag">${escapeHtml(tag)}</span>`).join("");
  const autoTags = (asset.autoTags || []).slice(0, 2).map((tag) => `<span class="asset-tag automatic">${escapeHtml(tag)}</span>`).join("");
  const tags = manualTags || autoTags || `<span class="asset-tag muted">${escapeHtml(asset.category)}</span>`;
  const sourceLabel = asset.classificationSource === "manual" ? "人工确认" : "本地规则 · 0 Token";
  const reviewActions = asset.smartGroup === "review"
    ? `<div class="review-actions" aria-label="人工复核 ${escapeHtml(asset.name)}"><button data-action="manual-category" type="button">手动分类</button><button data-action="manual-tags" type="button">手动标签</button></div>`
    : "";
  const promptBadge = asset.promptAssociation?.available
    ? `<span class="prompt-link-badge" title="通过预览查看资产与关联提示词">⌘ 已关联提示词</span>`
    : "";
  return `<header class="asset-card-header"><div><span class="asset-format">${escapeHtml(typeLabel)}</span><h3 title="${escapeHtml(asset.name)}">${escapeHtml(asset.title)}</h3></div><details class="asset-menu"><summary aria-label="管理 ${escapeHtml(asset.name)}">•••</summary><div><button data-action="preview" type="button">预览</button><button data-action="metadata" type="button">分类与标签</button><button data-action="rename" type="button">重命名</button><button data-action="move" type="button">移动到项目</button></div></details></header><div class="asset-meta"><span>${formatBytes(asset.size)}</span><span>${formatDate(asset.mtimeMs)}</span>${promptBadge}</div><div class="classification-line" title="${escapeHtml(asset.classificationReason || "")}"><span>${escapeHtml(asset.category)}</span><span>${escapeHtml(sourceLabel)} · ${Number(asset.confidence) || 0}%</span></div><div class="asset-tags">${tags}</div>${reviewActions}<div class="asset-primary-action"><button data-action="use-in-codex" type="button">插入到任务</button></div>`;
}

function renderTextCard(asset) {
  const card = document.createElement("article");
  card.className = "asset-card text-card";
  card.dataset.assetId = asset.id;
  card.dataset.smartGroup = asset.smartGroup;
  card.innerHTML = `${commonCardMarkup(asset, asset.extension || "TEXT")}<div class="text-card-preview" tabindex="0">${escapeHtml(asset.preview || "暂无可预览内容")}</div><div class="card-hint">双击也可插入到任务 · 卡片内可滚动</div>`;
  card.addEventListener("dblclick", (event) => {
    if (event.target.closest("button, details, .review-actions")) return;
    event.preventDefault();
    useAssetInCodex(asset);
  });
  return card;
}

function renderImageCard(asset) {
  const card = document.createElement("article");
  card.className = "asset-card image-card";
  card.dataset.assetId = asset.id;
  card.dataset.smartGroup = asset.smartGroup;
  card.innerHTML = `<figure class="media-frame"><img src="${asset.mediaUrl}" alt="${escapeHtml(asset.title)}" loading="lazy"><figcaption class="dimension-label">读取尺寸…</figcaption></figure>${commonCardMarkup(asset, asset.extension || "IMAGE")}`;
  const image = card.querySelector("img");
  image.addEventListener("load", () => { card.querySelector(".dimension-label").textContent = `${image.naturalWidth} × ${image.naturalHeight}`; });
  card.addEventListener("dblclick", (event) => {
    if (event.target.closest("button, details, .review-actions")) return;
    event.preventDefault();
    useAssetInCodex(asset);
  });
  return card;
}

function renderAudioCard(asset) {
  const card = document.createElement("article");
  card.className = "asset-card audio-card";
  card.dataset.assetId = asset.id;
  card.dataset.smartGroup = asset.smartGroup;
  card.innerHTML = `${commonCardMarkup(asset, asset.extension || "AUDIO")}<div class="audio-visual"><button class="audio-play" type="button" aria-label="播放">▶</button><div class="waveform" aria-hidden="true">${Array.from({ length: 34 }, (_, index) => `<i style="--h:${22 + ((index * 17) % 64)}%"></i>`).join("")}</div><span class="duration-label">--:--</span></div><audio src="${asset.mediaUrl}" preload="metadata"></audio><div class="card-hint">鼠标移入试听 · 双击也可插入到任务</div>`;
  const audio = card.querySelector("audio");
  const play = card.querySelector(".audio-play");
  audio.addEventListener("loadedmetadata", () => { card.querySelector(".duration-label").textContent = formatDuration(audio.duration); });
  const start = () => { audio.play().then(() => card.classList.add("playing")).catch(() => {}); };
  const stop = () => { audio.pause(); audio.currentTime = 0; card.classList.remove("playing"); };
  card.addEventListener("mouseenter", start);
  card.addEventListener("mouseleave", stop);
  play.addEventListener("click", (event) => { event.stopPropagation(); audio.paused ? start() : stop(); });
  card.addEventListener("dblclick", (event) => {
    if (event.target.closest("button, details, .review-actions")) return;
    stop();
    event.preventDefault();
    useAssetInCodex(asset);
  });
  return card;
}

function renderVideoCard(asset) {
  const card = document.createElement("article");
  card.className = "asset-card video-card";
  card.dataset.assetId = asset.id;
  card.dataset.smartGroup = asset.smartGroup;
  card.innerHTML = `<figure class="media-frame"><video src="${asset.mediaUrl}" muted loop playsinline preload="metadata"></video><div class="video-overlay"><button class="video-fullscreen" type="button">⛶ 全屏</button><span class="duration-label">--:--</span></div></figure>${commonCardMarkup(asset, asset.extension || "VIDEO")}<div class="card-hint">鼠标移入预览 · 双击也可插入到任务</div>`;
  const video = card.querySelector("video");
  video.addEventListener("loadedmetadata", () => { card.querySelector(".duration-label").textContent = formatDuration(video.duration); });
  card.addEventListener("mouseenter", () => video.play().catch(() => {}));
  card.addEventListener("mouseleave", () => { video.pause(); video.currentTime = 0; });
  card.querySelector(".video-fullscreen").addEventListener("click", (event) => {
    event.stopPropagation();
    if (video.requestFullscreen) video.requestFullscreen();
  });
  card.addEventListener("dblclick", (event) => {
    if (event.target.closest("button, details, .review-actions")) return;
    video.pause();
    event.preventDefault();
    useAssetInCodex(asset);
  });
  return card;
}

function previewAsset(asset) {
  if (asset?.kind === "text") void openReadOnlyPreview(asset);
  else if (asset) openMediaAsset(asset);
}

function renderMediaPreview(asset) {
  if (asset.kind === "image") return `<img src="${asset.mediaUrl}" alt="${escapeHtml(asset.title)}">`;
  if (asset.kind === "video") return `<video src="${asset.mediaUrl}" controls autoplay playsinline></video>`;
  return `<div class="audio-preview-visual"><span aria-hidden="true">◉</span><strong>${escapeHtml(asset.title)}</strong><small>${escapeHtml(asset.extension || "AUDIO")} · ${formatBytes(asset.size)}</small></div><audio src="${asset.mediaUrl}" controls autoplay></audio>`;
}

async function openMediaAsset(asset) {
  state.previewAsset = asset;
  els.mediaPreviewTitle.textContent = asset.title;
  els.mediaPreviewFormat.textContent = asset.extension || asset.kind.toUpperCase();
  els.mediaPreviewStage.innerHTML = renderMediaPreview(asset);
  els.mediaPromptPanel.hidden = true;
  els.mediaPreviewLayout.classList.remove("has-prompt");
  els.mediaPromptMeta.replaceChildren();
  els.mediaPromptText.textContent = "";
  els.mediaNegativePromptText.textContent = "";
  els.mediaPromptReferences.replaceChildren();
  els.mediaPreviewDialog.showModal();
  if (!asset.promptAssociation?.available) return;
  try {
    const association = await api(`/api/assets/prompt?id=${encodeURIComponent(asset.id)}`);
    if (state.previewAsset?.id !== asset.id || !els.mediaPreviewDialog.open) return;
    const meta = [association.generator, association.model].filter(Boolean);
    els.mediaPromptMeta.innerHTML = `${meta.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}${association.threadId ? `<span title="${escapeHtml(association.threadId)}">Codex 任务</span>` : ""}`;
    els.mediaPromptText.textContent = association.prompt || "（未登记提示词）";
    els.mediaNegativePromptGroup.hidden = !association.negativePrompt;
    els.mediaNegativePromptText.textContent = association.negativePrompt || "";
    const references = Array.isArray(association.references) ? association.references : [];
    els.mediaPromptReferences.hidden = !references.length;
    if (references.length) els.mediaPromptReferences.innerHTML = `<h4>参考资产</h4><ul>${references.map((item) => `<li title="${escapeHtml(item)}">${escapeHtml(item)}</li>`).join("")}</ul>`;
    els.mediaPromptPanel.hidden = false;
    els.mediaPreviewLayout.classList.add("has-prompt");
  } catch (error) {
    showToast(error.message, "error");
  }
}

function visibleAssets() {
  const query = state.query.trim().toLocaleLowerCase("zh-CN");
  const assets = state.assets.filter((asset) => {
    if (displayPreferences.excluded.includes(asset.previewType || asset.kind)) return false;
    if (displayPreferences.mjOnly && !asset.mjProfiles?.length) return false;
    if (state.contextOnly && assetRelation(asset) === '项目其他文件') return false;
    if (asset.smartGroup !== state.smartGroup) return false;
    if (state.kind !== "all" && asset.kind !== state.kind) return false;
    if (state.category && asset.category !== state.category) return false;
    if (!query) return true;
    return [asset.name, asset.preview, asset.category, ...(asset.tags || []), ...(asset.autoTags || [])].join(" ").toLocaleLowerCase("zh-CN").includes(query);
  });
  return assets.sort((a, b) => {
    if (displayPreferences.mjOnly) { const group = a.mjProfiles.join(' ').localeCompare(b.mjProfiles.join(' ')); if (group) return group; }
    if (state.sort === "oldest") return a.mtimeMs - b.mtimeMs;
    if (state.sort === "name") return a.name.localeCompare(b.name, "zh-CN", { numeric: true });
    if (state.sort === "size") return b.size - a.size;
    return b.mtimeMs - a.mtimeMs;
  });
}

function resetAssetWindow() {
  state.visibleLimit = 120;
  renderAssets();
}

function renderAssets() {
  const matchingAssets = visibleAssets();
  const assets = matchingAssets.slice(0, state.visibleLimit);
  els.assetGrid.replaceChildren();
  els.assetGrid.className = `asset-grid ${["image", "video"].includes(state.kind) ? "masonry" : ""}`;
  els.assetGrid.classList.toggle('asset-list-view', displayPreferences.layout === 'list');
  let lastGroup = null;
  for (const asset of assets) {
    const group = asset.mjProfiles?.join(' ') || '';
    if (displayPreferences.mjOnly && group !== lastGroup) {
      const header = document.createElement('div'); header.className = 'mj-profile-group';
      const text = document.createElement('strong'); text.textContent = `P 值组合：${group}`;
      const copy = document.createElement('button'); copy.type = 'button'; copy.textContent = '复制 --p';
      copy.onclick = async () => { try { await navigator.clipboard.writeText(`--p ${group}`); showToast('已复制 P 值组合'); } catch { showToast('复制失败，请手动复制组合', 'error'); } };
      header.append(text, copy); els.assetGrid.append(header); lastGroup = group;
    }
    const renderer = { text: renderTextCard, image: renderImageCard, audio: renderAudioCard, video: renderVideoCard }[asset.kind];
    if (renderer) {
      const card = renderer(asset); const badge = document.createElement('span'); badge.className = 'asset-relation'; badge.textContent = assetRelation(asset); card.prepend(badge); els.assetGrid.append(card);
    }
  }
  if (matchingAssets.length > assets.length) {
    const more = document.createElement("button");
    more.type = "button";
    more.className = "load-more-card";
    more.innerHTML = `<strong>继续加载</strong><span>已显示 ${assets.length} / ${matchingAssets.length}</span>`;
    more.addEventListener("click", () => { state.visibleLimit += 120; renderAssets(); });
    els.assetGrid.append(more);
  }
  const hasProject = Boolean(selectedProject());
  els.emptyLibraryState.hidden = Boolean(matchingAssets.length);
  els.emptyLibraryState.querySelector("h2").textContent = hasProject ? "没有符合条件的资产" : "这里还没有资产";
  els.emptyLibraryState.querySelector("p").textContent = state.contextOnly
    ? "当前任务还没有关联资产，可查看项目全部资产。"
    : hasProject
    ? "换一个智能分组、类型、分类或搜索词，也可以重新扫描关联文件夹。"
    : "创建项目并关联一个或多个文件夹，扫描结果会自动分类。";
  els.emptyCreateProjectButton.hidden = hasProject;
  els.workspaceSubtitle.textContent = hasProject
    ? `${state.assets.length} 个本地文件 · 正式资产 ${state.smartCounts.asset || 0} · 待确认 ${state.smartCounts.review || 0} · 干扰项 ${state.smartCounts.noise || 0}`
    : "关联本地文件夹后，系统会自动识别并分类资产。";
}

async function loadLibrary({ quiet = false, force = false } = {}) {
  const request = ++libraryRequest;
  const project = selectedProject();
  if (!project) {
    state.assets = [];
    state.counts = { all: 0, text: 0, image: 0, audio: 0, video: 0 };
    state.smartCounts = { asset: 0, review: 0, noise: 0 };
    els.workspaceTitle.textContent = "选择一个项目";
    renderSmartGroupTabs(); renderCategoryChips(); updateKindCounts(); resetAssetWindow();
    return;
  }
  state.busy = true;
  els.scanState.textContent = force ? "正在重新扫描…" : "正在读取索引…";
  els.scanState.classList.add("busy");
  try {
    const query = new URLSearchParams({ project: project.id });
    if (force) query.set("rescan", "1");
    const [data] = await Promise.all([api(`/api/library?${query}`), refreshTaskReferences()]);
    if (request !== libraryRequest || state.selectedProject !== project.id) return;
    state.assets = data.assets || [];
    state.counts = data.counts || state.counts;
    state.smartCounts = data.smartCounts || state.smartCounts;
    state.settings = data.settings || state.settings;
    state.visibleLimit = 120;
    setColumns(state.settings.columns);
    els.workspaceTitle.textContent = project.name;
    els.scanState.textContent = data.index?.mode === "initial-scan"
      ? "索引已建立"
      : data.index?.mode === "manual-rescan"
        ? "重新扫描完成"
        : `增量同步 ${formatDate(data.index?.updatedAt || Date.now())}`;
    renderSmartGroupTabs(); updateKindCounts(); renderCategoryChips(); renderAssets();
    if (!quiet) showToast(force
      ? `已重新扫描 ${state.assets.length} 个资产`
      : `已从持久索引加载 ${state.assets.length} 个资产`);
  } catch (error) {
    els.scanState.textContent = force ? "重新扫描失败" : "索引读取失败";
    showToast(error.message, "error");
  } finally {
    state.busy = false;
    els.scanState.classList.remove("busy");
  }
}

async function loadBootstrap() {
  try {
    const [config, projectData] = await Promise.all([api("/api/config"), api("/api/projects")]);
    state.system = config.system || state.system;
    state.settings = config.assetManager || state.settings;
    state.projects = projectData.projects || [];
    const contextProjectId = contextualProjectId();
    if (contextProjectId) state.selectedProject = contextProjectId;
    else if (!state.projects.some((project) => project.id === state.selectedProject)) state.selectedProject = state.projects[0]?.id || "";
    applyPlatformProjectUi(config);
    renderTaskContext();
    setColumns(state.settings.columns);
    renderProjects();
    await loadLibrary({ quiet: true });
  } catch (error) {
    showToast(`资产服务不可用：${error.message}`, "error");
  }
}

async function selectProject(projectId) {
  if (state.selectedProject === projectId && state.assets.length) return;
  state.selectedProject = projectId;
  state.category = "";
  localStorage.setItem("asset-library:selected-project", projectId);
  renderProjects();
  await loadLibrary({ quiet: true });
}

function openProjectDialog(project = null) {
  state.editingProject = project;
  els.projectDialogTitle.textContent = project ? "管理本地项目" : "新建本地项目";
  els.projectNameInput.value = project?.name || "";
  els.codexNewProjectScanRoots.value = (project?.folders || []).join("\n");
  els.projectFormError.textContent = "";
  els.projectDialog.showModal();
  setTimeout(() => els.projectNameInput.focus(), 30);
}

async function saveProject(event) {
  event.preventDefault();
  const name = els.projectNameInput.value.trim();
  const folders = parseScanRoots(els.codexNewProjectScanRoots.value);
  const invalid = folders.find((folder) => !isAbsoluteProjectPath(folder, state.system.platform));
  if (!name || !folders.length || invalid) {
    els.projectFormError.textContent = invalid ? `不是有效的绝对路径：${invalid}` : "请填写项目名称和至少一个文件夹。";
    return;
  }
  els.saveProjectButton.disabled = true;
  try {
    const route = state.editingProject ? `/api/projects/${encodeURIComponent(state.editingProject.id)}` : "/api/projects";
    const data = await api(route, { method: state.editingProject ? "PATCH" : "POST", body: JSON.stringify({ name, folders }) });
    const project = data.project;
    const projectData = await api("/api/projects");
    state.projects = projectData.projects || [];
    state.selectedProject = project.id;
    localStorage.setItem("asset-library:selected-project", project.id);
    els.projectDialog.close();
    renderProjects();
    await loadLibrary();
  } catch (error) {
    els.projectFormError.textContent = error.message;
  } finally {
    els.saveProjectButton.disabled = false;
  }
}

function markdownToSafeHtml(text) {
  return escapeHtml(text)
    .replace(/^### (.+)$/gm, "<h3>$1</h3>")
    .replace(/^## (.+)$/gm, "<h2>$1</h2>")
    .replace(/^# (.+)$/gm, "<h1>$1</h1>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\n/g, "<br>");
}

async function openTextAsset(asset) {
  state.textAsset = asset;
  els.textViewerTitle.textContent = asset.name;
  els.textViewerFormat.textContent = asset.extension || "TEXT";
  els.textViewerPreview.innerHTML = "<p>正在读取…</p>";
  els.textViewerEditor.hidden = true;
  els.textViewerPreview.hidden = false;
  els.saveTextButton.hidden = true;
  els.toggleTextEditButton.hidden = !asset.editable;
  els.toggleTextEditButton.textContent = "编辑";
  els.textSaveState.textContent = "";
  els.textViewerDialog.showModal();
  try {
    const data = await api(`/api/text?id=${encodeURIComponent(asset.id)}`);
    state.textAsset = { ...asset, content: data.content, editable: data.editable };
    els.textViewerPreview.innerHTML = markdownToSafeHtml(data.content);
    els.textViewerEditor.value = data.content;
    els.toggleTextEditButton.hidden = !data.editable;
  } catch (error) {
    els.textViewerPreview.textContent = error.message;
  }
}

function toggleTextEditor() {
  const editing = els.textViewerEditor.hidden;
  els.textViewerEditor.hidden = !editing;
  els.textViewerPreview.hidden = editing;
  els.saveTextButton.hidden = !editing;
  els.toggleTextEditButton.textContent = editing ? "预览" : "编辑";
  if (editing) els.textViewerEditor.focus();
  else els.textViewerPreview.innerHTML = markdownToSafeHtml(els.textViewerEditor.value);
}

async function saveTextAsset() {
  if (!state.textAsset) return;
  els.saveTextButton.disabled = true;
  els.textSaveState.textContent = "正在保存…";
  try {
    await api("/api/text", { method: "PUT", body: JSON.stringify({ assetId: state.textAsset.id, content: els.textViewerEditor.value }) });
    els.textSaveState.textContent = "已保存到原文件";
    showToast("文本已保存");
    await loadLibrary({ quiet: true });
  } catch (error) {
    els.textSaveState.textContent = error.message;
  } finally {
    els.saveTextButton.disabled = false;
  }
}

function assetById(id) {
  return state.assets.find((asset) => asset.id === id);
}

function openManualReviewAction(event) {
  if (event.button !== 0 || els.assetActionDialog.open) return false;
  const actionButton = event.target.closest('[data-action="manual-category"], [data-action="manual-tags"]');
  if (!actionButton) return false;
  const asset = assetById(actionButton.closest("[data-asset-id]")?.dataset.assetId);
  if (!asset) return false;
  event.preventDefault();
  event.stopPropagation();
  openAssetAction(actionButton.dataset.action, asset);
  return true;
}

function openAssetAction(action, asset) {
  state.action = action;
  state.actionAsset = asset;
  els.assetActionError.textContent = "";
  els.confirmAssetAction.className = "primary-button";
  const titles = { rename: "重命名文件", move: "移动到项目", metadata: "分类与标签", "manual-category": "手动分类", "manual-tags": "手动标签" };
  els.assetActionTitle.textContent = titles[action];
  els.confirmAssetAction.textContent = action === "manual-category" ? "保存分类" : action === "manual-tags" ? "保存标签" : "确认";
  if (action === "rename") {
    els.assetActionFields.innerHTML = `<label>新文件名<input name="name" value="${escapeHtml(asset.name)}" required></label><p class="field-hint">文件格式不能在重命名时改变。</p>`;
  } else if (action === "move") {
    const options = state.projects.filter((project) => project.id !== state.selectedProject).map((project) => `<option value="${escapeHtml(project.id)}">${escapeHtml(project.name)}</option>`).join("");
    els.assetActionFields.innerHTML = `<label>目标项目<select name="targetProjectId" required>${options}</select></label><p class="field-hint">只改变项目归属，不移动磁盘上的原文件。</p>`;
  } else {
    const categories = state.settings.taxonomy?.[asset.kind] || [];
    const categoryOptions = categories.map((category) => `<option value="${escapeHtml(category)}" ${category === asset.category ? "selected" : ""}>${escapeHtml(category)}</option>`).join("");
    const availableTags = [...new Set([...(state.settings.tags || []), ...(asset.tags || [])])];
    const tags = availableTags.map((tag) => `<label class="check-chip"><input type="checkbox" name="tags" value="${escapeHtml(tag)}" ${(asset.tags || []).includes(tag) ? "checked" : ""}><span>${escapeHtml(tag)}</span></label>`).join("") || "<p class=\"field-hint\">暂无预设标签，可在下方直接输入。</p>";
    const selectedGroup = defaultManualSmartGroup(asset, action);
    const groupOptions = [["asset", "正式资产"], ["review", "待确认"], ["noise", "干扰项"]].map(([value, label]) => `<option value="${value}" ${value === selectedGroup ? "selected" : ""}>${label}</option>`).join("");
    const sourceLabel = asset.classificationSource === "manual" ? "人工确认" : "本地规则 · 0 Token";
    const classificationFields = action === "manual-tags"
      ? `<input type="hidden" name="smartGroup" value="${escapeHtml(selectedGroup)}"><input type="hidden" name="category" value="${escapeHtml(asset.category)}">`
      : `<label>智能分组<select name="smartGroup">${groupOptions}</select></label><label>子分类<select name="category">${categoryOptions}</select></label>`;
    const tagFields = action === "manual-category"
      ? `${(asset.tags || []).map((tag) => `<input type="hidden" name="tags" value="${escapeHtml(tag)}">`).join("")}<input type="hidden" name="customTags" value="">`
      : `<fieldset><legend>标签</legend><div class="check-chip-grid">${tags}</div></fieldset><label>新增标签<input name="customTags" type="text" placeholder="多个标签用逗号、分号或换行分隔" autocomplete="off"></label>`;
    els.assetActionFields.innerHTML = `<div class="classification-callout"><strong>${escapeHtml(sourceLabel)} · 置信度 ${Number(asset.confidence) || 0}%</strong><span>${escapeHtml(asset.classificationReason || "")}</span></div>${classificationFields}${tagFields}`;
  }
  els.assetActionDialog.showModal();
  requestAnimationFrame(() => els.assetActionFields.querySelector(action === "manual-tags" ? "[name=customTags]" : action === "manual-category" ? "[name=category]" : "select, input")?.focus());
}

function useAssetInCodex(asset) {
  if (!asset?.sourcePath || window.parent === window) return false;
  window.parent.postMessage({
    source: "asset-console",
    action: "use-in-codex",
    path: asset.sourcePath,
    kind: asset.kind,
    name: asset.name,
  }, "*");
  showToast("正在插入到当前任务…");
  return true;
}

async function submitAssetAction(event) {
  event.preventDefault();
  const form = new FormData(els.assetActionForm);
  const asset = state.actionAsset;
  if (!asset) return;
  els.confirmAssetAction.disabled = true;
  try {
    if (state.action === "rename") {
      await api("/api/assets/rename", { method: "POST", body: JSON.stringify({ assetId: asset.id, name: form.get("name") }) });
      showToast("文件已重命名");
    } else if (state.action === "move") {
      await api("/api/assets/assign", { method: "POST", body: JSON.stringify({ assetId: asset.id, targetProjectId: form.get("targetProjectId") }) });
      showToast("已移动项目归属，磁盘文件未移动");
    } else {
      const tags = mergeManualTags(form.getAll("tags"), form.get("customTags"));
      await api("/api/assets/metadata", { method: "PATCH", body: JSON.stringify({ assetId: asset.id, smartGroup: form.get("smartGroup"), category: form.get("category"), tags }) });
      showToast(state.action === "manual-category" ? "人工分类已保存" : state.action === "manual-tags" ? "人工标签已保存" : "分类和标签已保存");
    }
    els.assetActionDialog.close();
    await loadLibrary({ quiet: true });
  } catch (error) {
    els.assetActionError.textContent = error.message;
  } finally {
    els.confirmAssetAction.disabled = false;
  }
}

function renderSettings() {
  els.tagManager.replaceChildren();
  for (const tag of state.settings.tags || []) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "removable-tag";
    chip.innerHTML = `${escapeHtml(tag)} <span>×</span>`;
    chip.addEventListener("click", () => { state.settings.tags = state.settings.tags.filter((item) => item !== tag); renderSettings(); });
    els.tagManager.append(chip);
  }
  els.taxonomyManager.replaceChildren();
  const labels = { text: "文本", image: "图片", audio: "音频", video: "视频" };
  for (const [kind, label] of Object.entries(labels)) {
    const row = document.createElement("label");
    row.innerHTML = `<span>${label}</span><input data-taxonomy-kind="${kind}" value="${escapeHtml((state.settings.taxonomy?.[kind] || []).join("、"))}" placeholder="用顿号或逗号分隔">`;
    els.taxonomyManager.append(row);
  }
}

async function saveSettings(event) {
  event.preventDefault();
  const taxonomy = {};
  document.querySelectorAll("[data-taxonomy-kind]").forEach((input) => {
    taxonomy[input.dataset.taxonomyKind] = String(input.value).split(/[、,，;；]+/u).map((item) => item.trim()).filter(Boolean);
  });
  try {
    const data = await api("/api/settings", { method: "PATCH", body: JSON.stringify({ tags: state.settings.tags, taxonomy, columns: state.settings.columns }) });
    state.settings = data.settings;
    els.settingsDialog.close();
    renderCategoryChips(); resetAssetWindow();
    showToast("资产库设置已保存");
  } catch (error) {
    showToast(error.message, "error");
  }
}

function bindEvents() {
  els.newProjectButton.addEventListener("click", () => openProjectDialog());
  els.emptyCreateProjectButton.addEventListener("click", () => openProjectDialog());
  els.editProjectButton.addEventListener("click", () => openProjectDialog(selectedProject()));
  els.projectForm.addEventListener("submit", saveProject);
  els.refreshLibraryButton.addEventListener("click", () => loadLibrary({ force: true }));
  els.settingsButton.addEventListener("click", () => { renderSettings(); els.settingsDialog.showModal(); });
  els.taskContextToggle.addEventListener("click", () => {
    state.contextOnly = !state.contextOnly;
    renderTaskContext();
    resetAssetWindow();
  });
  els.smartGroupTabs.addEventListener("click", (event) => {
    const button = event.target.closest("[data-smart-group]");
    if (!button) return;
    state.smartGroup = button.dataset.smartGroup;
    state.category = "";
    renderSmartGroupTabs(); updateKindCounts(); renderCategoryChips(); resetAssetWindow();
  });
  els.assetKindTabs.addEventListener("click", (event) => {
    const button = event.target.closest("[data-asset-kind]");
    if (!button) return;
    state.kind = button.dataset.assetKind;
    state.category = "";
    els.assetKindTabs.querySelectorAll("button").forEach((item) => item.classList.toggle("active", item === button));
    renderCategoryChips(); resetAssetWindow();
  });
  els.librarySearchInput.addEventListener("input", () => { state.query = els.librarySearchInput.value; resetAssetWindow(); });
  els.librarySortSelect.addEventListener("change", () => { state.sort = els.librarySortSelect.value; resetAssetWindow(); });
  els.assetColumnRange.addEventListener("input", () => setColumns(els.assetColumnRange.value, true));
  els.assetGrid.addEventListener("pointerdown", openManualReviewAction, true);
  els.assetGrid.addEventListener("click", (event) => {
    const actionButton = event.target.closest("[data-action]");
    if (!actionButton) return;
    event.preventDefault(); event.stopPropagation();
    if (["manual-category", "manual-tags"].includes(actionButton.dataset.action) && event.detail !== 0) return;
    const asset = assetById(actionButton.closest("[data-asset-id]")?.dataset.assetId);
    if (asset && actionButton.dataset.action === "use-in-codex") useAssetInCodex(asset);
    else if (asset && actionButton.dataset.action === "preview") previewAsset(asset);
    else if (asset) openAssetAction(actionButton.dataset.action, asset);
  });
  els.assetActionForm.addEventListener("submit", submitAssetAction);
  els.toggleTextEditButton.addEventListener("click", toggleTextEditor);
  els.saveTextButton.addEventListener("click", saveTextAsset);
  els.addTagButton.addEventListener("click", () => {
    const tag = els.newTagInput.value.trim();
    if (!tag || state.settings.tags.includes(tag)) return;
    state.settings.tags.push(tag); els.newTagInput.value = ""; renderSettings();
  });
  els.settingsForm.addEventListener("submit", saveSettings);
  els.mediaPreviewDialog.addEventListener("close", () => {
    els.mediaPreviewStage.querySelectorAll("audio, video").forEach((media) => media.pause());
    els.mediaPreviewStage.replaceChildren();
    state.previewAsset = null;
  });
  document.querySelectorAll("[data-close-dialog]").forEach((button) => button.addEventListener("click", () => document.getElementById(button.dataset.closeDialog)?.close()));
  document.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault(); els.librarySearchInput.focus();
    }
  });
  window.addEventListener("message", (event) => {
    const message = event.data;
    if (event.source !== window.parent || message?.source !== "codex-sidebar-enhancer") return;
    if (message.action === "search") {
      const query = String(message.query || "").trim();
      state.query = query;
      els.librarySearchInput.value = query;
      resetAssetWindow();
      els.librarySearchInput.focus();
    } else if (message.action === "context") {
      void applyTaskContext(message);
    } else if (message.action === "asset-added" || message.action === "assets-added") {
      const count = Math.max(1, Number(message.count) || 1);
      showToast(count > 1 ? `已插入 ${count} 个资产到当前任务` : "已插入到当前任务");
    } else if (message.action === "asset-add-failed") {
      showToast("未能插入到当前任务，请确认输入框可用", "error");
    }
  });
}

function connectEvents() {
  try {
    const events = new EventSource("/api/events");
    const refresh = () => {
      clearTimeout(state.refreshTimer);
      state.refreshTimer = setTimeout(() => loadLibrary({ quiet: true }), 400);
    };
    events.addEventListener("asset-change", refresh);
    events.addEventListener("project-change", () => loadBootstrap());
    events.addEventListener("config-change", () => loadBootstrap());
  } catch {}
}

bindEvents();
loadBootstrap();
connectEvents();

initializeDisplayPreferences();

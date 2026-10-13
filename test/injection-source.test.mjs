import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../inject/conversation-preview.user.js", import.meta.url), "utf8");

test("injection uses stable Codex sidebar and tooltip anchors", () => {
  assert.match(source, /data-app-action-sidebar-thread-row/);
  assert.match(source, /data-app-action-sidebar-thread-id/);
  assert.match(source, /data-app-action-sidebar-thread-title/);
  assert.match(source, /role=\\?"tooltip/);
});

test("workspace menu pages stay in a shared side panel and accept conversation commands", () => {
  assert.match(source, /data-codex-workspace-side-panel/);
  assert.match(source, /nuyoah-workstation-header/);
  assert.match(source, /WORKSTATION_PANELS/);
  assert.match(source, /PROJECT_OVERVIEW_PAGE_ID/);
  assert.match(source, /WORKSTATION_LAST_PANEL_KEY/);
  assert.match(source, /function openWorkstationPanel\(panel = savedWorkstationPanel\(\), options = \{\}\)/);
  assert.match(source, /button\.onclick = \(\) => openWorkstationPanel\(panel\.id\)/);
  assert.match(source, /function workspaceCommand\(value\)/);
  assert.match(source, /const direct = slash \? null : text\.match\(\/\^/);
  assert.doesNotMatch(source, /const hasAction = Boolean\(slash\)/);
  assert.match(source, /routeWorkspaceCommand/);
  assert.match(source, /openWorkstationPanel\(command\.panel, \{ query: command\.query \}\)/);
  assert.match(source, /if \(typeof options\?\.query === "string"\) \{\s*skillOrganizerQuery = options\.query\.trim\(\);\s*skillOrganizerFilter = "全部";/);
  assert.match(source, /setSkillCatalog/);
  assert.match(source, /takeSkillLabelRequest/);
  assert.match(source, /requestSkillCatalogRefresh/);
  assert.match(source, /刷新当前可调用 Skills/);
  assert.match(source, /pendingSkillLabelRequest = \{ mode: "refresh" \}/);
  assert.match(source, /生成缺失中文标题和简介/);
  assert.match(source, /重做全部中文标题和简介/);
  assert.match(source, /重做中文标题和简介/);
  assert.match(source, /handleStatusDocumentPointerDown[\s\S]{0,300}!skillContextMenu\.contains\(event\.target\)[\s\S]{0,220}closeSkillContextMenu\(\)/);
  assert.match(source, /event\.key === "Escape" && skillContextMenu[\s\S]{0,180}closeSkillContextMenu\(\)/);
  assert.match(source, /labelStatus === "unverified" \? "清单待验证" : "待生成中文标题"/);
  assert.match(source, /labelStatus !== "unverified" && generatedTitle && generatedTitle !== "待生成"/);
  assert.match(source, /title: displayTitle,[\s\S]{0,80}sourceTitle: title/);
  assert.match(source, /skillDisplayName: entry\.sourceTitle \|\| entry\.name \|\| entry\.title/);
  assert.doesNotMatch(source, /skillDisplayName: entry\.title,/);
  assert.match(source, /skillPath: entry\.mentionPath \|\| entry\.path \|\| ""/);
  assert.match(source, /mentionPath: String\(entry\.mentionPath \|\| entry\.path \|\| ""\)/);
  assert.match(source, /generatedSummary/);
  assert.match(source, /description: displayDescription,[\s\S]{0,80}sourceDescription/);
  assert.match(source, /previousSourceDescriptions\.get\(name\)/);
  assert.match(source, /skillMatchesCategory[\s\S]{0,180}entry\.sourceDescription/);
  assert.match(source, /data-nuyoah-workstation-frame="true"\]:has\(\.codex-skill-label-notice:not\(\[hidden\]\)\)[\s\S]{0,160}grid-template-rows: 50px auto auto auto auto auto auto minmax/);
  assert.match(source, /codex-skill-callable/);
  assert.match(source, /DEFAULT_SKILL_FILTERS = \["全部", "当前任务", "常用"\]/);
  assert.match(source, /skillPrimaryCategory\(entry\) === category/);
  assert.match(source, /skillMatchesCurrentTask/);
  assert.match(source, /插入到任务/);
  assert.match(source, /projectId: typeof entry\?\.projectId/);
  assert.match(source, /action: "context"/);
  assert.match(source, /nuyoah-workstation-close/);
  assert.match(source, /@container \(max-width: 620px\)/);
  assert.match(source, /PROJECT_OVERVIEW_PAGE_ID\}, #codex-taskboard-page,[\s\S]{0,420}position: relative !important/);
  assert.match(source, /nuyoah-workstation-title \{ display: none; \}/);
  assert.match(source, /WORKSTATION_HEADER_CLASS\} button[\s\S]{0,360}-webkit-app-region:\s*no-drag/);
  assert.match(source, /WORKSTATION_HEADER_CLASS\} \{[\s\S]{0,760}pointer-events:\s*auto/);
  assert.match(source, /function setAssetConsoleHostLayer\(active\)/);
  assert.match(source, /host\.style\.setProperty\("z-index", "40"\)/);
  assert.match(source, /action: "search", query: pendingAssetConsoleQuery/);
  assert.doesNotMatch(source, /Array\.from\(mount\.surface\.children\)[\s\S]{0,180}CUSTOM_SHORTCUT_HIDDEN_ATTRIBUTE/);
});

test("hover previews contain all requested fields and clamp message bodies to three lines", () => {
  assert.match(source, /核心总结/);
  assert.match(source, /最近输入/);
  assert.match(source, /最近输出/);
  assert.match(source, /-webkit-line-clamp:\s*3/);
  assert.match(source, /codex-conversation-preview-fallback-tooltip/);
  assert.match(source, /handlePreviewPointerOver/);
  assert.match(source, /handlePreviewPointerOut/);
});

test("sidebar cards, project filters, and hover previews adapt to available space", () => {
  assert.match(source, /repeat\(auto-fit, minmax\(min\(100%, 10\.5rem\), 1fr\)\)/);
  assert.match(source, /height:\s*auto !important;[\s\S]{0,100}max-height:\s*none !important;/);
  assert.doesNotMatch(source, /height:\s*168px !important;/);
  assert.match(source, /data-codex-sidebar-folder-tags[\s\S]{0,220}flex-wrap:\s*wrap/);
  assert.match(source, /\[data-codex-sidebar-folder-tag\]\s*\{[\s\S]{0,1200}overflow-wrap:\s*anywhere/);
  assert.match(source, /function positionPreviewTooltip\(tooltip, row\)/);
  assert.match(source, /positionPreviewTooltip\(tooltip, row\)/);
  assert.match(source, /positionPreviewTooltip\(fallback, row\)/);
});

test("injection is idempotent and reversible", () => {
  assert.match(source, /__codexConversationPreviewInjection__/);
  assert.match(source, /destroy/);
  assert.match(source, /\.remove\(\)/);
});

test("renderer receives host-pushed previews without a local HTTP fetch", () => {
  assert.match(source, /setPreviews/);
  assert.doesNotMatch(source, /fetch\s*\(/);
});

test("Taskboard snapshot uses the full unarchived catalog, native runtime state, folders, and Codex actions", () => {
  assert.match(source, /function getTaskboardSnapshot\(\{ includeProjectHistory = false \} = \{\}\)/);
  assert.match(source, /function setTaskCatalog\(items\)/);
  assert.match(source, /\.filter\(\(entry\) => includeProjectHistory \|\| entry\.archived !== true\)/);
  assert.match(source, /const running = activeProjectThreadIds\.has\(threadId\)/);
  assert.doesNotMatch(source, /querySelector\('\[class\*="animate-spin"\]'\)/);
  assert.match(source, /const runtimeStatus = nativeStatus\?\.runtimeStatus === "running" \|\| running \? "running" : interruption \? "failed" : "completed"/);
  assert.match(source, /projectName: entry\.projectName \|\| "未归入项目"/);
  assert.match(source, /workspacePath: entry\.workspacePath \|\| ""/);
  assert.match(source, /workspacePathStatus: entry\.workspacePathStatus \|\| "unknown"/);
  assert.match(source, /projectWorkspacePath: entry\.projectWorkspacePath \|\| ""/);
  assert.match(source, /function createProjectTask\(projectId\)/);
  assert.match(source, /nativeFolderCreateButton\(item\)/);
  assert.match(source, /async function archiveProjectTask\(threadId, hostId = "local"\)/);
  assert.match(source, /data-app-action-sidebar-thread-host-id/);
  assert.match(source, /getTaskboardSnapshot,/);
  assert.match(source, /createProjectTask,/);
  assert.match(source, /archiveProjectTask,/);
  assert.match(source, /function revealThread\(rawThreadId, \{ refreshPinnedProjects = true \} = \{\}\)/);
  assert.match(source, /function openAllProject\(entry\)[\s\S]{0,260}revealThread\(threadId\)[\s\S]{0,260}window\.setTimeout\(\(\) => revealThread\(threadId\), 180\)/);
  assert.match(source, /const projectPinned = Boolean\(projectId && pinnedProjectIds\.has\(projectId\)\)/);
  assert.match(source, /const pinned = pinnedThreadIds\.has\(threadId\) \|\| projectPinned \|\| nativeSection === "置顶"/);
  assert.match(source, /candidate\?\.key === "pinned-project-ids"/);
  assert.match(source, /selectSectionTab\(pinned \? "置顶" : "项目"\)/);
  assert.match(source, /row\.scrollIntoView\(\{ block: "nearest" \}\)/);
  assert.match(source, /row\.dataset\.codexSidebarThreadRevealed = "true"/);
  assert.match(source, /revealThread,/);
});

test("catalog-only conversation rows never replace the native Codex context menu", () => {
  const catalogRowSource = source.match(
    /function createCatalogThreadRow\(entry, kind = "all"\) \{[\s\S]*?\n  \}\n\n  function visibleSidebarThreadRow/,
  )?.[0] || "";
  assert.ok(catalogRowSource);
  assert.doesNotMatch(catalogRowSource, /oncontextmenu/);
  assert.doesNotMatch(source, /function openCatalogThreadContextMenu/);
});

test("injection leaves the native Codex conversation as the only rendered message flow", () => {
  assert.doesNotMatch(source, /setConversationHistory/);
  assert.doesNotMatch(source, /data-codex-recovered-history/);
  assert.doesNotMatch(source, /codex-recovered-history-body/);
});

test("sidebar groups use accessible tabs and preserve native project actions", () => {
  assert.match(source, /role", "tablist"/);
  assert.match(source, /role", "tab"/);
  assert.match(source, /role", "tabpanel"/);
  assert.match(source, /aria-selected/);
  assert.match(source, /data-codex-sidebar-project-actions/);
  assert.match(source, /codexSidebarProjectActionSource/);
  assert.match(source, /ArrowRight/);
});

test("public shortcut grid replaces separate project management with the unified workstation", () => {
  assert.match(source, /HIDDEN_SHORTCUT_NAMES = new Set\(\["项目管理"\]\)/);
  assert.match(source, /id:\s*"workstation", name:\s*"工作站"/);
  assert.match(source, /else findNativeShortcutButton\(item\.name\)\?\.click\(\)/,
    "native shortcut cards must resolve the current source button after another injector replaces it");
  assert.match(source, /schemaVersion: 4/);
  assert.match(source, /hidden\.filter\(\(value\) => !value\.startsWith\("native:"\)\)/);
  assert.match(source, /savedShortcutSettings\.schemaVersion !== 4[\s\S]*localStorage\.setItem\(SHORTCUT_SETTINGS_STORAGE_KEY/);
  assert.match(source, /button\.dataset\.codexSidebarShortcutUrl = item\.url/);
  assert.doesNotMatch(source, /TV_SHORTCUT_URL|__codexTvHostV1|data-codex-tv-open/);
  assert.doesNotMatch(source, /TV_SHORTCUT_URL|__codexTvHostV1|data-codex-tv-open/);
});

test("shortcut discovery supports Codex navigation buttons wrapped by contents containers", () => {
  assert.match(source, /findNativeShortcutButton\(\["拉取请求", "Pull Request"\]\)/);
  assert.match(source, /function shortcutSiblingGroup\(button\)/);
  assert.match(source, /:scope > button, :scope > \* > button/);
  assert.match(source, /const navigationGroup = shortcutSiblingGroup\(pullRequests\)/);
  assert.match(source, /shortcutGroupButtons\(navigationGroup\)/);
});

test("header controls opt their shared toolbar host out of the Electron drag region", () => {
  assert.match(source, /data-codex-sidebar-header-controls/);
  assert.match(source, /webkitAppRegion = "no-drag"/);
  assert.match(source, /removeProperty\("-webkit-app-region"\)/);
});

test("view switch responds on pointer down before Codex can consume the click", () => {
  assert.match(source, /button\.onpointerdown = handleViewTogglePointerDown/);
  assert.match(source, /event\.detail > 0/);
});

test("section enhancement fails closed when Codex native anchors are incomplete", () => {
  assert.match(source, /NATIVE_ANCHOR_GRACE_MS = 1_800/);
  assert.match(source, /sectionSourcesMissingSince[\s\S]*scheduleAnchorRetry\(\)[\s\S]*clearSectionEnhancement\(\)/);
  assert.match(source, /folderSourcesMissingSince[\s\S]*scheduleAnchorRetry\(\)[\s\S]*clearFolderEnhancement\(\)/);
});

test("priority-only Codex sidebars retain virtual tabs, project search, and folder filters", () => {
  assert.match(source, /function nativePrioritySource\(\)/);
  assert.match(source, /data-codex-sidebar-priority-native-hidden/);
  assert.match(source, /data-codex-sidebar-virtual-section/);
  assert.match(source, /function ensureVirtualPinnedRows\(\)/);
  assert.match(source, /function virtualFolderSourceItems\(excludedIds = new Set\(\), sourceIndexOffset = 0\)/);
  assert.match(source, /sourceMode: virtualItems\.length \? "hybrid" : "native"/);
});

test("virtual folder catalog rows participate in card-view enhancement", () => {
  assert.match(
    source,
    /#\$\{ALL_PROJECTS_PANEL_ID\}, \[data-codex-sidebar-virtual-folder-panel\]/,
  );
});

test("native project folders merge catalog-only conversations and sort them by real activity", () => {
  assert.match(source, /function reconcileNativeFolderCatalog\(item\)/);
  assert.match(source, /const projectSection = sectionSources\.get\("项目"\)\?\.section/);
  assert.match(source, /projectSection\?\.querySelectorAll\("\[data-app-action-sidebar-project-row\]"\)/);
  assert.match(source, /createCatalogThreadRow\(entry, "folder"\)/);
  assert.match(source, /desired\.sort\(\(left, right\) => Number\(left\.archived\) - Number\(right\.archived\)/);
  assert.match(source, /row\.dataset\.codexSidebarThreadArchived/);
  assert.match(source, /if \(selected\) reconcileNativeFolderCatalog\(item\)/);
});

test("new native conversations replace catalog placeholders without duplicate cards", () => {
  assert.match(source, /function isTemporaryThreadId\(value\)/);
  assert.match(source, /startsWith\("client-new-thread:"\)/);
  assert.match(source, /const temporaryNativeCatalogId = new Map\(\)/);
  assert.match(source, /nativeAliasByCatalogId\.get\(threadId\)/);
  assert.match(source, /temporaryNativeCatalogId\.has\(threadId\)/);
});

test("folder reconciliation never removes React-owned rows during the first message send", () => {
  assert.match(source, /list\.dataset\.codexSidebarFolderCatalogList = "true"/);
  assert.match(source, /listItem\.style\.order = String\(index\)/);
  assert.match(source, /data-codex-sidebar-native-alias-hidden/);
  assert.match(source, /row\?\.dataset\.codexSidebarFolderCatalogRow !== "true"/);
  assert.doesNotMatch(source, /list\.replaceChildren\(\.\.\.desiredChildren\)/);
});

test("folder cards collapse short retry bursts and keep native controls on a full bottom row", () => {
  assert.match(source, /const FOLDER_DUPLICATE_WINDOW_MS = 15 \* 60 \* 1000/);
  assert.match(source, /function dedupeFolderCatalogEntries\(sourceEntries\)/);
  assert.match(source, /entry\.dedupeKey/);
  assert.match(source, /data-codex-sidebar-semantic-duplicate-hidden/);
  assert.match(source, /\[data-codex-sidebar-semantic-duplicate-hidden\]\s*\{/);
  assert.doesNotMatch(source, /\[data-codex-sidebar-semantic-duplicate-hidden="true"\]/);
  assert.match(source, /control\.style\.order = String\(desired\.length \+ index\)/);
  assert.match(source, /data-codex-sidebar-folder-control-item/);
  assert.match(source, /grid-column: 1 \/ -1 !important/);
});

test("running Taskboard threads receive a reduced-motion-safe blue border glow", () => {
  assert.match(source, /data-codex-project-running/);
  assert.match(source, /codex-running-border-flow/);
  assert.match(source, /setActiveProjectThreads/);
  assert.match(source, /setActiveProjectThreads[\s\S]{0,260}refreshContext/);
  assert.match(source, /prefers-reduced-motion:\s*reduce/);
});

test("pinned conversations are exclusive to the pinned tab", () => {
  assert.match(source, /data-codex-sidebar-pinned-outside-hidden/);
  assert.match(source, /recentCatalog[\s\S]*filter\(\(entry\) => !pinnedThreadIds\.has/);
  assert.match(source, /interruptedCatalog[\s\S]*filter\(\(entry\) => !pinnedThreadIds\.has/);
  assert.match(source, /return searchCatalog[\s\S]*filter\(\(entry\) => !pinnedThreadIds\.has/);
  assert.doesNotMatch(source, /function ensurePinnedProjectRows/);
});

test("folder create action is bound to the selected folder and restores native markup", () => {
  assert.match(source, /nativeFolderCreateButton/);
  assert.match(source, /codexSidebarFolderCreate = item\.id/);
  assert.match(source, /在“\$\{item\.label\}”文件夹下创建项目/);
  assert.match(source, /removeAttribute\("data-codex-sidebar-folder-create"\)/);
  assert.match(
    source,
    /\[data-codex-sidebar-folder-actions-source\]\s*\{[\s\S]{0,500}opacity:\s*1\s*!important/,
    "moved native folder actions must not retain their original hover-only transparency",
  );
});

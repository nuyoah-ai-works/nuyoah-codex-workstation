(() => {
  "use strict";

  const SENTINEL = "__codexConversationPreviewInjection__";
  const STYLE_ID = "codex-conversation-preview-style";
  const TOGGLE_ID = "codex-conversation-view-toggle";
  const SWITCH_THUMB_CLASS = "codex-conversation-view-switch-thumb";
  const USAGE_ID = "codex-conversation-usage-status";
  const USAGE_TEXT_CLASS = "codex-conversation-usage-text";
  const USAGE_VALUE_CLASS = "codex-conversation-usage-value";
  const USAGE_FILL_CLASS = "codex-conversation-usage-fill";
  const SHORTCUT_GRID_ID = "codex-sidebar-shortcut-grid";
  const SHORTCUT_CARD_CLASS = "codex-sidebar-shortcut-card";
  const SHORTCUT_ICON_CLASS = "codex-sidebar-shortcut-icon";
  const SHORTCUT_LABEL_CLASS = "codex-sidebar-shortcut-label";
  const SHORTCUT_SETTINGS_ID = "codex-sidebar-shortcut-settings-dialog";
  const SHORTCUT_SETTINGS_BUTTON_ID = "codex-sidebar-shortcut-settings-button";
  const SHORTCUT_SETTINGS_STORAGE_KEY = "codex-conversation-preview:shortcut-settings";
  const CUSTOM_SHORTCUT_PAGE_ID = "codex-custom-shortcut-page";
  const CUSTOM_SHORTCUT_FRAME_ID = "codex-custom-shortcut-frame";
  const CUSTOM_SHORTCUT_HIDDEN_ATTRIBUTE = "data-codex-custom-shortcut-hidden";
  const CUSTOM_SHORTCUT_HOST_ATTRIBUTE = "data-codex-custom-shortcut-host";
  const ASSET_CONSOLE_PAGE_ID = "codex-asset-console-page";
  const ASSET_CONSOLE_FRAME_ID = "codex-asset-console-frame";
  const PROJECT_OVERVIEW_PAGE_ID = "nuyoah-workstation-project-page";
  const WORKSTATION_HEADER_CLASS = "nuyoah-workstation-header";
  const WORKSTATION_ENTRY_ID = "nuyoah-workstation-entry";
  const sidebarMode = ["enhanced", "capsules"].includes(window.__NUYOAH_WORKSTATION_CONFIG__?.sidebarMode)
    ? window.__NUYOAH_WORKSTATION_CONFIG__.sidebarMode : "native";
  const WORKSTATION_LAST_PANEL_KEY = "nuyoah-workstation:last-panel-v1";
  const WORKSTATION_FONT_SIZE_KEY = "nuyoah-workstation:font-size-v1";
  const WORKSTATION_FONT_SIZE_MIN = 11;
  const WORKSTATION_FONT_SIZE_MAX = 18;
  const WORKSTATION_FONT_SIZE_DEFAULT = 17;
  const WORKSTATION_PANELS = Object.freeze([
    Object.freeze({ id: "project", label: "项目" }),
    Object.freeze({ id: "taskboard", label: "任务" }),
    Object.freeze({ id: "skills", label: "技能" }),
    Object.freeze({ id: "asset", label: "资产" }),
  ]);
  const SKILL_ORGANIZER_ID = "codex-skill-organizer";
  const SKILL_FAVORITES_KEY = "codex-workspace-enhancer:skill-favorites-v1";
  const SKILL_OPEN_REQUEST_STORAGE_KEY = "codex-workspace-enhancer:skill-open-request-v1";
  const SKILL_OPEN_REQUEST_TTL_MS = 15_000;
  const SKILL_NATIVE_SECTION_ATTR = "data-codex-skill-native-section";
  const WORKSPACE_PANEL_ATTRIBUTE = "data-codex-workspace-side-panel";
  const WORKSPACE_PANEL_WIDTH_KEY = "codex-workspace-enhancer:side-panel-width-v1";
  const WORKSPACE_PANEL_EVENT = "codex-workspace-panel:open";
  const SHORTCUT_ICON_PRESETS = {
    link: '<path d="M10.2 13.8 13.8 10.2M8.1 15.9l-1.4 1.4a3.5 3.5 0 0 1-5-5l3-3a3.5 3.5 0 0 1 5 0M15.9 8.1l1.4-1.4a3.5 3.5 0 0 1 5 5l-3 3a3.5 3.5 0 0 1-5 0"/>',
    book: '<path d="M4 4.5h5.5A2.5 2.5 0 0 1 12 7v13a3 3 0 0 0-3-3H4zM20 4.5h-5.5A2.5 2.5 0 0 0 12 7v13a3 3 0 0 1 3-3h5z"/>',
    sparkle: '<path d="m12 2 1.5 5.2L19 9l-5.5 1.8L12 16l-1.5-5.2L5 9l5.5-1.8zM5 16l.8 2.2L8 19l-2.2.8L5 22l-.8-2.2L2 19l2.2-.8z"/>',
    play: '<rect x="3.5" y="5" width="17" height="14" rx="3"/><path d="m10 9 5 3-5 3z"/>',
    chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    code: '<path d="m8 9-3 3 3 3M16 9l3 3-3 3M14 5l-4 14"/>',
    skills: '<path d="M5 5.5h6M5 9h9M5 12.5h5M16.5 4v8M13 8h7M6 17.5h12M8.5 15v5M15.5 15v5"/>',
    assets: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M7 4V2M17 4V2M3 9h18M8 13h3v3H8zM14 13h3v3h-3z"/>',
    workstation: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M9 4v16M13 8h4M13 12h4M13 16h4"/>',
  };
  const HIDDEN_SHORTCUT_NAMES = new Set(["项目管理"]);
  const SECTION_TABS_ID = "codex-sidebar-section-tabs";
  const SECTION_TAB_STORAGE_KEY = "codex-conversation-preview:section-tab";
  const NATIVE_SECTION_NAMES = ["置顶", "项目", "最近"];
  const SECTION_NAMES = [...NATIVE_SECTION_NAMES, "中断"];
  const RECENT_LIST_ID = "codex-sidebar-global-recent-list";
  const RECENT_VISIBLE_LIMIT = 30;
  const INTERRUPTED_PANEL_ID = "codex-sidebar-interrupted-panel";
  const INTERRUPTED_LIST_ID = "codex-sidebar-interrupted-list";
  const FOLDER_SWITCHER_ID = "codex-sidebar-folder-switcher";
  const ALL_FOLDER_ID = "__all__";
  const ALL_PROJECTS_PANEL_ID = "codex-sidebar-all-projects";
  const FOLDER_STORAGE_KEY = "codex-conversation-preview:folder-id";
  const PINNED_THREAD_TIMES_STORAGE_KEY = "codex-conversation-preview:pinned-thread-times";
  const VIEW_STORAGE_KEY = "codex-conversation-preview:view-mode";
  const THREAD_STATUS_STORAGE_KEY = "codex-conversation-preview:thread-statuses";
  const NATIVE_ANCHOR_GRACE_MS = 1_800;
  const FOLDER_DUPLICATE_WINDOW_MS = 15 * 60 * 1000;
  const STATUS_BUTTON_CLASS = "codex-conversation-status-button";
  const STATUS_MENU_ID = "codex-conversation-status-menu";
  const SUMMARY_CLASS = "codex-conversation-core-summary";
  const DETAILS_CLASS = "codex-conversation-hover-details";
  const FALLBACK_TOOLTIP_ID = "codex-conversation-preview-fallback-tooltip";
  const CARD_CONTENT_CLASS = "codex-conversation-card-content";
  const CARD_TITLE_CLASS = "codex-conversation-card-title";
  const CARD_SUMMARY_CLASS = "codex-conversation-card-summary";
  const TIME_CLASS = "codex-conversation-card-time";
  const TAGS_CLASS = "codex-conversation-card-tags";
  const ROW_SELECTOR = "[data-app-action-sidebar-thread-row]";
  const RUNTIME_TOKEN = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
  try { window[SENTINEL]?.destroy?.(); } catch {}
  if (sidebarMode !== "enhanced") clearLegacySidebarResidue();

  let destroyed = false;
  let observer = null;
  let syncTimer = null;
  let snapshotDepth = 0;
  let anchorRetryTimer = null;
  let previews = new Map();
  let shortcutSources = new Map();
  let shortcutCatalog = [];
  let shortcutSettings = {
    schemaVersion: 4,
    hidden: Array.from(HIDDEN_SHORTCUT_NAMES, (name) => `native:${name}`),
    custom: [],
  };
  let customShortcutPage = null;
  let customShortcutFrame = null;
  let customShortcutLastFocusedElement = null;
  let assetConsole = { available: false, label: "资产控制台", mode: "embedded" };
  let assetConsolePage = null;
  let assetConsoleFrame = null;
  let assetConsoleLoadTimer = null;
  let assetConsoleReturnFocus = null;
  let assetConsoleRequestId = null;
  let workstationResumePanel = null;
  let projectOverviewPage = null;
  let projectOverviewReturnFocus = null;
  let workstationFontSize = WORKSTATION_FONT_SIZE_DEFAULT;
  let skillOrganizerSource = null;
  let skillOrganizerCatalog = [];
  let skillOrganizerCatalogSignature = "";
  let skillOrganizerFilter = "全部";
  let skillOrganizerQuery = "";
  let skillOrganizerNativeVisible = false;
  let skillOrganizerFavorites = null;
  let skillOrganizerRenderFrame = null;
  let skillOrganizerRenderGeneration = 0;
  let skillOrganizerOpening = false;
  let skillOrganizerOpenGeneration = 0;
  let skillOrganizerOpenObserver = null;
  let skillOrganizerOpenTimer = null;
  let hostSkillCatalog = [];
  let skillContextMenu = null;
  let pendingSkillLabelRequest = null;
  let skillLabelGenerationActive = false;
  let skillCatalogRefreshActive = false;
  let skillLabelPromptHandled = false;
  let pendingAssetConsoleQuery = "";
  let lastWorkspaceCommand = { text: "", at: 0 };
  let sectionSources = new Map();
  let sectionTogglePending = new Map();
  let sectionSourcesMissingSince = 0;
  let folderSources = new Map();
  let folderTogglePending = new Map();
  let folderSourcesMissingSince = 0;
  let usage = {
    available: false,
    text: "剩余量 --",
    remainingPercent: null,
    tone: "muted",
    ariaLabel: "Codex 剩余量暂不可用",
  };
  let layoutAnchored = false;
  let viewMode = "list";
  let activeSectionTab = null;
  let activeFolderId = null;
  let folderSearchQuery = "";
  let folderPreSearchId = null;
  let folderTagsExpanded = false;
  let searchCatalog = [];
  let searchCatalogByProject = new Map();
  let searchCatalogByThread = new Map();
  let recentCatalog = [];
  let recentCatalogByThread = new Map();
  let archivedThreadIds = new Set();
  let taskCatalog = [];
  let interruptedCatalog = [];
  let interruptedCatalogByThread = new Map();
  let pinnedThreadIds = new Set();
  let pinnedProjectIds = new Set();
  let pinnedProjectRefresh = null;
  let pinnedThreadTimes = {};
  let activeProjectThreadIds = new Set();
  let folderSearchExpansionPending = null;
  let folderSearchRevealKey = "";
  let sidebarThreadRevealTimer = null;
  let threadStatuses = {};
  let openStatusButton = null;
  let hoveredPreviewRow = null;
  try {
    const savedShortcutSettings = JSON.parse(localStorage.getItem(SHORTCUT_SETTINGS_STORAGE_KEY) || "null");
    if (savedShortcutSettings && typeof savedShortcutSettings === "object") {
      const hidden = Array.isArray(savedShortcutSettings.hidden)
        ? savedShortcutSettings.hidden.filter((value) => typeof value === "string")
        : shortcutSettings.hidden;
      const custom = Array.isArray(savedShortcutSettings.custom)
        ? savedShortcutSettings.custom.filter((item) => item && typeof item === "object")
        : [];
      shortcutSettings = {
        schemaVersion: 4,
        // v1-v3 shipped with native entries hidden by default. Restore every
        // built-in once so an update cannot look incomplete; later v4 choices
        // remain user-controlled and persistent.
        hidden: savedShortcutSettings.schemaVersion === 4
          ? hidden
          : hidden.filter((value) => !value.startsWith("native:")),
        custom,
      };
      if (savedShortcutSettings.schemaVersion !== 4) {
        localStorage.setItem(SHORTCUT_SETTINGS_STORAGE_KEY, JSON.stringify(shortcutSettings));
      }
    }
  } catch {}
  try { viewMode = localStorage.getItem(VIEW_STORAGE_KEY) === "card" ? "card" : "list"; } catch {}
  try {
    const savedSectionTab = localStorage.getItem(SECTION_TAB_STORAGE_KEY);
    if (SECTION_NAMES.includes(savedSectionTab)) activeSectionTab = savedSectionTab;
  } catch {}
  try { activeFolderId = localStorage.getItem(FOLDER_STORAGE_KEY) || null; } catch {}
  try {
    const savedFontSize = localStorage.getItem(WORKSTATION_FONT_SIZE_KEY);
    const parsedFontSize = savedFontSize === null ? NaN : Number(savedFontSize);
    if (Number.isInteger(parsedFontSize)) workstationFontSize = Math.min(WORKSTATION_FONT_SIZE_MAX, Math.max(WORKSTATION_FONT_SIZE_MIN, parsedFontSize));
  } catch {}
  try {
    const savedPinnedThreadTimes = JSON.parse(localStorage.getItem(PINNED_THREAD_TIMES_STORAGE_KEY) || "null");
    if (savedPinnedThreadTimes && typeof savedPinnedThreadTimes === "object" && !Array.isArray(savedPinnedThreadTimes)) {
      pinnedThreadTimes = savedPinnedThreadTimes;
      pinnedThreadIds = new Set(Object.keys(savedPinnedThreadTimes));
    }
  } catch {}
  try {
    const savedThreadStatuses = JSON.parse(localStorage.getItem(THREAD_STATUS_STORAGE_KEY) || "null");
    if (savedThreadStatuses && typeof savedThreadStatuses === "object" && !Array.isArray(savedThreadStatuses)) {
      threadStatuses = savedThreadStatuses;
    }
  } catch {}

  function installStyles() {
    document.getElementById(STYLE_ID)?.remove();
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      @property --codex-running-angle {
        syntax: "<angle>";
        inherits: false;
        initial-value: 0deg;
      }
      @keyframes codex-running-border-flow {
        to { --codex-running-angle: 360deg; }
      }
      #${WORKSTATION_ENTRY_ID} {
        display: inline-flex; align-items: center; justify-content: center; gap: 6px;
        flex: 0 0 auto; min-height: 28px; padding: 4px 8px; margin-inline: 4px;
        border: 0; border-radius: 7px; background: transparent; color: inherit;
        font: inherit; font-size: 12px; line-height: 20px; cursor: pointer;
        -webkit-app-region: no-drag; pointer-events: auto;
      }
      #${WORKSTATION_ENTRY_ID}:hover, #${WORKSTATION_ENTRY_ID}[aria-expanded="true"] {
        background: color-mix(in srgb, currentColor 7%, transparent);
      }
      #${WORKSTATION_ENTRY_ID}:focus-visible {
        outline: 2px solid var(--color-token-accent-foreground, Highlight); outline-offset: 2px;
      }
      ${ROW_SELECTOR}[data-codex-conversation-preview-enhanced="true"] {
        height: auto !important;
        min-height: 48px !important;
        padding-top: 5px !important;
        padding-bottom: 5px !important;
      }
      ${ROW_SELECTOR}[data-codex-sidebar-search-match="true"] {
        background: color-mix(in srgb, var(--color-accent, #2f80ed) 10%, transparent) !important;
        box-shadow: inset 3px 0 0 color-mix(in srgb, var(--color-accent, #2f80ed) 65%, transparent);
      }
      [data-codex-conversation-preview-title="true"] {
        flex-direction: column !important;
        align-items: stretch !important;
        justify-content: center !important;
        gap: 0 !important;
        min-height: 38px;
      }
      [data-codex-conversation-preview-title="true"] > [data-thread-title="true"] {
        flex: 0 0 auto !important;
        width: 100%;
        line-height: 20px;
      }
      .${SUMMARY_CLASS} {
        min-width: 0;
        max-width: 100%;
        overflow: hidden;
        color: var(--color-token-description-foreground, color-mix(in srgb, currentColor 62%, transparent));
        font-size: 12px;
        line-height: 16px;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .${CARD_CONTENT_CLASS} {
        display: none;
      }
      html[data-codex-conversation-view="card"] [data-codex-conversation-card-grid="true"] {
        display: grid !important;
        grid-template-columns: repeat(auto-fit, minmax(min(100%, 10.5rem), 1fr)) !important;
        align-items: stretch;
        gap: 10px 8px !important;
      }
      [data-codex-sidebar-pinned-outside-hidden="true"] {
        display: none !important;
      }
      [data-codex-sidebar-native-alias-hidden] {
        display: none !important;
      }
      [data-codex-sidebar-semantic-duplicate-hidden] {
        display: none !important;
      }
      [data-codex-sidebar-folder-control-item="true"] {
        grid-column: 1 / -1 !important;
        width: 100% !important;
      }
      html:not([data-codex-conversation-view="card"]) [data-codex-sidebar-folder-catalog-list="true"] {
        display: flex !important;
        flex-direction: column;
      }
      html[data-codex-conversation-view="card"] [data-codex-conversation-card-grid="true"] > [data-codex-conversation-card-item="true"],
      html[data-codex-conversation-view="card"] [data-codex-conversation-card-grid="true"] > [data-codex-conversation-card-item="true"] > *,
      html[data-codex-conversation-view="card"] [data-codex-conversation-card-grid="true"] > [data-codex-conversation-card-item="true"] > * > *:not(.${STATUS_BUTTON_CLASS}) {
        min-width: 0 !important;
        width: 100% !important;
      }
      html[data-codex-conversation-view="card"] ${ROW_SELECTOR}[data-codex-conversation-preview-enhanced="true"] {
        position: relative;
        width: 100% !important;
        height: auto !important;
        min-height: 0 !important;
        max-height: none !important;
        margin: 0 !important;
        padding: 0 !important;
        overflow: hidden;
        scroll-margin-top: 176px;
        scroll-margin-bottom: 88px;
        border: 0.5px solid color-mix(in srgb, currentColor 10%, transparent) !important;
        border-radius: 13px !important;
        background: color-mix(in srgb, var(--color-token-main-surface-secondary, Canvas) 68%, transparent) !important;
        box-shadow: 0 7px 22px color-mix(in srgb, black 6%, transparent);
        backdrop-filter: blur(14px) saturate(112%);
        -webkit-backdrop-filter: blur(14px) saturate(112%);
      }
      html[data-codex-conversation-view="card"] ${ROW_SELECTOR}[data-codex-conversation-preview-enhanced="true"]:hover,
      html[data-codex-conversation-view="card"] ${ROW_SELECTOR}[aria-current="page"] {
        border-color: color-mix(in srgb, currentColor 17%, transparent) !important;
        background: color-mix(in srgb, var(--color-token-list-hover-background, Canvas) 76%, transparent) !important;
        box-shadow: 0 9px 26px color-mix(in srgb, black 8%, transparent);
      }
      html[data-codex-conversation-view="card"] ${ROW_SELECTOR}[data-codex-project-running="true"] {
        isolation: isolate;
        border-color: color-mix(in srgb, #2f95ff 58%, transparent) !important;
        box-shadow: 0 7px 22px color-mix(in srgb, black 6%, transparent),
          0 0 0 1px color-mix(in srgb, #2f95ff 26%, transparent),
          0 0 15px color-mix(in srgb, #2f95ff 24%, transparent) !important;
      }
      html[data-codex-conversation-view="card"] ${ROW_SELECTOR}[data-codex-project-running="true"]::before {
        position: absolute;
        z-index: 3;
        inset: -0.5px;
        padding: 1.5px;
        border-radius: inherit;
        background: conic-gradient(from var(--codex-running-angle),
          transparent 0deg 205deg,
          color-mix(in srgb, #2f95ff 20%, transparent) 230deg,
          #4ba9ff 260deg,
          #b9e9ff 278deg,
          #2f95ff 296deg,
          transparent 330deg 360deg);
        content: "";
        pointer-events: none;
        filter: drop-shadow(0 0 4px color-mix(in srgb, #2f95ff 62%, transparent));
        -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
        -webkit-mask-composite: xor;
        mask-composite: exclude;
        animation: codex-running-border-flow 2.4s linear infinite;
      }
      html[data-codex-conversation-view="card"] [data-codex-conversation-preview-title="true"] {
        display: none !important;
      }
      html[data-codex-conversation-view="card"] .${CARD_CONTENT_CLASS} {
        display: grid;
        position: relative;
        z-index: 1;
        width: 100%;
        box-sizing: border-box;
        grid-template-rows: repeat(4, auto);
        align-content: start;
        gap: 6px;
        padding: 14px;
        pointer-events: none;
      }
      .${CARD_TITLE_CLASS} {
        display: block;
        min-width: 0;
        padding-right: 38px;
        color: var(--color-token-text-primary, var(--color-token-foreground, inherit));
        font-size: 14px;
        font-weight: 600;
        line-height: 20px;
        white-space: normal;
        overflow-wrap: anywhere;
      }
      .${TIME_CLASS} {
        min-width: 0;
        overflow: hidden;
        color: var(--color-token-description-foreground, color-mix(in srgb, currentColor 58%, transparent));
        font-size: 11px;
        line-height: 16px;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .${CARD_SUMMARY_CLASS} {
        display: block;
        min-width: 0;
        color: var(--color-token-description-foreground, color-mix(in srgb, currentColor 64%, transparent));
        font-size: 12px;
        line-height: 18px;
        white-space: normal;
        overflow-wrap: anywhere;
      }
      .${TAGS_CLASS} {
        display: grid;
        min-width: 0;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        align-items: center;
        gap: 5px;
        overflow: hidden;
      }
      .${TAGS_CLASS} > span {
        min-width: 0;
        max-width: none;
        overflow: hidden;
        padding: 2px 5px;
        border: 0.5px solid color-mix(in srgb, currentColor 10%, transparent);
        border-radius: 999px;
        background: color-mix(in srgb, currentColor 5%, transparent);
        color: var(--color-token-description-foreground, color-mix(in srgb, currentColor 68%, transparent));
        font-size: 10px;
        font-weight: 500;
        line-height: 18px;
        text-align: center;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      @media (prefers-reduced-motion: reduce) {
        html[data-codex-conversation-view="card"] ${ROW_SELECTOR}[data-codex-project-running="true"]::before {
          animation: none;
          background: #2f95ff;
        }
      }
      .${STATUS_BUTTON_CLASS} {
        display: none;
      }
      html[data-codex-conversation-view="card"] .${STATUS_BUTTON_CLASS} {
        display: inline-flex;
        position: absolute;
        z-index: 12;
        top: 9px;
        right: 9px;
        width: 28px;
        height: 28px;
        align-items: center;
        justify-content: center;
        box-sizing: border-box;
        padding: 0;
        border: 0;
        border-radius: 999px;
        background: color-mix(in srgb, var(--color-token-main-surface-primary, Canvas) 72%, transparent);
        box-shadow: 0 2px 8px color-mix(in srgb, black 9%, transparent), inset 0 0 0 0.5px color-mix(in srgb, currentColor 10%, transparent);
        cursor: pointer;
        pointer-events: auto;
        backdrop-filter: blur(10px);
        -webkit-backdrop-filter: blur(10px);
      }
      .${STATUS_BUTTON_CLASS}::before {
        width: 14px;
        height: 14px;
        border: 2px solid color-mix(in srgb, white 72%, transparent);
        border-radius: 50%;
        background: #b5b7ba;
        box-shadow: 0 0 0 2px color-mix(in srgb, #8f9296 22%, transparent);
        content: "";
      }
      .${STATUS_BUTTON_CLASS}[data-status="urgent-important"]::before {
        background: #ef4755;
        box-shadow: 0 0 0 2px color-mix(in srgb, #ef4755 22%, transparent);
      }
      .${STATUS_BUTTON_CLASS}[data-status="urgent-or-important"]::before {
        background: #f28a16;
        box-shadow: 0 0 0 2px color-mix(in srgb, #f28a16 22%, transparent);
      }
      .${STATUS_BUTTON_CLASS}[data-status="not-urgent"]::before {
        background: #2fa56b;
        box-shadow: 0 0 0 2px color-mix(in srgb, #2fa56b 22%, transparent);
      }
      .${STATUS_BUTTON_CLASS}[data-status="unmarked"]::before,
      .${STATUS_BUTTON_CLASS}[data-status="clear"]::before {
        border-color: color-mix(in srgb, white 58%, transparent);
        background: #b5b7ba;
        box-shadow: 0 0 0 2px color-mix(in srgb, #8f9296 22%, transparent);
      }
      .${STATUS_BUTTON_CLASS}:hover {
        background: color-mix(in srgb, var(--color-token-list-hover-background, Canvas) 90%, transparent);
        transform: scale(1.04);
      }
      .${STATUS_BUTTON_CLASS}:focus-visible {
        outline: 2px solid var(--color-token-accent-foreground, Highlight) !important;
        outline-offset: 2px !important;
      }
      #${STATUS_MENU_ID} {
        display: flex;
        position: fixed;
        z-index: 10000;
        width: 214px;
        flex-direction: column;
        gap: 3px;
        box-sizing: border-box;
        padding: 8px;
        border: 0.5px solid color-mix(in srgb, currentColor 13%, transparent);
        border-radius: 16px;
        background: color-mix(in srgb, var(--color-token-main-surface-primary, Canvas) 92%, transparent);
        color: var(--color-token-text-primary, currentColor);
        box-shadow: 0 18px 50px color-mix(in srgb, black 18%, transparent), inset 0 1px 0 color-mix(in srgb, white 38%, transparent);
        backdrop-filter: blur(22px) saturate(120%);
        -webkit-backdrop-filter: blur(22px) saturate(120%);
      }
      #${STATUS_MENU_ID} [data-codex-conversation-status-option] {
        display: grid;
        width: 100%;
        height: 42px;
        grid-template-columns: 22px minmax(0, 1fr) 18px;
        align-items: center;
        gap: 10px;
        box-sizing: border-box;
        padding: 0 10px;
        border: 0;
        border-radius: 11px;
        background: transparent;
        color: inherit;
        font: inherit;
        font-size: 14px;
        font-weight: 570;
        line-height: 20px;
        text-align: left;
        cursor: pointer;
      }
      #${STATUS_MENU_ID} [data-codex-conversation-status-option]:hover,
      #${STATUS_MENU_ID} [data-codex-conversation-status-option]:focus-visible {
        outline: 0;
        background: color-mix(in srgb, currentColor 7%, transparent);
      }
      #${STATUS_MENU_ID} [data-codex-conversation-status-option="clear"] {
        margin-top: 4px;
        border-top: 0.5px solid color-mix(in srgb, currentColor 10%, transparent);
        border-radius: 0 0 11px 11px;
      }
      #${STATUS_MENU_ID} .codex-conversation-status-option-dot {
        width: 16px;
        height: 16px;
        box-sizing: border-box;
        border: 2px solid color-mix(in srgb, white 70%, transparent);
        border-radius: 50%;
        background: var(--codex-status-color);
        box-shadow: 0 0 0 2px color-mix(in srgb, var(--codex-status-color) 22%, transparent);
      }
      #${STATUS_MENU_ID} .codex-conversation-status-option-check {
        color: var(--color-token-text-primary, currentColor);
        font-size: 18px;
        line-height: 1;
        text-align: center;
      }
      [data-codex-sidebar-shortcut-source-hidden="true"],
      [data-codex-sidebar-shortcut-source-group-hidden="true"] {
        display: none !important;
      }
      [${CUSTOM_SHORTCUT_HOST_ATTRIBUTE}="true"] {
        position: relative !important;
        z-index: 31 !important;
        pointer-events: none !important;
      }
      [${CUSTOM_SHORTCUT_HIDDEN_ATTRIBUTE}="true"] {
        visibility: hidden !important;
        pointer-events: none !important;
      }
      #${SHORTCUT_GRID_ID} {
        display: grid !important;
        width: 100%;
        min-width: 0;
        grid-template-columns: repeat(auto-fit, minmax(54px, 1fr));
        align-items: stretch;
        gap: 6px;
      }
      #${SHORTCUT_GRID_ID} > [data-codex-sidebar-shortcut-card-wrap] {
        position: relative;
        min-width: 0;
      }
      #${SHORTCUT_GRID_ID} .${SHORTCUT_CARD_CLASS} {
        display: flex;
        position: relative;
        width: 100%;
        min-width: 0;
        height: 66px;
        align-items: center;
        justify-content: center;
        flex-direction: column;
        gap: 5px;
        box-sizing: border-box;
        padding: 7px 4px 6px;
        overflow: hidden;
        border: 0.5px solid color-mix(in srgb, currentColor 10%, transparent);
        border-radius: 12px;
        background: color-mix(in srgb, var(--color-token-main-surface-secondary, Canvas) 72%, transparent);
        color: var(--color-token-text-primary, currentColor);
        box-shadow: inset 0 1px 0 color-mix(in srgb, white 22%, transparent), 0 3px 10px color-mix(in srgb, black 4%, transparent);
        cursor: pointer;
        transition: background-color 150ms ease, border-color 150ms ease, transform 150ms ease, box-shadow 150ms ease;
      }
      #${SHORTCUT_GRID_ID} .${SHORTCUT_CARD_CLASS}:hover,
      #${SHORTCUT_GRID_ID} .${SHORTCUT_CARD_CLASS}[data-active="true"] {
        border-color: color-mix(in srgb, currentColor 17%, transparent);
        background: color-mix(in srgb, var(--color-token-list-hover-background, Canvas) 82%, transparent);
        box-shadow: inset 0 1px 0 color-mix(in srgb, white 25%, transparent), 0 5px 14px color-mix(in srgb, black 7%, transparent);
        transform: translateY(-1px);
      }
      #${SHORTCUT_GRID_ID} .${SHORTCUT_CARD_CLASS}:focus-visible,
      #${SHORTCUT_GRID_ID} [data-codex-sidebar-shortcut-quick="true"]:focus-visible {
        outline: 2px solid var(--color-token-accent-foreground, Highlight);
        outline-offset: 2px;
      }
      #${SHORTCUT_GRID_ID} .${SHORTCUT_ICON_CLASS} {
        display: inline-flex;
        flex: 0 0 28px;
        width: 28px;
        height: 28px;
        align-items: center;
        justify-content: center;
        border-radius: 9px;
        background: color-mix(in srgb, currentColor 6%, transparent);
        color: var(--color-token-text-primary, currentColor);
      }
      #${SHORTCUT_GRID_ID} .${SHORTCUT_ICON_CLASS} svg,
      #${SHORTCUT_GRID_ID} .${SHORTCUT_ICON_CLASS} img {
        display: block;
        position: static !important;
        inset: auto !important;
        transform: none !important;
        margin: 0 !important;
        width: 18px !important;
        height: 18px !important;
      }
      #${SHORTCUT_GRID_ID} .${SHORTCUT_LABEL_CLASS} {
        display: block;
        width: 100%;
        min-width: 0;
        overflow: hidden;
        color: var(--color-token-description-foreground, color-mix(in srgb, currentColor 72%, transparent));
        font-size: 10px;
        font-weight: 550;
        line-height: 14px;
        text-align: center;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      #${SHORTCUT_GRID_ID} .codex-sidebar-shortcut-status {
        position: absolute;
        z-index: 2;
        top: 7px;
        right: 7px;
        width: 6px;
        height: 6px;
        border: 2px solid var(--color-token-main-surface-primary, Canvas);
        border-radius: 50%;
        background: var(--vscode-textLink-foreground, #2f95ff);
        pointer-events: none;
      }
      #${SHORTCUT_GRID_ID} [data-codex-sidebar-shortcut-quick="true"] {
        display: inline-flex;
        position: absolute;
        z-index: 3;
        top: 4px;
        right: 4px;
        width: 20px;
        height: 20px;
        align-items: center;
        justify-content: center;
        padding: 0;
        border: 0.5px solid color-mix(in srgb, currentColor 12%, transparent);
        border-radius: 7px;
        background: color-mix(in srgb, var(--color-token-main-surface-primary, Canvas) 88%, transparent);
        color: var(--color-token-description-foreground, currentColor);
        box-shadow: 0 1px 4px color-mix(in srgb, black 7%, transparent);
        cursor: pointer;
      }
      #${SHORTCUT_GRID_ID} [data-codex-sidebar-shortcut-quick="true"]:hover {
        background: var(--color-token-list-hover-background, Canvas);
        color: var(--color-token-text-primary, currentColor);
      }
      #${SHORTCUT_GRID_ID} [data-codex-sidebar-shortcut-quick="true"] svg {
        width: 12px !important;
        height: 12px !important;
      }
      #${SHORTCUT_SETTINGS_BUTTON_ID} {
        display: inline-flex !important;
        flex: 0 0 28px !important;
        width: 28px !important;
        min-width: 28px !important;
        max-width: 28px !important;
        height: 28px !important;
        min-height: 28px !important;
        align-items: center !important;
        justify-content: center !important;
        margin: 0 !important;
        padding: 0 !important;
        border: 0 !important;
        border-radius: 9px !important;
        background: transparent !important;
        color: var(--color-token-description-foreground, currentColor) !important;
        cursor: pointer;
      }
      #${SHORTCUT_SETTINGS_BUTTON_ID}:hover {
        background: color-mix(in srgb, currentColor 7%, transparent) !important;
        color: var(--color-token-text-primary, currentColor) !important;
      }
      #${SHORTCUT_SETTINGS_BUTTON_ID}:focus-visible {
        outline: 2px solid var(--color-token-accent-foreground, Highlight) !important;
        outline-offset: 2px !important;
      }
      #${SHORTCUT_SETTINGS_BUTTON_ID} svg {
        width: 18px !important;
        height: 18px !important;
      }
      #${SHORTCUT_SETTINGS_ID} {
        width: min(430px, calc(100vw - 32px));
        max-height: min(680px, calc(100vh - 48px));
        margin: auto;
        padding: 0;
        overflow: hidden;
        border: 0.5px solid color-mix(in srgb, currentColor 16%, transparent);
        border-radius: 18px;
        background: color-mix(in srgb, var(--color-token-main-surface-primary, Canvas) 94%, transparent);
        color: var(--color-token-text-primary, CanvasText);
        box-shadow: 0 24px 70px color-mix(in srgb, black 24%, transparent);
        backdrop-filter: blur(24px) saturate(125%);
      }
      #${SHORTCUT_SETTINGS_ID}::backdrop {
        background: color-mix(in srgb, black 28%, transparent);
        backdrop-filter: blur(4px);
      }
      #${SHORTCUT_SETTINGS_ID} .codex-shortcut-settings-shell {
        display: flex;
        max-height: min(680px, calc(100vh - 48px));
        flex-direction: column;
      }
      #${SHORTCUT_SETTINGS_ID} .codex-shortcut-settings-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 18px 18px 12px;
      }
      #${SHORTCUT_SETTINGS_ID} h2,
      #${SHORTCUT_SETTINGS_ID} h3 {
        margin: 0;
        font-weight: 650;
      }
      #${SHORTCUT_SETTINGS_ID} h2 { font-size: 17px; }
      #${SHORTCUT_SETTINGS_ID} h3 { font-size: 13px; }
      #${SHORTCUT_SETTINGS_ID} [data-codex-shortcut-settings-close] {
        width: 30px;
        height: 30px;
        padding: 0;
        border: 0;
        border-radius: 9px;
        background: color-mix(in srgb, currentColor 6%, transparent);
        color: inherit;
        font-size: 20px;
        cursor: pointer;
      }
      #${SHORTCUT_SETTINGS_ID} .codex-shortcut-settings-body {
        min-height: 0;
        padding: 0 18px 18px;
        overflow: auto;
      }
      #${SHORTCUT_SETTINGS_ID} .codex-shortcut-settings-list {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 7px;
        margin: 10px 0 18px;
      }
      #${SHORTCUT_SETTINGS_ID} .codex-shortcut-settings-row {
        display: flex;
        min-width: 0;
        align-items: center;
        gap: 8px;
        padding: 9px 10px;
        border: 0.5px solid color-mix(in srgb, currentColor 10%, transparent);
        border-radius: 11px;
        background: color-mix(in srgb, currentColor 3%, transparent);
      }
      #${SHORTCUT_SETTINGS_ID} .codex-shortcut-settings-row > span {
        min-width: 0;
        flex: 1;
        overflow: hidden;
        font-size: 12px;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      #${SHORTCUT_SETTINGS_ID} .codex-shortcut-settings-row input {
        accent-color: var(--vscode-textLink-foreground, #2f95ff);
      }
      #${SHORTCUT_SETTINGS_ID} [data-codex-shortcut-delete] {
        padding: 2px 5px;
        border: 0;
        background: transparent;
        color: color-mix(in srgb, currentColor 55%, transparent);
        cursor: pointer;
      }
      #${SHORTCUT_SETTINGS_ID} [data-codex-shortcut-custom-form] {
        display: grid;
        gap: 11px;
        padding: 13px;
        border: 0.5px solid color-mix(in srgb, currentColor 10%, transparent);
        border-radius: 13px;
        background: color-mix(in srgb, currentColor 3%, transparent);
      }
      #${SHORTCUT_SETTINGS_ID} .codex-shortcut-field {
        display: grid;
        gap: 6px;
        color: color-mix(in srgb, currentColor 68%, transparent);
        font-size: 11px;
      }
      #${SHORTCUT_SETTINGS_ID} .codex-shortcut-field input[type="text"],
      #${SHORTCUT_SETTINGS_ID} .codex-shortcut-field input[type="url"] {
        width: 100%;
        height: 34px;
        box-sizing: border-box;
        padding: 0 10px;
        border: 0.5px solid color-mix(in srgb, currentColor 13%, transparent);
        border-radius: 9px;
        outline: none;
        background: color-mix(in srgb, Canvas 86%, transparent);
        color: inherit;
      }
      #${SHORTCUT_SETTINGS_ID} .codex-shortcut-field input:focus-visible {
        border-color: var(--vscode-textLink-foreground, #2f95ff);
        box-shadow: 0 0 0 2px color-mix(in srgb, var(--vscode-textLink-foreground, #2f95ff) 17%, transparent);
      }
      #${SHORTCUT_SETTINGS_ID} .codex-shortcut-icon-options {
        display: grid;
        grid-template-columns: repeat(6, 1fr);
        gap: 6px;
      }
      #${SHORTCUT_SETTINGS_ID} [data-codex-shortcut-icon] {
        display: grid;
        height: 35px;
        place-items: center;
        padding: 0;
        border: 0.5px solid color-mix(in srgb, currentColor 11%, transparent);
        border-radius: 9px;
        background: color-mix(in srgb, Canvas 72%, transparent);
        color: inherit;
        cursor: pointer;
      }
      #${SHORTCUT_SETTINGS_ID} [data-codex-shortcut-icon][aria-pressed="true"] {
        border-color: var(--vscode-textLink-foreground, #2f95ff);
        background: color-mix(in srgb, var(--vscode-textLink-foreground, #2f95ff) 12%, transparent);
      }
      #${SHORTCUT_SETTINGS_ID} [data-codex-shortcut-icon] svg {
        width: 17px;
        height: 17px;
        fill: none;
        stroke: currentColor;
        stroke-width: 1.7;
        stroke-linecap: round;
        stroke-linejoin: round;
      }
      #${SHORTCUT_SETTINGS_ID} .codex-shortcut-open-modes {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 6px;
      }
      #${SHORTCUT_SETTINGS_ID} .codex-shortcut-open-modes label {
        display: flex;
        height: 34px;
        align-items: center;
        justify-content: center;
        gap: 6px;
        border: 0.5px solid color-mix(in srgb, currentColor 11%, transparent);
        border-radius: 9px;
        background: color-mix(in srgb, Canvas 72%, transparent);
        cursor: pointer;
      }
      #${SHORTCUT_SETTINGS_ID} [data-codex-shortcut-error] {
        min-height: 16px;
        color: #e5484d;
        font-size: 11px;
      }
      #${SHORTCUT_SETTINGS_ID} [data-codex-shortcut-save] {
        height: 36px;
        border: 0;
        border-radius: 10px;
        background: var(--vscode-textLink-foreground, #2f95ff);
        color: white;
        font-weight: 650;
        cursor: pointer;
      }
      #${CUSTOM_SHORTCUT_PAGE_ID} {
        position: relative;
        z-index: 30;
        display: grid;
        grid-template-rows: 44px minmax(0, 1fr);
        flex: 0 0 var(--codex-workspace-panel-width, min(680px, 48vw));
        width: var(--codex-workspace-panel-width, min(680px, 48vw));
        min-width: 420px;
        max-width: min(1000px, calc(100vw - 360px));
        height: 100%;
        min-height: 0;
        overflow: hidden;
        border-left: 1px solid color-mix(in srgb, currentColor 12%, transparent);
        background: Canvas;
        color: CanvasText;
        box-shadow: -12px 0 32px color-mix(in srgb, black 8%, transparent);
        pointer-events: auto;
      }
      #${CUSTOM_SHORTCUT_PAGE_ID}[hidden] { display: none !important; }
      #${CUSTOM_SHORTCUT_PAGE_ID} .codex-custom-shortcut-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0 12px 0 16px;
        border-bottom: 0.5px solid color-mix(in srgb, currentColor 12%, transparent);
        font-size: 13px;
        font-weight: 620;
      }
      #${CUSTOM_SHORTCUT_PAGE_ID} [data-codex-custom-shortcut-close] {
        width: 30px;
        height: 30px;
        padding: 0;
        border: 0;
        border-radius: 9px;
        background: color-mix(in srgb, currentColor 6%, transparent);
        color: inherit;
        font-size: 20px;
        cursor: pointer;
      }
      #${CUSTOM_SHORTCUT_FRAME_ID} {
        width: 100%;
        height: 100%;
        border: 0;
        background: Canvas;
      }
      [data-codex-sidebar-section-heading-hidden="true"] {
        display: none !important;
      }
      [data-codex-sidebar-priority-native-hidden="true"] {
        display: none !important;
      }
      [data-codex-sidebar-virtual-section][hidden],
      [data-codex-sidebar-virtual-folder-panel][hidden] {
        display: none !important;
      }
      #${SECTION_TABS_ID} {
        display: grid !important;
        position: relative;
        flex: 0 0 auto;
        grid-template-columns: minmax(0, 1fr) 58px;
        align-items: center;
        gap: 6px;
        box-sizing: border-box;
        min-width: 0;
        min-height: 42px;
        margin: 0 8px -6px;
        padding: 4px;
        border: 0.5px solid color-mix(in srgb, currentColor 10%, transparent);
        border-radius: 12px;
        background: color-mix(in srgb, var(--color-token-main-surface-secondary, Canvas) 68%, transparent);
        box-shadow: inset 0 1px 0 color-mix(in srgb, white 22%, transparent), 0 4px 14px color-mix(in srgb, black 4%, transparent);
        backdrop-filter: blur(14px) saturate(112%);
        -webkit-backdrop-filter: blur(14px) saturate(112%);
      }
      #${SECTION_TABS_ID} [role="tablist"] {
        display: grid;
        min-width: 0;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        align-items: center;
        gap: 3px;
        overflow: hidden;
      }
      #${SECTION_TABS_ID} [role="tab"] {
        display: inline-flex;
        min-width: 0;
        height: 32px;
        align-items: center;
        justify-content: center;
        box-sizing: border-box;
        padding: 0 4px;
        overflow: hidden;
        border: 0;
        border-radius: 8px;
        background: transparent;
        color: var(--color-token-description-foreground, color-mix(in srgb, currentColor 64%, transparent));
        font-size: 12px;
        font-weight: 560;
        line-height: 18px;
        text-overflow: ellipsis;
        white-space: nowrap;
        cursor: pointer;
        transition: color 150ms ease, background-color 150ms ease, box-shadow 150ms ease;
      }
      #${SECTION_TABS_ID} [role="tab"]:hover {
        color: var(--color-token-text-primary, currentColor);
        background: color-mix(in srgb, currentColor 5%, transparent);
      }
      #${SECTION_TABS_ID} [role="tab"][aria-selected="true"] {
        background: color-mix(in srgb, var(--color-token-main-surface-primary, Canvas) 88%, transparent);
        color: var(--color-token-text-primary, currentColor);
        box-shadow: 0 1px 4px color-mix(in srgb, black 10%, transparent), inset 0 0 0 0.5px color-mix(in srgb, currentColor 8%, transparent);
      }
      #${SECTION_TABS_ID} [role="tab"]:focus-visible,
      #${SECTION_TABS_ID} [data-codex-sidebar-project-actions] button:focus-visible {
        outline: 2px solid var(--color-token-accent-foreground, Highlight) !important;
        outline-offset: 1px !important;
      }
      #${SECTION_TABS_ID} [data-codex-sidebar-project-actions] {
        display: flex;
        width: 58px;
        height: 32px;
        align-items: center;
        justify-content: flex-end;
        gap: 2px;
      }
      #${SECTION_TABS_ID} [data-codex-sidebar-project-actions][hidden] {
        display: none !important;
      }
      #${SECTION_TABS_ID} [data-codex-sidebar-project-actions] [data-codex-sidebar-project-actions-source] {
        display: flex !important;
        align-items: center;
        gap: 2px !important;
      }
      #${SECTION_TABS_ID} [data-codex-sidebar-project-actions] [data-codex-sidebar-project-actions-source] > *,
      #${SECTION_TABS_ID} [data-codex-sidebar-project-actions] [data-codex-sidebar-project-actions-source] > * > * {
        pointer-events: auto !important;
        opacity: 1 !important;
      }
      #${SECTION_TABS_ID} [data-codex-sidebar-project-actions] button {
        width: 26px !important;
        height: 26px !important;
        min-width: 26px !important;
        min-height: 26px !important;
        padding: 3px !important;
        border-radius: 8px !important;
      }
      #${SECTION_TABS_ID} [data-codex-sidebar-project-actions] svg {
        width: 17px !important;
        height: 17px !important;
      }
      [data-codex-sidebar-folder-heading-hidden="true"] {
        display: none !important;
      }
      #${FOLDER_SWITCHER_ID} {
        display: flex;
        min-width: 0;
        flex-direction: column;
        gap: 8px;
        box-sizing: border-box;
        margin: 2px 0 10px;
        padding: 9px;
        border: 0.5px solid color-mix(in srgb, currentColor 9%, transparent);
        border-radius: 13px;
        background: color-mix(in srgb, var(--color-token-main-surface-secondary, Canvas) 63%, transparent);
        box-shadow: inset 0 1px 0 color-mix(in srgb, white 20%, transparent), 0 4px 14px color-mix(in srgb, black 3%, transparent);
        backdrop-filter: blur(13px) saturate(110%);
        -webkit-backdrop-filter: blur(13px) saturate(110%);
      }
      #${FOLDER_SWITCHER_ID} .codex-sidebar-folder-search-row {
        display: grid;
        min-width: 0;
        grid-template-columns: minmax(0, 1fr) 58px;
        align-items: center;
        gap: 6px;
      }
      #${FOLDER_SWITCHER_ID} .codex-sidebar-folder-search-shell {
        position: relative;
        min-width: 0;
      }
      #${FOLDER_SWITCHER_ID} .codex-sidebar-folder-search-icon {
        display: inline-flex;
        position: absolute;
        z-index: 1;
        top: 50%;
        left: 10px;
        align-items: center;
        justify-content: center;
        color: var(--color-token-description-foreground, color-mix(in srgb, currentColor 58%, transparent));
        pointer-events: none;
        transform: translateY(-50%);
      }
      #${FOLDER_SWITCHER_ID} [data-codex-sidebar-folder-search] {
        width: 100%;
        min-width: 0;
        height: 34px;
        box-sizing: border-box;
        padding: 0 32px;
        border: 0.5px solid color-mix(in srgb, currentColor 11%, transparent);
        border-radius: 10px;
        outline: 0;
        background: color-mix(in srgb, var(--color-token-main-surface-primary, Canvas) 80%, transparent);
        color: var(--color-token-text-primary, currentColor);
        box-shadow: inset 0 1px 2px color-mix(in srgb, black 3%, transparent);
        font-size: 12px;
        line-height: 18px;
      }
      #${FOLDER_SWITCHER_ID} [data-codex-sidebar-folder-search]::placeholder {
        color: var(--color-token-description-foreground, color-mix(in srgb, currentColor 52%, transparent));
      }
      #${FOLDER_SWITCHER_ID} [data-codex-sidebar-folder-search]:focus-visible {
        border-color: color-mix(in srgb, var(--color-token-accent-foreground, currentColor) 38%, transparent);
        box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-token-accent-foreground, Highlight) 14%, transparent);
      }
      #${FOLDER_SWITCHER_ID} [data-codex-sidebar-folder-clear] {
        display: inline-flex;
        position: absolute;
        z-index: 2;
        top: 50%;
        right: 5px;
        width: 24px;
        height: 24px;
        align-items: center;
        justify-content: center;
        padding: 0;
        border: 0;
        border-radius: 7px;
        background: transparent;
        color: var(--color-token-description-foreground, currentColor);
        cursor: pointer;
        transform: translateY(-50%);
      }
      #${FOLDER_SWITCHER_ID} [data-codex-sidebar-folder-clear]:hover {
        background: color-mix(in srgb, currentColor 7%, transparent);
        color: var(--color-token-text-primary, currentColor);
      }
      #${FOLDER_SWITCHER_ID} [data-codex-sidebar-folder-actions] {
        display: flex;
        width: 58px;
        height: 32px;
        align-items: center;
        justify-content: flex-end;
        gap: 2px;
      }
      #${FOLDER_SWITCHER_ID} [data-codex-sidebar-folder-actions][hidden] {
        display: none !important;
      }
      #${FOLDER_SWITCHER_ID} [data-codex-sidebar-folder-actions-source] {
        display: flex !important;
        width: auto !important;
        max-width: none !important;
        align-items: center;
        gap: 2px !important;
        overflow: visible !important;
        opacity: 1 !important;
        visibility: visible !important;
        pointer-events: auto !important;
      }
      #${FOLDER_SWITCHER_ID} [data-codex-sidebar-folder-actions-source] > *,
      #${FOLDER_SWITCHER_ID} [data-codex-sidebar-folder-actions-source] > * > *,
      #${FOLDER_SWITCHER_ID} [data-codex-sidebar-folder-actions-source] > * > * > * {
        width: auto !important;
        overflow: visible !important;
        pointer-events: auto !important;
        opacity: 1 !important;
        visibility: visible !important;
      }
      #${FOLDER_SWITCHER_ID} [data-codex-sidebar-folder-actions] button {
        width: 26px !important;
        height: 26px !important;
        min-width: 26px !important;
        min-height: 26px !important;
        padding: 3px !important;
        border-radius: 8px !important;
      }
      #${FOLDER_SWITCHER_ID} [data-codex-sidebar-folder-actions] svg {
        width: 17px !important;
        height: 17px !important;
      }
      #${FOLDER_SWITCHER_ID} [data-codex-sidebar-folder-tags] {
        display: flex;
        min-width: 0;
        max-height: clamp(4.75rem, 18vh, 12rem);
        flex-wrap: wrap;
        align-items: start;
        gap: 6px;
        overflow: hidden;
      }
      #${FOLDER_SWITCHER_ID} [data-codex-sidebar-folder-tags][data-expanded="true"] {
        max-height: none;
      }
      #${FOLDER_SWITCHER_ID} [data-codex-sidebar-folder-tag] {
        display: inline-flex;
        flex: 1 1 8rem;
        min-width: 0;
        max-width: 100%;
        min-height: 28px;
        height: auto;
        align-items: center;
        justify-content: center;
        box-sizing: border-box;
        padding: 5px 10px;
        border: 0.5px solid color-mix(in srgb, currentColor 10%, transparent);
        border-radius: 999px;
        background: color-mix(in srgb, var(--color-token-main-surface-primary, Canvas) 66%, transparent);
        color: var(--color-token-description-foreground, color-mix(in srgb, currentColor 67%, transparent));
        font-size: 11px;
        font-weight: 520;
        line-height: 16px;
        text-align: center;
        white-space: normal;
        overflow-wrap: anywhere;
        cursor: pointer;
        transition: color 140ms ease, border-color 140ms ease, background-color 140ms ease, box-shadow 140ms ease;
      }
      #${FOLDER_SWITCHER_ID} [data-codex-sidebar-folder-tag]:hover {
        border-color: color-mix(in srgb, currentColor 18%, transparent);
        background: color-mix(in srgb, var(--color-token-list-hover-background, Canvas) 82%, transparent);
        color: var(--color-token-text-primary, currentColor);
      }
      #${FOLDER_SWITCHER_ID} [data-codex-sidebar-folder-tag][aria-pressed="true"] {
        border-color: color-mix(in srgb, var(--color-token-accent-foreground, currentColor) 24%, transparent);
        background: color-mix(in srgb, var(--color-token-accent-foreground, currentColor) 10%, var(--color-token-main-surface-primary, Canvas));
        color: var(--color-token-text-primary, currentColor);
        box-shadow: inset 0 0 0 0.5px color-mix(in srgb, var(--color-token-accent-foreground, currentColor) 10%, transparent), 0 2px 6px color-mix(in srgb, black 5%, transparent);
        font-weight: 620;
      }
      #${FOLDER_SWITCHER_ID} [data-codex-sidebar-folder-tag]:focus-visible,
      #${FOLDER_SWITCHER_ID} [data-codex-sidebar-folder-expand]:focus-visible,
      #${FOLDER_SWITCHER_ID} [data-codex-sidebar-folder-clear]:focus-visible,
      #${FOLDER_SWITCHER_ID} [data-codex-sidebar-folder-actions] button:focus-visible {
        outline: 2px solid var(--color-token-accent-foreground, Highlight) !important;
        outline-offset: 1px !important;
      }
      #${ALL_PROJECTS_PANEL_ID} {
        min-width: 0;
        padding-top: 8px;
      }
      #${ALL_PROJECTS_PANEL_ID} [data-codex-sidebar-all-project-list] {
        min-width: 0;
      }
      [data-codex-sidebar-recent-native-hidden="true"] {
        display: none !important;
      }
      #${RECENT_LIST_ID},
      #${INTERRUPTED_LIST_ID} {
        min-width: 0;
      }
      #${FOLDER_SWITCHER_ID} .codex-sidebar-folder-meta {
        display: flex;
        min-width: 0;
        min-height: 20px;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
      }
      #${FOLDER_SWITCHER_ID} [data-codex-sidebar-folder-result] {
        min-width: 0;
        overflow: hidden;
        color: var(--color-token-description-foreground, color-mix(in srgb, currentColor 56%, transparent));
        font-size: 10px;
        line-height: 16px;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      #${FOLDER_SWITCHER_ID} [data-codex-sidebar-folder-expand] {
        display: inline-flex;
        flex: 0 0 auto;
        height: 22px;
        align-items: center;
        gap: 3px;
        padding: 0 6px;
        border: 0;
        border-radius: 7px;
        background: transparent;
        color: var(--color-token-description-foreground, currentColor);
        font-size: 10px;
        line-height: 16px;
        cursor: pointer;
      }
      #${FOLDER_SWITCHER_ID} [data-codex-sidebar-folder-expand]:hover {
        background: color-mix(in srgb, currentColor 6%, transparent);
        color: var(--color-token-text-primary, currentColor);
      }
      #${FOLDER_SWITCHER_ID} [data-codex-sidebar-folder-expand] svg {
        transition: transform 150ms ease;
      }
      #${FOLDER_SWITCHER_ID} [data-codex-sidebar-folder-expand][aria-expanded="true"] svg {
        transform: rotate(180deg);
      }
      #${USAGE_ID} {
        display: grid !important;
        position: relative;
        flex: 0 0 112px !important;
        grid-template-columns: minmax(0, 1fr) auto;
        align-items: center;
        box-sizing: border-box !important;
        width: 112px !important;
        min-width: 112px !important;
        max-width: 112px !important;
        height: 28px !important;
        min-height: 28px !important;
        margin: 0 !important;
        padding: 3px 8px 6px;
        overflow: hidden;
        border: 0.5px solid color-mix(in srgb, currentColor 10%, transparent);
        border-radius: 9px;
        background: color-mix(in srgb, var(--color-token-main-surface-secondary, Canvas) 74%, transparent);
        color: var(--color-token-description-foreground, color-mix(in srgb, currentColor 68%, transparent));
        box-shadow: inset 0 1px 0 color-mix(in srgb, white 22%, transparent);
        font-variant-numeric: tabular-nums;
      }
      #${USAGE_ID}[data-tone="muted"] {
        opacity: 0.68;
      }
      #${USAGE_ID} .${USAGE_TEXT_CLASS} {
        min-width: 0;
        overflow: hidden;
        font-size: 10px;
        font-weight: 500;
        line-height: 16px;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      #${USAGE_ID} .${USAGE_VALUE_CLASS} {
        margin-left: 4px;
        color: var(--color-token-text-primary, currentColor);
        font-size: 12px;
        font-weight: 650;
        line-height: 16px;
        white-space: nowrap;
      }
      #${USAGE_ID} .codex-conversation-usage-track {
        position: absolute;
        right: 8px;
        bottom: 3px;
        left: 8px;
        height: 2px;
        overflow: hidden;
        border-radius: 999px;
        background: color-mix(in srgb, currentColor 9%, transparent);
      }
      #${USAGE_ID} .${USAGE_FILL_CLASS} {
        display: block;
        width: 0;
        height: 100%;
        border-radius: inherit;
        background: var(--color-token-accent-foreground, currentColor);
        opacity: 0.56;
        transition: width 180ms ease;
      }
      #${USAGE_ID}[data-tone="warning"] .${USAGE_FILL_CLASS} {
        background: #b7791f;
        opacity: 0.78;
      }
      #${USAGE_ID}[data-tone="critical"] .${USAGE_FILL_CLASS} {
        background: #c2413b;
        opacity: 0.82;
      }
      #${TOGGLE_ID} {
        display: inline-flex !important;
        position: relative;
        flex: 0 0 52px !important;
        align-items: center !important;
        justify-content: flex-start !important;
        box-sizing: border-box !important;
        width: 52px !important;
        min-width: 52px !important;
        max-width: 52px !important;
        height: 28px !important;
        min-height: 28px !important;
        margin: 0 !important;
        padding: 3px !important;
        overflow: visible !important;
        border: 0.5px solid color-mix(in srgb, currentColor 14%, transparent) !important;
        border-radius: 999px !important;
        background: color-mix(in srgb, currentColor 6%, transparent) !important;
        color: var(--color-token-description-foreground, color-mix(in srgb, currentColor 66%, transparent));
        box-shadow: inset 0 1px 2px color-mix(in srgb, black 5%, transparent);
        cursor: pointer;
        transition: background-color 160ms ease, border-color 160ms ease;
      }
      #${TOGGLE_ID}:hover {
        border-color: color-mix(in srgb, currentColor 20%, transparent) !important;
        background: color-mix(in srgb, currentColor 9%, transparent) !important;
      }
      #${TOGGLE_ID}[aria-checked="true"] {
        border-color: color-mix(in srgb, var(--color-token-accent-foreground, currentColor) 22%, transparent) !important;
        background: color-mix(in srgb, var(--color-token-accent-foreground, currentColor) 12%, transparent) !important;
      }
      #${TOGGLE_ID}:focus-visible {
        outline: 2px solid var(--color-token-accent-foreground, Highlight) !important;
        outline-offset: 2px !important;
      }
      #${TOGGLE_ID} .${SWITCH_THUMB_CLASS} {
        display: inline-flex;
        flex: 0 0 22px;
        align-items: center;
        justify-content: center;
        width: 22px;
        height: 22px;
        border-radius: 50%;
        background: var(--color-token-main-surface-primary, Canvas);
        color: var(--color-token-text-primary, currentColor);
        box-shadow: 0 1px 4px color-mix(in srgb, black 20%, transparent), 0 0 0 0.5px color-mix(in srgb, currentColor 10%, transparent);
        transform: translateX(0);
        transition: transform 180ms cubic-bezier(0.2, 0.8, 0.2, 1), background-color 160ms ease;
      }
      #${TOGGLE_ID}[aria-checked="true"] .${SWITCH_THUMB_CLASS} {
        transform: translateX(24px);
      }
      [role="tooltip"][data-codex-conversation-preview-tooltip="true"] {
        width: min(24rem, calc(100vw - 16px)) !important;
        max-width: min(24rem, calc(100vw - 16px)) !important;
        max-height: calc(100vh - 16px) !important;
        overflow: auto !important;
      }
      [role="tooltip"][data-codex-conversation-preview-tooltip="true"] [class*="max-w-"] {
        max-width: none !important;
        width: 100% !important;
      }
      #${FALLBACK_TOOLTIP_ID} {
        position: fixed;
        z-index: 1000;
        width: min(24rem, calc(100vw - 16px));
        max-width: min(24rem, calc(100vw - 16px));
        max-height: calc(100vh - 16px);
        overflow: auto;
        padding: 12px 14px;
        border: 1px solid var(--color-token-border, color-mix(in srgb, currentColor 14%, transparent));
        border-radius: 14px;
        background: var(--color-token-bg-primary, Canvas);
        color: var(--color-token-foreground, CanvasText);
        box-shadow: 0 12px 34px color-mix(in srgb, black 18%, transparent);
        pointer-events: none;
      }
      #${FALLBACK_TOOLTIP_ID} .codex-conversation-preview-tooltip-title {
        overflow: hidden;
        font-size: 14px;
        font-weight: 650;
        line-height: 20px;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .${DETAILS_CLASS} {
        display: flex;
        min-width: 0;
        flex-direction: column;
        gap: 7px;
        margin-top: 4px;
        padding-top: 8px;
        border-top: 0.5px solid var(--color-token-border, color-mix(in srgb, currentColor 16%, transparent));
      }
      .${DETAILS_CLASS} .codex-conversation-preview-block {
        display: grid;
        min-width: 0;
        grid-template-columns: 52px minmax(0, 1fr);
        align-items: start;
        gap: 8px;
      }
      .${DETAILS_CLASS} .codex-conversation-preview-label {
        color: var(--color-token-description-foreground, color-mix(in srgb, currentColor 62%, transparent));
        font-size: 12px;
        line-height: 18px;
      }
      .${WORKSTATION_HEADER_CLASS} {
        position: relative;
        z-index: 8;
        display: grid;
        grid-template-columns: auto minmax(0, 1fr) auto;
        align-items: center;
        gap: 12px;
        min-height: 50px;
        padding: 0 10px 0 16px;
        border-bottom: 1px solid var(--color-token-border, color-mix(in srgb, currentColor 12%, transparent));
        background: var(--color-token-bg-primary, Canvas);
        color: var(--color-token-foreground, CanvasText);
        font: inherit;
        font-size: var(--nuyoah-workstation-font-size, 14px);
        pointer-events: auto !important;
        -webkit-app-region: no-drag !important;
      }
      .${WORKSTATION_HEADER_CLASS} .nuyoah-workstation-title {
        font-size: var(--nuyoah-workstation-font-size, 14px);
        font-weight: 650;
        white-space: nowrap;
      }
      .${WORKSTATION_HEADER_CLASS} .nuyoah-workstation-tabs {
        display: flex;
        min-width: 0;
        align-items: center;
        justify-content: center;
        gap: 2px;
      }
      .${WORKSTATION_HEADER_CLASS} button {
        min-height: 30px;
        border: 0;
        border-radius: 8px;
        background: transparent;
        color: inherit;
        cursor: pointer;
        font: inherit;
        -webkit-app-region: no-drag !important;
      }
      .${WORKSTATION_HEADER_CLASS} [data-nuyoah-workstation-panel] {
        padding: 0 10px;
        color: var(--color-token-text-secondary, color-mix(in srgb, currentColor 62%, transparent));
        font-size: calc(var(--nuyoah-workstation-font-size, 14px) - 2px);
        font-weight: 560;
      }
      .${WORKSTATION_HEADER_CLASS} [data-nuyoah-workstation-panel]:hover,
      .${WORKSTATION_HEADER_CLASS} [data-nuyoah-workstation-panel]:focus-visible {
        background: var(--color-token-list-hover-background, color-mix(in srgb, currentColor 7%, transparent));
        color: var(--color-token-foreground, currentColor);
      }
      .${WORKSTATION_HEADER_CLASS} [data-nuyoah-workstation-panel][aria-selected="true"] {
        background: var(--color-token-main-surface-secondary, color-mix(in srgb, currentColor 7%, transparent));
        color: var(--color-token-foreground, currentColor);
        font-weight: 650;
      }
      .${WORKSTATION_HEADER_CLASS} .nuyoah-workstation-task-count {
        display: inline-grid;
        min-width: 17px;
        min-height: 17px;
        margin-left: 5px;
        padding: 0 4px;
        place-items: center;
        border-radius: 999px;
        background: var(--color-token-danger-background, #ef4444);
        color: var(--color-token-danger-foreground, #fff);
        font-size: 10px;
        line-height: 17px;
      }
      .${WORKSTATION_HEADER_CLASS} .nuyoah-workstation-close {
        width: 32px;
        padding: 0;
        font-size: 19px;
        line-height: 1;
      }
      .${WORKSTATION_HEADER_CLASS} .nuyoah-workstation-actions,
      .${WORKSTATION_HEADER_CLASS} .nuyoah-workstation-font-controls {
        display: flex;
        align-items: center;
        gap: 3px;
      }
      .${WORKSTATION_HEADER_CLASS} .nuyoah-workstation-font-controls {
        padding: 2px;
        border: 1px solid color-mix(in srgb, currentColor 12%, transparent);
        border-radius: 8px;
      }
      .${WORKSTATION_HEADER_CLASS} [data-nuyoah-workstation-font-action] {
        width: 28px;
        min-height: 26px;
        padding: 0;
        font-size: 11px;
      }
      .${WORKSTATION_HEADER_CLASS} [data-nuyoah-workstation-font-action]:disabled { cursor: default; opacity: .35; }
      .${WORKSTATION_HEADER_CLASS} [data-nuyoah-workstation-font-size] {
        min-width: 34px;
        font-size: 10px;
        text-align: center;
      }
      .${WORKSTATION_HEADER_CLASS} .nuyoah-workstation-close:hover,
      .${WORKSTATION_HEADER_CLASS} .nuyoah-workstation-close:focus-visible {
        background: var(--color-token-list-hover-background, color-mix(in srgb, currentColor 7%, transparent));
      }
      #${PROJECT_OVERVIEW_PAGE_ID} {
        position: relative;
        z-index: 30;
        display: grid;
        grid-template-rows: 50px auto minmax(0, 1fr);
        flex: 0 0 var(--codex-workspace-panel-width, min(680px, 48vw));
        width: var(--codex-workspace-panel-width, min(680px, 48vw));
        min-width: 420px;
        max-width: min(1000px, calc(100vw - 360px));
        height: 100%;
        min-height: 0;
        overflow: hidden;
        border-left: 1px solid var(--color-token-border, color-mix(in srgb, currentColor 12%, transparent));
        background: var(--color-token-bg-primary, Canvas);
        color: var(--color-token-foreground, CanvasText);
        font-size: var(--nuyoah-workstation-font-size, 14px);
        box-shadow: -12px 0 32px color-mix(in srgb, black 8%, transparent);
        pointer-events: auto;
      }
      #${PROJECT_OVERVIEW_PAGE_ID}[hidden] { display: none !important; }
      #${PROJECT_OVERVIEW_PAGE_ID} .nuyoah-project-overview-body {
        min-height: 0;
        overflow: auto;
        padding: 20px;
      }
      .nuyoah-project-subnav { display:flex; gap:6px; padding:8px 16px; flex-shrink:0; border-bottom:1px solid color-mix(in srgb,currentColor 12%,transparent); font:inherit; }
      .nuyoah-project-subnav button { font:inherit; color:inherit; background:transparent; border:1px solid transparent; border-radius:7px; padding:6px 10px; cursor:pointer; }
      .nuyoah-project-subnav button[aria-pressed="true"] { background:color-mix(in srgb,currentColor 7%,transparent); border-color:color-mix(in srgb,currentColor 16%,transparent); }
      .nuyoah-project-subnav button:focus-visible { outline:2px solid currentColor; outline-offset:2px; }
      [data-nuyoah-project-task-view][hidden], [data-nuyoah-task-map-view][hidden], [data-nuyoah-work-items-view][hidden] { display:none!important; }
      #${PROJECT_OVERVIEW_PAGE_ID} .nuyoah-project-heading {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 16px;
        padding-bottom: 18px;
        border-bottom: 1px solid var(--color-token-border, color-mix(in srgb, currentColor 10%, transparent));
      }
      #${PROJECT_OVERVIEW_PAGE_ID} h2 {
        margin: 0;
        font-size: calc(var(--nuyoah-workstation-font-size, 14px) + 6px);
        line-height: 1.25;
      }
      #${PROJECT_OVERVIEW_PAGE_ID} .nuyoah-project-current-task {
        margin: 6px 0 0;
        color: var(--color-token-text-secondary, color-mix(in srgb, currentColor 62%, transparent));
        font-size: calc(var(--nuyoah-workstation-font-size, 14px) - 2px);
        line-height: 1.5;
      }
      #${PROJECT_OVERVIEW_PAGE_ID} .nuyoah-project-binding {
        flex: 0 0 auto;
        padding: 5px 8px;
        border-radius: 8px;
        background: color-mix(in srgb, #2e9b65 12%, transparent);
        color: #268457;
        font-size: calc(var(--nuyoah-workstation-font-size, 14px) - 3px);
        font-weight: 620;
      }
      #${PROJECT_OVERVIEW_PAGE_ID} .nuyoah-project-metrics {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 8px;
        margin: 16px 0 20px;
      }
      #${PROJECT_OVERVIEW_PAGE_ID} .nuyoah-project-metric {
        min-width: 0;
        padding: 12px;
        border: 1px solid var(--color-token-border, color-mix(in srgb, currentColor 10%, transparent));
        border-radius: 10px;
        background: var(--color-token-main-surface-secondary, color-mix(in srgb, currentColor 3%, transparent));
      }
      #${PROJECT_OVERVIEW_PAGE_ID} .nuyoah-project-metric strong,
      #${PROJECT_OVERVIEW_PAGE_ID} .nuyoah-project-metric span { display: block; }
      #${PROJECT_OVERVIEW_PAGE_ID} .nuyoah-project-metric strong { font-size: calc(var(--nuyoah-workstation-font-size, 14px) + 3px); }
      #${PROJECT_OVERVIEW_PAGE_ID} .nuyoah-project-metric span {
        margin-top: 3px;
        overflow: hidden;
        color: var(--color-token-text-secondary, color-mix(in srgb, currentColor 60%, transparent));
        font-size: calc(var(--nuyoah-workstation-font-size, 14px) - 3px);
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      #${PROJECT_OVERVIEW_PAGE_ID} .nuyoah-project-section-title {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin: 0 0 8px;
        font-size: calc(var(--nuyoah-workstation-font-size, 14px) - 2px);
        font-weight: 650;
      }
      #${PROJECT_OVERVIEW_PAGE_ID} .nuyoah-project-task-list { display: grid; gap: 6px; }
      #${PROJECT_OVERVIEW_PAGE_ID} .nuyoah-project-task {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        align-items: center;
        gap: 10px;
        width: 100%;
        min-height: 42px;
        padding: 8px 10px;
        border: 1px solid transparent;
        border-radius: 9px;
        background: transparent;
        color: inherit;
        cursor: pointer;
        text-align: left;
      }
      #${PROJECT_OVERVIEW_PAGE_ID} .nuyoah-project-task:hover,
      #${PROJECT_OVERVIEW_PAGE_ID} .nuyoah-project-task:focus-visible {
        border-color: var(--color-token-border, color-mix(in srgb, currentColor 10%, transparent));
        background: var(--color-token-list-hover-background, color-mix(in srgb, currentColor 6%, transparent));
      }
      #${PROJECT_OVERVIEW_PAGE_ID} .nuyoah-project-task strong {
        overflow: hidden;
        font-size: var(--nuyoah-workstation-font-size, 14px);
        font-weight: 580;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      #${PROJECT_OVERVIEW_PAGE_ID} .nuyoah-project-task span {
        color: var(--color-token-text-secondary, color-mix(in srgb, currentColor 58%, transparent));
        font-size: calc(var(--nuyoah-workstation-font-size, 14px) - 4px);
      }
      .${WORKSTATION_HEADER_CLASS} .nuyoah-workstation-settings { position:relative; }
      .${WORKSTATION_HEADER_CLASS} .nuyoah-workstation-settings > summary { list-style:none; cursor:pointer; padding:7px; border-radius:6px; font-size:13px; }
      .${WORKSTATION_HEADER_CLASS} .nuyoah-workstation-settings > summary::-webkit-details-marker { display:none; }
      .${WORKSTATION_HEADER_CLASS} .nuyoah-workstation-settings:not([open]) > .nuyoah-workstation-font-controls { display:none; }
      .${WORKSTATION_HEADER_CLASS} .nuyoah-workstation-settings[open] > .nuyoah-workstation-font-controls { display:flex; position:absolute; right:0; top:36px; z-index:50; padding:8px; background:var(--color-token-bg-primary, Canvas); color:var(--color-token-foreground, CanvasText); box-shadow:0 4px 16px #0002; }
      .${WORKSTATION_HEADER_CLASS} summary:focus-visible { outline:2px solid var(--text-link,#4285b4); outline-offset:2px; }
      #${PROJECT_OVERVIEW_PAGE_ID} .nuyoah-project-heading { padding-bottom:20px; border-bottom:0; gap:12px; }
      #${PROJECT_OVERVIEW_PAGE_ID} .nuyoah-project-heading > div { min-width:0; }
      #${PROJECT_OVERVIEW_PAGE_ID} h2 { font-size:calc(var(--nuyoah-workstation-font-size,17px) + 3px); font-weight:550; line-height:1.4; overflow-wrap:anywhere; }
      #${PROJECT_OVERVIEW_PAGE_ID} .nuyoah-project-current-task { margin-top:8px; overflow-wrap:anywhere; }
      #${PROJECT_OVERVIEW_PAGE_ID} .nuyoah-project-binding { display:flex; align-items:center; gap:5px; padding:6px 0; background:transparent; color:var(--color-token-text-secondary, GrayText); font-weight:400; }
      #${PROJECT_OVERVIEW_PAGE_ID} .nuyoah-project-binding::before { content:""; width:6px; height:6px; border-radius:50%; background:currentColor; }
      #${PROJECT_OVERVIEW_PAGE_ID} .nuyoah-project-binding[data-bound="true"]::before { background:#39a572; }
      #${PROJECT_OVERVIEW_PAGE_ID} .nuyoah-project-section-title { gap:12px; flex-wrap:wrap; margin:0 0 10px; font-weight:550; }
      #${PROJECT_OVERVIEW_PAGE_ID} .nuyoah-project-counts { font-weight:400; color:var(--color-token-text-secondary, GrayText); }
      #${PROJECT_OVERVIEW_PAGE_ID} .nuyoah-project-task-list { gap:2px; }
      #${PROJECT_OVERVIEW_PAGE_ID} .nuyoah-project-task { min-height:48px; font:inherit; padding:10px; border:0; border-radius:7px; }
      #${PROJECT_OVERVIEW_PAGE_ID} .nuyoah-project-task strong { font-weight:400; line-height:1.5; }
      #${PROJECT_OVERVIEW_PAGE_ID} .nuyoah-project-task[aria-current="true"] { background:color-mix(in srgb,currentColor 5%,transparent); }
      #${PROJECT_OVERVIEW_PAGE_ID} .nuyoah-project-task[aria-current="true"] strong { font-weight:550; }
      #${PROJECT_OVERVIEW_PAGE_ID} .nuyoah-project-task:focus-visible { outline:2px solid var(--text-link,#4285b4); outline-offset:-2px; }
      #${PROJECT_OVERVIEW_PAGE_ID} .nuyoah-project-filters { display:flex; gap:8px; margin-bottom:12px; }
      #${PROJECT_OVERVIEW_PAGE_ID} .nuyoah-project-filters input { flex:1; min-width:0; }
      #${PROJECT_OVERVIEW_PAGE_ID} .nuyoah-project-filters select { max-width:45%; }
      #${PROJECT_OVERVIEW_PAGE_ID} .nuyoah-project-filters input,
      #${PROJECT_OVERVIEW_PAGE_ID} .nuyoah-project-filters select,
      #${PROJECT_OVERVIEW_PAGE_ID} .nuyoah-project-more { font:inherit; font-size:.82em; color:inherit; background:transparent; border:1px solid color-mix(in srgb,currentColor 15%,transparent); border-radius:7px; padding:8px; }
      #${PROJECT_OVERVIEW_PAGE_ID} .nuyoah-project-filters :focus-visible,
      #${PROJECT_OVERVIEW_PAGE_ID} .nuyoah-project-more:focus-visible { outline:2px solid var(--text-link,#4285b4); outline-offset:2px; }
      #${PROJECT_OVERVIEW_PAGE_ID} .nuyoah-project-more { cursor:pointer; display:block; margin:12px auto 0; }
      #${PROJECT_OVERVIEW_PAGE_ID} [hidden] { display:none!important; }
      #${PROJECT_OVERVIEW_PAGE_ID} .nuyoah-project-task-content { min-width:0; }
      #${PROJECT_OVERVIEW_PAGE_ID} .nuyoah-project-task-content strong { display:block; }
      #${PROJECT_OVERVIEW_PAGE_ID} .nuyoah-project-task-content small { display:block; font-size:.7em; color:var(--color-token-text-secondary,GrayText); margin-top:3px; }
      #${PROJECT_OVERVIEW_PAGE_ID} .nuyoah-project-task-status { font-size:.72em; text-align:right; max-width:7em; }
      #${PROJECT_OVERVIEW_PAGE_ID} .nuyoah-project-task[data-status="running"] .nuyoah-project-task-status { color:var(--text-link,#4285b4); }
      #${PROJECT_OVERVIEW_PAGE_ID} .nuyoah-project-feedback,
      #${PROJECT_OVERVIEW_PAGE_ID} .nuyoah-project-remote-note { font-size:.8em; color:var(--color-token-text-secondary,GrayText); }
      #${PROJECT_OVERVIEW_PAGE_ID} .nuyoah-project-feedback:empty { display:none; }
      #${PROJECT_OVERVIEW_PAGE_ID} .nuyoah-project-empty {
        padding: 26px 10px;
        color: var(--color-token-text-secondary, color-mix(in srgb, currentColor 58%, transparent));
        font-size: var(--nuyoah-workstation-font-size, 14px);
        text-align: center;
      }
      #${PROJECT_OVERVIEW_PAGE_ID} {
        --nuyoah-surface:var(--color-token-bg-primary,Canvas);
        --nuyoah-text:var(--color-token-foreground,CanvasText);
        --nuyoah-muted:color-mix(in srgb,var(--nuyoah-text) 64%,var(--nuyoah-surface));
        --nuyoah-canvas-bg:color-mix(in srgb,var(--nuyoah-text) 2.5%,var(--nuyoah-surface));
        --nuyoah-subtle:color-mix(in srgb,var(--nuyoah-text) 5%,var(--nuyoah-surface));
        --nuyoah-border:color-mix(in srgb,var(--nuyoah-text) 11%,var(--nuyoah-surface));
        --nuyoah-accent:var(--color-token-text-link,light-dark(#0868cd,#77b7ff));
        --nuyoah-accent-soft:color-mix(in srgb,var(--nuyoah-accent) 10%,var(--nuyoah-surface));
        container-type:inline-size;container-name:nuyoah-project;
        background:var(--nuyoah-surface);box-shadow:none;font-weight:400;
      }
      .${WORKSTATION_HEADER_CLASS}{background:var(--color-token-main-surface-secondary,color-mix(in srgb,currentColor 4%,Canvas));border-bottom:0;gap:8px;font-weight:400}
      .${WORKSTATION_HEADER_CLASS} .nuyoah-workstation-title{font-size:calc(var(--nuyoah-workstation-font-size,17px) - 2px);font-weight:600}
      .${WORKSTATION_HEADER_CLASS} [data-nuyoah-workstation-panel]{font-weight:400;padding:0 9px}
      .${WORKSTATION_HEADER_CLASS} [data-nuyoah-workstation-panel][aria-selected="true"]{background:var(--color-token-bg-primary,Canvas);box-shadow:0 1px 4px #0001;font-weight:500}
      .${WORKSTATION_HEADER_CLASS} .nuyoah-workstation-task-count{background:transparent;color:var(--color-token-text-secondary,GrayText);font-weight:500;margin-left:3px;min-width:12px;padding:0}
      #${PROJECT_OVERVIEW_PAGE_ID} .nuyoah-project-subnav{gap:24px;padding:0 24px;background:var(--nuyoah-surface);border-color:var(--nuyoah-border)}
      #${PROJECT_OVERVIEW_PAGE_ID} .nuyoah-project-subnav button{font-size:.84em;padding:13px 0 11px;border:0;border-bottom:2px solid transparent;border-radius:0;color:var(--nuyoah-muted);background:transparent;font-weight:400;white-space:nowrap}
      #${PROJECT_OVERVIEW_PAGE_ID} .nuyoah-project-subnav button[aria-pressed="true"]{color:var(--nuyoah-text);border-bottom-color:var(--nuyoah-accent);font-weight:600}
      #${PROJECT_OVERVIEW_PAGE_ID} .nuyoah-project-subnav button:focus-visible{outline:2px solid var(--nuyoah-accent);outline-offset:-3px}
      #${PROJECT_OVERVIEW_PAGE_ID} .nuyoah-project-overview-body{padding:28px 30px;scrollbar-width:thin}
      #${PROJECT_OVERVIEW_PAGE_ID}[data-project-view="map"] .nuyoah-project-overview-body,
      #${PROJECT_OVERVIEW_PAGE_ID}[data-project-view="work-items"] .nuyoah-project-overview-body{padding:0;overflow:hidden}
      #${PROJECT_OVERVIEW_PAGE_ID} :is([data-nuyoah-task-map-view],[data-nuyoah-work-items-view]){height:100%;min-height:0}
      #${PROJECT_OVERVIEW_PAGE_ID} [data-nuyoah-project-task-view]{max-width:810px;margin:0 auto}
      #${PROJECT_OVERVIEW_PAGE_ID} .nuyoah-project-heading{padding:0 0 20px;gap:8px}
      #${PROJECT_OVERVIEW_PAGE_ID} [data-nuyoah-project-name]{color:var(--nuyoah-muted);font-size:.78em;line-height:1.6;overflow-wrap:anywhere;margin:0 0 25px}
      #${PROJECT_OVERVIEW_PAGE_ID} .nuyoah-project-current-label{display:block;color:var(--nuyoah-muted);font-size:.75em;margin:0 0 7px}
      #${PROJECT_OVERVIEW_PAGE_ID} h2.nuyoah-project-current-task{font-size:calc(var(--nuyoah-workstation-font-size,17px) + 6px);line-height:1.45;font-weight:600;color:var(--nuyoah-text);margin:0}
      #${PROJECT_OVERVIEW_PAGE_ID} .nuyoah-project-binding{font-size:.7em;white-space:nowrap}
      #${PROJECT_OVERVIEW_PAGE_ID} .nuyoah-project-binding[data-bound="true"][data-local="true"]{display:none}
      #${PROJECT_OVERVIEW_PAGE_ID} .nuyoah-project-task-directory,
      #${PROJECT_OVERVIEW_PAGE_ID} .nuyoah-project-extra-records{border-bottom:1px solid var(--nuyoah-border);margin:0}
      #${PROJECT_OVERVIEW_PAGE_ID} .nuyoah-project-task-directory>summary,
      #${PROJECT_OVERVIEW_PAGE_ID} .nuyoah-project-extra-records>summary{cursor:pointer;list-style:none;display:flex;gap:10px;align-items:center;padding:15px 0;font-size:.85em;font-weight:500;margin:0}
      #${PROJECT_OVERVIEW_PAGE_ID} .nuyoah-project-task-directory>summary::-webkit-details-marker,
      #${PROJECT_OVERVIEW_PAGE_ID} .nuyoah-project-extra-records>summary::-webkit-details-marker{display:none}
      #${PROJECT_OVERVIEW_PAGE_ID} .nuyoah-project-task-directory>summary::after,
      #${PROJECT_OVERVIEW_PAGE_ID} .nuyoah-project-extra-records>summary::after{content:'›';color:var(--nuyoah-muted);margin-left:auto}
      #${PROJECT_OVERVIEW_PAGE_ID} details[open]>summary::after{transform:rotate(90deg)}
      #${PROJECT_OVERVIEW_PAGE_ID} .nuyoah-project-task-directory>summary:focus-visible,
      #${PROJECT_OVERVIEW_PAGE_ID} .nuyoah-project-extra-records>summary:focus-visible{outline:2px solid var(--nuyoah-accent);outline-offset:2px}
      #${PROJECT_OVERVIEW_PAGE_ID} .nuyoah-project-counts{font-size:.8em;margin-left:auto;color:var(--nuyoah-muted)}
      #${PROJECT_OVERVIEW_PAGE_ID} .nuyoah-project-task-directory>summary::after{margin-left:0}
      #${PROJECT_OVERVIEW_PAGE_ID} .nuyoah-project-filters :is(input,select){background:var(--nuyoah-subtle);border:1px solid transparent;border-radius:8px}
      #${PROJECT_OVERVIEW_PAGE_ID} .nuyoah-project-more{border:0;color:var(--nuyoah-accent)}
      @container nuyoah-project (max-width:500px){#${PROJECT_OVERVIEW_PAGE_ID} .nuyoah-project-overview-body{padding:24px 22px}#${PROJECT_OVERVIEW_PAGE_ID} .nuyoah-project-subnav{gap:22px;padding:0 20px}#${PROJECT_OVERVIEW_PAGE_ID} .nuyoah-project-current-task{font-size:calc(var(--nuyoah-workstation-font-size,17px) + 4px)}}
      #codex-taskboard-page[data-nuyoah-workstation-frame="true"] {
        display: grid;
        grid-template-rows: 50px minmax(0, 1fr);
      }
      #codex-taskboard-page[data-nuyoah-workstation-frame="true"] > #codex-taskboard-frame,
      #codex-taskboard-page[data-nuyoah-workstation-frame="true"] > #codex-taskboard-status {
        grid-row: 2;
        min-height: 0;
      }
      #codex-taskboard-page[data-nuyoah-workstation-frame="true"] > #codex-taskboard-status {
        top: 50px;
      }
      #codex-taskboard-page[data-nuyoah-workstation-frame="true"] > #codex-taskboard-drag-region,
      #codex-taskboard-page[data-nuyoah-workstation-frame="true"] > #codex-taskboard-no-drag-left,
      #codex-taskboard-page[data-nuyoah-workstation-frame="true"] > #codex-taskboard-no-drag-right {
        transform: translateY(50px);
      }
      #${ASSET_CONSOLE_PAGE_ID} {
        position: relative;
        z-index: 1000;
        display: grid;
        grid-template-rows: 50px minmax(0, 1fr);
        flex: 0 0 var(--codex-workspace-panel-width, min(680px, 48vw));
        width: var(--codex-workspace-panel-width, min(680px, 48vw));
        min-width: 420px;
        max-width: min(1000px, calc(100vw - 360px));
        height: 100%;
        overflow: hidden;
        border-left: 1px solid color-mix(in srgb, currentColor 12%, transparent);
        background: var(--color-token-bg-primary, #fff);
        font-size: var(--nuyoah-workstation-font-size, 14px);
        box-shadow: -12px 0 32px color-mix(in srgb, black 8%, transparent);
        pointer-events: auto;
      }
      #${ASSET_CONSOLE_PAGE_ID}[hidden] { display: none !important; }
      #${ASSET_CONSOLE_PAGE_ID} .codex-asset-console-header {
        position: relative;
        z-index: 4;
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 0 8px 0 16px;
        border-bottom: 1px solid color-mix(in srgb, currentColor 12%, transparent);
        pointer-events: auto !important;
        -webkit-app-region: no-drag !important;
      }
      #${ASSET_CONSOLE_PAGE_ID} .codex-asset-console-title { font-size: calc(var(--nuyoah-workstation-font-size, 14px) + 1px); font-weight: 650; }
      #${ASSET_CONSOLE_PAGE_ID} .codex-asset-console-local {
        padding: 3px 8px;
        border-radius: 999px;
        color: #22764a;
        background: color-mix(in srgb, #2fa56b 13%, transparent);
        font-size: calc(var(--nuyoah-workstation-font-size, 14px) - 3px);
      }
      #${ASSET_CONSOLE_PAGE_ID} .codex-asset-console-spacer { flex: 1; }
      #${ASSET_CONSOLE_PAGE_ID} .codex-asset-console-close,
      #${ASSET_CONSOLE_PAGE_ID} .codex-asset-console-retry {
        border: 1px solid color-mix(in srgb, currentColor 14%, transparent);
        border-radius: 9px;
        background: color-mix(in srgb, currentColor 4%, transparent);
        color: inherit;
        cursor: pointer;
      }
      #${ASSET_CONSOLE_PAGE_ID} .codex-asset-console-close {
        position: relative;
        z-index: 5;
        display: grid;
        place-items: center;
        flex: 0 0 40px;
        width: 40px;
        height: 40px;
        min-width: 40px;
        min-height: 40px;
        padding: 0;
        font-size: 20px;
        line-height: 1;
        pointer-events: auto !important;
        touch-action: manipulation;
        -webkit-app-region: no-drag !important;
      }
      #${ASSET_CONSOLE_PAGE_ID} .codex-asset-console-body { position: relative; min-height: 0; }
      #${ASSET_CONSOLE_PAGE_ID} .codex-asset-console-state {
        position: absolute;
        inset: 0;
        display: grid;
        place-content: center;
        justify-items: center;
        gap: 12px;
        color: color-mix(in srgb, currentColor 65%, transparent);
      }
      #${ASSET_CONSOLE_PAGE_ID}[data-state="ready"] .codex-asset-console-state { display: none; }
      #${ASSET_CONSOLE_PAGE_ID}[data-state="loading"] .codex-asset-console-retry { display: none; }
      #${ASSET_CONSOLE_FRAME_ID} { width: 100%; height: 100%; border: 0; background: #fff; }
      #${ASSET_CONSOLE_PAGE_ID}:not([data-state="ready"]) #${ASSET_CONSOLE_FRAME_ID} { visibility: hidden; }
      [${SKILL_NATIVE_SECTION_ATTR}="hidden"] { display: none !important; }
      #${SKILL_ORGANIZER_ID} {
        display: grid;
        position: relative;
        z-index: 30;
        flex: 0 0 var(--codex-workspace-panel-width, min(680px, 48vw));
        width: var(--codex-workspace-panel-width, min(680px, 48vw));
        min-width: 420px;
        max-width: min(1000px, calc(100vw - 360px));
        height: 100%;
        min-height: 0;
        grid-template-rows: auto auto auto auto minmax(0, 1fr);
        gap: 12px;
        box-sizing: border-box;
        margin: 0;
        padding: 16px;
        overflow: hidden;
        border: 0;
        border-left: 1px solid color-mix(in srgb, currentColor 12%, transparent);
        border-radius: 0;
        background: var(--color-token-bg-primary, #fff);
        font-size: var(--nuyoah-workstation-font-size, 14px);
        box-shadow: -12px 0 32px color-mix(in srgb, #24364b 9%, transparent);
      }
      #${SKILL_ORGANIZER_ID}[hidden] { display: none !important; }
      #${SKILL_ORGANIZER_ID}[data-nuyoah-workstation-frame="true"] {
        grid-template-rows: 50px auto auto auto auto auto minmax(0, 1fr);
        padding: 0 16px 16px;
      }
      #${SKILL_ORGANIZER_ID}[data-nuyoah-workstation-frame="true"]:has(.codex-skill-label-notice:not([hidden])) {
        grid-template-rows: 50px auto auto auto auto auto auto minmax(0, 1fr);
      }
      #${SKILL_ORGANIZER_ID}[data-nuyoah-workstation-frame="true"] > .${WORKSTATION_HEADER_CLASS} {
        margin: 0 -16px;
      }
      #${SKILL_ORGANIZER_ID} .codex-skill-organizer-head,
      #${SKILL_ORGANIZER_ID} .codex-skill-result-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
      }
      #${SKILL_ORGANIZER_ID} .codex-skill-head-actions { display: flex; align-items: center; gap: 6px; }
      #${SKILL_ORGANIZER_ID} .codex-skill-refresh,
      #${SKILL_ORGANIZER_ID} .codex-skill-page-menu,
      #${SKILL_ORGANIZER_ID} .codex-skill-more {
        width: 30px; height: 30px; padding: 0; border: 0; border-radius: 8px; background: transparent; cursor: pointer; font-size: 18px;
      }
      #${SKILL_ORGANIZER_ID} .codex-skill-refresh:hover,
      #${SKILL_ORGANIZER_ID} .codex-skill-page-menu:hover,
      #${SKILL_ORGANIZER_ID} .codex-skill-more:hover { background: color-mix(in srgb, currentColor 7%, transparent); }
      #${SKILL_ORGANIZER_ID} .codex-skill-refresh:disabled { cursor: wait; opacity: .55; }
      #${SKILL_ORGANIZER_ID} .codex-skill-label-notice {
        display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 9px 11px; border: 1px solid color-mix(in srgb, #2f80ed 28%, transparent); border-radius: 10px; background: color-mix(in srgb, #2f80ed 7%, transparent); font-size: calc(var(--nuyoah-workstation-font-size, 14px) - 2px);
      }
      #${SKILL_ORGANIZER_ID} .codex-skill-label-notice[hidden] { display: none; }
      #${SKILL_ORGANIZER_ID} .codex-skill-label-notice-actions { display: flex; gap: 6px; flex: 0 0 auto; }
      #${SKILL_ORGANIZER_ID} .codex-skill-label-notice button { padding: 5px 8px; border: 0; border-radius: 7px; background: color-mix(in srgb, currentColor 8%, transparent); cursor: pointer; }
      #${SKILL_ORGANIZER_ID} .codex-skill-label-notice .codex-skill-label-generate { background: #2f80ed; color: #fff; }
      #${SKILL_ORGANIZER_ID} h2 { margin: 0; font-size: calc(var(--nuyoah-workstation-font-size, 14px) + 4px); }
      #${SKILL_ORGANIZER_ID} p { margin: 3px 0 0; color: color-mix(in srgb, currentColor 58%, transparent); font-size: calc(var(--nuyoah-workstation-font-size, 14px) - 2px); }
      #${SKILL_ORGANIZER_ID} .codex-skill-context {
        margin: 0;
        overflow: hidden;
        color: color-mix(in srgb, currentColor 58%, transparent);
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      #${SKILL_ORGANIZER_ID} button { color: inherit; font: inherit; }
      #${SKILL_ORGANIZER_ID} .codex-skill-native-toggle {
        padding: 7px 11px;
        border: 1px solid color-mix(in srgb, currentColor 13%, transparent);
        border-radius: 9px;
        background: transparent;
        cursor: pointer;
      }
      #${SKILL_ORGANIZER_ID} .codex-skill-search {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 0 11px;
        border: 1px solid color-mix(in srgb, currentColor 14%, transparent);
        border-radius: 11px;
      }
      #${SKILL_ORGANIZER_ID} .codex-skill-search input {
        width: 100%;
        height: 38px;
        border: 0;
        outline: 0;
        background: transparent;
        color: inherit;
        font-size: var(--nuyoah-workstation-font-size, 14px);
      }
      #${SKILL_ORGANIZER_ID} .codex-skill-filter-list { display: flex; flex-wrap: wrap; gap: 7px; }
      #${SKILL_ORGANIZER_ID} .codex-skill-filter {
        padding: 6px 10px;
        border: 1px solid color-mix(in srgb, currentColor 12%, transparent);
        border-radius: 999px;
        background: transparent;
        cursor: pointer;
      }
      #${SKILL_ORGANIZER_ID} .codex-skill-filter[aria-pressed="true"] {
        border-color: color-mix(in srgb, #2f80ed 48%, transparent);
        background: color-mix(in srgb, #2f80ed 11%, transparent);
        color: #1767c0;
      }
      #${SKILL_ORGANIZER_ID} .codex-skill-category {
        display: inline-block; margin-top: 6px; padding: 2px 7px; border-radius: 6px;
        background: color-mix(in srgb, currentColor 7%, transparent);
        color: var(--color-token-text-secondary, inherit); font-size: 12px; overflow-wrap: anywhere;
      }
      #${SKILL_ORGANIZER_ID} .codex-skill-filter:focus-visible {
        outline: 2px solid var(--color-token-accent-foreground, #2f80ed); outline-offset: 2px;
      }
      #${SKILL_ORGANIZER_ID} .codex-skill-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        grid-auto-rows: max-content;
        gap: 9px;
        align-content: start;
        overflow: auto;
        padding-right: 2px;
      }
      #${SKILL_ORGANIZER_ID} .codex-skill-row {
        display: grid;
        grid-template-columns: minmax(0, 1fr) 30px 30px auto;
        align-items: center;
        gap: 8px;
        min-height: 96px;
        padding: 10px 11px;
        border: 1px solid color-mix(in srgb, currentColor 11%, transparent);
        border-radius: 12px;
        background: color-mix(in srgb, currentColor 2.5%, transparent);
        cursor: pointer;
      }
      #${SKILL_ORGANIZER_ID} .codex-skill-row:hover { border-color: color-mix(in srgb, #2f80ed 35%, transparent); }
      #${SKILL_ORGANIZER_ID} .codex-skill-name {
        display: block;
        min-width: 0;
        overflow: hidden;
        font-size: var(--nuyoah-workstation-font-size, 14px);
        font-weight: 650;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      #${SKILL_ORGANIZER_ID} .codex-skill-description {
        display: -webkit-box;
        min-width: 0;
        min-height: 32px;
        max-height: 40px;
        overflow: hidden;
        margin-top: 3px;
        color: color-mix(in srgb, currentColor 56%, transparent);
        font-size: calc(var(--nuyoah-workstation-font-size, 14px) - 2px);
        line-height: calc(var(--nuyoah-workstation-font-size, 14px) + 2px);
        white-space: normal;
        overflow-wrap: anywhere;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 2;
      }
      #${SKILL_ORGANIZER_ID} .codex-skill-callable {
        display: block;
        min-width: 0;
        overflow: hidden;
        margin-top: 2px;
        color: color-mix(in srgb, currentColor 43%, transparent);
        font-size: calc(var(--nuyoah-workstation-font-size, 14px) - 3px);
        line-height: 1.35;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      #${SKILL_ORGANIZER_ID} .codex-skill-favorite {
        width: 30px; height: 30px; border: 0; border-radius: 8px; background: transparent; cursor: pointer; font-size: 18px;
      }
      #${SKILL_ORGANIZER_ID} .codex-skill-row[data-label-status="pending"] .codex-skill-name,
      #${SKILL_ORGANIZER_ID} .codex-skill-row[data-label-status="unverified"] .codex-skill-name { font-style: italic; }
      #${SKILL_ORGANIZER_ID} .codex-skill-favorite[aria-pressed="true"] { color: #d89400; background: #fff5d5; }
      #${SKILL_ORGANIZER_ID} .codex-skill-empty { grid-column: 1 / -1; padding: 30px; text-align: center; color: color-mix(in srgb, currentColor 58%, transparent); }
      #${SKILL_ORGANIZER_ID} .codex-skill-close {
        width: 32px; height: 32px; border: 0; border-radius: 9px; background: color-mix(in srgb, currentColor 6%, transparent); cursor: pointer; font-size: 20px;
      }
      #${SKILL_ORGANIZER_ID} .codex-skill-use {
        min-width: 76px; height: 30px; padding: 0 10px; border: 0; border-radius: 8px; background: color-mix(in srgb, #2f80ed 10%, transparent); color: #1767c0; cursor: pointer; font-size: calc(var(--nuyoah-workstation-font-size, 14px) - 2px); font-weight: 650; white-space: nowrap;
      }
      .codex-skill-context-menu {
        position: fixed; z-index: 10000; min-width: 150px; padding: 6px; border: 1px solid color-mix(in srgb, currentColor 14%, transparent); border-radius: 10px; background: var(--color-token-bg-primary, Canvas); box-shadow: 0 14px 34px color-mix(in srgb, black 20%, transparent); font-size: var(--nuyoah-workstation-font-size, 14px);
      }
      .codex-skill-context-menu button { width: 100%; padding: 8px 10px; border: 0; border-radius: 7px; background: transparent; color: inherit; text-align: left; cursor: pointer; }
      .codex-skill-context-menu button:hover { background: color-mix(in srgb, currentColor 7%, transparent); }
      [${WORKSPACE_PANEL_ATTRIBUTE}]::before {
        content: ""; position: absolute; z-index: 5; top: 0; bottom: 0; left: -4px; width: 8px; cursor: ew-resize;
      }
      [data-nuyoah-native-panel-adaptive="true"] { max-width: var(--nuyoah-native-panel-width) !important; }
      [data-nuyoah-native-panel-content-adaptive="true"], [data-nuyoah-chat-frame-adaptive="true"] { width: 100% !important; min-width: 0 !important; max-width: 100% !important; }
      /* All modules share the same host-relative geometry, including before first measurement. */
      :is(#${PROJECT_OVERVIEW_PAGE_ID}, #codex-taskboard-page,
          #${ASSET_CONSOLE_PAGE_ID}, #${SKILL_ORGANIZER_ID}, #${CUSTOM_SHORTCUT_PAGE_ID}) {
        position: relative !important;
        inset: auto !important;
        box-sizing: border-box;
        container-type: inline-size;
        width: var(--nuyoah-panel-width, 0px) !important;
        min-width: 0 !important;
        max-width: 100% !important;
        height: calc(100% - var(--nuyoah-panel-top, 50px)) !important;
        margin-top: var(--nuyoah-panel-top, 50px) !important;
        flex: 0 0 var(--nuyoah-panel-width, 0px) !important;
      }
      :is(#${PROJECT_OVERVIEW_PAGE_ID}, #codex-taskboard-page,
          #${ASSET_CONSOLE_PAGE_ID}, #${SKILL_ORGANIZER_ID}, #${CUSTOM_SHORTCUT_PAGE_ID})[data-nuyoah-panel-layout="docked"] {
        position: relative !important;
        inset: auto !important;
        margin-top: var(--nuyoah-panel-top, 50px) !important;
      }
      @container (max-width: 620px) {
        .${WORKSTATION_HEADER_CLASS} {
          grid-template-columns: minmax(0, 1fr) auto;
          gap: 6px;
          padding-left: 8px;
        }
        .${WORKSTATION_HEADER_CLASS} .nuyoah-workstation-title { display: none; }
        .${WORKSTATION_HEADER_CLASS} .nuyoah-workstation-tabs { justify-content: start; overflow-x: auto; }
        .${WORKSTATION_HEADER_CLASS} [data-nuyoah-workstation-panel] { flex-shrink: 0; padding: 0 7px; }
        .codex-skill-grid { grid-template-columns: minmax(0, 1fr) !important; }
      }
      @container (max-width: 460px) {
        .${WORKSTATION_HEADER_CLASS} .nuyoah-workstation-font-controls { display: none; }
      }
      .${DETAILS_CLASS} .codex-conversation-preview-text {
        display: -webkit-box;
        min-width: 0;
        overflow: hidden;
        color: var(--color-token-foreground, inherit);
        font-size: 13px;
        line-height: 18px;
        white-space: normal;
        overflow-wrap: anywhere;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 3;
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function rowKey(row) {
    return `${row.getAttribute("data-app-action-sidebar-thread-id") || ""}\n${row.getAttribute("data-app-action-sidebar-thread-title") || ""}`;
  }

  function formatCatalogCommunication(value) {
    const date = new Date(value || "");
    if (!Number.isFinite(date.getTime())) return "时间待更新";
    const now = new Date();
    const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const startDate = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
    const time = date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
    if (startDate === startToday) return `今天 ${time}`;
    if (startDate === startToday - 86_400_000) return `昨天 ${time}`;
    return `${date.getMonth() + 1}月${date.getDate()}日`;
  }

  function catalogPreviewForRow(row) {
    const threadId = normalizedThreadId(row.getAttribute("data-app-action-sidebar-thread-id"));
    const entry = searchCatalogByThread.get(threadId)
      || recentCatalogByThread.get(threadId)
      || interruptedCatalogByThread.get(threadId);
    if (!entry) return null;
    const title = entry.title || row.getAttribute("data-app-action-sidebar-thread-title") || "未命名对话";
    const subject = title
      .replace(/^(创建|构建|优化|更新|安装|调研|查找|梳理|整理|生成|制作)+/u, "")
      .replace(/skills?/ig, "")
      .trim()
      .slice(0, 8) || "任务主题";
    return {
      catalogOnly: true,
      threadId: entry.threadId,
      updatedAt: entry.updatedAt,
      summary: `正在读取“${title}”的核心总结…`,
      recentInput: "",
      recentOutput: "",
      lastCommunication: formatCatalogCommunication(entry.updatedAt),
      tags: [subject, entry.projectName || "未分类项目", entry.interruptionLabel || "最近请求"],
    };
  }

  function previewForRow(row) {
    const preview = previews.get(rowKey(row)) || catalogPreviewForRow(row);
    if (!preview || !row.hasAttribute("data-codex-sidebar-interrupted-row")) return preview;
    const entry = interruptedCatalogByThread.get(normalizedThreadId(row.getAttribute("data-app-action-sidebar-thread-id")));
    if (!entry?.interruptionLabel) return preview;
    const tags = Array.isArray(preview.tags) ? preview.tags.slice(0, 2) : [];
    return { ...preview, tags: [...tags, entry.interruptionLabel].slice(-3) };
  }

  function visibleRows() {
    return Array.from(document.querySelectorAll(ROW_SELECTOR)).filter((row) => {
      if (!row.isConnected) return false;
      const sectionPanel = row.closest("[data-codex-sidebar-section-panel]");
      if (sectionPanel?.hidden) return false;
      if (row.closest('[data-codex-sidebar-recent-native-hidden="true"]')) return false;
      if (row.hasAttribute("data-codex-sidebar-all-project-row")) {
        return Boolean(row.closest(
          `#${ALL_PROJECTS_PANEL_ID}, [data-codex-sidebar-virtual-folder-panel]`,
        ));
      }
      const folderPanel = row.closest("[data-codex-sidebar-folder-panel]");
      return !folderPanel?.hidden;
    });
  }

  const STATUS_OPTIONS = [
    { value: "urgent-important", label: "紧急且重要", color: "#ef4755" },
    { value: "urgent-or-important", label: "紧急或重要", color: "#f28a16" },
    { value: "not-urgent", label: "不紧急", color: "#2fa56b" },
    { value: "clear", label: "清除标注", color: "#b5b7ba" },
  ];
  const UNMARKED_STATUS = { value: "unmarked", label: "未标记", color: "#b5b7ba" };

  function threadStatusKey(row) {
    return row.getAttribute("data-app-action-sidebar-thread-id") || rowKey(row);
  }

  function threadStatus(key) {
    return STATUS_OPTIONS.some((option) => option.value !== "clear" && option.value === threadStatuses[key])
      ? threadStatuses[key]
      : UNMARKED_STATUS.value;
  }

  function statusOption(value) {
    return STATUS_OPTIONS.find((option) => option.value === value) || UNMARKED_STATUS;
  }

  function persistThreadStatuses() {
    try { localStorage.setItem(THREAD_STATUS_STORAGE_KEY, JSON.stringify(threadStatuses)); } catch {}
  }

  function updateStatusButton(button, value) {
    const option = statusOption(value);
    button.dataset.status = option.value;
    button.setAttribute("aria-label", `状态：${option.label}`);
    button.title = option.label;
  }

  function closeStatusMenu({ focus = false } = {}) {
    document.getElementById(STATUS_MENU_ID)?.remove();
    if (openStatusButton) {
      openStatusButton.setAttribute("aria-expanded", "false");
      if (focus && openStatusButton.isConnected) openStatusButton.focus();
    }
    openStatusButton = null;
  }

  function positionStatusMenu(menu, button) {
    const rect = button.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    const gap = 6;
    const left = Math.min(innerWidth - menuRect.width - 8, Math.max(8, rect.right - menuRect.width));
    const below = rect.bottom + gap;
    const top = below + menuRect.height <= innerHeight - 8
      ? below
      : Math.max(8, rect.top - menuRect.height - gap);
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
  }

  function chooseThreadStatus(key, value) {
    if (value === "clear") delete threadStatuses[key];
    else threadStatuses[key] = statusOption(value).value;
    persistThreadStatuses();
    document.querySelectorAll(`.${STATUS_BUTTON_CLASS}`).forEach((button) => {
      if (button.dataset.threadStatusKey === key) updateStatusButton(button, threadStatus(key));
    });
    closeStatusMenu();
  }

  function handleStatusMenuKeydown(event) {
    const items = Array.from(event.currentTarget.querySelectorAll("[data-codex-conversation-status-option]"));
    const index = items.indexOf(document.activeElement);
    let next = null;
    if (event.key === "ArrowDown") next = items[(index + 1 + items.length) % items.length];
    else if (event.key === "ArrowUp") next = items[(index - 1 + items.length) % items.length];
    else if (event.key === "Home") next = items[0];
    else if (event.key === "End") next = items.at(-1);
    else if (event.key === "Escape") {
      event.preventDefault();
      closeStatusMenu({ focus: true });
      return;
    }
    if (!next) return;
    event.preventDefault();
    next.focus();
  }

  function openThreadStatusMenu(row, button) {
    if (openStatusButton === button && document.getElementById(STATUS_MENU_ID)) {
      closeStatusMenu({ focus: true });
      return;
    }
    closeStatusMenu();
    const key = threadStatusKey(row);
    const current = threadStatus(key);
    const menu = document.createElement("div");
    menu.id = STATUS_MENU_ID;
    menu.dataset.codexConversationStatusMenu = "true";
    menu.setAttribute("role", "menu");
    menu.setAttribute("aria-label", "设置项目状态");
    menu.onkeydown = handleStatusMenuKeydown;
    for (const option of STATUS_OPTIONS) {
      const item = document.createElement("button");
      item.type = "button";
      item.dataset.codexConversationStatusOption = option.value;
      item.setAttribute("role", option.value === "clear" ? "menuitem" : "menuitemradio");
      if (option.value !== "clear") item.setAttribute("aria-checked", String(option.value === current));
      item.style.setProperty("--codex-status-color", option.color);
      const dot = document.createElement("span");
      dot.className = "codex-conversation-status-option-dot";
      dot.setAttribute("aria-hidden", "true");
      const label = document.createElement("span");
      label.textContent = option.label;
      const check = document.createElement("span");
      check.className = "codex-conversation-status-option-check";
      check.setAttribute("aria-hidden", "true");
      if (option.value === current && option.value !== "clear") {
        check.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="m3.5 8.2 2.8 2.8 6.2-6.4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      }
      item.append(dot, label, check);
      item.onclick = (event) => {
        event.preventDefault();
        event.stopPropagation();
        chooseThreadStatus(key, option.value);
      };
      menu.appendChild(item);
    }
    document.body.appendChild(menu);
    openStatusButton = button;
    button.setAttribute("aria-expanded", "true");
    positionStatusMenu(menu, button);
    requestAnimationFrame(() => (menu.querySelector('[aria-checked="true"]') || menu.querySelector("button"))?.focus());
  }

  function ensureCardStatusButton(row) {
    let button = Array.from(row.children).find((node) => node.classList?.contains(STATUS_BUTTON_CLASS));
    if (!button) {
      button = document.createElement("button");
      button.type = "button";
      button.className = STATUS_BUTTON_CLASS;
      button.dataset.codexConversationStatusButton = "true";
      button.setAttribute("aria-haspopup", "menu");
      button.setAttribute("aria-expanded", "false");
      button.onclick = (event) => {
        event.preventDefault();
        event.stopPropagation();
        openThreadStatusMenu(row, button);
      };
      row.appendChild(button);
    }
    const key = threadStatusKey(row);
    button.dataset.threadStatusKey = key;
    updateStatusButton(button, threadStatus(key));
  }

  function handleStatusDocumentPointerDown(event) {
    if (skillContextMenu
      && !skillContextMenu.contains(event.target)
      && !event.target?.closest?.(".codex-skill-more, .codex-skill-page-menu")) {
      closeSkillContextMenu();
    }
    const menu = document.getElementById(STATUS_MENU_ID);
    if (!menu || menu.contains(event.target) || openStatusButton?.contains(event.target)) return;
    closeStatusMenu();
  }

  function applySummary(row, preview) {
    const titleHost = row.querySelector("[data-thread-title-trigger=\"true\"]");
    if (!titleHost) return;
    row.setAttribute("data-codex-conversation-preview-enhanced", "true");
    const threadId = normalizedThreadId(row.getAttribute("data-app-action-sidebar-thread-id"));
    if (activeProjectThreadIds.has(threadId)) row.setAttribute("data-codex-project-running", "true");
    else row.removeAttribute("data-codex-project-running");
    if (preview && !preview.catalogOnly && preview.updatedAt) {
      row.setAttribute("data-codex-conversation-preview-loaded", "true");
    } else {
      row.removeAttribute("data-codex-conversation-preview-loaded");
    }
    const cardItem = row.closest('[role="listitem"]');
    cardItem?.setAttribute("data-codex-conversation-card-item", "true");
    cardItem?.parentElement?.setAttribute("data-codex-conversation-card-grid", "true");
    titleHost.setAttribute("data-codex-conversation-preview-title", "true");
    let summary = titleHost.querySelector(`.${SUMMARY_CLASS}`);
    if (!summary) {
      summary = document.createElement("div");
      summary.className = SUMMARY_CLASS;
      titleHost.appendChild(summary);
    }
    const value = preview?.summary || "正在读取核心总结…";
    if (summary.textContent !== value) summary.textContent = value;
    summary.title = value;
    applyCardDetails(row, preview);
    ensureCardStatusButton(row);
  }

  function applyCardDetails(row, preview) {
    let card = Array.from(row.children).find((node) => node.classList?.contains(CARD_CONTENT_CLASS));
    if (!card) {
      card = document.createElement("div");
      card.className = CARD_CONTENT_CLASS;
      card.setAttribute("aria-hidden", "true");
      const title = document.createElement("div");
      title.className = CARD_TITLE_CLASS;
      const time = document.createElement("div");
      time.className = TIME_CLASS;
      const summary = document.createElement("div");
      summary.className = CARD_SUMMARY_CLASS;
      const tags = document.createElement("div");
      tags.className = TAGS_CLASS;
      card.append(title, time, summary, tags);
      row.appendChild(card);
    }

    const title = card.querySelector(`.${CARD_TITLE_CLASS}`);
    const time = card.querySelector(`.${TIME_CLASS}`);
    const summary = card.querySelector(`.${CARD_SUMMARY_CLASS}`);
    const tags = card.querySelector(`.${TAGS_CLASS}`);
    const titleValue = row.getAttribute("data-app-action-sidebar-thread-title") || "未命名对话";
    const summaryValue = preview?.summary || "正在提炼本次对话的核心内容…";
    title.textContent = titleValue;
    title.title = titleValue;
    time.textContent = preview?.lastCommunication || "正在读取时间";
    summary.textContent = summaryValue;
    summary.title = summaryValue;

    const subjectFallback = titleValue
      .replace(/^(创建|构建|优化|更新|安装|调研|查找|梳理|整理|生成|制作)+/u, "")
      .replace(/skills?/ig, "")
      .trim()
      .slice(0, 8) || "任务主题";
    const values = Array.isArray(preview?.tags) && preview.tags.length
      ? preview.tags.slice(0, 3)
      : [subjectFallback, "内容提炼中", "结果更新中"];
    while (values.length < 3) values.push(["任务主题", "内容提炼中", "结果更新中"][values.length]);
    const signature = values.join("\n");
    if (tags.dataset.values !== signature) {
      tags.dataset.values = signature;
      tags.replaceChildren(...values.map((value) => {
        const tag = document.createElement("span");
        tag.textContent = value;
        tag.title = value;
        return tag;
      }));
    }
  }

  function switchIcon(mode) {
    if (mode === "card") {
      return `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1" stroke="currentColor" stroke-width="1.15"/><rect x="9" y="2.5" width="4.5" height="4.5" rx="1" stroke="currentColor" stroke-width="1.15"/><rect x="2.5" y="9" width="4.5" height="4.5" rx="1" stroke="currentColor" stroke-width="1.15"/><rect x="9" y="9" width="4.5" height="4.5" rx="1" stroke="currentColor" stroke-width="1.15"/></svg>`;
    }
    return `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3 4h10M3 8h10M3 12h10" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/></svg>`;
  }

  function updateViewState() {
    if (sidebarMode !== "enhanced") return;
    document.documentElement.setAttribute("data-codex-conversation-view", viewMode);
    const button = document.getElementById(TOGGLE_ID);
    if (!button) return;
    const isCard = viewMode === "card";
    const label = isCard
      ? "卡片视图已开启，切换为列表视图"
      : "卡片视图已关闭，切换为卡片视图";
    button.setAttribute("aria-checked", String(isCard));
    button.setAttribute("aria-label", label);
    button.title = label;
    if (button.dataset.mode !== viewMode || !button.querySelector(`.${SWITCH_THUMB_CLASS}`)) {
      button.dataset.mode = viewMode;
      button.innerHTML = `<span class="${SWITCH_THUMB_CLASS}" aria-hidden="true">${switchIcon(viewMode)}</span>`;
    }
  }

  function handleViewToggle(event) {
    event.preventDefault();
    event.stopPropagation();
    viewMode = viewMode === "card" ? "list" : "card";
    try { localStorage.setItem(VIEW_STORAGE_KEY, viewMode); } catch {}
    layoutAnchored = false;
    updateViewState();
    scheduleSync();
  }

  function handleViewTogglePointerDown(event) {
    if (event.button !== 0) return;
    handleViewToggle(event);
  }

  function handleViewToggleClick(event) {
    if (event.detail > 0) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    handleViewToggle(event);
  }

  function shortcutItemKey(item) {
    if (item?.kind === "enhancement") return `enhancement:${item.id}`;
    return item?.custom ? `custom:${item.id}` : `native:${item?.name || ""}`;
  }

  function validShortcutUrl(value) {
    try {
      const url = new URL(String(value || "").trim());
      if (url.protocol !== "https:" && url.protocol !== "http:") return null;
      return url.href;
    } catch {
      return null;
    }
  }

  function normalizedCustomShortcuts() {
    const seen = new Set();
    return shortcutSettings.custom.flatMap((raw) => {
      const id = typeof raw?.id === "string" && raw.id ? raw.id : "";
      const name = typeof raw?.name === "string" ? raw.name.trim().slice(0, 24) : "";
      const url = validShortcutUrl(raw?.url);
      if (!id || !name || !url || seen.has(id)) return [];
      seen.add(id);
      return [{
        id,
        name,
        url,
        icon: Object.hasOwn(SHORTCUT_ICON_PRESETS, raw.icon) ? raw.icon : "link",
        openMode: raw.openMode === "browser" ? "browser" : "internal",
        custom: true,
      }];
    });
  }

  function persistShortcutSettings() {
    shortcutSettings = {
      schemaVersion: 4,
      hidden: Array.from(new Set(shortcutSettings.hidden.filter((value) => typeof value === "string"))),
      custom: normalizedCustomShortcuts(),
    };
    try { localStorage.setItem(SHORTCUT_SETTINGS_STORAGE_KEY, JSON.stringify(shortcutSettings)); } catch {}
  }

  function presetShortcutSvg(icon) {
    const paths = SHORTCUT_ICON_PRESETS[icon] || SHORTCUT_ICON_PRESETS.link;
    return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
  }

  function settingsShortcutSvg() {
    return '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 8.4a3.6 3.6 0 1 0 0 7.2 3.6 3.6 0 0 0 0-7.2Z" stroke="currentColor" stroke-width="1.7"/><path d="m19 13.2 1.5 1.2-1.7 2.9-1.8-.7a7.6 7.6 0 0 1-2.1 1.2l-.3 1.9h-3.4l-.3-1.9a7.6 7.6 0 0 1-2.1-1.2l-1.8.7-1.7-2.9 1.5-1.2a7.5 7.5 0 0 1 0-2.4L5.3 9.6 7 6.7l1.8.7a7.6 7.6 0 0 1 2.1-1.2l.3-1.9h3.4l.3 1.9A7.6 7.6 0 0 1 17 7.4l1.8-.7 1.7 2.9-1.5 1.2a7.5 7.5 0 0 1 0 2.4Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>';
  }

  function openCustomShortcutInBrowser(item) {
    const url = validShortcutUrl(item?.url);
    if (!url) return false;
    const link = document.createElement("a");
    link.href = url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.hidden = true;
    document.body.appendChild(link);
    link.click();
    link.remove();
    return true;
  }

  function restoreCustomShortcutNativeContent() {
    document.querySelectorAll(`[${CUSTOM_SHORTCUT_HIDDEN_ATTRIBUTE}="true"]`)
      .forEach((node) => node.removeAttribute(CUSTOM_SHORTCUT_HIDDEN_ATTRIBUTE));
    document.querySelectorAll(`[${CUSTOM_SHORTCUT_HOST_ATTRIBUTE}="true"]`)
      .forEach((node) => node.removeAttribute(CUSTOM_SHORTCUT_HOST_ATTRIBUTE));
  }

  // Widths here are host CSS pixels, not screen pixels (Codex can apply CSS zoom).
  function workspacePanelGeometry(availableWidth, preferredWidth, reservedWidth = 0, nativePreferredWidth = 0, priority = "balanced") {
    const available = Math.max(0, availableWidth - Math.max(0, reservedWidth));
    const preferred = Number.isFinite(preferredWidth) && preferredWidth > 0 ? Math.max(420, preferredWidth) : 680;
    const native = Number.isFinite(nativePreferredWidth) ? Math.max(0, nativePreferredWidth) : 0;
    const nativeMinimum = Math.min(420, native);
    const collapsed = available < 560 + 420 + nativeMinimum;
    const budget = available - 560;
    let width = collapsed ? 0 : Math.min(preferred, budget - nativeMinimum);
    let nativeWidth = native;
    if (native && !collapsed) {
      const requested = priority === "workstation" ? budget - width
        : priority === "native" ? native : budget * native / (native + preferred);
      nativeWidth = Math.max(nativeMinimum, Math.min(native, budget - 420, requested));
      width = Math.min(preferred, budget - nativeWidth);
    }
    const geometry = { mode: collapsed ? "collapsed" : "docked", width };
    if (native) geometry.nativeWidth = nativeWidth;
    return geometry;
  }

  const workstationPanelSelector = `#${PROJECT_OVERVIEW_PAGE_ID}, #codex-taskboard-page, #${ASSET_CONSOLE_PAGE_ID}, #${SKILL_ORGANIZER_ID}, #${CUSTOM_SHORTCUT_PAGE_ID}`;
  let workstationLayoutFrame = null;
  let workstationResizeObserver = null;
  let workstationLayoutObserver = null;
  const workstationObservedElements = new Set();
  const nativePanelLayouts = new WeakMap();

  function nativePanelReservation(host, scale, adaptivePanel = null) {
    return [...host.children].reduce((width, sibling) => {
      if (sibling === adaptivePanel || sibling.matches(workstationPanelSelector) || !sibling.getClientRects().length) return width;
      const style = getComputedStyle(sibling);
      if (Number(style.flexGrow) > 0 || ['absolute', 'fixed'].includes(style.position)) return width;
      return width + sibling.getBoundingClientRect().width / scale
        + (parseFloat(style.marginLeft) || 0) + (parseFloat(style.marginRight) || 0);
    }, 0);
  }

  // The modern native pane retains its own width preference in inline styles.
  // Temporary CSS limits let it share space without writing that host preference.
  function adaptiveNativePanel(host) {
    const viewport = host.querySelector(":scope > [data-app-shell-main-content-layout]");
    if (viewport?.getAttribute("data-app-shell-right-panel-full-width") === "true") return null;
    const panes = [...host.children].filter(node => node.tagName === "ASIDE"
      && /^\d+(?:\.\d+)?px$/.test(node.style.width) && parseFloat(node.style.width) > 0
      && node.getClientRects().length && !node.closest('[aria-hidden="true"]')
      && getComputedStyle(node).visibility !== "hidden");
    return panes.length === 1 ? panes[0] : null;
  }

  function nativePanelPreference(pane) {
    if (!pane) return null;
    const rawWidth = parseFloat(pane.style.width);
    let state = nativePanelLayouts.get(pane);
    if (!state) {
      state = { rawWidth, preferredWidth: rawWidth, priority: "balanced", effectiveWidth: rawWidth };
      nativePanelLayouts.set(pane, state);
    } else if (rawWidth !== state.rawWidth) {
      // Native drags use the saved width as their starting point. Apply their
      // delta to the constrained size so dragging still follows the pointer.
      state.preferredWidth = Math.max(Math.min(420, rawWidth), state.effectiveWidth + rawWidth - state.rawWidth);
      state.rawWidth = rawWidth;
      state.priority = "native";
    }
    return state;
  }

  function constrainNativePanel(pane, width, keep) {
    const setAttribute = (node, name) => { if (node.getAttribute(name) !== "true") node.setAttribute(name, "true"); keep.add(node); };
    setAttribute(pane, "data-nuyoah-native-panel-adaptive");
    nativePanelLayouts.get(pane).effectiveWidth = width;
    const value = `${width}px`;
    if (pane.style.getPropertyValue("--nuyoah-native-panel-width") !== value) pane.style.setProperty("--nuyoah-native-panel-width", value);
    // Native pane content has an explicit minimum width to animate tab changes.
    // Restrict only those frame nodes, leaving editor/browser content untouched.
    for (const node of pane.querySelectorAll("[style]")) {
      if (node.style.width === pane.style.width && parseFloat(node.style.minWidth) > 0)
        setAttribute(node, "data-nuyoah-native-panel-content-adaptive");
    }
  }

  function restoreNativePanelConstraints(keep = new Set()) {
    for (const node of document.querySelectorAll("[data-nuyoah-native-panel-adaptive], [data-nuyoah-native-panel-content-adaptive], [data-nuyoah-chat-frame-adaptive]")) {
      if (keep.has(node)) continue;
      nativePanelLayouts.delete(node);
      node.removeAttribute("data-nuyoah-native-panel-adaptive");
      node.removeAttribute("data-nuyoah-native-panel-content-adaptive");
      node.removeAttribute("data-nuyoah-chat-frame-adaptive");
      node.style.removeProperty("--nuyoah-native-panel-width");
    }
  }

  function scheduleWorkstationLayout() {
    if (destroyed || workstationLayoutFrame !== null) return;
    workstationLayoutFrame = requestAnimationFrame(() => {
      workstationLayoutFrame = null;
      syncWorkstationLayout();
    });
  }

  function syncWorkstationLayout() {
    if (destroyed || workstationDrag) return;
    const panels = [...document.querySelectorAll(workstationPanelSelector)];
    const headers = [...document.querySelectorAll("header")].filter((header) => {
      const rect = header.getBoundingClientRect();
      return !header.closest(workstationPanelSelector) && getComputedStyle(header).position === "fixed"
        && rect.top <= 1 && rect.bottom > 0 && rect.height < 160;
    });
    const hosts = panels.map(panel => panel.parentElement).filter(Boolean);
    const observed = new Set([...hosts, ...hosts.flatMap(host => [...host.children].filter(child => !child.matches(workstationPanelSelector))), ...headers]);
    for (const element of workstationObservedElements) {
      if (!observed.has(element)) { workstationResizeObserver?.unobserve(element); workstationObservedElements.delete(element); }
    }
    for (const element of observed) {
      if (!workstationObservedElements.has(element)) { workstationResizeObserver?.observe(element); workstationObservedElements.add(element); }
    }
    const adapted = new Set();
    for (const panel of panels) {
      if (panel.hidden || !panel.parentElement || panel.closest('[aria-hidden="true"]')) continue;
      const host = panel.parentElement;
      const rect = host.getBoundingClientRect();
      if (!host.clientWidth || !rect.width) continue;
      const scale = rect.width / host.offsetWidth || 1;
      const available = Math.min(host.clientWidth, Math.max(0, (innerWidth - rect.left) / scale));
      const preferred = parseFloat(panel.style.getPropertyValue(panel.id === "codex-taskboard-page"
        ? "--codex-taskboard-panel-width" : "--codex-workspace-panel-width"));
      const nativePane = adaptiveNativePanel(host);
      if (nativePane && panel.nextElementSibling !== nativePane) {
        const focused = panel.contains(document.activeElement) ? document.activeElement : null;
        host.insertBefore(panel, nativePane);
        focused?.focus({ preventScroll: true });
      }
      const nativeState = nativePanelPreference(nativePane);
      const nativeFullWidth = host.querySelector(':scope > [data-app-shell-right-panel-full-width="true"]');
      const geometry = nativeFullWidth ? { mode: "collapsed", width: 0 }
        : workspacePanelGeometry(available, preferred, nativePanelReservation(host, scale, nativePane), nativeState?.preferredWidth || 0, nativeState?.priority);
      if (geometry.mode === "collapsed") {
        const kind = panel.querySelector("[data-nuyoah-workstation-header]")?.dataset.nuyoahWorkstationHeader;
        if (kind) {
          closeWorkstationPanel(kind, false);
          if (nativeFullWidth) workstationResumePanel = kind;
        }
        else closeCustomShortcutPanel(false);
        continue;
      }
      if (nativePane) constrainNativePanel(nativePane, geometry.nativeWidth, adapted);
      const viewport = host.querySelector(":scope > [data-app-shell-main-content-layout]");
      if (viewport) {
        const frames = [...viewport.children].filter(node => node.tagName === "DIV"
          && /^\d+(?:\.\d+)?px$/.test(node.style.width)
          && node.getBoundingClientRect().height >= viewport.getBoundingClientRect().height * 0.7);
        if (frames.length === 1) {
          if (frames[0].getAttribute("data-nuyoah-chat-frame-adaptive") !== "true") frames[0].setAttribute("data-nuyoah-chat-frame-adaptive", "true");
          adapted.add(frames[0]);
        }
      }
      const bottom = Math.max(rect.top, ...headers.filter((header) => {
        const r = header.getBoundingClientRect();
        return r.right > rect.left && r.left < rect.right;
      }).map((header) => header.getBoundingClientRect().bottom));
      const top = Math.max(0, (bottom - rect.top) / scale);
      const set = (key, value) => { if (panel.style.getPropertyValue(key) !== value) panel.style.setProperty(key, value); };
      set("--nuyoah-panel-width", `${geometry.width}px`);
      set("--nuyoah-panel-top", `${top}px`);
      if (panel.dataset.nuyoahPanelLayout !== geometry.mode) panel.dataset.nuyoahPanelLayout = geometry.mode;
    }
    restoreNativePanelConstraints(adapted);
  }

  function savedWorkspacePanelWidth() {
    let value = 680;
    try { value = Number(localStorage.getItem(WORKSPACE_PANEL_WIDTH_KEY)) || value; } catch {}
    return Number.isFinite(value) ? Math.max(420, value) : 680;
  }

  function initializeWorkspacePanel(page, panelName) {
    page.setAttribute(WORKSPACE_PANEL_ATTRIBUTE, panelName);
    page.style.setProperty("--codex-workspace-panel-width", `${savedWorkspacePanelWidth()}px`);
    return page;
  }

  let workstationDrag = null;

  function handleWorkstationResizeStart(event) {
    const panel = event.target.closest?.(workstationPanelSelector);
    if (!panel || event.button !== 0 || panel.hidden) return;
    const rect = panel.getBoundingClientRect();
    if (Math.abs(event.clientX - rect.left) > 8) return;
    const host = panel.parentElement;
    const hostRect = host.getBoundingClientRect();
    const scale = hostRect.width / host.offsetWidth || 1;
    const nativePane = adaptiveNativePanel(host);
    const nativeState = nativePanelPreference(nativePane);
    const available = Math.min(host.clientWidth, (innerWidth - hostRect.left) / scale) - nativePanelReservation(host, scale);
    if (workspacePanelGeometry(available, 420).mode === "collapsed") return;
    // Intercept the upstream resizer: one owner, one coordinate system, one commit.
    event.preventDefault();
    event.stopImmediatePropagation();
    const guide = document.createElement("div");
    const startWidth = rect.width / scale;
    const drag = { panel, guide, pointerId: event.pointerId, startX: event.clientX, startWidth,
      width: startWidth, scale, available, nativeState, frame: null };
    workstationDrag = drag;
    guide.style.cssText = `position:absolute;pointer-events:none;z-index:10001;top:${panel.style.getPropertyValue("--nuyoah-panel-top") || "50px"};bottom:0;right:${startWidth + (hostRect.right - rect.right) / scale}px;width:2px;background:var(--color-token-accent-foreground,Highlight);`;
    guide.setAttribute("aria-hidden", "true");
    host.appendChild(guide);
    panel.setPointerCapture(event.pointerId);
    document.addEventListener("pointermove", handleWorkstationResizeMove, true);
    document.addEventListener("pointerup", finishWorkstationResize, true);
    document.addEventListener("pointercancel", cancelWorkstationResize, true);
    panel.addEventListener("lostpointercapture", cancelWorkstationResize);
  }

  function handleWorkstationResizeMove(event) {
    const drag = workstationDrag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    drag.width = workspacePanelGeometry(drag.available, drag.startWidth + (drag.startX - event.clientX) / drag.scale).width;
    if (drag.frame !== null) return;
    drag.frame = requestAnimationFrame(() => {
      drag.frame = null;
      drag.guide.style.transform = `translateX(${drag.startWidth - drag.width}px)`;
    });
  }

  function cancelWorkstationResize() { finishWorkstationResize(null, false); }

  function finishWorkstationResize(event, commit = true) {
    const drag = workstationDrag;
    if (!drag || (event && event.pointerId !== drag.pointerId)) return;
    if (event && commit) handleWorkstationResizeMove(event);
    workstationDrag = null;
    if (drag.frame !== null) cancelAnimationFrame(drag.frame);
    document.removeEventListener("pointermove", handleWorkstationResizeMove, true);
    document.removeEventListener("pointerup", finishWorkstationResize, true);
    document.removeEventListener("pointercancel", cancelWorkstationResize, true);
    drag.panel.removeEventListener("lostpointercapture", cancelWorkstationResize);
    if (drag.panel.hasPointerCapture(drag.pointerId)) drag.panel.releasePointerCapture(drag.pointerId);
    drag.guide.remove();
    if (commit) {
      if (drag.nativeState) {
        drag.nativeState.preferredWidth = drag.nativeState.effectiveWidth;
        drag.nativeState.priority = "workstation";
      }
      const key = drag.panel.id === "codex-taskboard-page" ? "--codex-taskboard-panel-width" : "--codex-workspace-panel-width";
      drag.panel.style.setProperty(key, `${drag.width}px`);
      try { localStorage.setItem(WORKSPACE_PANEL_WIDTH_KEY, String(Math.round(drag.width))); } catch {}
    }
    scheduleWorkstationLayout();
    scheduleSync();
  }

  function announceWorkspacePanel(panel) {
    window.postMessage({ type: WORKSPACE_PANEL_EVENT, panel }, window.location.origin);
  }

  function normalizedWorkstationPanel(value) {
    return WORKSTATION_PANELS.some((panel) => panel.id === value) ? value : "project";
  }

  function savedWorkstationPanel() {
    try { return normalizedWorkstationPanel(localStorage.getItem(WORKSTATION_LAST_PANEL_KEY)); } catch {}
    return "project";
  }

  function persistWorkstationPanel(panel) {
    const normalized = normalizedWorkstationPanel(panel);
    try { localStorage.setItem(WORKSTATION_LAST_PANEL_KEY, normalized); } catch {}
    return normalized;
  }

  function setWorkstationFontSize(value, persist = true) {
    workstationFontSize = Math.min(WORKSTATION_FONT_SIZE_MAX, Math.max(WORKSTATION_FONT_SIZE_MIN, Math.round(Number(value) || WORKSTATION_FONT_SIZE_DEFAULT)));
    document.documentElement.style.setProperty("--nuyoah-workstation-font-size", `${workstationFontSize}px`);
    document.querySelectorAll("[data-nuyoah-workstation-font-size]").forEach((output) => { output.textContent = `${workstationFontSize}px`; });
    document.querySelectorAll('[data-nuyoah-workstation-font-action="decrease"]').forEach((button) => { button.disabled = workstationFontSize <= WORKSTATION_FONT_SIZE_MIN; });
    document.querySelectorAll('[data-nuyoah-workstation-font-action="increase"]').forEach((button) => { button.disabled = workstationFontSize >= WORKSTATION_FONT_SIZE_MAX; });
    if (persist) {
      try { localStorage.setItem(WORKSTATION_FONT_SIZE_KEY, String(workstationFontSize)); } catch {}
    }
  }

  function closeWorkstationPanel(panel, restoreFocus = true) {
    workstationResumePanel = null;
    if (panel === "project") closeProjectOverview(restoreFocus);
    else if (panel === "taskboard") window.__codexTaskboardInjection__?.close?.(restoreFocus);
    else if (panel === "skills") closeSkillsGrouping(restoreFocus);
    else if (panel === "asset") closeAssetConsolePanel({ restoreFocus });
    // The measured native slot can replace its children during layout. Restore
    // to the current entry after the host finishes handling this key event.
    if (restoreFocus && sidebarMode === 'native') requestAnimationFrame(() => document.getElementById(WORKSTATION_ENTRY_ID)?.focus());
  }

  function createWorkstationHeader(activePanel) {
    const header = document.createElement("header");
    header.className = WORKSTATION_HEADER_CLASS;
    header.dataset.nuyoahWorkstationHeader = activePanel;
    const title = document.createElement("span");
    title.className = "nuyoah-workstation-title";
    title.textContent = "工作站";
    const tabs = document.createElement("div");
    tabs.className = "nuyoah-workstation-tabs";
    tabs.setAttribute("role", "tablist");
    tabs.setAttribute("aria-label", "工作站模块");
    for (const panel of WORKSTATION_PANELS) {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.nuyoahWorkstationPanel = panel.id;
      button.setAttribute("role", "tab");
      button.setAttribute("aria-selected", String(panel.id === activePanel));
      button.textContent = panel.label;
      button.tabIndex = panel.id === activePanel ? 0 : -1;
      button.onclick = () => openWorkstationPanel(panel.id);
      tabs.appendChild(button);
    }
    tabs.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      const at = WORKSTATION_PANELS.findIndex(item => item.id === activePanel);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? WORKSTATION_PANELS.length - 1 : (at + (event.key === 'ArrowRight' ? 1 : WORKSTATION_PANELS.length - 1)) % WORKSTATION_PANELS.length;
      event.preventDefault(); event.stopPropagation();
      const target = WORKSTATION_PANELS[next].id; openWorkstationPanel(target);
      const focusTab = () => {
        const node = document.querySelector(`[data-nuyoah-workstation-header="${target}"] [data-nuyoah-workstation-panel="${target}"]`);
        if (!node?.getClientRects().length) return false;
        node.focus({ preventScroll: true }); return true;
      };
      requestAnimationFrame(() => { if (!focusTab()) requestAnimationFrame(focusTab); });
    });
    const close = document.createElement("button");
    close.type = "button";
    close.className = "nuyoah-workstation-close";
    close.setAttribute("aria-label", "关闭工作站");
    close.textContent = "×";
    close.onclick = () => closeWorkstationPanel(activePanel);
    const fontControls = document.createElement("div");
    fontControls.className = "nuyoah-workstation-font-controls";
    fontControls.setAttribute("role", "group");
    fontControls.setAttribute("aria-label", "工作站字号");
    const decrease = document.createElement("button");
    decrease.type = "button";
    decrease.dataset.nuyoahWorkstationFontAction = "decrease";
    decrease.setAttribute("aria-label", "减小工作站字号");
    decrease.textContent = "A−";
    decrease.disabled = workstationFontSize <= WORKSTATION_FONT_SIZE_MIN;
    decrease.onclick = () => setWorkstationFontSize(workstationFontSize - 1);
    const output = document.createElement("output");
    output.dataset.nuyoahWorkstationFontSize = "true";
    output.setAttribute("aria-label", "当前工作站字号");
    output.textContent = `${workstationFontSize}px`;
    const increase = document.createElement("button");
    increase.type = "button";
    increase.dataset.nuyoahWorkstationFontAction = "increase";
    increase.setAttribute("aria-label", "增大工作站字号");
    increase.textContent = "A+";
    increase.disabled = workstationFontSize >= WORKSTATION_FONT_SIZE_MAX;
    increase.onclick = () => setWorkstationFontSize(workstationFontSize + 1);
    fontControls.append(decrease, output, increase);
    const actions = document.createElement("div");
    actions.className = "nuyoah-workstation-actions";
    const settings = document.createElement("details");
    settings.className = "nuyoah-workstation-settings";
    const settingsToggle = document.createElement("summary");
    settingsToggle.textContent = "Aa";
    settingsToggle.setAttribute("aria-label", "文字设置");
    settingsToggle.title = "文字设置";
    settings.append(settingsToggle, fontControls);
    settings.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && settings.open) {
        event.preventDefault(); event.stopPropagation(); settings.open = false; settingsToggle.focus();
      }
    });
    settings.addEventListener("focusout", (event) => {
      if (event.relatedTarget && !settings.contains(event.relatedTarget)) settings.open = false;
    });
    actions.append(settings, close);
    header.append(title, tabs, actions);
    setWorkstationFontSize(workstationFontSize, false);
    return header;
  }

  let workstationTaskboardFrame = null;
  let workstationTaskboardDocument = null;

  function handleTaskboardEscape(event) {
    if (event.key === "Escape" && !event.defaultPrevented) handleWorkspaceEnhancementKeydown(event);
  }

  function syncTaskboardKeyboardBridge() {
    const frame = document.getElementById("codex-taskboard-frame");
    if (frame !== workstationTaskboardFrame) {
      workstationTaskboardFrame?.removeEventListener("load", syncTaskboardKeyboardBridge);
      workstationTaskboardFrame = frame;
      frame?.addEventListener("load", syncTaskboardKeyboardBridge);
    }
    // The bundled Taskboard blob shares the host origin. Never inspect external frames.
    const frameDocument = frame?.contentDocument || null;
    if (frameDocument === workstationTaskboardDocument) return;
    workstationTaskboardDocument?.removeEventListener("keydown", handleTaskboardEscape);
    workstationTaskboardDocument = frameDocument;
    frameDocument?.addEventListener("keydown", handleTaskboardEscape);
  }

  function ensureTaskboardWorkstationHeader() {
    const page = document.getElementById("codex-taskboard-page");
    if (!page) return;
    page.dataset.nuyoahWorkstationFrame = "true";
    syncTaskboardKeyboardBridge();
    const current = page.querySelector(`:scope > .${WORKSTATION_HEADER_CLASS}`);
    if (current?.dataset.nuyoahWorkstationHeader === "taskboard") return;
    current?.remove();
    // The upstream initializer clamps against the whole window; retain the saved preference here.
    try {
      const preferred = Number(localStorage.getItem(WORKSPACE_PANEL_WIDTH_KEY));
      if (Number.isFinite(preferred) && preferred > 0) page.style.setProperty("--codex-taskboard-panel-width", `${Math.max(420, preferred)}px`);
    } catch {}
    page.prepend(createWorkstationHeader("taskboard"));
  }

  let projectSubview = 'map', workItemsScrollTop = 0, taskMapScrollTop = 0;
  try { const saved = localStorage.getItem('nuyoah-project-subview'); if (['tasks', 'map', 'work-items'].includes(saved)) projectSubview = saved; } catch {}
  let projectViewScope = '', projectViewState = null, projectRestorePending = false, projectListSignature = '';
  function currentProjectSnapshot() {
    const context = currentCodexTaskContext();
    const tasks = getTaskboardSnapshot({ includeProjectHistory: true }).tasks;
    const entry = tasks.find(task => task.threadId === context.threadId && task.hostId === context.hostId) || null;
    const selected = !context.threadId && !window.__nuyoahMultiChat__?.isOpen?.() && activeFolderId !== ALL_FOLDER_ID ? folderSources.get(activeFolderId) : null;
    if (selected) {
      context.projectId = selected.id; context.projectName = selected.label;
      context.hostId = tasks.find(task => task.projectId === selected.id)?.hostId
        || (selected.folder?.getAttribute('data-sidebar-project-kind') === 'remote' ? 'remote:pending' : 'local');
    }
    const projectId = entry?.projectId || context.projectId || '';
    const projectName = entry?.projectName || context.projectName || (context.hostId && context.hostId !== 'local' ? '项目同步中' : '未绑定项目');
    const entries = projectId && projectId !== '__unassigned__'
      ? tasks.filter(task => task.projectId === projectId && task.hostId === context.hostId) : entry ? [entry] : [];
    return { context, entry, projectId, projectName, entries, tasks, pendingProject: Boolean(context.hostId && context.hostId !== 'local' && !entry) };
  }

  function saveProjectPosition() {
    if (projectViewState && projectViewScope) window.__nuyoahProjectView__?.save(projectViewScope, projectViewState);
  }
  function restoreProjectPosition() {
    if (!projectRestorePending || !projectViewState) return;
    const body = projectOverviewPage?.querySelector('.nuyoah-project-overview-body');
    if (!body || projectOverviewPage.hidden) return;
    const max = Math.max(0, body.scrollHeight - body.clientHeight);
    body.scrollTop = Math.min(projectViewState.scrollTop, max);
    if (max >= projectViewState.scrollTop) projectRestorePending = false;
  }
  function createProjectOverviewPage() {
    const page = document.createElement('section');
    page.id = PROJECT_OVERVIEW_PAGE_ID; page.hidden = true;
    page.setAttribute('role', 'dialog'); page.setAttribute('aria-label', '项目工作站');
    const body = document.createElement('div'); body.className = 'nuyoah-project-overview-body';
    body.innerHTML = `
      <div data-nuyoah-project-task-view>
      <div class="nuyoah-project-heading">
        <div><p data-nuyoah-project-name></p><span class="nuyoah-project-current-label">当前任务</span><h2 class="nuyoah-project-current-task" data-nuyoah-current-task></h2></div>
        <span class="nuyoah-project-binding" data-nuyoah-project-binding></span>
      </div>
      <p class="nuyoah-project-remote-note" data-nuyoah-project-remote-note hidden>远程任务的摘要与文件暂不可用。</p>
      <details class="nuyoah-project-task-directory"><summary class="nuyoah-project-section-title"><span>项目内任务</span><span class="nuyoah-project-counts"><span data-nuyoah-project-task-summary></span><span data-nuyoah-project-live-count> · <span data-nuyoah-running-count>0</span> 个执行中</span></span></summary>
      <div class="nuyoah-project-filters">
        <input type="search" aria-label="搜索项目任务" placeholder="搜索项目任务" data-nuyoah-project-search maxlength="500">
        <select aria-label="筛选任务状态" data-nuyoah-project-filter><option value="all">全部状态</option><option value="attention">待处理</option><option value="running">执行中</option><option value="failed">失败</option><option value="completed">已确认完成</option><option value="history">历史记录</option></select>
      </div>
      <div class="nuyoah-project-task-list" data-nuyoah-project-task-list></div>
      <p class="nuyoah-project-feedback" role="status" data-nuyoah-project-feedback></p>
      <button type="button" class="nuyoah-project-more" data-nuyoah-project-more hidden></button>
      </details><details class="nuyoah-project-extra-records" data-nuyoah-project-records hidden><summary>更多记录</summary></details>
      </div><div data-nuyoah-task-map-view hidden></div><div data-nuyoah-work-items-view hidden></div>`;
    const changeFilter = () => {
      projectViewState.query = body.querySelector('[data-nuyoah-project-search]').value;
      projectViewState.filter = body.querySelector('[data-nuyoah-project-filter]').value;
      projectViewState.count = 12; projectRestorePending = false;
      projectViewState.scrollTop = body.scrollTop;
      saveProjectPosition(); renderProjectOverview();
    };
    body.querySelector('[data-nuyoah-project-search]').oninput = changeFilter;
    body.querySelector('[data-nuyoah-project-filter]').onchange = changeFilter;
    body.querySelector('[data-nuyoah-project-more]').onclick = () => { projectViewState.count += 12; saveProjectPosition(); renderProjectOverview(); };
    body.addEventListener('scroll', () => {
      if (projectSubview === 'work-items') { workItemsScrollTop = body.scrollTop; return; }
      if (projectSubview === 'map') { taskMapScrollTop = body.scrollTop; return; }
      if (!projectViewState || projectRestorePending || page.hidden) return;
      projectViewState.scrollTop = body.scrollTop; saveProjectPosition();
    }, { passive: true });
    for (const event of ['wheel', 'touchstart', 'pointerdown', 'keydown']) body.addEventListener(event, () => { projectRestorePending = false; }, { passive: true });
    const subnav = document.createElement('nav'); subnav.className = 'nuyoah-project-subnav'; subnav.setAttribute('aria-label', '项目视图');
    for (const [key, label] of [['map', '任务地图'], ['tasks', '当前项目'], ['work-items', '工作事项']]) {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = label;
      button.dataset.projectSubview = key; button.setAttribute('aria-pressed', String(projectSubview === key));
      button.onclick = () => {
        if (projectSubview === key) return;
        if (projectSubview === 'tasks') saveProjectPosition();
        projectSubview = key;
        try { localStorage.setItem('nuyoah-project-subview', key); } catch {}
        if (key === 'tasks') projectRestorePending = true;
        renderProjectOverview();
        if (key === 'work-items') body.scrollTop = workItemsScrollTop;
        if (key === 'map') body.scrollTop = taskMapScrollTop;
      };
      subnav.append(button);
    }
    subnav.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key) || !event.target.matches('[data-project-subview]')) return;
      const buttons = [...subnav.querySelectorAll('button')], index = buttons.indexOf(event.target);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : buttons.length - 1)) % buttons.length;
      event.preventDefault(); buttons[next].click(); buttons[next].focus();
    });
    page.append(createWorkstationHeader('project'), subnav, body);
    return initializeWorkspacePanel(page, 'project');
  }

  function openProjectTask(entry, body, { returning = false, fromGrid = false } = {}) {
    const threadId = normalizedThreadId(entry?.threadId);
    if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(threadId) || !entry?.hostId) return false;
    if (!fromGrid && window.__nuyoahMultiChat__?.isOpen?.()) return window.__nuyoahMultiChat__.selectTask({ ...entry, threadId });
    // A child view can leave the parent's sidebar row selected. Explicitly route
    // back instead of clicking that already-selected row, which may be a no-op.
    const remoteHost = entry.hostId === 'local' ? null : window.__nuyoahMultiChatNative__?.hostInfo?.(entry.hostId);
    if (returning && (entry.hostId === 'local' || remoteHost?.available === true)) {
      const search = entry.hostId === 'local' ? '' : '?' + new URLSearchParams({ hostId: entry.hostId });
      window.postMessage({ type: 'navigate-to-route', path: `/local/${threadId}${search}` }, '*');
      return true;
    }
    if (returning && remoteHost && !remoteHost.available) {
      const feedback = body?.querySelector('[data-nuyoah-project-feedback]');
      if (feedback) feedback.textContent = '远程设备暂未连接';
      return false;
    }
    const row = Array.from(document.querySelectorAll('[data-app-action-sidebar-thread-id]')).find(candidate =>
      normalizedThreadId(candidate.getAttribute('data-app-action-sidebar-thread-id')) === threadId
      && (candidate.getAttribute('data-app-action-sidebar-thread-host-id') || 'local') === entry.hostId
      && !candidate.hasAttribute('data-codex-sidebar-all-project-row'));
    if (row) { row.click(); return true; }
    if (entry.hostId === 'local') { revealThread(threadId); window.postMessage({ type: 'navigate-to-route', path: `/local/${threadId}` }, '*'); return true; }
    const feedback = body?.querySelector('[data-nuyoah-project-feedback]');
    if (feedback) feedback.textContent = '请先在左侧展开此远程项目，再打开任务。';
    return false;
  }

  function renderProjectOverview() {
    if (!projectOverviewPage || projectOverviewPage.hidden) return;
    const model = window.__nuyoahProjectView__; if (!model) return;
    const snapshot = currentProjectSnapshot(), body = projectOverviewPage.querySelector('.nuyoah-project-overview-body');
    projectOverviewPage.dataset.projectView = projectSubview;
    const taskView = body.querySelector('[data-nuyoah-project-task-view]');
    const workView = body.querySelector('[data-nuyoah-work-items-view]');
    const mapView = body.querySelector('[data-nuyoah-task-map-view]');
    taskView.hidden = projectSubview !== 'tasks'; workView.hidden = projectSubview !== 'work-items'; mapView.hidden = projectSubview !== 'map';
    projectOverviewPage.querySelectorAll('[data-project-subview]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.projectSubview === projectSubview)));
    if (projectSubview === 'map') {
      window.__nuyoahTaskMapUI__?.mount?.(mapView, {
        context: { ...snapshot.context, projectId: snapshot.projectId, projectName: snapshot.projectName },
        tasks: model.present(snapshot.tasks),
        getLocalStatus: threadId => window.__nuyoahRemoteTaskCatalog__?.localStatus?.(threadId),
        syncLocalRelationRoots: roots => window.__nuyoahRemoteTaskCatalog__?.setLocalRelationRoots?.(roots),
        openTask: (entry, options) => openProjectTask(entry, body, options),
      });
      return;
    }
    window.__nuyoahTaskMapUI__?.suspend?.();
    if (projectSubview === 'work-items') {
      window.__nuyoahWorkItemsUI__?.mount?.(workView, { context: snapshot.context, tasks: model.present(snapshot.tasks),
        insertText: insertPlainTextIntoComposer, openTask: entry => {
          openProjectTask(entry, body); projectSubview = 'tasks'; projectRestorePending = true;
          try { localStorage.setItem('nuyoah-project-subview', 'tasks'); } catch {}
          renderProjectOverview();
        } });
      return;
    }
    const scope = model.scope(snapshot.context.hostId, snapshot.projectId || snapshot.context.threadId);
    if (scope !== projectViewScope) {
      saveProjectPosition(); projectViewScope = scope; projectViewState = model.read(scope); projectListSignature = '';
      projectRestorePending = true;
      body.querySelector('[data-nuyoah-project-search]').value = projectViewState.query;
      body.querySelector('[data-nuyoah-project-filter]').value = projectViewState.filter;
    }
    window.__nuyoahTaskContextUI__?.mount?.(taskView, snapshot.context.threadId, insertPlainTextIntoComposer, snapshot.context.hostId,
      model.present(snapshot.tasks), entry => openProjectTask(entry, body));
    window.__nuyoahTaskContextUI__?.mountHistory?.(taskView, { ...snapshot.context, projectId: snapshot.projectId });
    body.querySelector('[data-nuyoah-project-remote-note]').hidden = snapshot.context.hostId === 'local';
    const entries = model.present(snapshot.entries), selection = model.select(entries, projectViewState);
    const currentTitle = snapshot.context.threadTitle || snapshot.entry?.title || '当前没有选中的任务';
    body.querySelector('[data-nuyoah-project-name]').textContent = snapshot.projectName;
    body.querySelector('[data-nuyoah-current-task]').textContent = currentTitle;
    body.querySelector('[data-nuyoah-project-binding]').dataset.bound = String(Boolean(snapshot.projectId && snapshot.projectId !== '__unassigned__'));
    body.querySelector('[data-nuyoah-project-binding]').dataset.local = String(snapshot.context.hostId === 'local');
    body.querySelector('[data-nuyoah-project-binding]').textContent = snapshot.context.hostId !== 'local'
      ? snapshot.entry?.hostName || '远程设备' : snapshot.projectId && snapshot.projectId !== '__unassigned__' ? '已绑定' : '待绑定';
    body.querySelector('[data-nuyoah-running-count]').textContent = String(entries.filter(entry => entry.displayStatus === 'running').length);
    body.querySelector('[data-nuyoah-project-task-summary]').textContent = snapshot.pendingProject ? '任务数待同步' : `${entries.length} 个任务`;
    body.querySelector('[data-nuyoah-project-live-count]').hidden = snapshot.pendingProject;
    const list = body.querySelector('[data-nuyoah-project-task-list]');
    const signature = JSON.stringify([snapshot.context.threadId, snapshot.context.hostId, projectViewState.query, projectViewState.filter, selection.visible, selection.remaining]);
    if (signature !== projectListSignature) {
      projectListSignature = signature;
      const titleCounts = new Map();
      for (const entry of entries) titleCounts.set(entry.title, (titleCounts.get(entry.title) || 0) + 1);
      const previousFocus = list.contains(document.activeElement) ? document.activeElement?.dataset?.taskIdentity : null;
      const rows = selection.visible.map(entry => {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'nuyoah-project-task';
        button.dataset.taskIdentity = entry.identity; button.dataset.threadId = entry.threadId; button.dataset.hostId = entry.hostId;
        const current = entry.threadId === snapshot.context.threadId && entry.hostId === snapshot.context.hostId;
        button.setAttribute('aria-current', String(current)); button.dataset.status = entry.displayStatus;
        const content = document.createElement('div'); content.className = 'nuyoah-project-task-content';
        const title = document.createElement('strong'); title.textContent = entry.title || '未命名任务'; content.append(title);
        const date = new Date(entry.updatedAt);
        const secondary = document.createElement('small');
        secondary.textContent = `${current ? '当前 · ' : ''}${Number.isFinite(date.getTime()) ? date.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '时间待同步'}`;
        if (titleCounts.get(entry.title) > 1) secondary.textContent += ` · 编号 ${entry.threadId.slice(-6)}`;
        content.append(secondary);
        const status = document.createElement('span'); status.className = 'nuyoah-project-task-status'; status.textContent = entry.statusLabel;
        button.append(content, status);
        button.onclick = () => openProjectTask(entry, body);
        return button;
      });
      if (!rows.length) { const empty = document.createElement('p'); empty.className = 'nuyoah-project-empty'; empty.textContent = snapshot.pendingProject ? '远程项目信息尚未同步，请稍后查看。' : entries.length ? '没有符合筛选条件的任务。' : '此项目暂无可显示的任务。'; rows.push(empty); }
      list.replaceChildren(...rows);
      if (previousFocus) Array.from(list.children).find(row => row.dataset.taskIdentity === previousFocus)?.focus({ preventScroll: true });
      const more = body.querySelector('[data-nuyoah-project-more]'); more.hidden = selection.remaining === 0;
      more.textContent = `显示更多（剩余 ${selection.remaining} 个）`;
      body.querySelector('[data-nuyoah-project-feedback]').textContent = projectViewState.query || projectViewState.filter !== 'all' ? `找到 ${selection.filtered.length} 个任务` : '';
    }
    requestAnimationFrame(restoreProjectPosition);
  }

  function openProjectOverview() {
    const mount = findCustomShortcutPageMount();
    if (!mount) return false;
    closeOtherWorkspacePanels("project");
    if (!projectOverviewPage) projectOverviewPage = createProjectOverviewPage();
    projectOverviewReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (projectOverviewPage.parentElement !== mount.surface) mount.surface.appendChild(projectOverviewPage);
    projectOverviewPage.hidden = false;
    document.documentElement.setAttribute("data-nuyoah-workstation-project-open", "true");
    renderProjectOverview();
    scheduleSync();
    return true;
  }

  function closeProjectOverview(restoreFocus = true) {
    saveProjectPosition();
    window.__nuyoahTaskMapUI__?.suspend?.();
    if (projectOverviewPage) projectOverviewPage.hidden = true;
    document.documentElement.removeAttribute("data-nuyoah-workstation-project-open");
    if (restoreFocus) projectOverviewReturnFocus?.focus?.();
    projectOverviewReturnFocus = null;
    scheduleSync();
  }

  function openWorkstationPanel(panel = savedWorkstationPanel(), options = {}) {
    workstationResumePanel = null;
    const target = persistWorkstationPanel(panel);
    if (target === "project") return openProjectOverview();
    if (target === "taskboard") {
      const api = window.__codexTaskboardInjection__;
      if (typeof api?.search === "function" && options.query) void api.search(options.query);
      else api?.open?.();
      ensureTaskboardWorkstationHeader();
      return Boolean(api);
    }
    if (target === "skills") return openSkillsGrouping(options);
    return openAssetConsolePanel(options);
  }

  function closeOtherWorkspacePanels(panel) {
    if (panel !== "custom") closeCustomShortcutPanel(false);
    if (panel !== "project") closeProjectOverview(false);
    if (panel !== "asset") closeAssetConsolePanel({ restoreFocus: false });
    if (panel !== "skills") closeSkillsGrouping(false);
    if (panel !== "taskboard") window.__codexTaskboardInjection__?.close?.(false);
    announceWorkspacePanel(panel);
  }

  function findCustomShortcutPageMount() {
    const visible = node => {
      const rect = node.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && !node.closest('[hidden], [aria-hidden="true"]');
    };
    let frameHost = Array.from(document.querySelectorAll(".app-shell-main-content-frame")).find(visible);
    if (!frameHost?.closest?.("[data-app-shell-main-content-layout]")) {
      const viewport = Array.from(document.querySelectorAll("[data-app-shell-main-content-layout]")).find(visible);
      if (viewport) {
        const viewportRect = viewport.getBoundingClientRect();
        const candidates = Array.from(viewport.children).filter((candidate) => {
          const rect = candidate.getBoundingClientRect();
          return candidate.tagName === 'DIV' && visible(candidate) && rect.height >= viewportRect.height * 0.7;
        });
        // Docked panels already shrink the chat frame. Width is not identity.
        frameHost = candidates.length === 1 ? candidates[0] : null;
      }
    }
    const viewport = frameHost?.closest?.("[data-app-shell-main-content-layout]");
    const surface = viewport?.parentElement
      || document.querySelector("main")
      || document.querySelector('[role="main"]');
    if (!surface || surface.closest("aside")) return null;
    return { surface };
  }

  function createCustomShortcutPage() {
    const page = document.createElement("section");
    page.id = CUSTOM_SHORTCUT_PAGE_ID;
    page.hidden = true;
    const header = document.createElement("header");
    header.className = "codex-custom-shortcut-header";
    const title = document.createElement("span");
    title.dataset.codexCustomShortcutTitle = "true";
    const close = document.createElement("button");
    close.type = "button";
    close.dataset.codexCustomShortcutClose = "true";
    close.setAttribute("aria-label", "关闭内置网页");
    close.textContent = "×";
    close.onclick = () => closeCustomShortcutPanel();
    header.append(title, close);
    page.appendChild(header);
    return initializeWorkspacePanel(page, "custom");
  }

  function openCustomShortcutPanel(item) {
    const url = validShortcutUrl(item?.url);
    if (!url) return false;
    const mount = findCustomShortcutPageMount();
    if (!mount) return false;
    closeOtherWorkspacePanels("custom");
    if (!customShortcutPage) customShortcutPage = createCustomShortcutPage();
    customShortcutLastFocusedElement = document.activeElement;
    if (customShortcutPage.parentElement !== mount.surface) mount.surface.appendChild(customShortcutPage);
    customShortcutPage.querySelector("[data-codex-custom-shortcut-title]").textContent = item.name;
    customShortcutFrame?.remove();
    const frame = document.createElement("iframe");
    frame.id = CUSTOM_SHORTCUT_FRAME_ID;
    frame.title = item.name;
    frame.src = url;
    frame.referrerPolicy = "no-referrer";
    frame.setAttribute("sandbox", "allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads allow-modals allow-presentation");
    frame.setAttribute("allow", "clipboard-read; clipboard-write; fullscreen");
    customShortcutFrame = frame;
    customShortcutPage.appendChild(frame);
    customShortcutPage.hidden = false;
    document.documentElement.setAttribute("data-codex-custom-shortcut-open", "true");
    return true;
  }

  function closeCustomShortcutPanel(restoreFocus = true) {
    if (customShortcutPage) customShortcutPage.hidden = true;
    customShortcutFrame?.remove();
    customShortcutFrame = null;
    restoreCustomShortcutNativeContent();
    document.documentElement.removeAttribute("data-codex-custom-shortcut-open");
    if (restoreFocus) customShortcutLastFocusedElement?.focus?.();
    customShortcutLastFocusedElement = null;
  }

  function currentCodexTaskContext() {
    if (window.__nuyoahMultiChat__?.isOpen?.()) {
      const target = window.__nuyoahMultiChat__.currentTarget();
      const threadId = normalizedThreadId(target?.threadId || '');
      if (target?.hostId === 'local' && /^client-new-thread:[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(target.clientThreadId || '')) {
        const project = window.__nuyoahMultiChatNative__?.importedFolders?.().find(project => project.hostId === 'local'
          && project.projectId === target.projectId && project.cwd === target.cwd);
        if (project) return { threadId: '', hostId: 'local', threadTitle: '', projectId: project.projectId, projectName: project.name };
      }
      if (!target?.hostId || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(threadId))
        return { threadId: '', hostId: '', threadTitle: '', projectId: '', projectName: '' };
      const entry = target.hostId === 'local' ? searchCatalogByThread.get(threadId) || recentCatalogByThread.get(threadId)
        || taskCatalog.find(entry => normalizedThreadId(entry.threadId) === threadId)
        : window.__nuyoahRemoteTaskCatalog__?.snapshot?.().find(entry => entry.hostId === target.hostId && normalizedThreadId(entry.threadId) === threadId);
      return { threadId, hostId: target.hostId, threadTitle: target.title || entry?.title || '',
        projectId: entry?.projectId || '', projectName: entry?.projectName || '' };
    }
    // Hidden native rows can retain a client-draft or previous-thread marker.
    // Prefer the visible native controller's explicit host/thread route.
    let nativeTarget = null;
    try { nativeTarget = window.__nuyoahMultiChatNative__?.current?.(); } catch {}
    if (nativeTarget?.clientThreadId && !nativeTarget.threadId)
      return { threadId: '', hostId: '', threadTitle: '', projectId: '', projectName: '' };
    const nativeId = normalizedThreadId(nativeTarget?.threadId || '');
    if (nativeTarget?.hostId && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(nativeId)) {
      const entry = nativeTarget.hostId === 'local' ? searchCatalogByThread.get(nativeId) || recentCatalogByThread.get(nativeId)
        || taskCatalog.find(item => normalizedThreadId(item.threadId) === nativeId)
        : window.__nuyoahRemoteTaskCatalog__?.snapshot?.().find(item => item.hostId === nativeTarget.hostId && item.threadId === nativeId);
      return { threadId: nativeId, hostId: nativeTarget.hostId, threadTitle: entry?.title || '',
        projectId: entry?.projectId || '', projectName: entry?.projectName || '' };
    }
    const active = document.querySelector('[data-app-action-sidebar-thread-active="true"], [data-app-action-sidebar-thread-selected="true"], [data-app-action-sidebar-thread-row][aria-current="page"]');
    let threadId = normalizedThreadId(active?.getAttribute("data-app-action-sidebar-thread-id") || "");
    const hasSidebarIdentity = Boolean(threadId);
    let hostId = active?.getAttribute('data-app-action-sidebar-thread-host-id') || 'local';
    let titleRow = active;
    if (!threadId) {
      const empty = { threadId: '', hostId: '', threadTitle: '', projectId: '', projectName: '' };
      const roots = Array.from(document.querySelectorAll('[data-codex-composer-root][data-composer-placement="thread"]')).filter(root => {
        const rect = root.getBoundingClientRect(), style = getComputedStyle(root);
        return rect.width > 0 && rect.height > 0 && style.display !== 'none'
          && !['hidden', 'collapse'].includes(style.visibility) && !root.closest('[hidden], [aria-hidden="true"]');
      });
      if (roots.length !== 1) return empty;
      // The native identity marker itself is intentionally hidden; visibility
      // belongs to its owning thread composer, not to this metadata element.
      const ids = new Set(Array.from(roots[0].querySelectorAll('[data-above-composer-conversation-id]'))
        .map(node => normalizedThreadId(node.getAttribute('data-above-composer-conversation-id')))
        .filter(id => /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(id)));
      if (ids.size !== 1) return empty;
      threadId = [...ids][0];
      const rows = Array.from(document.querySelectorAll('[data-app-action-sidebar-thread-row][data-app-action-sidebar-thread-id]'))
        .filter(row => normalizedThreadId(row.getAttribute('data-app-action-sidebar-thread-id')) === threadId);
      const hosts = new Set(rows.map(row => row.getAttribute('data-app-action-sidebar-thread-host-id')).filter(Boolean));
      if (searchCatalogByThread.has(threadId) || recentCatalogByThread.has(threadId)
        || taskCatalog.some(entry => normalizedThreadId(entry.threadId) === threadId)) hosts.add('local');
      // Spawned children can be known to the native local metadata catalog
      // without being admitted as regular Taskboard cards.
      try { if (window.__nuyoahRemoteTaskCatalog__?.hasLocalThread?.(threadId) === true) hosts.add('local'); } catch {}
      for (const task of window.__nuyoahRemoteTaskCatalog__?.snapshot?.() || []) {
        if (normalizedThreadId(task.threadId) === threadId && typeof task.hostId === 'string' && task.hostId) hosts.add(task.hostId);
      }
      if (hosts.size !== 1) return empty;
      hostId = [...hosts][0]; titleRow = rows.find(row => row.getAttribute('data-app-action-sidebar-thread-host-id') === hostId);
    }
    const entry = hostId === 'local' ? searchCatalogByThread.get(threadId) || recentCatalogByThread.get(threadId) || null
      : window.__nuyoahRemoteTaskCatalog__?.snapshot?.().find(task => task.threadId === threadId && task.hostId === hostId);
    return {
      threadId,
      hostId,
      threadTitle: titleRow?.getAttribute("data-app-action-sidebar-thread-title") || (!hasSidebarIdentity ? entry?.title || entry?.displayTitle || '' : ''),
      projectId: typeof entry?.projectId === "string" ? entry.projectId : "",
      projectName: typeof entry?.projectName === "string" ? entry.projectName : "",
    };
  }

  function notifyAssetConsole(action) {
    const requestId = action === "open" ? globalThis.crypto.randomUUID() : assetConsoleRequestId;
    assetConsoleRequestId = action === "open" ? requestId : null;
    if (action === "open") {
      clearTimeout(assetConsoleLoadTimer);
      assetConsoleLoadTimer = null;
      assetConsoleFrame?.remove();
      assetConsoleFrame = null;
    }
    if (!requestId) return false;
    const binding = globalThis.codexSidebarOpenAssetConsole;
    if (typeof binding !== "function") {
      assetConsoleRequestId = null;
      return false;
    }
    try {
      binding(JSON.stringify({ action, requestId, ...currentCodexTaskContext() }));
      return true;
    } catch {
      assetConsoleRequestId = null;
      return false;
    }
  }

  function syncAssetConsoleContext(force = false) {
    if (!assetConsoleFrame?.isConnected || assetConsolePage?.hidden || assetConsolePage?.dataset.state !== 'ready') return;
    const context = currentCodexTaskContext();
    if ((!context.threadId || !context.hostId) && !window.__nuyoahMultiChat__?.isOpen?.()) return;
    const signature = JSON.stringify(context);
    if (!force && assetConsoleFrame.__nuyoahContextSignature === signature) return;
    assetConsoleFrame.contentWindow?.postMessage({ source: "codex-sidebar-enhancer", action: "context", ...context,
      clearTask: window.__nuyoahMultiChat__?.isOpen?.() === true && !context.threadId }, "*");
    assetConsoleFrame.__nuyoahContextSignature = signature;
  }

  function setAssetConsoleHostLayer(active) {
    const host = assetConsolePage?.parentElement;
    if (!host) return;
    const marker = "data-codex-asset-console-host-layer";
    const previous = "data-codex-asset-console-host-z-index";
    if (active) {
      if (!host.hasAttribute(marker)) {
        host.setAttribute(marker, "true");
        host.setAttribute(previous, host.style.zIndex || "");
      }
      host.style.setProperty("z-index", "40");
      return;
    }
    if (!host.hasAttribute(marker)) return;
    const original = host.getAttribute(previous) || "";
    if (original) host.style.zIndex = original;
    else host.style.removeProperty("z-index");
    host.removeAttribute(marker);
    host.removeAttribute(previous);
  }

  function createAssetConsolePage() {
    const page = document.createElement("section");
    page.id = ASSET_CONSOLE_PAGE_ID;
    page.hidden = true;
    page.setAttribute("role", "dialog");
    page.setAttribute("aria-label", "资产控制台");
    page.innerHTML = `
      <div class="codex-asset-console-body">
        <div class="codex-asset-console-state" role="status">
          <span class="codex-asset-console-message">正在连接本机资产库…</span>
          <button type="button" class="codex-asset-console-retry">重新连接</button>
        </div>
      </div>`;
    page.prepend(createWorkstationHeader("asset"));
    page.querySelector(".codex-asset-console-retry").onclick = () => {
      page.dataset.state = "loading";
      page.querySelector(".codex-asset-console-message").textContent = "正在连接本机资产库…";
      if (!notifyAssetConsole("open")) {
        page.dataset.state = "error";
        page.querySelector(".codex-asset-console-message").textContent = "本机连接尚未就绪";
      }
    };
    return initializeWorkspacePanel(page, "asset");
  }

  function openAssetConsolePanel(options = {}) {
    pendingAssetConsoleQuery = typeof options?.query === "string" ? options.query.trim() : "";
    closeOtherWorkspacePanels("asset");
    const mount = findCustomShortcutPageMount();
    if (!mount) return false;
    if (!assetConsolePage) assetConsolePage = createAssetConsolePage();
    assetConsoleReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const moved = assetConsolePage.parentElement !== mount.surface;
    if (moved) { setAssetConsoleHostLayer(false); mount.surface.appendChild(assetConsolePage); }
    setAssetConsoleHostLayer(true);
    assetConsolePage.hidden = false;
    if (!moved && assetConsoleFrame?.isConnected && assetConsolePage.dataset.state === "ready") {
      syncAssetConsoleContext(true);
      if (pendingAssetConsoleQuery) {
        assetConsoleFrame.contentWindow?.postMessage({ source: "codex-sidebar-enhancer", action: "search", query: pendingAssetConsoleQuery }, "*");
      }
      document.documentElement.setAttribute("data-codex-asset-console-open", "true");
      scheduleSync();
      return true;
    }
    assetConsolePage.dataset.state = "loading";
    assetConsolePage.querySelector(".codex-asset-console-message").textContent = assetConsole.available
      ? "正在连接本机资产库…"
      : "资产控制台服务正在准备，请稍后重试";
    document.documentElement.setAttribute("data-codex-asset-console-open", "true");
    if (!notifyAssetConsole("open")) {
      assetConsolePage.dataset.state = "error";
      assetConsolePage.querySelector(".codex-asset-console-message").textContent = "本机连接尚未就绪";
    }
    scheduleSync();
    return true;
  }

  function closeAssetConsolePanel({ restoreFocus = true } = {}) {
    clearTimeout(assetConsoleLoadTimer);
    assetConsoleLoadTimer = null;
    if (assetConsolePage) assetConsolePage.hidden = true;
    setAssetConsoleHostLayer(false);
    assetConsoleFrame?.remove();
    assetConsoleFrame = null;
    restoreCustomShortcutNativeContent();
    document.documentElement.removeAttribute("data-codex-asset-console-open");
    notifyAssetConsole("close");
    if (restoreFocus) assetConsoleReturnFocus?.focus?.();
    assetConsoleReturnFocus = null;
    scheduleSync();
  }

  function setAssetConsolePanel(value) {
    const state = value && typeof value === "object" ? value : {};
    if (!assetConsoleRequestId || state.requestId !== assetConsoleRequestId) return;
    if (!assetConsolePage || assetConsolePage.hidden) return;
    clearTimeout(assetConsoleLoadTimer);
    assetConsoleLoadTimer = null;
    if (state.state !== "ready" || typeof state.url !== "string" || !state.url) {
      assetConsoleFrame?.remove();
      assetConsoleFrame = null;
      assetConsolePage.dataset.state = "error";
      assetConsolePage.querySelector(".codex-asset-console-message").textContent = state.message || "资产控制台暂时无法加载";
      notifyAssetConsole("close");
      return;
    }
    const body = assetConsolePage.querySelector(".codex-asset-console-body");
    assetConsoleFrame?.remove();
    const frame = document.createElement("iframe");
    frame.id = ASSET_CONSOLE_FRAME_ID;
    frame.title = "资产控制台";
    frame.src = state.url;
    frame.setAttribute("allow", "clipboard-read; clipboard-write; autoplay");
    frame.onload = () => {
      if (assetConsoleFrame !== frame) return;
      syncAssetConsoleContext(true);
      if (pendingAssetConsoleQuery) {
        frame.contentWindow?.postMessage({ source: "codex-sidebar-enhancer", action: "search", query: pendingAssetConsoleQuery }, "*");
      }
    };
    assetConsoleFrame = frame;
    assetConsolePage.dataset.state = "loading";
    assetConsoleLoadTimer = setTimeout(() => {
      if (assetConsoleFrame === frame) setAssetConsolePanel({ requestId: state.requestId, state: "error", message: "资产页面加载失败，请重新连接。" });
    }, 15_000);
    body.appendChild(frame);
  }

  function currentComposer() {
    if (window.__nuyoahMultiChat__?.isOpen?.()) return window.__nuyoahMultiChat__.composer();
    return Array.from(document.querySelectorAll('[contenteditable="true"]')).find((node) => {
      const rect = node.getBoundingClientRect();
      return rect.width > 80 && rect.height > 20 && !node.closest(`#${ASSET_CONSOLE_PAGE_ID}, [hidden], [inert], [aria-hidden="true"]`)
        && getComputedStyle(node).visibility === 'visible';
    }) || null;
  }

  function addAssetReferencesToComposer(assetPaths) {
    if (currentCodexTaskContext().hostId !== 'local') return false;
    const composer = currentComposer();
    if (!composer || !assetPaths?.length) return false;
    const text = `${composer.textContent?.trim() ? "\n" : ""}${assetPaths.map((assetPath) => `参考资产：${assetPath}`).join("\n")}`;
    composer.focus();
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(composer);
    range.collapse(false);
    selection?.removeAllRanges();
    selection?.addRange(range);
    let inserted = false;
    try { inserted = document.execCommand("insertText", false, text); } catch {}
    if (!inserted) {
      range.insertNode(document.createTextNode(text));
      range.collapse(false);
      selection?.removeAllRanges();
      selection?.addRange(range);
    }
    composer.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
    return true;
  }

  function isAbsoluteAssetPath(value) {
    const assetPath = typeof value === "string" ? value.trim() : "";
    return assetPath.startsWith("/")
      || /^[A-Za-z]:[\\/][^\0\r\n]*$/.test(assetPath)
      || /^[\\/]{2}[^\\/\0\r\n]+[\\/][^\\/\0\r\n]+(?:[\\/][^\0\r\n]*)?$/.test(assetPath);
  }

  function handleAssetConsoleMessage(event) {
    if (event.origin !== "https://web-sandbox.oaiusercontent.com" || event.source !== assetConsoleFrame?.contentWindow) return;
    const message = event.data;
    if (!message || message.source !== "asset-console") return;
    if (message.action === "ready") {
      clearTimeout(assetConsoleLoadTimer);
      assetConsoleLoadTimer = null;
      if (assetConsolePage && !assetConsolePage.hidden) assetConsolePage.dataset.state = "ready";
      syncAssetConsoleContext(true);
      return;
    }
    if (message.action === "load-error") {
      setAssetConsolePanel({ requestId: assetConsoleRequestId, state: "error", message: "资产页面加载失败，请重新连接。" });
      return;
    }
    if (message.action === "return-to-codex") {
      closeAssetConsolePanel();
      requestAnimationFrame(() => currentComposer()?.focus());
      return;
    }
    const single = message.action === "use-in-codex";
    const multiple = message.action === "use-many-in-codex";
    if (!single && !multiple) return;
    const assetPaths = single
      ? [typeof message.path === "string" ? message.path.trim() : ""]
      : Array.isArray(message.paths) ? message.paths.map((assetPath) => typeof assetPath === "string" ? assetPath.trim() : "") : [];
    const valid = assetPaths.length > 0
      && assetPaths.length <= 8
      && assetPaths.every((assetPath) => assetPath.length < 4096 && isAbsoluteAssetPath(assetPath));
    const context = currentCodexTaskContext();
    const added = valid && context.hostId === 'local' && message.hostId === context.hostId
      && message.threadId === context.threadId && addAssetReferencesToComposer(assetPaths);
    try {
      assetConsoleFrame.contentWindow.postMessage({
        source: "codex-sidebar-enhancer",
        action: added ? (multiple ? "assets-added" : "asset-added") : "asset-add-failed",
        count: added ? assetPaths.length : 0,
      }, event.origin);
    } catch {}
  }

  const DEFAULT_SKILL_FILTERS = ["全部", "当前任务", "常用"];
  const skillClassification = window.__nuyoahSkillClassification__;
  const SKILL_CONTEXT_STOP_WORDS = new Set(["当前", "任务", "项目", "实现", "开发", "修改", "修复", "检查", "现有", "代码", "直接", "一个", "这个", "提供", "显示", "根据"]);
  const customSkillCategories = window.__NUYOAH_WORKSTATION_CONFIG__?.skills?.categories;
  const SKILL_FILTERS = [...new Set([...DEFAULT_SKILL_FILTERS, ...(skillClassification?.labels || []),
    "未分类", ...(Array.isArray(customSkillCategories) ? customSkillCategories.map(item => item.label) : [])])];
  const skillPrimaryCategory = entry => skillClassification?.categoryFor(entry) || "未分类";

  function skillContextTerms() {
    const context = currentCodexTaskContext();
    const source = `${context.threadTitle || ""} ${context.projectName || ""}`.normalize("NFC").toLocaleLowerCase("zh-CN");
    const terms = new Set();
    for (const chunk of source.match(/[a-z0-9][a-z0-9._-]*|[\u3400-\u9fff]{2,}/gu) || []) {
      if (/^[\u3400-\u9fff]+$/u.test(chunk)) {
        if (chunk.length <= 8 && !SKILL_CONTEXT_STOP_WORDS.has(chunk)) terms.add(chunk);
        for (let index = 0; index < chunk.length - 1; index += 1) {
          const pair = chunk.slice(index, index + 2);
          if (!SKILL_CONTEXT_STOP_WORDS.has(pair)) terms.add(pair);
        }
      } else if (chunk.length >= 2) {
        terms.add(chunk);
      }
    }
    return { context, terms: [...terms] };
  }

  function skillMatchesCurrentTask(entry) {
    const { context, terms } = skillContextTerms();
    if (!context.threadId && !context.threadTitle && !context.projectName) return true;
    const text = `${entry.title} ${entry.description} ${entry.sourceDescription || ""} ${entry.name}`.toLocaleLowerCase("zh-CN");
    if (terms.some((term) => text.includes(term))) return true;
    const task = `${context.threadTitle || ""} ${context.projectName || ""}`;
    const domains = [
      [/图片|图像|海报|视觉|生图|缩略图/u, /图片|图像|海报|视觉|生图|摄影|插画|封面|资产/u],
      [/视频|短片|镜头|分镜|动画/u, /视频|导演|镜头|分镜|动画|节奏|seedance|minimax/iu],
      [/文章|写作|公众号|小红书|知乎|标题/u, /文章|写作|公众号|小红书|知乎|标题|研究/u],
      [/skill|技能|提示词/iu, /skill|技能|提示词|路由|工具/iu],
      [/资源|资产|素材|文件/u, /资源|资产|素材|文件|归档|工作台/u],
    ];
    return domains.some(([taskPattern, skillPattern]) => taskPattern.test(task) && skillPattern.test(text));
  }

  function loadSkillFavorites(catalog) {
    if (skillOrganizerFavorites) return skillOrganizerFavorites;
    try {
      const parsed = JSON.parse(localStorage.getItem(SKILL_FAVORITES_KEY) || "null");
      if (Array.isArray(parsed)) return (skillOrganizerFavorites = new Set(parsed.filter((name) => typeof name === "string")));
    } catch {}
    const initialFavorites = window.__NUYOAH_WORKSTATION_CONFIG__?.skills?.defaultFavorites;
    if (Array.isArray(initialFavorites)) {
      skillOrganizerFavorites = new Set(initialFavorites);
      try { localStorage.setItem(SKILL_FAVORITES_KEY, JSON.stringify([...skillOrganizerFavorites])); } catch {}
      return skillOrganizerFavorites;
    }
    const preferred = catalog.filter((entry) => /视频|导演|镜头|资产|工作台|提示词|知识|写作|skill/i.test(`${entry.title} ${entry.description} ${entry.name}`));
    skillOrganizerFavorites = new Set((preferred.length ? preferred : catalog).slice(0, 10).map((entry) => entry.name));
    try { localStorage.setItem(SKILL_FAVORITES_KEY, JSON.stringify([...skillOrganizerFavorites])); } catch {}
    return skillOrganizerFavorites;
  }

  function skillEntryFromCard(card) {
    const titleNode = card.querySelector(".font-medium")
      || Array.from(card.querySelectorAll("div")).find((node) => node.classList.contains("truncate"));
    const title = titleNode?.textContent?.trim() || "";
    if (!title) return null;
    const descriptionNode = card.querySelector(".text-token-text-secondary.text-sm")
      || Array.from(card.querySelectorAll("div")).find((node) => node !== titleNode && node.classList.contains("line-clamp-1"));
    return { title, description: descriptionNode?.textContent?.trim() || "打开查看 Skill 详情", card };
  }

  function skillMatchesCategory(entry, category) {
    const text = `${entry.title} ${entry.description} ${entry.sourceDescription || ""} ${entry.name}`;
    if (category === "全部") return true;
    if (category === "当前任务") return skillMatchesCurrentTask(entry);
    if (category === "常用") return skillOrganizerFavorites?.has(entry.name) === true;
    if (category === "未分类" || skillClassification?.labels.includes(category)) return skillPrimaryCategory(entry) === category;
    const configured = customSkillCategories?.find(item => item.label === category);
    return configured?.keywords.some(keyword => text.normalize('NFC').toLocaleLowerCase().includes(keyword.normalize('NFC').toLocaleLowerCase())) || false;
  }

  function clearSkillOrganizer() {
    skillOrganizerRenderGeneration += 1;
    if (skillOrganizerRenderFrame !== null) cancelAnimationFrame(skillOrganizerRenderFrame);
    skillOrganizerRenderFrame = null;
    document.getElementById(SKILL_ORGANIZER_ID)?.remove();
    document.querySelectorAll(`[${SKILL_NATIVE_SECTION_ATTR}]`).forEach((node) => node.removeAttribute(SKILL_NATIVE_SECTION_ATTR));
    skillOrganizerSource = null;
    skillOrganizerCatalog = [];
    skillOrganizerCatalogSignature = "";
    skillOrganizerFilter = "全部";
    skillOrganizerQuery = "";
    skillOrganizerNativeVisible = false;
    closeSkillContextMenu();
  }

  function syncSkillOrganizerFilterSelection(shell, selected = skillOrganizerFilter) {
    shell?.querySelectorAll("[data-codex-skill-filter]").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.codexSkillFilter === selected));
    });
  }

  function scheduleSkillOrganizerRender() {
    const generation = ++skillOrganizerRenderGeneration;
    if (skillOrganizerRenderFrame !== null) cancelAnimationFrame(skillOrganizerRenderFrame);
    skillOrganizerRenderFrame = requestAnimationFrame(() => {
      skillOrganizerRenderFrame = requestAnimationFrame(() => {
        skillOrganizerRenderFrame = null;
        if (generation !== skillOrganizerRenderGeneration) return;
        renderSkillOrganizer();
      });
    });
  }

  function selectSkillOrganizerFilter(label) {
    if (!SKILL_FILTERS.includes(label) || skillOrganizerFilter === label) return;
    skillOrganizerFilter = label;
    const shell = document.getElementById(SKILL_ORGANIZER_ID);
    if (!shell) return;
    syncSkillOrganizerFilterSelection(shell, label);
    shell.setAttribute("aria-busy", "true");
    scheduleSkillOrganizerRender();
  }

  function renderSkillOrganizer() {
    const shell = document.getElementById(SKILL_ORGANIZER_ID);
    if (!shell || (!hostSkillCatalog.length && !skillOrganizerSource?.isConnected)) return;
    loadSkillFavorites(skillOrganizerCatalog);
    if (skillOrganizerSource?.isConnected) {
      skillOrganizerSource.setAttribute(SKILL_NATIVE_SECTION_ATTR, skillOrganizerNativeVisible ? "visible" : "hidden");
    }
    const filters = shell.querySelector(".codex-skill-filter-list");
    if (!filters.childElementCount) {
      filters.append(...SKILL_FILTERS.map((label) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "codex-skill-filter";
        button.dataset.codexSkillFilter = label;
        button.textContent = label;
        button.onpointerdown = (event) => {
          if (event.button === 0) selectSkillOrganizerFilter(label);
        };
        button.onclick = () => selectSkillOrganizerFilter(label);
        return button;
      }));
    }
    syncSkillOrganizerFilterSelection(shell);
    filters.querySelectorAll("[data-codex-skill-filter]").forEach(button => {
      const label = button.dataset.codexSkillFilter;
      const count = skillOrganizerCatalog.filter(entry => skillMatchesCategory(entry, label)).length;
      button.textContent = `${label} ${count}`;
      button.setAttribute("aria-label", `${label}，${count} 个 Skill`);
    });
    renderSkillLabelNotice(shell);
    const context = currentCodexTaskContext();
    const contextCopy = shell.querySelector(".codex-skill-context");
    if (contextCopy) contextCopy.textContent = context.threadTitle
      ? `当前任务：${context.threadTitle}`
      : "当前没有选中的任务，可查看全部 Skills";
    const terms = skillOrganizerQuery.toLocaleLowerCase("zh-CN").split(/\s+/).filter(Boolean);
    const visible = skillOrganizerCatalog.filter((entry) => {
      const text = `${entry.title} ${entry.description} ${entry.sourceDescription || ""} ${entry.name} ${skillPrimaryCategory(entry)}`.toLocaleLowerCase("zh-CN");
      return terms.every((term) => text.includes(term)) && skillMatchesCategory(entry, skillOrganizerFilter);
    });
    shell.querySelector(".codex-skill-result-head strong").textContent = skillOrganizerFilter === "全部" ? "全部 Skills" : skillOrganizerFilter;
    shell.querySelector(".codex-skill-result-count").textContent = `${visible.length} / ${skillOrganizerCatalog.length}`;
    const grid = shell.querySelector(".codex-skill-grid");
    if (!visible.length) {
      const empty = document.createElement("div");
      empty.className = "codex-skill-empty";
      empty.textContent = skillOrganizerFilter === "当前任务"
        ? "当前任务没有匹配的 Skill，可切换到“全部”"
        : "没有找到匹配的 Skill";
      grid.replaceChildren(empty);
      shell.removeAttribute("aria-busy");
      return;
    }
    grid.replaceChildren(...visible.map((entry) => {
      const row = document.createElement("div");
      row.className = "codex-skill-row";
      row.dataset.labelStatus = entry.labelStatus || "pending";
      row.setAttribute("role", "button");
      row.tabIndex = 0;
      const copy = document.createElement("span");
      copy.innerHTML = '<span class="codex-skill-name"></span><span class="codex-skill-description"></span><span class="codex-skill-callable"></span><span class="codex-skill-category"></span>';
      copy.querySelector(".codex-skill-name").textContent = entry.title;
      copy.querySelector(".codex-skill-description").textContent = entry.description;
      copy.querySelector(".codex-skill-callable").textContent = entry.name;
      copy.querySelector(".codex-skill-category").textContent = skillPrimaryCategory(entry);
      const favorite = document.createElement("button");
      favorite.type = "button";
      favorite.className = "codex-skill-favorite";
      favorite.setAttribute("aria-pressed", String(skillOrganizerFavorites.has(entry.name)));
      favorite.setAttribute("aria-label", `${skillOrganizerFavorites.has(entry.name) ? "取消常用" : "加入常用"}：${entry.title}`);
      favorite.textContent = "★";
      favorite.onclick = (event) => {
        event.stopPropagation();
        if (skillOrganizerFavorites.has(entry.name)) skillOrganizerFavorites.delete(entry.name);
        else skillOrganizerFavorites.add(entry.name);
        try { localStorage.setItem(SKILL_FAVORITES_KEY, JSON.stringify([...skillOrganizerFavorites])); } catch {}
        renderSkillOrganizer();
      };
      const use = document.createElement("button");
      use.type = "button";
      use.className = "codex-skill-use";
      use.setAttribute("aria-label", `插入到任务：${entry.title}`);
      use.title = "插入到任务";
      use.textContent = "插入到任务";
      use.onclick = (event) => { event.stopPropagation(); void addSkillToConversation(entry); };
      const more = document.createElement("button");
      more.type = "button";
      more.className = "codex-skill-more";
      more.setAttribute("aria-label", `更多操作：${entry.title}`);
      more.textContent = "⋯";
      more.onclick = (event) => {
        event.stopPropagation();
        const rect = more.getBoundingClientRect();
        showSkillContextMenu(entry, rect.right, rect.bottom + 4);
      };
      const open = () => {
        if (entry.card?.isConnected) entry.card.click();
        else row.toggleAttribute("data-expanded");
      };
      row.onclick = open;
      row.onkeydown = (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); open(); } };
      row.oncontextmenu = (event) => { event.preventDefault(); showSkillContextMenu(entry, event.clientX, event.clientY); };
      row.append(copy, favorite, more, use);
      return row;
    }));
    shell.removeAttribute("aria-busy");
  }

  function ensureSkillOrganizer() {
    if (hostSkillCatalog.length) return;
    const section = document.querySelector("section#skills-installed");
    if (!section) {
      if (skillOrganizerSource) clearSkillOrganizer();
      return;
    }
    skillOrganizerSource = section;
    const expand = Array.from(section.querySelectorAll('button[aria-expanded="false"]')).find((button) => /另有|查看|展开/.test(button.textContent || ""));
    if (expand) { expand.click(); return; }
    const catalog = Array.from(section.querySelectorAll('div[role="button"][tabindex="0"]'))
      .map(skillEntryFromCard)
      .filter(Boolean)
      .sort((a, b) => a.title.localeCompare(b.title, "zh-CN"));
    if (!catalog.length) return;
    const catalogSignature = catalog.map((entry) => `${entry.title}\u0000${entry.description}`).join("\u0001");
    const catalogChanged = catalogSignature !== skillOrganizerCatalogSignature;
    if (catalogChanged) {
      skillOrganizerCatalog = catalog;
      skillOrganizerCatalogSignature = catalogSignature;
    } else {
      const currentCards = new Map(catalog.map((entry) => [entry.title, entry.card]));
      skillOrganizerCatalog.forEach((entry) => { entry.card = currentCards.get(entry.title) || entry.card; });
    }
    let shell = document.getElementById(SKILL_ORGANIZER_ID);
    let shellCreated = false;
    if (!shell || shell.nextElementSibling !== section) {
      shell?.remove();
      shell = document.createElement("section");
      shellCreated = true;
      shell.id = SKILL_ORGANIZER_ID;
      shell.innerHTML = `
        <div class="codex-skill-organizer-head"><div><h2>Skills 分组</h2><p>按工作环节整理已安装 Skill，并保留原生详情。</p></div><button type="button" class="codex-skill-native-toggle">完整列表</button></div>
        <label class="codex-skill-search"><input type="search" placeholder="搜索名称或用途" aria-label="搜索已安装 Skill"></label>
        <div class="codex-skill-filter-list" role="group" aria-label="Skills 分组"></div>
        <div class="codex-skill-result-head"><strong>已安装 Skills</strong><span class="codex-skill-result-count"></span></div>
        <div class="codex-skill-grid"></div>`;
      shell.querySelector("input").oninput = (event) => { skillOrganizerQuery = event.target.value.trim(); renderSkillOrganizer(); };
      shell.querySelector(".codex-skill-native-toggle").onclick = () => { skillOrganizerNativeVisible = !skillOrganizerNativeVisible; renderSkillOrganizer(); };
      section.parentElement?.insertBefore(shell, section);
    }
    if (shellCreated || catalogChanged) renderSkillOrganizer();
    finishSkillsGroupingOpen();
  }

  function updateSkillsGroupingShortcutState() {
    const button = Array.from(document.querySelectorAll("[data-codex-sidebar-shortcut-card]"))
      .find((candidate) => candidate.dataset.codexSidebarShortcutName === "Skills 分组");
    if (!button) return;
    const shell = document.getElementById(SKILL_ORGANIZER_ID);
    const active = skillOrganizerOpening || Boolean(shell && !shell.hidden);
    button.dataset.active = String(active);
    button.setAttribute("aria-current", String(active));
    const label = button.querySelector(`.${SHORTCUT_LABEL_CLASS}`);
    if (skillOrganizerOpening) {
      button.setAttribute("aria-busy", "true");
      button.setAttribute("aria-label", "正在打开 Skills 分组");
      if (label) label.textContent = "正在打开…";
    } else {
      button.removeAttribute("aria-busy");
      button.setAttribute("aria-label", "打开Skills 分组");
      if (label) label.textContent = "Skills 分组";
    }
  }

  function finishSkillsGroupingOpen() {
    skillOrganizerOpening = false;
    skillOrganizerOpenObserver?.disconnect();
    skillOrganizerOpenObserver = null;
    if (skillOrganizerOpenTimer !== null) clearTimeout(skillOrganizerOpenTimer);
    skillOrganizerOpenTimer = null;
    try { localStorage.removeItem(SKILL_OPEN_REQUEST_STORAGE_KEY); } catch {}
    updateSkillsGroupingShortcutState();
  }

  function insertPlainTextIntoComposer(text) {
    const composer = currentComposer();
    if (!composer || !text) return false;
    composer.focus();
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(composer);
    range.collapse(false);
    selection?.removeAllRanges();
    selection?.addRange(range);
    let inserted = false;
    try { inserted = document.execCommand("insertText", false, text); } catch {}
    if (!inserted) range.insertNode(document.createTextNode(text));
    composer.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
    return true;
  }

  async function addSkillToConversation(entry) {
    closeSkillContextMenu();
    let added = false;
    try {
      added = !window.__nuyoahMultiChat__?.isOpen?.() && await window.__codexTaskboardInjection__?.addSkillToComposer?.({
        skillDisplayName: entry.sourceTitle || entry.name || entry.title,
        skillName: entry.name || entry.title,
        skillPath: entry.mentionPath || entry.path || "",
      }) === true;
    } catch {}
    if (!added) added = insertPlainTextIntoComposer(`${currentComposer()?.textContent?.trim() ? " " : ""}$${entry.name || entry.title} `);
    const useButton = Array.from(document.querySelectorAll(`#${SKILL_ORGANIZER_ID} .codex-skill-use`))
      .find((button) => button.getAttribute("aria-label") === `插入到任务：${entry.title}`);
    if (useButton) useButton.textContent = added ? "已插入" : "插入失败";
    return added;
  }

  function requestSkillLabels(mode, id = "") {
    if (skillLabelGenerationActive || skillCatalogRefreshActive || pendingSkillLabelRequest) return false;
    if (!(mode === "missing" || mode === "all" || (mode === "single" && id))) return false;
    pendingSkillLabelRequest = { mode, ...(id ? { id } : {}) };
    skillLabelGenerationActive = true;
    skillLabelPromptHandled = true;
    closeSkillContextMenu();
    skillOrganizerCatalog = skillOrganizerCatalog.map((entry) => {
      const affected = (mode === "all" && entry.labelStatus !== "unverified")
        || (mode === "missing" && entry.labelStatus === "pending")
        || (mode === "single" && entry.id === id && entry.labelStatus !== "unverified");
      return affected ? { ...entry, title: "正在生成中文标题和简介…", description: "正在生成中文简介…", labelStatus: "generating" } : entry;
    });
    renderSkillOrganizer();
    return true;
  }

  function requestSkillCatalogRefresh() {
    if (skillLabelGenerationActive || skillCatalogRefreshActive || pendingSkillLabelRequest) return false;
    pendingSkillLabelRequest = { mode: "refresh" };
    skillCatalogRefreshActive = true;
    const shell = document.getElementById(SKILL_ORGANIZER_ID);
    const button = shell?.querySelector(".codex-skill-refresh");
    shell?.setAttribute("aria-busy", "true");
    if (button) {
      button.disabled = true;
      button.setAttribute("aria-busy", "true");
      button.textContent = "…";
    }
    return true;
  }

  function takeSkillLabelRequest() {
    const request = pendingSkillLabelRequest;
    pendingSkillLabelRequest = null;
    return request;
  }

  function renderSkillLabelNotice(shell) {
    const notice = shell.querySelector(".codex-skill-label-notice");
    if (!notice) return;
    const pendingCount = skillOrganizerCatalog.filter((entry) => entry.labelStatus === "pending").length;
    const visible = skillLabelGenerationActive || (!skillLabelPromptHandled && pendingCount > 0);
    notice.hidden = !visible;
    if (!visible) return;
    notice.querySelector("span").textContent = skillLabelGenerationActive
      ? "正在生成中文标题和简介…"
      : `${pendingCount} 个 Skill 待生成中文标题和简介`;
    const actions = notice.querySelector(".codex-skill-label-notice-actions");
    actions.hidden = skillLabelGenerationActive;
  }

  function positionSkillMenu(menu, x, y) {
    document.body.appendChild(menu);
    const rect = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - rect.width - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - rect.height - 8))}px`;
    skillContextMenu = menu;
  }

  function closeSkillContextMenu() {
    skillContextMenu?.remove();
    skillContextMenu = null;
  }

  function showSkillPageMenu(anchor) {
    closeSkillContextMenu();
    const menu = document.createElement("div");
    menu.className = "codex-skill-context-menu";
    menu.setAttribute("role", "menu");
    const pending = document.createElement("button");
    pending.type = "button";
    pending.textContent = "生成缺失中文标题和简介";
    pending.disabled = skillLabelGenerationActive || skillCatalogRefreshActive || !hostSkillCatalog.some((entry) => entry.labelStatus === "pending");
    pending.onclick = () => requestSkillLabels("missing");
    const redo = document.createElement("button");
    redo.type = "button";
    redo.textContent = "重做全部中文标题和简介";
    redo.disabled = skillLabelGenerationActive || skillCatalogRefreshActive || !hostSkillCatalog.some((entry) => entry.labelStatus !== "unverified");
    redo.onclick = () => requestSkillLabels("all");
    menu.append(pending, redo);
    const rect = anchor.getBoundingClientRect();
    positionSkillMenu(menu, rect.right, rect.bottom + 4);
  }

  function showSkillContextMenu(entry, x, y) {
    closeSkillContextMenu();
    const menu = document.createElement("div");
    menu.className = "codex-skill-context-menu";
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "插入到任务";
    button.onclick = () => void addSkillToConversation(entry);
    const regenerate = document.createElement("button");
    regenerate.type = "button";
    regenerate.textContent = entry.labelStatus === "ready" ? "重做中文标题和简介" : "生成中文标题和简介";
    regenerate.disabled = skillLabelGenerationActive || skillCatalogRefreshActive || !entry.id || entry.labelStatus === "unverified";
    regenerate.onclick = () => requestSkillLabels("single", entry.id);
    menu.append(button, regenerate);
    positionSkillMenu(menu, x, y);
  }

  function createHostSkillOrganizer() {
    const shell = document.createElement("section");
    shell.id = SKILL_ORGANIZER_ID;
    shell.hidden = true;
    shell.dataset.nuyoahWorkstationFrame = "true";
    shell.innerHTML = `
      <div class="codex-skill-organizer-head"><div><h2>Skills</h2><p>筛选并插入到当前任务</p></div><div class="codex-skill-head-actions"><button type="button" class="codex-skill-refresh" aria-label="刷新当前可调用 Skills" title="刷新当前可调用 Skills">↻</button><button type="button" class="codex-skill-page-menu" aria-label="Skills 页面菜单">⋯</button></div></div>
      <div class="codex-skill-label-notice" hidden><span></span><div class="codex-skill-label-notice-actions"><button type="button" class="codex-skill-label-later">稍后</button><button type="button" class="codex-skill-label-generate">生成全部</button></div></div>
      <p class="codex-skill-context"></p>
      <label class="codex-skill-search"><input type="search" placeholder="搜索名称或用途" aria-label="搜索已安装 Skill"></label>
      <div class="codex-skill-filter-list" role="group" aria-label="Skills 分组"></div>
      <div class="codex-skill-result-head"><strong>已安装 Skills</strong><span class="codex-skill-result-count"></span></div>
      <div class="codex-skill-grid"></div>`;
    shell.prepend(createWorkstationHeader("skills"));
    shell.querySelector("input").oninput = (event) => { skillOrganizerQuery = event.target.value.trim(); renderSkillOrganizer(); };
    shell.querySelector(".codex-skill-refresh").onclick = () => requestSkillCatalogRefresh();
    shell.querySelector(".codex-skill-page-menu").onclick = (event) => { event.stopPropagation(); showSkillPageMenu(event.currentTarget); };
    shell.querySelector(".codex-skill-label-later").onclick = () => { skillLabelPromptHandled = true; renderSkillOrganizer(); };
    shell.querySelector(".codex-skill-label-generate").onclick = () => requestSkillLabels("missing");
    return initializeWorkspacePanel(shell, "skills");
  }

  function closeSkillsGrouping(restoreFocus = true) {
    const shell = document.getElementById(SKILL_ORGANIZER_ID);
    if (shell) shell.hidden = true;
    closeSkillContextMenu();
    skillOrganizerOpening = false;
    updateSkillsGroupingShortcutState();
    if (restoreFocus) currentComposer()?.focus();
  }

  function openSkillsGrouping(options = {}) {
    const mount = findCustomShortcutPageMount();
    if (!mount) return false;
    closeOtherWorkspacePanels("skills");
    let shell = document.getElementById(SKILL_ORGANIZER_ID);
    if (!shell || !hostSkillCatalog.length) {
      shell?.remove();
      shell = createHostSkillOrganizer();
    }
    if (shell.parentElement !== mount.surface) mount.surface.appendChild(shell);
    skillOrganizerCatalog = hostSkillCatalog.slice();
    skillOrganizerCatalogSignature = skillOrganizerCatalog.map((entry) => `${entry.name}\u0000${entry.description}`).join("\u0001");
    if (typeof options?.query === "string") {
      skillOrganizerQuery = options.query.trim();
      skillOrganizerFilter = "全部";
    }
    const input = shell.querySelector("input");
    input.value = skillOrganizerQuery;
    shell.hidden = false;
    skillOrganizerOpening = false;
    renderSkillOrganizer();
    updateSkillsGroupingShortcutState();
    if (skillOrganizerQuery) requestAnimationFrame(() => input.focus());
    return true;
  }

  function setSkillCatalog(value) {
    const previousSourceDescriptions = new Map(hostSkillCatalog.map((entry) => [entry.name, entry.sourceDescription]));
    hostSkillCatalog = (Array.isArray(value) ? value : []).flatMap((entry) => {
      const name = typeof entry?.name === "string" ? entry.name.trim() : "";
      const title = typeof entry?.title === "string" ? entry.title.trim() : name;
      if (!name || !title) return [];
      const id = typeof entry?.id === "string" && /^skill-[a-f0-9]{24}$/u.test(entry.id) ? entry.id : "";
      const labelStatus = entry?.labelStatus === "ready" || entry?.labelStatus === "unverified" ? entry.labelStatus : "pending";
      const generatedTitle = String(entry.description || "").trim();
      const generatedSummary = String(entry.summary || "").trim();
      const sourceDescription = (typeof entry?.sourceDescription === "string" ? entry.sourceDescription.trim() : "")
        || previousSourceDescriptions.get(name)
        || "";
      const displayTitle = labelStatus !== "unverified" && generatedTitle && generatedTitle !== "待生成"
        ? generatedTitle
        : labelStatus === "unverified" ? "清单待验证" : "待生成中文标题";
      const displayDescription = labelStatus === "ready" && generatedSummary
        ? generatedSummary
        : labelStatus === "unverified" ? "当前清单来源尚未验证" : "待生成中文简介";
      return [{
        name,
        title: displayTitle,
        sourceTitle: title,
        id,
        labelStatus,
        description: displayDescription,
        sourceDescription,
        path: String(entry.path || ""),
        mentionPath: String(entry.mentionPath || entry.path || ""),
      }];
    });
    skillLabelGenerationActive = false;
    skillCatalogRefreshActive = false;
    const shell = document.getElementById(SKILL_ORGANIZER_ID);
    const refresh = shell?.querySelector(".codex-skill-refresh");
    if (refresh) {
      refresh.disabled = false;
      refresh.removeAttribute("aria-busy");
      refresh.textContent = "↻";
    }
    if (shell && !shell.hidden) {
      skillOrganizerCatalog = hostSkillCatalog.slice();
      renderSkillOrganizer();
    }
  }

  function resumeSkillsGroupingOpenRequest() {
    if (hostSkillCatalog.length) return;
    if (skillOrganizerOpening || document.getElementById(SKILL_ORGANIZER_ID)) return;
    let requestedAt = 0;
    try { requestedAt = Number(localStorage.getItem(SKILL_OPEN_REQUEST_STORAGE_KEY)); } catch {}
    if (!Number.isFinite(requestedAt) || requestedAt <= 0) return;
    if (Date.now() - requestedAt > SKILL_OPEN_REQUEST_TTL_MS) {
      try { localStorage.removeItem(SKILL_OPEN_REQUEST_STORAGE_KEY); } catch {}
      return;
    }
    openSkillsGrouping();
  }

  function iconChoiceButton(icon, selected = false) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.codexShortcutIcon = icon;
    button.setAttribute("aria-label", `图标 ${icon}`);
    button.setAttribute("aria-pressed", String(selected));
    button.innerHTML = presetShortcutSvg(icon);
    button.onclick = () => {
      button.parentElement.querySelectorAll("[data-codex-shortcut-icon]")
        .forEach((candidate) => candidate.setAttribute("aria-pressed", String(candidate === button)));
    };
    return button;
  }

  function renderShortcutVisibilityList(dialog) {
    const list = dialog.querySelector("[data-codex-shortcut-visibility-list]");
    const items = shortcutCatalog.filter((item) => item.kind !== "settings");
    list.replaceChildren(...items.map((item) => {
      const row = document.createElement("label");
      row.className = "codex-shortcut-settings-row";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = !shortcutSettings.hidden.includes(shortcutItemKey(item));
      checkbox.dataset.codexShortcutVisible = shortcutItemKey(item);
      checkbox.setAttribute("aria-label", `显示${item.name}`);
      checkbox.onchange = () => {
        const key = shortcutItemKey(item);
        shortcutSettings.hidden = checkbox.checked
          ? shortcutSettings.hidden.filter((value) => value !== key)
          : [...shortcutSettings.hidden.filter((value) => value !== key), key];
        persistShortcutSettings();
        document.getElementById(SHORTCUT_GRID_ID)?.remove();
        scheduleSync();
      };
      const name = document.createElement("span");
      name.textContent = item.name;
      row.append(checkbox, name);
      if (item.custom) {
        const remove = document.createElement("button");
        remove.type = "button";
        remove.dataset.codexShortcutDelete = item.id;
        remove.setAttribute("aria-label", `删除${item.name}`);
        remove.textContent = "删除";
        remove.onclick = (event) => {
          event.preventDefault();
          shortcutSettings.custom = shortcutSettings.custom.filter((candidate) => candidate.id !== item.id);
          shortcutSettings.hidden = shortcutSettings.hidden.filter((value) => value !== shortcutItemKey(item));
          persistShortcutSettings();
          document.getElementById(SHORTCUT_GRID_ID)?.remove();
          scheduleSync();
          shortcutCatalog = shortcutCatalog.filter((candidate) => candidate.id !== item.id);
          renderShortcutVisibilityList(dialog);
        };
        row.appendChild(remove);
      }
      return row;
    }));
  }

  function createShortcutSettingsDialog() {
    const dialog = document.createElement("dialog");
    dialog.id = SHORTCUT_SETTINGS_ID;
    dialog.innerHTML = `
      <div class="codex-shortcut-settings-shell">
        <header class="codex-shortcut-settings-header">
          <h2>快捷入口设置</h2>
          <button type="button" data-codex-shortcut-settings-close aria-label="关闭设置">×</button>
        </header>
        <div class="codex-shortcut-settings-body">
          <h3>显示与隐藏</h3>
          <div class="codex-shortcut-settings-list" data-codex-shortcut-visibility-list></div>
          <form data-codex-shortcut-custom-form>
            <h3>新建快捷入口</h3>
            <label class="codex-shortcut-field">名称<input type="text" name="name" maxlength="24" required placeholder="例如：知识卡片"></label>
            <label class="codex-shortcut-field">链接<input type="url" name="url" required placeholder="https://example.com"></label>
            <div class="codex-shortcut-field">图标<div class="codex-shortcut-icon-options" data-codex-shortcut-icons></div></div>
            <div class="codex-shortcut-field">打开方式<div class="codex-shortcut-open-modes">
              <label><input type="radio" name="openMode" value="internal" checked>内置打开</label>
              <label><input type="radio" name="openMode" value="browser">浏览器打开</label>
            </div></div>
            <div data-codex-shortcut-error role="alert"></div>
            <button type="submit" data-codex-shortcut-save>新建快捷入口</button>
          </form>
        </div>
      </div>`;
    const icons = dialog.querySelector("[data-codex-shortcut-icons]");
    icons.replaceChildren(...Object.keys(SHORTCUT_ICON_PRESETS).map((icon, index) => iconChoiceButton(icon, index === 0)));
    dialog.querySelector("[data-codex-shortcut-settings-close]").onclick = () => dialog.close();
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) dialog.close();
    });
    dialog.querySelector("[data-codex-shortcut-custom-form]").onsubmit = (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const name = form.elements.name.value.trim().slice(0, 24);
      const url = validShortcutUrl(form.elements.url.value);
      const error = form.querySelector("[data-codex-shortcut-error]");
      if (!name || !url) {
        error.textContent = "请填写名称和有效的 http(s) 链接";
        return;
      }
      const icon = form.querySelector('[data-codex-shortcut-icon][aria-pressed="true"]')?.dataset.codexShortcutIcon || "link";
      const openMode = form.elements.openMode.value === "browser" ? "browser" : "internal";
      shortcutSettings.custom.push({
        id: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`,
        name,
        url,
        icon,
        openMode,
        custom: true,
      });
      persistShortcutSettings();
      form.reset();
      form.querySelector('input[name="openMode"][value="internal"]').checked = true;
      form.querySelectorAll("[data-codex-shortcut-icon]").forEach((button, index) => button.setAttribute("aria-pressed", String(index === 0)));
      error.textContent = "";
      document.getElementById(SHORTCUT_GRID_ID)?.remove();
      dialog.close();
      scheduleSync();
    };
    document.body.appendChild(dialog);
    return dialog;
  }

  function openShortcutSettings() {
    let dialog = document.getElementById(SHORTCUT_SETTINGS_ID);
    if (!dialog) dialog = createShortcutSettingsDialog();
    renderShortcutVisibilityList(dialog);
    if (!dialog.open) dialog.showModal();
  }

  function shortcutLabel(button) {
    return button?.querySelector(".text-fade-truncate")?.textContent?.trim()
      || button?.getAttribute("title")
      || button?.getAttribute("aria-label")?.replace(/^打开/u, "")
      || "快捷入口";
  }

  function findNativeShortcutButton(name) {
    const names = Array.isArray(name) ? name : [name];
    return Array.from(document.querySelectorAll("button")).find((button) =>
      !button.closest(`#${SHORTCUT_GRID_ID}`) && names.includes(shortcutLabel(button)),
    );
  }

  function shortcutGroupButtons(group) {
    return Array.from(group?.querySelectorAll(":scope > button, :scope > * > button") || [])
      .filter((button) => button instanceof HTMLButtonElement && !button.closest(`#${SHORTCUT_GRID_ID}`));
  }

  function shortcutSiblingGroup(button) {
    let candidate = button?.parentElement;
    while (candidate && !candidate.matches("nav, [data-app-action-sidebar-scroll]")) {
      const buttons = shortcutGroupButtons(candidate);
      if (buttons.includes(button) && buttons.length >= 3) return candidate;
      candidate = candidate.parentElement;
    }
    return null;
  }

  function nativeShortcutSources() {
    const newConversation = findNativeShortcutButton("新对话");
    const pullRequests = findNativeShortcutButton(["拉取请求", "Pull Request"]);
    const navigationGroup = shortcutSiblingGroup(pullRequests);
    const newConversationRow = newConversation?.parentElement;
    const header = newConversationRow?.parentElement?.parentElement?.parentElement;
    if (!newConversation || !navigationGroup || !header) return null;

    const navigationButtons = shortcutGroupButtons(navigationGroup);
    const quickButton = Array.from(newConversationRow.children)
      .flatMap((node) => node === newConversation ? [] : Array.from(node.querySelectorAll?.("button") || []))[0] || null;
    const sourceItems = [
      { name: "新对话", button: newConversation, quickButton },
      ...navigationButtons.map((button) => ({ name: shortcutLabel(button), button, quickButton: null })),
    ].filter((item, index, values) => item.name && values.findIndex((candidate) => candidate.name === item.name) === index);
    const builtInItems = sourceItems.filter((item) => !HIDDEN_SHORTCUT_NAMES.has(item.name));
    const enhancementItems = [
      { id: "workstation", name: "工作站", kind: "enhancement", icon: "workstation", activate: () => openWorkstationPanel() },
    ];
    const catalogItems = [...builtInItems, ...enhancementItems, ...normalizedCustomShortcuts()];
    const items = catalogItems.filter((item) => !shortcutSettings.hidden.includes(shortcutItemKey(item)));
    return { header, newConversationRow, navigationGroup, sourceItems, catalogItems, items };
  }

  function shortcutIcon(source, className = SHORTCUT_ICON_CLASS, name = "", icon = "") {
    const host = document.createElement("span");
    host.className = className;
    host.setAttribute("aria-hidden", "true");
    if (name === "设置") {
      host.innerHTML = settingsShortcutSvg();
      return host;
    }
    if (icon) {
      host.innerHTML = presetShortcutSvg(icon);
      return host;
    }
    const image = source?.querySelector("svg, img")?.cloneNode(true);
    if (image) host.appendChild(image);
    return host;
  }

  function createShortcutCard(item) {
    const wrap = document.createElement("div");
    wrap.setAttribute("data-codex-sidebar-shortcut-card-wrap", "true");
    const button = document.createElement("button");
    button.type = "button";
    button.className = SHORTCUT_CARD_CLASS;
    button.dataset.codexSidebarShortcutCard = "true";
    button.dataset.codexSidebarShortcutName = item.name;
    if (item.url) button.dataset.codexSidebarShortcutUrl = item.url;
    if (item.kind === "settings") button.dataset.codexSidebarShortcutSettings = "true";
    if (item.custom) button.dataset.codexSidebarShortcutCustom = item.id;
    button.setAttribute("aria-label", item.button?.getAttribute("aria-label") || `打开${item.name}`);
    button.title = item.name;
    const label = document.createElement("span");
    label.className = SHORTCUT_LABEL_CLASS;
    label.textContent = /^Pull Requests?$/i.test(item.name) ? "合并请求" : item.name;
    button.append(shortcutIcon(item.button, SHORTCUT_ICON_CLASS, item.name, item.icon), label);
    button.onclick = () => {
      if (item.kind === "settings") openShortcutSettings();
      else if (item.kind === "enhancement") item.activate?.();
      else if (item.custom && item.openMode === "browser") openCustomShortcutInBrowser(item);
      else if (item.custom) openCustomShortcutPanel(item);
      else findNativeShortcutButton(item.name)?.click();
    };
    wrap.appendChild(button);

    if (item.quickButton) {
      const quick = document.createElement("button");
      quick.type = "button";
      quick.dataset.codexSidebarShortcutQuick = "true";
      quick.setAttribute("aria-label", item.quickButton.getAttribute("aria-label") || "快速聊天");
      quick.title = item.quickButton.getAttribute("aria-label") || "快速聊天";
      const image = item.quickButton.querySelector("svg, img")?.cloneNode(true);
      if (image) quick.appendChild(image);
      quick.onclick = (event) => {
        event.preventDefault();
        event.stopPropagation();
        nativeShortcutSources()?.sourceItems
          .find((candidate) => candidate.name === item.name)?.quickButton?.click();
      };
      wrap.appendChild(quick);
    }
    return wrap;
  }

  function updateShortcutCard(grid, item) {
    const button = Array.from(grid.querySelectorAll("[data-codex-sidebar-shortcut-card]"))
      .find((candidate) => item.custom
        ? candidate.dataset.codexSidebarShortcutCustom === item.id
        : candidate.dataset.codexSidebarShortcutName === item.name);
    if (!button) return;
    if (!item.button) {
      button.disabled = false;
      const active = item.id === "workstation" && Boolean(
        (projectOverviewPage && !projectOverviewPage.hidden)
        || (assetConsolePage && !assetConsolePage.hidden)
        || (document.getElementById(SKILL_ORGANIZER_ID) && !document.getElementById(SKILL_ORGANIZER_ID).hidden)
        || document.documentElement.getAttribute("data-codex-taskboard-open") === "true",
      );
      button.dataset.active = String(active);
      button.setAttribute("aria-current", String(active));
      if (item.id === "workstation" && skillOrganizerOpening) button.setAttribute("aria-busy", "true");
      else button.removeAttribute("aria-busy");
      button.setAttribute("aria-label", item.kind === "settings" ? "管理快捷入口" : `打开${item.name}`);
      button.closest("[data-codex-sidebar-shortcut-card-wrap]")
        ?.querySelector(".codex-sidebar-shortcut-status")?.remove();
      return;
    }
    button.disabled = item.button.disabled;
    const state = item.button.getAttribute("data-state");
    const active = item.button.getAttribute("aria-current") === "page"
      || item.button.getAttribute("data-active") === "true"
      || state === "open" || state === "active" || state === "selected";
    button.dataset.active = String(active);
    button.setAttribute("aria-label", item.button.getAttribute("aria-label") || item.name);
    const wrap = button.closest("[data-codex-sidebar-shortcut-card-wrap]");
    const hasStatus = item.button.children.length > 1;
    let status = wrap?.querySelector(".codex-sidebar-shortcut-status");
    if (hasStatus && !status) {
      status = document.createElement("span");
      status.className = "codex-sidebar-shortcut-status";
      status.setAttribute("aria-hidden", "true");
      wrap.appendChild(status);
    } else if (!hasStatus) {
      status?.remove();
    }
  }

  function clearShortcutEnhancement() {
    document.getElementById(SHORTCUT_GRID_ID)?.remove();
    document.querySelectorAll("[data-codex-sidebar-shortcut-source-hidden]").forEach((node) => {
      node.removeAttribute("data-codex-sidebar-shortcut-source-hidden");
    });
    document.querySelectorAll("[data-codex-sidebar-shortcut-source-group-hidden]").forEach((node) => {
      node.removeAttribute("data-codex-sidebar-shortcut-source-group-hidden");
    });
    document.querySelectorAll("[data-codex-sidebar-shortcut-source-name]").forEach((node) => {
      node.removeAttribute("data-codex-sidebar-shortcut-source-name");
    });
    shortcutSources = new Map();
    shortcutCatalog = [];
  }

  function ensureShortcutGrid() {
    const sources = nativeShortcutSources();
    if (!sources || sources.items.length < 2) {
      if (document.getElementById(SHORTCUT_GRID_ID)) clearShortcutEnhancement();
      return;
    }
    let grid = document.getElementById(SHORTCUT_GRID_ID);
    const needsRebuild = grid?.dataset.codexPreviewRuntime !== RUNTIME_TOKEN
      || grid?.parentElement !== sources.header
      || grid?.children.length !== sources.items.length
      || sources.items.some((item) => shortcutSources.get(shortcutItemKey(item)) !== (item.button || item.id || item.url || item.kind));
    if (needsRebuild) {
      clearShortcutEnhancement();
      grid = document.createElement("div");
      grid.id = SHORTCUT_GRID_ID;
      grid.setAttribute("role", "group");
      grid.setAttribute("aria-label", "快捷入口");
      grid.dataset.codexPreviewRuntime = RUNTIME_TOKEN;
      grid.replaceChildren(...sources.items.map(createShortcutCard));
      sources.header.appendChild(grid);
      shortcutSources = new Map(sources.items.map((item) => [shortcutItemKey(item), item.button || item.id || item.url || item.kind]));
    }
    shortcutCatalog = sources.catalogItems;
    sources.newConversationRow.setAttribute("data-codex-sidebar-shortcut-source-hidden", "true");
    sources.navigationGroup.setAttribute("data-codex-sidebar-shortcut-source-group-hidden", "true");
    for (const item of sources.sourceItems) {
      item.button.dataset.codexSidebarShortcutSourceName = item.name;
    }
    for (const item of sources.items) {
      updateShortcutCard(grid, item);
    }
  }

  function sectionLabel(button) {
    return button?.querySelector("span.min-w-0.truncate")?.textContent?.trim()
      || button?.textContent?.trim()
      || "";
  }

  function nativeSectionSource(name) {
    const button = Array.from(document.querySelectorAll("button[data-app-action-sidebar-section-toggle]"))
      .find((candidate) => !candidate.closest(`#${SECTION_TABS_ID}`) && sectionLabel(candidate) === name);
    if (!button) return null;
    let heading = button.parentElement;
    while (heading && !heading.classList.contains("group/nav-section-title")) heading = heading.parentElement;
    const section = heading?.closest("section");
    if (!heading || !section) return null;
    return { name, button, heading, section, panelHost: null, actions: null };
  }

  function commonAncestor(nodes) {
    if (!nodes.length) return null;
    let candidate = nodes[0]?.parentElement;
    while (candidate && !nodes.every((node) => candidate.contains(node))) candidate = candidate.parentElement;
    return candidate;
  }

  function topLevelPanelHost(section, common) {
    let host = section;
    while (host?.parentElement && host.parentElement !== common) host = host.parentElement;
    return host?.parentElement === common ? host : section;
  }

  function nativeSectionSources() {
    const items = NATIVE_SECTION_NAMES.map(nativeSectionSource);
    if (items.some((item) => !item)) return null;
    const common = commonAncestor(items.map((item) => item.section));
    if (!common) return null;
    for (const item of items) item.panelHost = topLevelPanelHost(item.section, common);
    const existingActions = document.querySelector(`#${SECTION_TABS_ID} [data-codex-sidebar-project-actions-source]`);
    items.find((item) => item.name === "项目").actions = items.find((item) => item.name === "项目").heading.children[1]
      || existingActions
      || null;
    return { common, items };
  }

  function nativePrioritySource() {
    const list = Array.from(document.querySelectorAll('[role="list"]')).find((candidate) => {
      if (!candidate.querySelector(ROW_SELECTOR)) return false;
      return Array.from(candidate.querySelectorAll("div,span,h1,h2,h3,h4")).some((node) =>
        node.childElementCount === 0 && node.textContent?.trim() === "优先级",
      );
    });
    return list?.parentElement ? { common: list.parentElement, list } : null;
  }

  function sectionIdPart(name) {
    return name === "置顶" ? "pinned" : name === "项目" ? "projects" : name === "最近" ? "recent" : "interrupted";
  }

  function sectionPanelId(name) {
    return name === "中断" ? INTERRUPTED_PANEL_ID : `codex-sidebar-section-panel-${sectionIdPart(name)}`;
  }

  function setNativeSectionExpanded(item, desired) {
    const expanded = item.button.getAttribute("aria-expanded") === "true";
    if (expanded === desired) {
      sectionTogglePending.delete(item.name);
      return;
    }
    const pending = sectionTogglePending.get(item.name);
    if (pending?.button === item.button && pending.desired === desired && Date.now() - pending.startedAt < 1_200) return;
    sectionTogglePending.set(item.name, { button: item.button, desired, startedAt: Date.now() });
    item.button.click();
  }

  function updateSectionTabState(items, { syncNative = true } = {}) {
    const bar = document.getElementById(SECTION_TABS_ID);
    if (!bar || !activeSectionTab) return;
    for (const item of items) {
      const selected = item.name === activeSectionTab;
      const part = sectionIdPart(item.name);
      const tab = bar.querySelector(`[data-codex-sidebar-section-tab="${item.name}"]`);
      tab?.setAttribute("aria-selected", String(selected));
      if (tab) tab.tabIndex = selected ? 0 : -1;
      item.panelHost.hidden = !selected;
      item.section.hidden = !selected;
      item.section.id = sectionPanelId(item.name);
      item.section.setAttribute("role", "tabpanel");
      item.section.setAttribute("aria-labelledby", `codex-sidebar-section-tab-${part}`);
      item.section.dataset.codexSidebarSectionPanel = item.name;
      if (item.heading) item.heading.dataset.codexSidebarSectionHeadingHidden = "true";
      if (syncNative && !item.virtual) {
        const keepMountedForVirtualTab = activeSectionTab === "中断" && item.name === "最近";
        setNativeSectionExpanded(item, selected || keepMountedForVirtualTab);
      }
    }
    const actions = bar.querySelector("[data-codex-sidebar-project-actions]");
    if (actions) actions.hidden = activeSectionTab !== "项目";
  }

  function selectSectionTab(name, { focus = false } = {}) {
    if (!SECTION_NAMES.includes(name)) return;
    activeSectionTab = name;
    try { localStorage.setItem(SECTION_TAB_STORAGE_KEY, name); } catch {}
    const items = SECTION_NAMES.map((sectionName) => sectionSources.get(sectionName)).filter(Boolean);
    updateSectionTabState(items);
    const tab = document.querySelector(`#${SECTION_TABS_ID} [data-codex-sidebar-section-tab="${name}"]`);
    if (focus) tab?.focus();
    scheduleSync();
  }

  function handleSectionTabKeydown(event) {
    const current = event.currentTarget?.dataset?.codexSidebarSectionTab;
    const index = SECTION_NAMES.indexOf(current);
    if (index < 0) return;
    let next = null;
    if (event.key === "ArrowRight") next = SECTION_NAMES[(index + 1) % SECTION_NAMES.length];
    else if (event.key === "ArrowLeft") next = SECTION_NAMES[(index - 1 + SECTION_NAMES.length) % SECTION_NAMES.length];
    else if (event.key === "Home") next = SECTION_NAMES[0];
    else if (event.key === "End") next = SECTION_NAMES.at(-1);
    if (!next) return;
    event.preventDefault();
    selectSectionTab(next, { focus: true });
  }

  function createSectionTabs() {
    const bar = document.createElement("div");
    bar.id = SECTION_TABS_ID;
    bar.dataset.codexPreviewRuntime = RUNTIME_TOKEN;
    const tablist = document.createElement("div");
    tablist.setAttribute("role", "tablist");
    tablist.setAttribute("aria-label", "对话分组");
    for (const name of SECTION_NAMES) {
      const tab = document.createElement("button");
      const part = sectionIdPart(name);
      tab.type = "button";
      tab.id = `codex-sidebar-section-tab-${part}`;
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-controls", sectionPanelId(name));
      tab.dataset.codexSidebarSectionTab = name;
      tab.textContent = name;
      tab.onclick = () => selectSectionTab(name);
      tab.onkeydown = handleSectionTabKeydown;
      tablist.appendChild(tab);
    }
    const actions = document.createElement("div");
    actions.dataset.codexSidebarProjectActions = "true";
    actions.setAttribute("aria-label", "项目操作");
    bar.append(tablist, actions);
    return bar;
  }

  function restoreProjectActions() {
    const project = sectionSources.get("项目");
    const actions = project?.actions;
    if (!actions) return;
    actions.removeAttribute("data-codex-sidebar-project-actions-source");
    actions.querySelectorAll("button[data-codex-sidebar-project-action-source]").forEach((button) => {
      button.removeAttribute("data-codex-sidebar-project-action-source");
    });
    if (project.heading?.isConnected && actions.parentElement !== project.heading && project.heading.children.length < 2) {
      project.heading.appendChild(actions);
    }
  }

  function clearSectionEnhancement() {
    clearFolderEnhancement();
    restoreProjectActions();
    document.getElementById(RECENT_LIST_ID)?.remove();
    document.querySelectorAll(`#${INTERRUPTED_PANEL_ID}, [data-codex-sidebar-section-panel="中断"]`).forEach((panel) => {
      panel.remove();
    });
    document.querySelectorAll('[data-codex-sidebar-recent-native-hidden="true"]').forEach((node) => {
      node.removeAttribute("data-codex-sidebar-recent-native-hidden");
    });
    document.querySelectorAll('[data-codex-sidebar-priority-native-hidden="true"]').forEach((node) => {
      node.hidden = false;
      node.removeAttribute("data-codex-sidebar-priority-native-hidden");
    });
    document.getElementById(SECTION_TABS_ID)?.remove();
    document.querySelectorAll("[data-codex-sidebar-section-heading-hidden]").forEach((heading) => {
      heading.removeAttribute("data-codex-sidebar-section-heading-hidden");
    });
    document.querySelectorAll("[data-codex-sidebar-section-panel]").forEach((section) => {
      section.removeAttribute("data-codex-sidebar-section-panel");
      section.removeAttribute("role");
      section.removeAttribute("aria-labelledby");
      section.removeAttribute("id");
    });
    for (const item of sectionSources.values()) {
      item.panelHost.hidden = false;
      item.section.hidden = false;
    }
    sectionSources = new Map();
    sectionTogglePending = new Map();
    sectionSourcesMissingSince = 0;
  }

  function ensurePriorityOnlySectionTabs(source) {
    let bar = document.getElementById(SECTION_TABS_ID);
    const needsRebuild = bar?.dataset.codexPreviewRuntime !== RUNTIME_TOKEN
      || bar?.dataset.codexSidebarSectionMode !== "priority"
      || bar?.parentElement !== source.common
      || bar?.dataset.codexSidebarPriorityList !== (source.list.dataset.codexSidebarPriorityList ||= RUNTIME_TOKEN)
      || SECTION_NAMES.some((name) => !sectionSources.get(name)?.section?.isConnected);
    if (needsRebuild) {
      clearSectionEnhancement();
      source.list.dataset.codexSidebarPriorityList = RUNTIME_TOKEN;
      bar = createSectionTabs();
      bar.dataset.codexSidebarSectionMode = "priority";
      bar.dataset.codexSidebarPriorityList = RUNTIME_TOKEN;
      source.common.insertBefore(bar, source.list);
      sectionSources = new Map();
      for (const name of SECTION_NAMES) {
        const panel = document.createElement("section");
        panel.id = sectionPanelId(name);
        panel.dataset.codexPreviewRuntime = RUNTIME_TOKEN;
        panel.dataset.codexSidebarVirtualSection = name;
        panel.className = "flex flex-col";
        source.common.insertBefore(panel, source.list);
        sectionSources.set(name, {
          name,
          virtual: true,
          button: null,
          heading: null,
          section: panel,
          panelHost: panel,
          actions: null,
        });
      }
    }
    source.list.hidden = true;
    source.list.dataset.codexSidebarPriorityNativeHidden = "true";
    updateSectionTabState(SECTION_NAMES.map((name) => sectionSources.get(name)).filter(Boolean), { syncNative: false });
  }

  function ensureSectionTabs() {
    const sources = nativeSectionSources();
    if (!sources) {
      const prioritySource = nativePrioritySource();
      if (prioritySource) {
        sectionSourcesMissingSince = 0;
        if (!activeSectionTab) activeSectionTab = "项目";
        ensurePriorityOnlySectionTabs(prioritySource);
        return;
      }
      if (document.getElementById(SECTION_TABS_ID)) {
        sectionSourcesMissingSince ||= Date.now();
        if (Date.now() - sectionSourcesMissingSince < NATIVE_ANCHOR_GRACE_MS) {
          scheduleAnchorRetry();
          return;
        }
        clearSectionEnhancement();
      }
      return;
    }
    sectionSourcesMissingSince = 0;
    if (!activeSectionTab) {
      activeSectionTab = sources.items.find((item) => item.button.getAttribute("aria-expanded") === "true")?.name || "项目";
    }
    let bar = document.getElementById(SECTION_TABS_ID);
    const projectActions = sources.items.find((item) => item.name === "项目")?.actions;
    const needsRebuild = bar?.dataset.codexPreviewRuntime !== RUNTIME_TOKEN
      || bar?.parentElement !== sources.common
      || sources.items.some((item) => sectionSources.get(item.name)?.section !== item.section)
      || sectionSources.get("项目")?.actions !== projectActions
      || !sectionSources.get("中断")?.section?.isConnected;
    if (needsRebuild) {
      clearSectionEnhancement();
      bar = createSectionTabs();
      sources.common.insertBefore(bar, sources.common.firstChild);
      sectionSources = new Map(sources.items.map((item) => [item.name, item]));
      const interruptedPanel = document.createElement("section");
      interruptedPanel.id = INTERRUPTED_PANEL_ID;
      interruptedPanel.dataset.codexPreviewRuntime = RUNTIME_TOKEN;
      sources.common.insertBefore(interruptedPanel, bar.nextSibling);
      sectionSources.set("中断", {
        name: "中断",
        virtual: true,
        button: null,
        heading: null,
        section: interruptedPanel,
        panelHost: interruptedPanel,
        actions: null,
      });
    }
    const project = sources.items.find((item) => item.name === "项目");
    const actionsHost = bar.querySelector("[data-codex-sidebar-project-actions]");
    if (project?.actions && project.actions.parentElement !== actionsHost) {
      project.actions.dataset.codexSidebarProjectActionsSource = "true";
      project.actions.querySelectorAll("button").forEach((button) => {
        const label = button.getAttribute("aria-label") || "项目操作";
        button.dataset.codexSidebarProjectActionSource = label;
      });
      actionsHost.appendChild(project.actions);
    }
    updateSectionTabState(SECTION_NAMES.map((name) => sectionSources.get(name)).filter(Boolean));
  }

  function ensureGlobalRecentRows() {
    const recent = sectionSources.get("最近");
    const container = recent?.virtual ? recent.section : recent?.heading?.parentElement;
    if (!recent?.section?.isConnected || !container) return;
    const entries = recentCatalog
      .filter((entry) => !pinnedThreadIds.has(normalizedThreadId(entry.threadId)))
      .slice(0, RECENT_VISIBLE_LIMIT);
    let list = document.getElementById(RECENT_LIST_ID);
    if (!entries.length) {
      list?.remove();
      container.querySelectorAll('[data-codex-sidebar-recent-native-hidden="true"]').forEach((node) => {
        node.removeAttribute("data-codex-sidebar-recent-native-hidden");
      });
      return;
    }
    for (const child of container.children) {
      if (child !== recent.heading && child !== list) child.dataset.codexSidebarRecentNativeHidden = "true";
    }
    if (!list || list.parentElement !== container) {
      list?.remove();
      list = document.createElement("div");
      list.id = RECENT_LIST_ID;
      list.setAttribute("role", "list");
      list.setAttribute("aria-label", "全部对话，活跃优先，组内按最近使用排序");
      list.dataset.codexPreviewRuntime = RUNTIME_TOKEN;
      list.className = "flex flex-col";
      container.appendChild(list);
    }
    const signature = entries.map((entry) => `${entry.threadId}:${entry.updatedAt || ""}:${entry.title}`).join("\n");
    const currentOrder = Array.from(list.querySelectorAll("[data-codex-sidebar-recent-row]"))
      .map((row) => normalizedThreadId(row.getAttribute("data-app-action-sidebar-thread-id")))
      .join("\n");
    const expectedOrder = entries.map((entry) => normalizedThreadId(entry.threadId)).join("\n");
    if (list.dataset.signature !== signature || currentOrder !== expectedOrder) {
      list.dataset.signature = signature;
      list.replaceChildren(...entries.map((entry) => createCatalogThreadRow(entry, "recent")));
    }
  }

  function ensureVirtualPinnedRows() {
    const panel = sectionSources.get("置顶")?.section;
    if (!panel?.isConnected || !sectionSources.get("置顶")?.virtual) return;
    let list = panel.querySelector('[data-codex-sidebar-virtual-pinned-list="true"]');
    if (!list) {
      list = document.createElement("div");
      list.dataset.codexSidebarVirtualPinnedList = "true";
      list.setAttribute("role", "list");
      list.setAttribute("aria-label", "置顶对话，最新置顶优先");
      list.className = "flex flex-col";
      panel.appendChild(list);
    }
    const entries = Array.from(pinnedThreadIds, (threadId) => {
      const entry = searchCatalogByThread.get(threadId)
        || recentCatalogByThread.get(threadId)
        || interruptedCatalogByThread.get(threadId);
      return entry ? { ...entry, threadId, pinnedAt: pinnedAtForThread(threadId) } : null;
    }).filter(Boolean).sort((left, right) => right.pinnedAt - left.pinnedAt);
    const signature = entries.map((entry) => `${entry.threadId}:${entry.pinnedAt}:${entry.title}`).join("\n");
    if (list.dataset.signature === signature) return;
    list.dataset.signature = signature;
    if (entries.length) list.replaceChildren(...entries.map((entry) => createCatalogThreadRow(entry, "pinned")));
    else {
      const empty = document.createElement("div");
      empty.className = "px-3 py-8 text-center text-sm text-token-text-secondary";
      empty.textContent = "暂无置顶的对话";
      list.replaceChildren(empty);
    }
  }

  function ensureInterruptedRows() {
    const panel = sectionSources.get("中断")?.section;
    if (!panel?.isConnected) return;
    let list = document.getElementById(INTERRUPTED_LIST_ID);
    if (!list) {
      list = document.createElement("div");
      list.id = INTERRUPTED_LIST_ID;
      list.setAttribute("role", "list");
      list.setAttribute("aria-label", "已中断对话，按中断时间排序");
      list.className = "flex flex-col";
      panel.appendChild(list);
    }
    const entries = interruptedCatalog
      .filter((entry) => !pinnedThreadIds.has(normalizedThreadId(entry.threadId)))
      .slice(0, RECENT_VISIBLE_LIMIT);
    const signature = entries.map((entry) => `${entry.threadId}:${entry.updatedAt || ""}:${entry.interruptionKind || ""}`).join("\n");
    if (list.dataset.signature === signature) return;
    list.dataset.signature = signature;
    if (entries.length) {
      list.replaceChildren(...entries.map((entry) => createCatalogThreadRow(entry, "interrupted")));
    } else {
      const empty = document.createElement("div");
      empty.dataset.codexSidebarInterruptedEmpty = "true";
      empty.className = "px-3 py-8 text-center text-sm text-token-text-secondary";
      empty.textContent = "暂无中断的对话";
      list.replaceChildren(empty);
    }
  }

  function pinnedThreadStorageKey(value) {
    const id = normalizedThreadId(value);
    return id ? `local:${id}` : "";
  }

  function persistPinnedThreadTimes() {
    try { localStorage.setItem(PINNED_THREAD_TIMES_STORAGE_KEY, JSON.stringify(pinnedThreadTimes)); } catch {}
  }

  function pinnedAtForThread(value) {
    const key = pinnedThreadStorageKey(value);
    return Number(pinnedThreadTimes[key] || pinnedThreadTimes[normalizedThreadId(value)] || 0);
  }

  function sortNativePinnedRows() {
    const pinnedSection = sectionSources.get("置顶")?.section;
    if (!pinnedSection?.isConnected) return;
    const rowsByList = new Map();
    for (const row of pinnedSection.querySelectorAll(`${ROW_SELECTOR}:not([data-codex-sidebar-pinned-project-row])`)) {
      const listItem = row.closest('[role="listitem"]');
      const list = listItem?.parentElement;
      if (!listItem || list?.getAttribute("role") !== "list") continue;
      const entries = rowsByList.get(list) || [];
      entries.push({ item: listItem, pinnedAt: pinnedAtForThread(row.getAttribute("data-app-action-sidebar-thread-id")) });
      rowsByList.set(list, entries);
    }
    for (const [list, entries] of rowsByList) {
      const sorted = [...entries].sort((left, right) => right.pinnedAt - left.pinnedAt);
      if (entries.every((entry, index) => entry.item === sorted[index].item)) continue;
      for (const entry of sorted) list.appendChild(entry.item);
    }
  }

  function handlePinDocumentClick(event) {
    const button = event.target?.closest?.("button[aria-label]");
    const action = button?.getAttribute("aria-label");
    if (action !== "置顶聊天" && action !== "取消置顶聊天") return;
    const row = button.closest(ROW_SELECTOR);
    const id = normalizedThreadId(row?.getAttribute("data-app-action-sidebar-thread-id"));
    if (!id) return;
    const key = pinnedThreadStorageKey(id);
    if (action === "置顶聊天") {
      pinnedThreadIds.add(id);
      pinnedThreadTimes[key] = Date.now();
    } else {
      pinnedThreadIds.delete(id);
      delete pinnedThreadTimes[key];
      delete pinnedThreadTimes[id];
    }
    persistPinnedThreadTimes();
    scheduleSync();
  }

  function folderLastUsed(folder) {
    let latest = 0;
    for (const row of folder.querySelectorAll(ROW_SELECTOR)) {
      const time = Date.parse(previews.get(rowKey(row))?.updatedAt || "");
      if (Number.isFinite(time) && time > latest) latest = time;
    }
    return latest;
  }

  function virtualFolderSourceItems(excludedIds = new Set(), sourceIndexOffset = 0) {
    let sourceIndex = sourceIndexOffset;
    return Array.from(searchCatalogByProject, ([id, sourceEntries]) => {
      if (excludedIds.has(id)) return null;
      const { entries: catalogEntries } = dedupeFolderCatalogEntries(sourceEntries
        .filter((entry) => !pinnedThreadIds.has(normalizedThreadId(entry.threadId))));
      const label = catalogEntries.find((entry) => entry.projectName)?.projectName || id;
      const lastUsed = catalogEntries.reduce((latest, entry) => {
        const time = Date.parse(entry.updatedAt || "");
        return Number.isFinite(time) && time > latest ? time : latest;
      }, 0);
      return {
        id,
        label,
        virtual: true,
        actions: null,
        sourceIndex: sourceIndex++,
        catalogEntries,
        threadTitles: catalogEntries.map((entry) => entry.title),
        searchText: [label, ...catalogEntries.map((entry) => entry.title)].join(" "),
        lastUsed,
        active: false,
      };
    }).filter((item) => item?.id && item?.label);
  }

  function nativeFolderSources() {
    const projectSection = sectionSources.get("项目")?.section;
    const rows = Array.from(projectSection?.querySelectorAll("[data-app-action-sidebar-project-row]") || []);
    if (!rows.length) return null;
    const items = rows.flatMap((row, sourceIndex) => {
      const id = row.getAttribute("data-app-action-sidebar-project-id") || "";
      const label = row.getAttribute("data-app-action-sidebar-project-label") || row.getAttribute("aria-label") || "";
      const folder = row.closest("[data-sidebar-project-kind]");
      let listRoot = folder?.parentElement;
      while (listRoot && listRoot.getAttribute("role") !== "list") listRoot = listRoot.parentElement;
      if (!id || !label || !folder || !listRoot) return [];
      const panelHost = topLevelPanelHost(folder, listRoot);
      const existingActions = document.querySelector(`#${FOLDER_SWITCHER_ID} [data-codex-sidebar-folder-actions-source="${CSS.escape(id)}"]`);
      const rowActions = Array.from(row.children).find((child) =>
        Array.from(child.querySelectorAll?.("button") || []).some((button) =>
          button.getAttribute("aria-label") === `${label} 的项目操作`,
        ),
      );
      const threadTitles = Array.from(folder.querySelectorAll(ROW_SELECTOR))
        .filter((thread) => !pinnedThreadIds.has(normalizedThreadId(
          thread.getAttribute("data-app-action-sidebar-thread-id"),
        )))
        .map((thread) => thread.getAttribute("data-app-action-sidebar-thread-title") || "")
        .filter(Boolean);
      const rawCatalogEntries = (searchCatalogByProject.get(id) || [])
        .filter((entry) => !pinnedThreadIds.has(normalizedThreadId(entry.threadId)));
      const { entries: catalogEntries, suppressedIds: duplicateThreadIds } = dedupeFolderCatalogEntries(rawCatalogEntries);
      const catalogTitles = catalogEntries.map((entry) => entry.title);
      const catalogLastUsed = catalogEntries.reduce((latest, entry) => {
        const time = Date.parse(entry.updatedAt || "");
        return Number.isFinite(time) && time > latest ? time : latest;
      }, 0);
      return [{
        id,
        label,
        row,
        folder,
        listRoot,
        panelHost,
        actions: rowActions || existingActions || null,
        sourceIndex,
        threadTitles,
        catalogEntries,
        duplicateThreadIds,
        searchText: [label, ...threadTitles, ...catalogTitles].join(" "),
        lastUsed: Math.max(folderLastUsed(folder), catalogLastUsed),
        active: Boolean(folder.querySelector('[aria-current="page"], [data-app-action-sidebar-thread-active="true"]')),
      }];
    });
    if (!items.length || items.some((item) => item.listRoot !== items[0].listRoot)) return null;
    return { listRoot: items[0].listRoot, items };
  }

  function requestCompleteNativeFolderList(sources) {
    const expandButton = Array.from(sources.listRoot.children)
      .map((child) => child.querySelector(":scope > button"))
      .find((button) => button?.textContent?.trim() === "展开显示");
    if (!expandButton || expandButton.dataset.codexSidebarFolderListExpansionRequested === "true") return false;
    expandButton.dataset.codexSidebarFolderListExpansionRequested = "true";
    expandButton.click();
    scheduleSync();
    return true;
  }

  function normalizeFolderSearch(value) {
    return String(value || "")
      .normalize("NFKC")
      .toLocaleLowerCase()
      .replace(/[\s\p{P}\p{S}]+/gu, "");
  }

  function fuzzyFolderScore(value, query) {
    const text = normalizeFolderSearch(value);
    const needle = normalizeFolderSearch(query);
    if (!needle) return 0;
    if (!text) return Infinity;
    if (text === needle) return 0;
    if (text.startsWith(needle)) return 10 + text.length - needle.length;
    const includedAt = text.indexOf(needle);
    if (includedAt >= 0) return 30 + includedAt + (text.length - needle.length) / 100;
    let cursor = -1;
    let gaps = 0;
    for (const character of needle) {
      const next = text.indexOf(character, cursor + 1);
      if (next < 0) return Infinity;
      if (cursor >= 0) gaps += next - cursor - 1;
      cursor = next;
    }
    return 80 + gaps + (text.length - needle.length) / 100;
  }

  function rankedFolders(items, query = folderSearchQuery) {
    const needle = normalizeFolderSearch(query);
    return items
      .map((item) => ({ ...item, searchScore: needle ? fuzzyFolderScore(item.searchText, needle) : 0 }))
      .filter((item) => Number.isFinite(item.searchScore))
      .sort((left, right) => needle
        ? left.searchScore - right.searchScore || right.lastUsed - left.lastUsed || left.sourceIndex - right.sourceIndex
        : right.lastUsed - left.lastUsed || left.sourceIndex - right.sourceIndex);
  }

  function allProjectEntries() {
    return searchCatalog
      .filter((entry) => !pinnedThreadIds.has(normalizedThreadId(entry.threadId)))
      .map((entry, sourceIndex) => ({
        ...entry,
        sourceIndex,
        time: Date.parse(entry.updatedAt || ""),
      }))
      .sort((left, right) => Number(left.archived === true) - Number(right.archived === true)
        || (Number.isFinite(right.time) ? right.time : 0)
        - (Number.isFinite(left.time) ? left.time : 0)
        || left.sourceIndex - right.sourceIndex);
  }

  function normalizedThreadId(value) {
    return String(value || "").trim().replace(/^(?:local|cloud):/i, "").toLocaleLowerCase();
  }

  function normalizedThreadTitle(value) {
    return String(value || "").trim().replace(/\s+/g, " ").toLocaleLowerCase();
  }

  async function refreshPinnedProjectIds() {
    if (pinnedProjectRefresh) return pinnedProjectRefresh;
    const bridge = window.electronBridge;
    if (typeof bridge?.getInitialSidebarBootstrap !== "function") return false;
    pinnedProjectRefresh = Promise.resolve(bridge.getInitialSidebarBootstrap()).then((bootstrap) => {
      const entry = (Array.isArray(bootstrap?.globalStateEntries) ? bootstrap.globalStateEntries : [])
        .find((candidate) => candidate?.key === "pinned-project-ids");
      const next = new Set((Array.isArray(entry?.value) ? entry.value : [])
        .filter((id) => typeof id === "string" && id));
      const changed = next.size !== pinnedProjectIds.size
        || Array.from(next).some((id) => !pinnedProjectIds.has(id));
      pinnedProjectIds = next;
      if (changed && !destroyed) scheduleSync();
      return changed;
    }).catch(() => false).finally(() => {
      pinnedProjectRefresh = null;
    });
    return pinnedProjectRefresh;
  }

  function isTemporaryThreadId(value) {
    return normalizedThreadId(value).startsWith("client-new-thread:");
  }

  function dedupeFolderCatalogEntries(sourceEntries) {
    const entries = [...sourceEntries]
      .sort((left, right) => Number(left.archived === true) - Number(right.archived === true)
        || Date.parse(right.updatedAt || "") - Date.parse(left.updatedAt || ""));
    const visible = [];
    const suppressedIds = new Set();
    const newestByKey = new Map();
    for (const entry of entries) {
      const threadId = normalizedThreadId(entry.threadId);
      const title = normalizedThreadTitle(entry.title);
      const key = String(entry.dedupeKey || "").trim() || (title ? `title:${title}` : "");
      const time = Date.parse(entry.updatedAt || "");
      const newest = key ? newestByKey.get(key) : null;
      if (threadId && newest && Number.isFinite(time) && Math.abs(newest.time - time) <= FOLDER_DUPLICATE_WINDOW_MS) {
        suppressedIds.add(threadId);
        continue;
      }
      visible.push(entry);
      if (key && Number.isFinite(time)) newestByKey.set(key, { time, threadId });
    }
    return { entries: visible, suppressedIds };
  }

  function catalogMatchesForFolder(item, query = folderSearchQuery) {
    const needle = normalizeFolderSearch(query);
    if (!needle) return [];
    return (item?.catalogEntries || [])
      .map((entry) => ({ ...entry, searchScore: fuzzyFolderScore(entry.title, needle) }))
      .filter((entry) => Number.isFinite(entry.searchScore))
      .sort((left, right) => left.searchScore - right.searchScore
        || Date.parse(right.updatedAt || "") - Date.parse(left.updatedAt || ""));
  }

  function revealFolderSearchMatch(item) {
    document.querySelectorAll(`${ROW_SELECTOR}[data-codex-sidebar-search-match="true"]`).forEach((row) => {
      row.removeAttribute("data-codex-sidebar-search-match");
    });
    if (!item || item.id !== activeFolderId || !normalizeFolderSearch(folderSearchQuery)) {
      folderSearchExpansionPending = null;
      folderSearchRevealKey = "";
      return;
    }
    if (item.virtual) return;
    const matches = catalogMatchesForFolder(item);
    if (!matches.length) return;
    const matchingIds = new Set(matches.map((entry) => normalizedThreadId(entry.threadId)));
    const matchingTitles = new Set(matches.map((entry) => entry.title));
    const rows = Array.from(item.panelHost.querySelectorAll(ROW_SELECTOR));
    const match = rows.find((row) => matchingIds.has(normalizedThreadId(
      row.getAttribute("data-app-action-sidebar-thread-id"),
    ))) || rows.find((row) => matchingTitles.has(
      row.getAttribute("data-app-action-sidebar-thread-title") || "",
    ));
    if (match) {
      folderSearchExpansionPending = null;
      match.dataset.codexSidebarSearchMatch = "true";
      const revealKey = `${normalizeFolderSearch(folderSearchQuery)}:${rowKey(match)}`;
      if (folderSearchRevealKey !== revealKey) {
        folderSearchRevealKey = revealKey;
        requestAnimationFrame(() => match.scrollIntoView({ block: "nearest" }));
      }
      return;
    }
    const expandButton = Array.from(item.folder.querySelectorAll("button"))
      .find((button) => button.textContent?.trim() === "展开显示");
    if (!expandButton) return;
    if (folderSearchExpansionPending?.id === item.id
      && folderSearchExpansionPending?.rowCount === rows.length) return;
    folderSearchExpansionPending = { id: item.id, rowCount: rows.length };
    expandButton.click();
    scheduleSync();
  }

  function setNativeFolderExpanded(item) {
    if (item.row.getAttribute("aria-expanded") === "true") {
      folderTogglePending.delete(item.id);
      return;
    }
    const pending = folderTogglePending.get(item.id);
    // Empty native folders stay collapsed after a click. Remember the request
    // for this DOM node so mutation-driven syncs do not keep clicking it.
    if (pending?.row === item.row) return;
    folderTogglePending.set(item.id, { row: item.row, startedAt: Date.now() });
    item.row.click();
  }

  function restoreFolderActions() {
    const source = document.querySelector(`#${FOLDER_SWITCHER_ID} [data-codex-sidebar-folder-actions-source]`);
    if (!source) return;
    const id = source.getAttribute("data-codex-sidebar-folder-actions-source");
    const item = folderSources.get(id);
    const row = item?.row || document.querySelector(`[data-app-action-sidebar-project-id="${CSS.escape(id)}"]`);
    source.removeAttribute("data-codex-sidebar-folder-actions-source");
    source.querySelectorAll("[data-codex-sidebar-folder-action-source]").forEach((button) => {
      button.removeAttribute("data-codex-sidebar-folder-action-source");
    });
    source.querySelectorAll("[data-codex-sidebar-folder-create]").forEach((button) => {
      const originalTitle = button.getAttribute("data-codex-sidebar-folder-create-original-title");
      if (originalTitle) button.title = originalTitle;
      else button.removeAttribute("title");
      button.removeAttribute("data-codex-sidebar-folder-create");
      button.removeAttribute("data-codex-sidebar-folder-create-original-title");
    });
    if (row?.isConnected && source.parentElement !== row) {
      const selectProject = Array.from(row.children).find((child) => child.matches?.("button[data-app-action-sidebar-select-project]"));
      row.insertBefore(source, selectProject || null);
    }
  }

  function nativeFolderCreateButton(item) {
    if (!item?.actions) return null;
    const expectedLabel = `在 ${item.label} 中开始新聊天`;
    return Array.from(item.actions.querySelectorAll("button")).find((button) =>
      button.getAttribute("aria-label") === expectedLabel,
    ) || null;
  }

  function moveActiveFolderActions(item) {
    const root = document.getElementById(FOLDER_SWITCHER_ID);
    const host = root?.querySelector("[data-codex-sidebar-folder-actions]");
    if (!host) return;
    const current = host.querySelector("[data-codex-sidebar-folder-actions-source]");
    if (current && current !== item?.actions) restoreFolderActions();
    if (!item?.actions) {
      host.hidden = true;
      return;
    }
    item.actions.dataset.codexSidebarFolderActionsSource = item.id;
    item.actions.querySelectorAll("button").forEach((button) => {
      button.dataset.codexSidebarFolderActionSource = button.getAttribute("aria-label") || item.label;
    });
    const create = nativeFolderCreateButton(item);
    if (create) {
      if (!create.hasAttribute("data-codex-sidebar-folder-create-original-title")) {
        create.dataset.codexSidebarFolderCreateOriginalTitle = create.getAttribute("title") || "";
      }
      create.dataset.codexSidebarFolderCreate = item.id;
      create.title = `在“${item.label}”文件夹下创建项目`;
    }
    if (item.actions.parentElement !== host) host.appendChild(item.actions);
    host.hidden = false;
  }

  function conversationRoute(rawThreadId) {
    const threadId = String(rawThreadId || "").trim().replace(/^(?:local|cloud):/i, "");
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(threadId)
      ? `/local/${threadId}`
      : null;
  }

  function openAllProject(entry) {
    const threadId = normalizedThreadId(entry?.threadId);
    const route = conversationRoute(threadId);
    if (!route) return;
    revealThread(threadId);
    window.postMessage({ type: "navigate-to-route", path: route }, "*");
    window.setTimeout(() => revealThread(threadId), 180);
  }

  function createCatalogThreadRow(entry, kind = "all") {
    const sourceRow = document.querySelector(`${ROW_SELECTOR}:not([data-codex-sidebar-all-project-row]):not([data-codex-sidebar-pinned-project-row])`);
    const sourceItem = sourceRow?.closest('[role="listitem"]');
    const sourceTitleHost = sourceRow?.querySelector('[data-thread-title-trigger="true"]');
    const sourceTitle = sourceRow?.querySelector('[data-thread-title="true"]');
    const item = document.createElement("div");
    item.setAttribute("role", "listitem");
    item.className = sourceItem?.className || "after:block after:h-px after:content-[''] last:after:hidden";
    const row = document.createElement("div");
    row.setAttribute("role", "button");
    row.tabIndex = 0;
    row.className = sourceRow?.className
      || "group relative cursor-interaction text-sm hover:bg-token-list-hover-background focus-visible:outline-offset-[-2px] sidebar-item";
    row.dataset.appActionSidebarThreadRow = "";
    row.dataset.appActionSidebarThreadId = `local:${entry.threadId}`;
    row.dataset.appActionSidebarThreadTitle = entry.title;
    row.dataset.codexSidebarThreadArchived = String(entry.archived === true);
    if (kind === "pinned") {
      row.dataset.codexSidebarPinnedProjectRow = "true";
      row.dataset.codexSidebarPinnedAt = String(entry.pinnedAt || 0);
    } else if (kind === "recent") {
      row.dataset.codexSidebarRecentRow = "true";
      row.dataset.codexSidebarRecentUpdatedAt = entry.updatedAt || "";
    } else if (kind === "interrupted") {
      row.dataset.codexSidebarInterruptedRow = "true";
      row.dataset.codexSidebarInterruptedKind = entry.interruptionKind || "passive";
      row.dataset.codexSidebarInterruptedUpdatedAt = entry.updatedAt || "";
    } else if (kind === "folder") {
      row.dataset.codexSidebarFolderCatalogRow = "true";
      row.dataset.codexSidebarFolderCatalogUpdatedAt = entry.updatedAt || "";
    } else {
      row.dataset.codexSidebarAllProjectRow = "true";
      row.dataset.codexSidebarAllProjectId = entry.projectId;
      row.dataset.codexSidebarAllProjectUpdatedAt = entry.updatedAt || "";
    }
    row.setAttribute("aria-label", entry.projectName ? `${entry.title}，${entry.projectName}` : entry.title);
    row.onclick = () => openAllProject(entry);
    row.onkeydown = (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      openAllProject(entry);
    };
    const titleHost = document.createElement("div");
    titleHost.dataset.threadTitleTrigger = "true";
    titleHost.className = sourceTitleHost?.className || "flex min-w-0 flex-1 items-center";
    const title = document.createElement("span");
    title.dataset.threadTitle = "true";
    title.className = sourceTitle?.className || "min-w-0 truncate";
    title.textContent = entry.title;
    titleHost.appendChild(title);
    row.appendChild(titleHost);
    item.appendChild(row);
    return item;
  }

  function visibleSidebarThreadRow(threadId) {
    const rows = Array.from(document.querySelectorAll(ROW_SELECTOR))
      .filter((row) => normalizedThreadId(row.getAttribute("data-app-action-sidebar-thread-id")) === threadId);
    return rows.find((row) => row.getClientRects().length > 0) || null;
  }

  function revealThread(rawThreadId, { refreshPinnedProjects = true } = {}) {
    // Native navigation owns project expansion, selection and list order.
    if (sidebarMode !== "enhanced") return Boolean(normalizedThreadId(rawThreadId));
    const threadId = normalizedThreadId(rawThreadId);
    if (!threadId) return false;
    const entry = searchCatalogByThread.get(threadId) || recentCatalogByThread.get(threadId);
    const projectId = typeof entry?.projectId === "string" ? entry.projectId : "";
    const nativeRow = Array.from(document.querySelectorAll(ROW_SELECTOR)).find((row) => (
      normalizedThreadId(row.getAttribute("data-app-action-sidebar-thread-id")) === threadId
      && row.dataset.codexSidebarAllProjectRow !== "true"
      && row.dataset.codexSidebarRecentRow !== "true"
      && row.dataset.codexSidebarInterruptedRow !== "true"
      && row.dataset.codexSidebarFolderCatalogRow !== "true"
      && row.dataset.codexSidebarPinnedProjectRow !== "true"
    ));
    const nativeSection = nativeRow
      ?.closest('[data-codex-sidebar-section-panel]')
      ?.getAttribute("data-codex-sidebar-section-panel");
    const projectPinned = Boolean(projectId && pinnedProjectIds.has(projectId));
    const pinned = pinnedThreadIds.has(threadId) || projectPinned || nativeSection === "置顶";

    if (refreshPinnedProjects && projectId) {
      void refreshPinnedProjectIds().then(() => {
        if (!destroyed && pinnedProjectIds.has(projectId) !== projectPinned) {
          revealThread(threadId, { refreshPinnedProjects: false });
        }
      });
    }

    selectSectionTab(pinned ? "置顶" : "项目");
    if (!pinned) {
      folderSearchQuery = "";
      folderPreSearchId = null;
      folderSearchExpansionPending = null;
      folderSearchRevealKey = "";
      if (projectId && folderSources.has(projectId)) selectFolder(projectId);
      else if (folderSources.size > 0) selectFolder(ALL_FOLDER_ID);
    }

    layoutAnchored = true;
    sync();
    if (sidebarThreadRevealTimer !== null) window.clearTimeout(sidebarThreadRevealTimer);
    const deadline = Date.now() + 1_200;
    const reveal = () => {
      sidebarThreadRevealTimer = null;
      if (destroyed) return;
      const row = visibleSidebarThreadRow(threadId);
      if (row) {
        document.querySelectorAll('[data-codex-sidebar-thread-revealed="true"]').forEach((candidate) => {
          candidate.removeAttribute("data-codex-sidebar-thread-revealed");
        });
        row.dataset.codexSidebarThreadRevealed = "true";
        requestAnimationFrame(() => row.scrollIntoView({ block: "nearest" }));
        return;
      }
      if (Date.now() < deadline) sidebarThreadRevealTimer = window.setTimeout(reveal, 40);
    };
    reveal();
    return true;
  }

  function reconcileNativeFolderCatalog(item) {
    if (!item?.folder || !item?.catalogEntries?.length) return;
    const projectList = item.folder.querySelector(
      `[data-app-action-sidebar-project-list-id="${CSS.escape(item.id)}"]`,
    );
    const list = projectList?.querySelector('[role="list"]');
    if (!list) return;

    const currentItems = Array.from(list.children).filter((child) => child.getAttribute("role") === "listitem");
    const nativeById = new Map();
    const generatedById = new Map();
    const nativeRows = [];
    const nativeControlItems = [];
    const duplicateThreadIds = item.duplicateThreadIds instanceof Set
      ? item.duplicateThreadIds
      : new Set(item.duplicateThreadIds || []);
    for (const listItem of currentItems) {
      const row = listItem.querySelector(ROW_SELECTOR);
      if (!row) {
        nativeControlItems.push(listItem);
        continue;
      }
      const threadId = normalizedThreadId(row?.getAttribute("data-app-action-sidebar-thread-id"));
      if (!threadId) continue;
      if (row.dataset.codexSidebarFolderCatalogRow === "true") generatedById.set(threadId, listItem);
      else {
        nativeById.set(threadId, listItem);
        nativeRows.push({
          listItem,
          row,
          threadId,
          title: normalizedThreadTitle(row.getAttribute("data-app-action-sidebar-thread-title")),
        });
      }
    }

    // Codex initially renders a newly created conversation with a client-new-thread id,
    // then persists it under a UUID. The catalog can see that UUID before React replaces
    // the temporary row, so compare the exact title only for temporary ids during this
    // hand-off. Permanent conversations continue to be matched strictly by id.
    const catalogEntriesByTitle = new Map();
    for (const entry of item.catalogEntries) {
      const title = normalizedThreadTitle(entry.title);
      if (!title) continue;
      const entries = catalogEntriesByTitle.get(title) || [];
      entries.push(entry);
      catalogEntriesByTitle.set(title, entries);
    }
    for (const entries of catalogEntriesByTitle.values()) {
      entries.sort((left, right) => Date.parse(right.updatedAt || "") - Date.parse(left.updatedAt || ""));
    }
    const temporaryNativeCatalogId = new Map();
    const nativeAliasByCatalogId = new Map();
    const claimedCatalogIds = new Set();
    for (const native of nativeRows) {
      if (!isTemporaryThreadId(native.threadId) || !native.title) continue;
      const candidate = (catalogEntriesByTitle.get(native.title) || []).find((entry) => {
        const catalogId = normalizedThreadId(entry.threadId);
        return catalogId && !claimedCatalogIds.has(catalogId);
      });
      const catalogId = normalizedThreadId(candidate?.threadId);
      if (!catalogId) continue;
      claimedCatalogIds.add(catalogId);
      temporaryNativeCatalogId.set(native.threadId, catalogId);
      if (!nativeById.has(catalogId)) nativeAliasByCatalogId.set(catalogId, native.listItem);
    }

    const catalogById = new Map();
    const desired = item.catalogEntries.flatMap((entry, sourceIndex) => {
      const threadId = normalizedThreadId(entry.threadId);
      if (!threadId || pinnedThreadIds.has(threadId) || catalogById.has(threadId)) return [];
      catalogById.set(threadId, entry);
      const listItem = nativeById.get(threadId)
        || nativeAliasByCatalogId.get(threadId)
        || generatedById.get(threadId)
        || createCatalogThreadRow(entry, "folder");
      const row = listItem.querySelector(ROW_SELECTOR);
      if (row) {
        row.dataset.codexSidebarFolderCatalogUpdatedAt = entry.updatedAt || "";
        row.dataset.codexSidebarThreadArchived = String(entry.archived === true);
      }
      const time = Date.parse(entry.updatedAt || "");
      return [{ listItem, archived: entry.archived === true, time: Number.isFinite(time) ? time : 0, sourceIndex }];
    });

    for (const [threadId, listItem] of nativeById) {
      if (catalogById.has(threadId)
        || temporaryNativeCatalogId.has(threadId)
        || duplicateThreadIds.has(threadId)) continue;
      const row = listItem.querySelector(ROW_SELECTOR);
      const previewTime = Date.parse(previewForRow(row)?.updatedAt || "");
      desired.push({
        listItem,
        archived: false,
        time: Number.isFinite(previewTime) ? previewTime : 0,
        sourceIndex: desired.length,
      });
    }
    desired.sort((left, right) => Number(left.archived) - Number(right.archived)
      || right.time - left.time
      || left.sourceIndex - right.sourceIndex);

    // Never move or remove Codex-owned list items. React replaces the temporary
    // new-thread row while the first message is being sent; mutating that native
    // child list can make React remove a node that no longer exists and abort the
    // send. CSS order keeps the visual activity sort without changing ownership.
    list.dataset.codexSidebarFolderCatalogList = "true";
    const desiredItems = new Set();
    desired.forEach(({ listItem }, index) => {
      desiredItems.add(listItem);
      listItem.style.order = String(index);
      if (!listItem.isConnected) list.appendChild(listItem);
    });

    for (const native of nativeRows) {
      const catalogId = temporaryNativeCatalogId.get(native.threadId);
      const aliasIsVisible = catalogId && nativeAliasByCatalogId.get(catalogId) === native.listItem;
      native.listItem.toggleAttribute("data-codex-sidebar-native-alias-hidden", Boolean(catalogId && !aliasIsVisible));
      native.listItem.toggleAttribute(
        "data-codex-sidebar-semantic-duplicate-hidden",
        duplicateThreadIds.has(native.threadId),
      );
    }

    nativeControlItems.forEach((control, index) => {
      control.dataset.codexSidebarFolderControlItem = "true";
      control.style.order = String(desired.length + index);
    });

    for (const listItem of currentItems) {
      const row = listItem.querySelector(ROW_SELECTOR);
      if (row?.dataset.codexSidebarFolderCatalogRow !== "true" || desiredItems.has(listItem)) continue;
      listItem.remove();
    }
  }

  function createAllProjectRow(entry) {
    return createCatalogThreadRow(entry, "all");
  }

  function ensureAllProjectsPanel(root, entries) {
    let panel = document.getElementById(ALL_PROJECTS_PANEL_ID);
    if (panel?.dataset.codexPreviewRuntime !== RUNTIME_TOKEN || panel?.parentElement !== root.parentElement) {
      panel?.remove();
      panel = document.createElement("section");
      panel.id = ALL_PROJECTS_PANEL_ID;
      panel.dataset.codexPreviewRuntime = RUNTIME_TOKEN;
      panel.setAttribute("role", "region");
      panel.setAttribute("aria-labelledby", `codex-sidebar-folder-tag-${ALL_FOLDER_ID}`);
      root.parentElement.insertBefore(panel, root.nextElementSibling);
    }
    const signature = entries.map((entry) => `${entry.threadId}:${entry.updatedAt || ""}:${entry.title}`).join("\n");
    if (panel.dataset.signature !== signature) {
      panel.dataset.signature = signature;
      const list = document.createElement("div");
      list.setAttribute("role", "list");
      list.setAttribute("aria-label", "全部项目，活跃对话优先");
      list.dataset.codexSidebarAllProjectList = "true";
      list.className = "flex flex-col";
      list.replaceChildren(...entries.map(createAllProjectRow));
      panel.replaceChildren(list);
    }
    return panel;
  }

  function ensureVirtualFolderPanel(root, item, entries) {
    let panel = root.parentElement.querySelector(`[data-codex-sidebar-virtual-folder-panel="${CSS.escape(item.id)}"]`);
    if (!panel) {
      panel = document.createElement("section");
      panel.id = `codex-sidebar-folder-panel-${item.id}`;
      panel.dataset.codexSidebarVirtualFolderPanel = item.id;
      panel.setAttribute("role", "region");
      panel.setAttribute("aria-labelledby", `codex-sidebar-folder-tag-${item.id}`);
      root.parentElement.appendChild(panel);
    }
    const signature = entries.map((entry) => `${entry.threadId}:${entry.updatedAt || ""}:${entry.title}`).join("\n");
    if (panel.dataset.signature !== signature) {
      panel.dataset.signature = signature;
      const list = document.createElement("div");
      list.setAttribute("role", "list");
      list.setAttribute("aria-label", `${item.label} 的项目`);
      list.className = "flex flex-col";
      list.replaceChildren(...entries.map(createAllProjectRow));
      panel.replaceChildren(list);
    }
    return panel;
  }

  function selectFolder(id, { focus = false, persist = !normalizeFolderSearch(folderSearchQuery) } = {}) {
    if (id !== ALL_FOLDER_ID && !folderSources.has(id)) return;
    activeFolderId = id;
    if (persist) {
      try { localStorage.setItem(FOLDER_STORAGE_KEY, id); } catch {}
    }
    updateFolderSwitcherState(Array.from(folderSources.values()));
    const tag = document.querySelector(`#${FOLDER_SWITCHER_ID} [data-codex-sidebar-folder-tag="${CSS.escape(id)}"]`);
    if (focus) tag?.focus();
    scheduleSync();
  }

  function handleFolderTagKeydown(event) {
    const tags = Array.from(document.querySelectorAll(`#${FOLDER_SWITCHER_ID} [data-codex-sidebar-folder-tag]`));
    const index = tags.indexOf(event.currentTarget);
    if (index < 0) return;
    let next = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") next = tags[(index + 1) % tags.length];
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = tags[(index - 1 + tags.length) % tags.length];
    else if (event.key === "Home") next = tags[0];
    else if (event.key === "End") next = tags.at(-1);
    if (!next) return;
    event.preventDefault();
    selectFolder(next.dataset.codexSidebarFolderTag, { focus: true });
  }

  function createFolderTag(item) {
    const tag = document.createElement("button");
    tag.type = "button";
    tag.id = `codex-sidebar-folder-tag-${item.id}`;
    tag.dataset.codexSidebarFolderTag = item.id;
    tag.dataset.codexSidebarFolderId = item.id;
    tag.dataset.codexSidebarFolderLabel = item.label;
    tag.dataset.codexSidebarFolderLastUsed = String(item.lastUsed || 0);
    tag.setAttribute("aria-controls", item.id === ALL_FOLDER_ID
      ? ALL_PROJECTS_PANEL_ID
      : `codex-sidebar-folder-panel-${item.id}`);
    tag.setAttribute("aria-label", item.id === ALL_FOLDER_ID ? "显示全部项目" : `显示文件夹 ${item.label}`);
    tag.title = item.label;
    tag.textContent = item.label;
    tag.onclick = () => selectFolder(item.id);
    tag.onkeydown = handleFolderTagKeydown;
    return tag;
  }

  function clearFolderSearch() {
    const input = document.querySelector(`#${FOLDER_SWITCHER_ID} [data-codex-sidebar-folder-search]`);
    if (input) input.value = "";
    folderSearchQuery = "";
    folderSearchExpansionPending = null;
    folderSearchRevealKey = "";
    if (folderPreSearchId === ALL_FOLDER_ID || (folderPreSearchId && folderSources.has(folderPreSearchId))) {
      activeFolderId = folderPreSearchId;
    }
    folderPreSearchId = null;
    updateFolderSwitcherState(Array.from(folderSources.values()));
  }

  function handleFolderSearchInput(event) {
    const nextQuery = event.currentTarget.value;
    if (!normalizeFolderSearch(folderSearchQuery) && normalizeFolderSearch(nextQuery)) folderPreSearchId = activeFolderId;
    folderSearchQuery = nextQuery;
    const items = Array.from(folderSources.values());
    const results = rankedFolders(items, folderSearchQuery);
    activeFolderId = results[0]?.id || null;
    updateFolderSwitcherState(items);
  }

  function createFolderSwitcher() {
    const root = document.createElement("div");
    root.id = FOLDER_SWITCHER_ID;
    root.dataset.codexPreviewRuntime = RUNTIME_TOKEN;

    const searchRow = document.createElement("div");
    searchRow.className = "codex-sidebar-folder-search-row";
    const searchShell = document.createElement("div");
    searchShell.className = "codex-sidebar-folder-search-shell";
    const searchIcon = document.createElement("span");
    searchIcon.className = "codex-sidebar-folder-search-icon";
    searchIcon.setAttribute("aria-hidden", "true");
    searchIcon.innerHTML = '<svg width="15" height="15" viewBox="0 0 16 16" fill="none"><circle cx="7" cy="7" r="4.5" stroke="currentColor" stroke-width="1.2"/><path d="m10.5 10.5 3 3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>';
    const input = document.createElement("input");
    input.type = "search";
    input.value = folderSearchQuery;
    input.placeholder = "搜索文件夹或项目";
    input.autocomplete = "off";
    input.spellcheck = false;
    input.dataset.codexSidebarFolderSearch = "true";
    input.setAttribute("aria-label", "搜索文件夹或项目");
    input.setAttribute("aria-controls", "codex-sidebar-folder-tags");
    input.oninput = handleFolderSearchInput;
    input.onkeydown = (event) => {
      if (event.key === "Escape" && input.value) {
        event.preventDefault();
        clearFolderSearch();
      } else if (event.key === "ArrowDown") {
        const first = document.querySelector(`#${FOLDER_SWITCHER_ID} [data-codex-sidebar-folder-tag]`);
        if (first) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    const clear = document.createElement("button");
    clear.type = "button";
    clear.dataset.codexSidebarFolderClear = "true";
    clear.setAttribute("aria-label", "清除项目搜索");
    clear.title = "清除搜索";
    clear.textContent = "×";
    clear.onclick = clearFolderSearch;
    searchShell.append(searchIcon, input, clear);
    const actions = document.createElement("div");
    actions.dataset.codexSidebarFolderActions = "true";
    actions.setAttribute("aria-label", "当前文件夹操作");
    searchRow.append(searchShell, actions);

    const tags = document.createElement("div");
    tags.id = "codex-sidebar-folder-tags";
    tags.dataset.codexSidebarFolderTags = "true";
    tags.setAttribute("role", "group");
    tags.setAttribute("aria-label", "项目文件夹标签");

    const meta = document.createElement("div");
    meta.className = "codex-sidebar-folder-meta";
    const result = document.createElement("span");
    result.dataset.codexSidebarFolderResult = "true";
    result.setAttribute("role", "status");
    result.setAttribute("aria-live", "polite");
    const expand = document.createElement("button");
    expand.type = "button";
    expand.dataset.codexSidebarFolderExpand = "true";
    expand.setAttribute("aria-controls", tags.id);
    expand.onclick = () => {
      folderTagsExpanded = !folderTagsExpanded;
      updateFolderSwitcherState(Array.from(folderSources.values()));
    };
    expand.innerHTML = '<span>展开全部</span><svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="m3 4.5 3 3 3-3" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    meta.append(result, expand);
    root.append(searchRow, tags, meta);
    return root;
  }

  function updateFolderSwitcherState(items) {
    const root = document.getElementById(FOLDER_SWITCHER_ID);
    if (!root) return;
    const ranked = rankedFolders(items);
    const searching = Boolean(normalizeFolderSearch(folderSearchQuery));
    if (!searching && activeFolderId !== ALL_FOLDER_ID && !items.some((item) => item.id === activeFolderId)) {
      activeFolderId = items.find((item) => item.active)?.id || ranked[0]?.id || null;
    } else if (searching && !ranked.some((item) => item.id === activeFolderId)) {
      activeFolderId = ranked[0]?.id || null;
    }
    const allSelected = !searching && activeFolderId === ALL_FOLDER_ID;

    for (const item of items) {
      const selected = item.id === activeFolderId;
      if (item.virtual) {
        const entries = searching ? catalogMatchesForFolder(item) : item.catalogEntries;
        const panel = ensureVirtualFolderPanel(root, item, entries);
        panel.hidden = allSelected || !selected;
        continue;
      }
      item.panelHost.hidden = allSelected || !selected;
      item.panelHost.dataset.codexSidebarFolderPanel = item.label;
      item.panelHost.dataset.codexSidebarFolderPanelId = item.id;
      item.folder.id = `codex-sidebar-folder-panel-${item.id}`;
      item.folder.setAttribute("aria-labelledby", `codex-sidebar-folder-tag-${item.id}`);
      item.row.dataset.codexSidebarFolderHeadingHidden = "true";
      for (const row of item.folder.querySelectorAll(ROW_SELECTOR)) {
        const pinned = pinnedThreadIds.has(normalizedThreadId(
          row.getAttribute("data-app-action-sidebar-thread-id"),
        ));
        const listItem = row.closest('[role="listitem"]') || row;
        if (pinned) listItem.dataset.codexSidebarPinnedOutsideHidden = "true";
        else listItem.removeAttribute("data-codex-sidebar-pinned-outside-hidden");
      }
      // Request every native folder behind the single visible panel. Non-empty
      // folders mount their threads, while empty folders safely remain closed.
      // This completes recent-use sorting and project-title search even when
      // Codex originally rendered a populated folder in its collapsed state.
      setNativeFolderExpanded(item);
      if (selected) reconcileNativeFolderCatalog(item);
    }

    const entries = allProjectEntries();
    if (allSelected) ensureAllProjectsPanel(root, entries);
    else document.getElementById(ALL_PROJECTS_PANEL_ID)?.remove();

    const tags = root.querySelector("[data-codex-sidebar-folder-tags]");
    const tagItems = searching
      ? ranked
      : [{ id: ALL_FOLDER_ID, label: "全部", lastUsed: entries[0]?.time || 0 }, ...ranked];
    const signature = tagItems.map((item) => `${item.id}:${item.lastUsed}`).join("\n");
    if (tags.dataset.signature !== signature) {
      tags.dataset.signature = signature;
      tags.replaceChildren(...tagItems.map(createFolderTag));
    }
    tags.dataset.expanded = String(folderTagsExpanded);
    for (const tag of tags.querySelectorAll("[data-codex-sidebar-folder-tag]")) {
      const selected = tag.dataset.codexSidebarFolderTag === activeFolderId;
      tag.setAttribute("aria-pressed", String(selected));
      tag.tabIndex = selected ? 0 : -1;
    }

    const input = root.querySelector("[data-codex-sidebar-folder-search]");
    if (input.value !== folderSearchQuery) input.value = folderSearchQuery;
    const clear = root.querySelector("[data-codex-sidebar-folder-clear]");
    clear.hidden = !folderSearchQuery;
    const result = root.querySelector("[data-codex-sidebar-folder-result]");
    const matchingConversationCount = ranked.reduce(
      (count, item) => count + catalogMatchesForFolder(item).length,
      0,
    );
    result.textContent = allSelected
      ? `全部 ${entries.length} 个对话 · 活跃优先`
      : !ranked.length
      ? "没有匹配的项目"
      : searching
        ? `找到 ${ranked.length} 个项目 · ${matchingConversationCount} 个对话`
        : `${ranked.length} 个文件夹 · 最近使用优先`;
    const expand = root.querySelector("[data-codex-sidebar-folder-expand]");
    expand.hidden = tagItems.length <= 6;
    expand.setAttribute("aria-expanded", String(folderTagsExpanded));
    expand.querySelector("span").textContent = folderTagsExpanded ? "收起" : "展开全部";
    moveActiveFolderActions(allSelected ? null : items.find((item) => item.id === activeFolderId));
    revealFolderSearchMatch(allSelected ? null : items.find((item) => item.id === activeFolderId));
  }

  function clearFolderEnhancement() {
    restoreFolderActions();
    document.getElementById(FOLDER_SWITCHER_ID)?.remove();
    document.getElementById(ALL_PROJECTS_PANEL_ID)?.remove();
    document.querySelectorAll("[data-codex-sidebar-virtual-folder-panel]").forEach((panel) => panel.remove());
    document.querySelectorAll('[data-codex-sidebar-pinned-outside-hidden="true"]').forEach((node) => {
      node.removeAttribute("data-codex-sidebar-pinned-outside-hidden");
    });
    document.querySelectorAll("[data-codex-sidebar-folder-heading-hidden]").forEach((row) => {
      row.removeAttribute("data-codex-sidebar-folder-heading-hidden");
    });
    document.querySelectorAll("[data-codex-sidebar-folder-panel]").forEach((panel) => {
      panel.hidden = false;
      panel.removeAttribute("data-codex-sidebar-folder-panel");
      panel.removeAttribute("data-codex-sidebar-folder-panel-id");
    });
    for (const item of folderSources.values()) {
      item.folder?.removeAttribute("id");
      item.folder?.removeAttribute("aria-labelledby");
    }
    folderSources = new Map();
    folderTogglePending = new Map();
    folderSourcesMissingSince = 0;
  }

  function ensureFolderSwitcher() {
    const project = sectionSources.get("项目");
    const nativeSources = nativeFolderSources();
    if (nativeSources && requestCompleteNativeFolderList(nativeSources)) return;
    const nativeIds = new Set(nativeSources?.items.map((item) => item.id) || []);
    const virtualItems = virtualFolderSourceItems(nativeIds, nativeSources?.items.length || 0);
    const sources = nativeSources
      ? {
          listRoot: nativeSources.listRoot,
          items: [...nativeSources.items, ...virtualItems],
          sourceMode: virtualItems.length ? "hybrid" : "native",
        }
      : virtualItems.length
        ? { listRoot: project?.section, items: virtualItems, sourceMode: "virtual" }
        : null;
    const host = project?.virtual ? project.section : project?.heading?.parentElement;
    if (!project || !sources || !host) {
      if (document.getElementById(FOLDER_SWITCHER_ID)) {
        folderSourcesMissingSince ||= Date.now();
        if (Date.now() - folderSourcesMissingSince < NATIVE_ANCHOR_GRACE_MS) {
          scheduleAnchorRetry();
          return;
        }
        clearFolderEnhancement();
      }
      return;
    }
    folderSourcesMissingSince = 0;
    let root = document.getElementById(FOLDER_SWITCHER_ID);
    const signature = sources.items.map((item) => item.id).join("\n");
    const needsRebuild = root?.dataset.codexPreviewRuntime !== RUNTIME_TOKEN
      || root?.parentElement !== host
      || root?.dataset.sourceIds !== signature
      || root?.dataset.sourceMode !== sources.sourceMode
      || sources.items.some((item) => item.virtual
        ? !folderSources.get(item.id)?.virtual
        : folderSources.get(item.id)?.row !== item.row);
    if (needsRebuild) {
      clearFolderEnhancement();
      root = createFolderSwitcher();
      root.dataset.sourceIds = signature;
      root.dataset.sourceMode = sources.sourceMode;
      if (project.virtual) host.insertBefore(root, host.firstChild);
      else host.insertBefore(root, project.heading.nextElementSibling);
      folderSources = new Map(sources.items.map((item) => [item.id, item]));
      if (!activeFolderId || (activeFolderId !== ALL_FOLDER_ID && !folderSources.has(activeFolderId))) {
        activeFolderId = sources.sourceMode === "virtual"
          ? ALL_FOLDER_ID
          : sources.items.find((item) => item.active)?.id || rankedFolders(sources.items, "")[0]?.id || null;
      }
    } else {
      folderSources = new Map(sources.items.map((item) => [item.id, item]));
    }
    updateFolderSwitcherState(sources.items);
  }

  function updateUsageState() {
    const status = document.getElementById(USAGE_ID);
    if (!status) return;
    const parts = String(usage.text || "剩余量 --").trim().match(/^(.*)\s+(\S+)$/u);
    const label = parts?.[1] || "剩余量";
    const value = parts?.[2] || "--";
    const remaining = Number(usage.remainingPercent);
    const available = usage.available === true && Number.isFinite(remaining);
    const normalizedRemaining = available ? Math.min(100, Math.max(0, Math.round(remaining))) : null;
    status.querySelector(`.${USAGE_TEXT_CLASS}`).textContent = label;
    status.querySelector(`.${USAGE_VALUE_CLASS}`).textContent = value;
    status.querySelector(`.${USAGE_FILL_CLASS}`).style.width = `${normalizedRemaining ?? 0}%`;
    status.dataset.tone = ["normal", "warning", "critical", "muted"].includes(usage.tone) ? usage.tone : "muted";
    status.dataset.remainingPercent = normalizedRemaining == null ? "" : String(normalizedRemaining);
    status.setAttribute("aria-label", usage.ariaLabel || "Codex 剩余量暂不可用");
    status.title = usage.ariaLabel || "Codex 剩余量暂不可用";
  }

  function ensureUsageStatus(host, switchButton) {
    let status = document.getElementById(USAGE_ID);
    if (status?.dataset.codexPreviewRuntime !== RUNTIME_TOKEN) {
      status?.remove();
      status = null;
    }
    if (!status) {
      status = document.createElement("div");
      status.id = USAGE_ID;
      status.setAttribute("role", "status");
      status.setAttribute("aria-live", "polite");
      status.setAttribute("aria-atomic", "true");
      status.dataset.codexPreviewRuntime = RUNTIME_TOKEN;
      const label = document.createElement("span");
      label.className = USAGE_TEXT_CLASS;
      const value = document.createElement("strong");
      value.className = USAGE_VALUE_CLASS;
      const track = document.createElement("span");
      track.className = "codex-conversation-usage-track";
      track.setAttribute("aria-hidden", "true");
      const fill = document.createElement("span");
      fill.className = USAGE_FILL_CLASS;
      track.appendChild(fill);
      status.append(label, value, track);
    }
    if (status.parentElement !== host || status.nextElementSibling !== switchButton) host.insertBefore(status, switchButton);
    updateUsageState();
  }

  function protectHeaderControlsFromDrag(host) {
    if (!host.hasAttribute("data-codex-sidebar-header-controls")) {
      host.setAttribute("data-codex-sidebar-header-controls", "true");
      host.dataset.codexSidebarHeaderControlsAppRegion = host.style.getPropertyValue("-webkit-app-region");
    }
    host.style.webkitAppRegion = "no-drag";
  }

  function ensureViewToggle() {
    const search = document.querySelector('button[aria-label="搜索"], button[aria-label="Search"]');
    if (!search) return;
    const searchSlot = search.parentElement;
    const host = searchSlot?.parentElement;
    if (!host) return;
    protectHeaderControlsFromDrag(host);
    let button = document.getElementById(TOGGLE_ID);
    if (button?.dataset.codexPreviewRuntime !== RUNTIME_TOKEN) {
      button?.remove();
      button = null;
    }
    if (!button) {
      button = document.createElement("button");
      button.id = TOGGLE_ID;
      button.type = "button";
      button.className = `${search.className} codex-conversation-view-switch`;
      button.setAttribute("role", "switch");
      button.dataset.codexPreviewRuntime = RUNTIME_TOKEN;
    }
    button.onpointerdown = handleViewTogglePointerDown;
    button.onclick = handleViewToggleClick;
    if (button.parentElement !== host || button.nextElementSibling !== searchSlot) host.insertBefore(button, searchSlot);
    ensureUsageStatus(host, button);
    updateViewState();
  }

  function ensureShortcutSettingsButton() {
    const search = document.querySelector('button[aria-label="搜索"], button[aria-label="Search"]');
    if (!search) return;
    const searchSlot = search.parentElement;
    const host = searchSlot?.parentElement;
    if (!host) return;
    protectHeaderControlsFromDrag(host);
    let button = document.getElementById(SHORTCUT_SETTINGS_BUTTON_ID);
    if (button?.dataset.codexPreviewRuntime !== RUNTIME_TOKEN) {
      button?.remove();
      button = null;
    }
    if (!button) {
      button = document.createElement("button");
      button.id = SHORTCUT_SETTINGS_BUTTON_ID;
      button.type = "button";
      button.className = search.className;
      button.dataset.codexSidebarShortcutSettings = "true";
      button.dataset.codexPreviewRuntime = RUNTIME_TOKEN;
      button.setAttribute("aria-label", "管理快捷入口");
      button.title = "快捷入口设置";
      button.innerHTML = settingsShortcutSvg();
    }
    button.onclick = openShortcutSettings;
    const notification = document.querySelector('button[aria-label^="查看活动"], button[aria-label^="View activity"], button[aria-label*="通知"], button[aria-label*="Notification"]');
    let notificationSlot = notification;
    while (notificationSlot?.parentElement && notificationSlot.parentElement !== host) {
      notificationSlot = notificationSlot.parentElement;
    }
    const before = notificationSlot?.parentElement === host ? notificationSlot : searchSlot;
    if (button.parentElement !== host || button.nextElementSibling !== before) host.insertBefore(button, before);
  }

  function openRow() {
    const rows = visibleRows();
    return (hoveredPreviewRow?.isConnected && rows.includes(hoveredPreviewRow) ? hoveredPreviewRow : null)
      || rows.find((row) => row.matches(":hover"))
      || rows.find((row) => ["open", "delayed-open"].includes(row.getAttribute("data-state")));
  }

  function handlePreviewPointerOver(event) {
    const row = event.target?.closest?.(ROW_SELECTOR);
    if (!row) return;
    hoveredPreviewRow = row;
    scheduleSync();
  }

  function handlePreviewPointerOut(event) {
    const row = event.target?.closest?.(ROW_SELECTOR);
    if (!row || row !== hoveredPreviewRow || row.contains(event.relatedTarget)) return;
    hoveredPreviewRow = null;
    document.getElementById(FALLBACK_TOOLTIP_ID)?.remove();
  }

  function appendBlock(container, label, value) {
    const block = document.createElement("div");
    block.className = "codex-conversation-preview-block";
    const labelNode = document.createElement("div");
    labelNode.className = "codex-conversation-preview-label";
    labelNode.textContent = label;
    const textNode = document.createElement("div");
    textNode.className = "codex-conversation-preview-text";
    textNode.textContent = value || "暂无";
    textNode.title = value || "暂无";
    block.append(labelNode, textNode);
    container.appendChild(block);
  }

  function positionPreviewTooltip(tooltip, row) {
    const margin = 8;
    const gap = 8;
    const viewportWidth = document.documentElement.clientWidth || innerWidth;
    const viewportHeight = document.documentElement.clientHeight || innerHeight;
    const rowRect = row.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();
    const rightSpace = viewportWidth - rowRect.right - margin;
    const leftSpace = rowRect.left - margin;
    let left;
    if (rightSpace >= tooltipRect.width + gap) {
      left = rowRect.right + gap;
    } else if (leftSpace >= tooltipRect.width + gap) {
      left = rowRect.left - tooltipRect.width - gap;
    } else {
      left = Math.min(
        Math.max(margin, rowRect.left),
        Math.max(margin, viewportWidth - tooltipRect.width - margin),
      );
    }
    const top = Math.min(
      Math.max(margin, rowRect.top),
      Math.max(margin, viewportHeight - tooltipRect.height - margin),
    );
    tooltip.style.setProperty("position", "fixed", "important");
    tooltip.style.setProperty("inset", "auto", "important");
    tooltip.style.setProperty("right", "auto", "important");
    tooltip.style.setProperty("bottom", "auto", "important");
    tooltip.style.setProperty("transform", "none", "important");
    tooltip.style.setProperty("left", `${left}px`, "important");
    tooltip.style.setProperty("top", `${top}px`, "important");
  }

  function enhanceTooltip() {
    const row = openRow();
    if (!row) {
      document.getElementById(FALLBACK_TOOLTIP_ID)?.remove();
      return;
    }
    const preview = previewForRow(row);
    if (!preview) return;
    const title = row.getAttribute("data-app-action-sidebar-thread-title") || "";
    const tooltip = Array.from(document.querySelectorAll('[role="tooltip"]')).find((candidate) =>
      candidate.id !== FALLBACK_TOOLTIP_ID
        && Array.from(candidate.querySelectorAll("button")).some((button) => button.textContent.trim() === title),
    );
    if (tooltip) {
      document.getElementById(FALLBACK_TOOLTIP_ID)?.remove();
      tooltip.setAttribute("data-codex-conversation-preview-tooltip", "true");
      if (!tooltip.querySelector(`.${DETAILS_CLASS}`)) {
        const titleButton = Array.from(tooltip.querySelectorAll("button"))
          .find((button) => button.textContent.trim() === title);
        let card = titleButton?.parentElement;
        while (card && card !== tooltip && !card.classList.contains("w-fit")) card = card.parentElement;
        if (!card || card === tooltip) card = tooltip;
        const details = document.createElement("div");
        details.className = DETAILS_CLASS;
        appendBlock(details, "核心总结", preview.summary);
        appendBlock(details, "最近输入", preview.recentInput);
        appendBlock(details, "最近输出", preview.recentOutput);
        card.appendChild(details);
      }
      positionPreviewTooltip(tooltip, row);
      return;
    }

    let fallback = document.getElementById(FALLBACK_TOOLTIP_ID);
    if (!fallback) {
      fallback = document.createElement("div");
      fallback.id = FALLBACK_TOOLTIP_ID;
      fallback.setAttribute("role", "tooltip");
      fallback.setAttribute("data-codex-conversation-preview-tooltip", "true");
      document.body.appendChild(fallback);
    }
    const signature = `${rowKey(row)}\n${preview.summary}\n${preview.recentInput}\n${preview.recentOutput}`;
    if (fallback.dataset.signature !== signature) {
      fallback.dataset.signature = signature;
      fallback.replaceChildren();
      const titleNode = document.createElement("div");
      titleNode.className = "codex-conversation-preview-tooltip-title";
      titleNode.textContent = title || "未命名对话";
      const details = document.createElement("div");
      details.className = DETAILS_CLASS;
      appendBlock(details, "核心总结", preview.summary);
      appendBlock(details, "最近输入", preview.recentInput);
      appendBlock(details, "最近输出", preview.recentOutput);
      fallback.append(titleNode, details);
    }
    positionPreviewTooltip(fallback, row);
  }

  function clearLegacySidebarResidue() {
    // Old versions left generated rows and inline ordering behind after destroy.
    // Remove only nodes/attributes carrying this enhancement's ownership markers.
    document.querySelectorAll('[data-codex-sidebar-folder-catalog-list]').forEach((list) => {
      for (const item of list.children) item.style.removeProperty('order');
      list.removeAttribute('data-codex-sidebar-folder-catalog-list');
    });
    document.querySelectorAll('[data-codex-sidebar-folder-control-item]').forEach((item) => {
      item.style.removeProperty('order');
      item.removeAttribute('data-codex-sidebar-folder-control-item');
    });
    document.querySelectorAll('[data-codex-sidebar-folder-catalog-row], [data-codex-sidebar-pinned-project-row]').forEach((row) => {
      (row.closest('[role="listitem"]') || row).remove();
    });
    document.querySelectorAll('[data-codex-sidebar-virtual-section], [data-codex-sidebar-virtual-pinned-list]').forEach(node => node.remove());
    for (const attribute of [
      'data-codex-sidebar-native-alias-hidden', 'data-codex-sidebar-semantic-duplicate-hidden',
      'data-codex-sidebar-priority-list', 'data-codex-sidebar-folder-list-expansion-requested',
      'data-codex-conversation-preview-loaded', 'data-codex-conversation-preview-tooltip',
    ]) document.querySelectorAll(`[${attribute}]`).forEach(node => node.removeAttribute(attribute));
    document.documentElement.removeAttribute('data-codex-conversation-view');
  }

  function isWorkstationVisible() {
    return Array.from(document.querySelectorAll(workstationPanelSelector)).some(panel =>
      panel.isConnected && !panel.hidden && !panel.closest('[hidden]')
      && panel.getBoundingClientRect().width > 0 && panel.getBoundingClientRect().height > 0);
  }

  function ensureNativeWorkstationEntry() {
    const visible = node => {
      const rect = node.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && !node.closest('[hidden], [aria-hidden="true"]')
        && getComputedStyle(node).visibility === 'visible';
    };
    // New shells paint native actions above the main titlebar. Participate in
    // the measured end slot instead of appending underneath its overlay.
    const slots = Array.from(document.querySelectorAll('[data-app-shell-header-slot="end"] [data-app-shell-header-slot-content]'));
    const surfaces = Array.from(document.querySelectorAll('[data-testid="app-shell-header-context-menu-surface"]'));
    const host = [...slots, ...surfaces].find(node => !node.closest('aside') && !node.closest(workstationPanelSelector)
      && visible(node));
    let button = document.getElementById(WORKSTATION_ENTRY_ID);
    if (!host) { button?.remove(); return; }
    if (!button) {
      button = document.createElement('button');
      button.id = WORKSTATION_ENTRY_ID;
      button.type = 'button';
      button.setAttribute('aria-label', '工作站');
      button.title = '工作站';
      button.textContent = '工作站';
      button.onclick = () => {
        if (isWorkstationVisible()) {
          for (const panel of WORKSTATION_PANELS) closeWorkstationPanel(panel.id, false);
          button.focus();
        } else openWorkstationPanel();
        scheduleSync();
      };
    }
    if (button.parentElement !== host) host.prepend(button);
    const expanded = String(isWorkstationVisible());
    if (button.getAttribute('aria-expanded') !== expanded) button.setAttribute('aria-expanded', expanded);
  }

  function sync() {
    if (destroyed || workstationDrag || snapshotDepth) return;
    if (sidebarMode !== "enhanced") {
      if (sidebarMode === "capsules" && window.__nuyoahCreateCapsuleSidebar__) {
        window.__nuyoahCapsuleSidebar__ ||= window.__nuyoahCreateCapsuleSidebar__({
          window, readSnapshot: getTaskboardSnapshot, readCurrent: currentCodexTaskContext,
          openTask: entry => openProjectTask(entry, null, { returning: true }),
          archiveTask: entry => archiveProjectTask(entry.threadId, entry.hostId),
        });
        window.__nuyoahCapsuleSidebar__.sync();
      }
      ensureNativeWorkstationEntry();
      const suspended = window.__nuyoahMultiChat__?.snapshot?.().suspended;
      if (!suspended && currentCodexTaskContext().threadId) {
        const mount = findCustomShortcutPageMount();
        if (mount && !mount.surface.querySelector(':scope > [data-app-shell-right-panel-full-width="true"]')) {
          if (workstationResumePanel) openWorkstationPanel(workstationResumePanel);
          else if (assetConsolePage && !assetConsolePage.hidden && assetConsolePage.parentElement !== mount.surface) openAssetConsolePanel();
        }
      }
      if (!isWorkstationVisible()) return;
      ensureSkillOrganizer();
      ensureTaskboardWorkstationHeader();
      syncWorkstationLayout();
      renderProjectOverview();
      syncAssetConsoleContext();
      window.__nuyoahSkillTimeline__?.sync?.(currentCodexTaskContext());
      resumeSkillsGroupingOpenRequest();
      return;
    }
    ensureShortcutGrid();
    ensureSkillOrganizer();
    ensureTaskboardWorkstationHeader();
    syncWorkstationLayout();
    renderProjectOverview();
    syncAssetConsoleContext();
    window.__nuyoahSkillTimeline__?.sync?.(currentCodexTaskContext());
    resumeSkillsGroupingOpenRequest();
    ensureViewToggle();
    ensureShortcutSettingsButton();
    ensureSectionTabs();
    ensureFolderSwitcher();
    const rows = visibleRows();
    const anchor = !layoutAnchored
      ? rows.find((row) => row.getAttribute("aria-current") === "page")
        || rows.find((row) => row.getAttribute("data-app-action-sidebar-thread-active") === "true")
        || rows.find((row) => {
          const rect = row.getBoundingClientRect();
          return rect.bottom > 0 && rect.top < innerHeight;
        })
      : null;
    for (const row of rows) {
      applySummary(row, previewForRow(row));
    }
    ensureVirtualPinnedRows();
    ensureGlobalRecentRows();
    ensureInterruptedRows();
    sortNativePinnedRows();
    if (anchor) {
      anchor.scrollIntoView({ block: viewMode === "card" ? "center" : "nearest" });
      layoutAnchored = true;
    }
    enhanceTooltip();
  }

  function setPreviews(items) {
    for (const preview of Array.isArray(items) ? items : []) {
      if (preview?.key) previews.set(preview.key, preview);
    }
    sync();
  }

  function applySnapshot(snapshot) {
    snapshotDepth++;
    try {
      setPreviews(snapshot.previews);
      setUsage(snapshot.usage);
      setSearchCatalog(snapshot.searchCatalog);
      setRecentCatalog(snapshot.recentCatalog);
      archivedThreadIds = new Set((Array.isArray(snapshot.archivedThreadIds) ? snapshot.archivedThreadIds : [])
        .map(normalizedThreadId).filter(Boolean));
      setTaskCatalog(snapshot.taskCatalog);
      setInterruptedCatalog(snapshot.interruptedCatalog);
      setPinnedThreads(snapshot.pinnedThreadIds);
      setActiveProjectThreads(snapshot.activeThreadIds);
    } finally { snapshotDepth--; }
    sync();
    window.__codexTaskboardInjection__?.refreshContext?.();
  }

  function setSearchCatalog(items) {
    searchCatalog = (Array.isArray(items) ? items : []).filter((entry) =>
      entry && typeof entry.projectId === "string" && typeof entry.title === "string",
    );
    searchCatalogByProject = new Map();
    searchCatalogByThread = new Map();
    for (const entry of searchCatalog) {
      const entries = searchCatalogByProject.get(entry.projectId) || [];
      entries.push(entry);
      searchCatalogByProject.set(entry.projectId, entries);
      searchCatalogByThread.set(normalizedThreadId(entry.threadId), entry);
    }
    sync();
  }

  function setRecentCatalog(items) {
    const newestByThread = new Map();
    for (const entry of Array.isArray(items) ? items : []) {
      const threadId = normalizedThreadId(entry?.threadId);
      const time = Date.parse(entry?.updatedAt || "");
      if (!threadId || typeof entry?.title !== "string" || !Number.isFinite(time)) continue;
      const current = newestByThread.get(threadId);
      if (!current || time > current.time) newestByThread.set(threadId, { ...entry, threadId, archived: entry.archived === true, time });
    }
    recentCatalog = Array.from(newestByThread.values())
      .sort((left, right) => Number(left.archived) - Number(right.archived) || right.time - left.time)
      .map(({ time, ...entry }) => entry);
    recentCatalogByThread = new Map(recentCatalog.map((entry) => [normalizedThreadId(entry.threadId), entry]));
    sync();
  }

  function setTaskCatalog(items) {
    const newestByThread = new Map();
    for (const entry of Array.isArray(items) ? items : []) {
      const threadId = normalizedThreadId(entry?.threadId);
      const time = Date.parse(entry?.updatedAt || "");
      if (!threadId || typeof entry?.title !== "string" || !Number.isFinite(time)) continue;
      const current = newestByThread.get(threadId);
      if (!current || time > current.time) newestByThread.set(threadId, { ...entry, threadId, time });
    }
    taskCatalog = Array.from(newestByThread.values())
      .sort((left, right) => right.time - left.time)
      .map(({ time, ...entry }) => entry);
    sync();
  }

  function setInterruptedCatalog(items) {
    interruptedCatalog = (Array.isArray(items) ? items : [])
      .filter((entry) => normalizedThreadId(entry?.threadId) && typeof entry?.title === "string")
      .sort((left, right) => Date.parse(right.updatedAt || "") - Date.parse(left.updatedAt || ""));
    interruptedCatalogByThread = new Map(interruptedCatalog.map((entry) => [normalizedThreadId(entry.threadId), entry]));
    sync();
  }

  function setPinnedThreads(items) {
    const next = new Set((Array.isArray(items) ? items : []).map(normalizedThreadId).filter(Boolean));
    let changed = false;
    let fallback = -1;
    for (const id of next) {
      const key = pinnedThreadStorageKey(id);
      if (!Object.hasOwn(pinnedThreadTimes, key) && !Object.hasOwn(pinnedThreadTimes, id)) {
        pinnedThreadTimes[key] = fallback;
        fallback -= 1;
        changed = true;
      }
    }
    for (const key of Object.keys(pinnedThreadTimes)) {
      if (next.has(normalizedThreadId(key))) continue;
      delete pinnedThreadTimes[key];
      changed = true;
    }
    pinnedThreadIds = next;
    if (changed) persistPinnedThreadTimes();
    sync();
  }

  function setActiveProjectThreads(items) {
    activeProjectThreadIds = new Set((Array.isArray(items) ? items : []).map(normalizedThreadId).filter(Boolean));
    sync();
    if (!snapshotDepth) window.__codexTaskboardInjection__?.refreshContext?.();
  }

  function taskboardPreview(entry) {
    return previews.get(`local:${entry.threadId}\n${entry.title}`) || null;
  }

  function getTaskboardSnapshot({ includeProjectHistory = false } = {}) {
    const activeIds = new Set(taskCatalog.map(entry => normalizedThreadId(entry.threadId)));
    const catalog = includeProjectHistory
      ? [...taskCatalog, ...searchCatalog.filter(entry => !activeIds.has(normalizedThreadId(entry.threadId))).map(entry => ({ ...entry, catalogHistory: true }))]
      : taskCatalog;
    const tasks = catalog
      .filter((entry) => includeProjectHistory || entry.archived !== true)
      .map((entry) => {
        const threadId = normalizedThreadId(entry.threadId);
        const running = activeProjectThreadIds.has(threadId);
        const interruption = interruptedCatalogByThread.get(threadId);
        const preview = taskboardPreview(entry);
        const nativeStatus = window.__nuyoahRemoteTaskCatalog__?.localStatus?.(threadId);
        const runtimeStatus = nativeStatus?.runtimeStatus === "running" || running ? "running" : interruption ? "failed" : "completed";
        const progress = runtimeStatus === "running"
          ? preview?.recentOutput || preview?.summary || "Codex 正在执行…"
          : runtimeStatus === "failed"
            ? interruption?.interruptionLabel || "执行中断"
            : preview?.finalOutput || preview?.summary || "等待查看任务结果";
        return {
          threadId,
          taskKey: threadId,
          hostId: "local",
          catalogHistory: entry.catalogHistory === true,
          archived: entry.archived === true,
          title: entry.title,
          projectId: entry.projectId || "__unassigned__",
          projectName: entry.projectName || "未归入项目",
          workspacePath: entry.workspacePath || "",
          workspacePathStatus: entry.workspacePathStatus || "unknown",
          projectWorkspacePath: entry.projectWorkspacePath || "",
          projectWorkspacePathStatus: entry.projectWorkspacePathStatus || "unknown",
          runtimeStatus,
          waitingReason: window.__nuyoahTaskAttention__?.read("local", threadId) || nativeStatus?.waitingReason || null,
          hasFinalResponse: preview?.hasFinalResponse === true,
          resultLinks: preview?.hasFinalResponse && runtimeStatus !== "running" ? preview.resultLinks || [] : [],
          progress: String(progress).replace(/\s+/g, " ").trim().slice(0, 240),
          updatedAt: entry.updatedAt,
          activityAt: entry.activityAt ?? null,
          pinned: pinnedThreadIds.has(threadId),
        };
      });
    const remoteTasks = window.__nuyoahRemoteTaskCatalog__?.snapshot?.() || [];
    const remoteSync = window.__nuyoahRemoteTaskCatalog__?.syncState?.() || [];
    const chats = includeProjectHistory ? [] : window.__nuyoahChatGptCatalog__?.snapshot?.() || [];
    const chatSync = includeProjectHistory ? [] : window.__nuyoahChatGptCatalog__?.syncState?.() || [];
    return { version: 1, updatedAt: new Date().toISOString(), tasks: [...tasks, ...remoteTasks, ...chats], remoteSync: [...remoteSync, ...chatSync] };
  }

  function createProjectTask(projectId) {
    const id = String(projectId || "").trim();
    const item = folderSources.get(id) || (sidebarMode === "native"
      ? nativeFolderSources()?.items.find(item => item.id === id) : null);
    const button = nativeFolderCreateButton(item);
    if (!button?.isConnected) return false;
    button.click();
    return true;
  }

  async function archiveProjectTask(threadId, hostId = "local") {
    const normalized = normalizedThreadId(threadId);
    if (!normalized || hostId !== "local") return false;
    if (archivedThreadIds.has(normalized)) return false;
    const archive = window.__nuyoahNativeTaskAdapter__?.archive;
    if (typeof archive !== "function") return false;
    try {
      await archive({ hostId, threadId: normalized });
    } catch (error) {
      if (error?.definite === true) return false;
      // A sent request may have succeeded even when its response was lost.
    }
    return await waitForProjectTaskArchive(normalized, hostId);
  }

  async function waitForProjectTaskArchive(threadId, hostId) {
    const confirmed = () => hostId === "local" && archivedThreadIds.has(threadId);
    if (confirmed()) return true;
    return await new Promise((resolve) => {
      const started = Date.now();
      const timer = window.setInterval(() => {
        if (confirmed()) { window.clearInterval(timer); resolve(true); }
        else if (Date.now() - started >= 16_000) { window.clearInterval(timer); resolve(false); }
      }, 250);
    });
  }

  function setUsage(value) {
    usage = value && typeof value === "object" ? value : {
      available: false,
      text: "剩余量 --",
      remainingPercent: null,
      tone: "muted",
      ariaLabel: "Codex 剩余量暂不可用",
    };
    sync();
  }

  function setAssetConsole(value) {
    const source = value && typeof value === "object" ? value : {};
    assetConsole = {
      available: source.available === true,
      label: typeof source.label === "string" && source.label.trim() ? source.label.trim() : "资产控制台",
      mode: source.mode === "embedded" ? "embedded" : "external",
    };
    scheduleSync();
  }

  function handleWorkspaceEnhancementKeydown(event) {
    if (event.defaultPrevented) return;
    if (event.target?.closest?.('.nuyoah-file-preview')) return;
    if (event.key === "Escape" && workstationDrag) { event.preventDefault(); cancelWorkstationResize(); return; }
    if (event.key === "Escape" && skillContextMenu) {
      event.preventDefault();
      event.stopPropagation();
      closeSkillContextMenu();
      return;
    }
    if (event.key === "Escape" && projectOverviewPage && !projectOverviewPage.hidden) {
      const consumed = projectSubview === 'map' ? window.__nuyoahTaskMapUI__?.dismiss?.()
        : projectSubview === 'work-items' ? window.__nuyoahWorkItemsUI__?.dismiss?.() : window.__nuyoahTaskContextUI__?.dismiss?.();
      if (consumed) { event.preventDefault(); event.stopPropagation(); return; }
      event.preventDefault();
      event.stopPropagation();
      closeWorkstationPanel('project');
      return;
    }
    if (event.key === "Escape" && assetConsolePage && !assetConsolePage.hidden) {
      event.preventDefault();
      event.stopPropagation();
      closeWorkstationPanel('asset');
      return;
    }
    if (event.key === "Escape" && document.getElementById(SKILL_ORGANIZER_ID) && !document.getElementById(SKILL_ORGANIZER_ID).hidden) {
      event.preventDefault();
      event.stopPropagation();
      closeWorkstationPanel('skills');
      return;
    }
    if (event.key === "Escape" && document.documentElement.getAttribute("data-codex-taskboard-open") === "true") {
      event.preventDefault();
      event.stopPropagation();
      closeWorkstationPanel('taskboard');
      return;
    }
    if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
    const composer = event.target?.closest?.('[contenteditable="true"]');
    if (!composer || composer !== currentComposer()) return;
    routeWorkspaceCommand(composer.textContent || "");
  }

  function workspaceCommand(value) {
    const text = String(value || "").replace(/\s+/gu, " ").trim();
    if (!text) return null;
    const slash = text.match(/^\/(工作站|项目|项目管理|skills?|技能|资产|资产控制台)(?:\s+(.+))?$/iu);
    const direct = slash ? null : text.match(/^(?:请|麻烦)?(?:帮我)?(?:打开|进入|查找|搜索|检索|定位)(?:一下|下)?\s*(工作站|当前项目|项目总览|项目管理|任务面板|项目看板|skills?\s*分组|skills?|技能列表|资产控制台|资产库|素材库)(?:[，,。；;：:\s]+(.+?))?[。！？!?]*$/iu);
    const target = slash?.[1] || direct?.[1];
    if (!target) return null;
    const panel = /工作站|当前项目|项目总览/u.test(target)
      ? "project"
      : /项目|任务/u.test(target) ? "taskboard" : /skill|技能/iu.test(target) ? "skills" : "asset";
    let query = slash?.[2] || direct?.[2] || "";
    query = query
      .replace(/^(?:请|麻烦)?(?:帮我)?/u, "")
      .replace(new RegExp(target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "iu"), "")
      .replace(/(?:帮我|请)?(?:打开|进入|找|查找|搜索|检索|定位)(?:一下|下)?/gu, "")
      .replace(/(?:这个|有关的|相关的)?(?:项目|skills?|技能|资产|素材)?[。！？!?]*$/iu, "")
      .replace(/^[，,。；;：:\s]+|[，,。；;：:\s]+$/gu, "")
      .trim();
    return { panel, query };
  }

  function routeWorkspaceCommand(value) {
    const text = String(value || "").trim();
    const command = workspaceCommand(text);
    if (!command) return false;
    const now = Date.now();
    if (lastWorkspaceCommand.text === text && now - lastWorkspaceCommand.at < 1_500) return true;
    lastWorkspaceCommand = { text, at: now };
    window.setTimeout(() => openWorkstationPanel(command.panel, { query: command.query }), 0);
    return true;
  }

  function handleWorkspaceCommandClick(event) {
    const button = event.target?.closest?.('button[aria-label*="发送"], button[aria-label*="Send"], button[data-testid*="send"]');
    if (!button || !currentComposer()) return;
    routeWorkspaceCommand(currentComposer().textContent || "");
  }

  function handleWorkspacePanelMessage(event) {
    if (event.source !== window || event.origin !== window.location.origin || event.data?.type !== WORKSPACE_PANEL_EVENT) return;
    if (event.data.panel === "taskboard") {
      closeCustomShortcutPanel(false);
      closeProjectOverview(false);
      closeAssetConsolePanel({ restoreFocus: false });
      closeSkillsGrouping(false);
      persistWorkstationPanel("taskboard");
      window.setTimeout(ensureTaskboardWorkstationHeader, 0);
    }
  }

  function scheduleSync() {
    if (destroyed || syncTimer) return;
    syncTimer = setTimeout(() => {
      syncTimer = null;
      sync();
    }, 80);
  }

  function scheduleAnchorRetry() {
    if (destroyed || anchorRetryTimer) return;
    anchorRetryTimer = setTimeout(() => {
      anchorRetryTimer = null;
      scheduleSync();
    }, NATIVE_ANCHOR_GRACE_MS + 40);
  }

  function start() {
    installStyles();
    setWorkstationFontSize(workstationFontSize, false);
    updateViewState();
    workstationResizeObserver = new ResizeObserver(scheduleWorkstationLayout);
    workstationLayoutObserver = new MutationObserver((records) => {
      if (records.some((record) => record.type === "childList" || record.attributeName === "data-app-shell-right-panel-full-width" || record.target.matches?.(`${workstationPanelSelector}, [data-nuyoah-native-panel-adaptive], [data-nuyoah-native-panel-content-adaptive]`))) scheduleWorkstationLayout();
    });
    workstationLayoutObserver.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden", "style", "data-app-shell-right-panel-full-width"] });
    window.addEventListener("resize", scheduleWorkstationLayout);
    observer = new MutationObserver(scheduleSync);
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-state", "aria-expanded"] });
    document.addEventListener("pointerdown", handleWorkstationResizeStart, true);
    if (sidebarMode === "enhanced") {
      document.addEventListener("pointerover", handlePreviewPointerOver, true);
      document.addEventListener("pointerout", handlePreviewPointerOut, true);
      document.addEventListener("click", handlePinDocumentClick, true);
    }
    document.addEventListener("pointerdown", handleStatusDocumentPointerDown, true);
    document.addEventListener("keydown", handleWorkspaceEnhancementKeydown, true);
    document.addEventListener("click", handleWorkspaceCommandClick, true);
    window.addEventListener("message", handleAssetConsoleMessage);
    window.addEventListener("message", handleWorkspacePanelMessage);
    if (sidebarMode === "enhanced") void refreshPinnedProjectIds();
    sync();
  }

  function destroy() {
    window.__nuyoahCapsuleSidebar__?.destroy?.();
    delete window.__nuyoahCapsuleSidebar__;
    window.__nuyoahMultiChat__?.destroy?.();
    window.__nuyoahSkillTimeline__?.destroy?.();
    window.__nuyoahWorkItemsUI__?.destroy?.();
    window.__nuyoahTaskMapUI__?.destroy?.();
    window.__nuyoahTaskAttention__?.destroy?.();
    window.__nuyoahRemoteTaskCatalog__?.destroy?.();
    destroyed = true;
    document.removeEventListener("DOMContentLoaded", start);
    cancelWorkstationResize();
    document.removeEventListener("pointerdown", handleWorkstationResizeStart, true);
    skillOrganizerOpenGeneration += 1;
    skillOrganizerOpenObserver?.disconnect();
    skillOrganizerOpenObserver = null;
    clearTimeout(skillOrganizerOpenTimer);
    skillOrganizerOpenTimer = null;
    observer?.disconnect();
    workstationTaskboardFrame?.removeEventListener("load", syncTaskboardKeyboardBridge);
    workstationTaskboardDocument?.removeEventListener("keydown", handleTaskboardEscape);
    workstationTaskboardFrame = null;
    workstationTaskboardDocument = null;
    workstationResizeObserver?.disconnect();
    restoreNativePanelConstraints();
    workstationLayoutObserver?.disconnect();
    workstationObservedElements.clear();
    if (workstationLayoutFrame !== null) cancelAnimationFrame(workstationLayoutFrame);
    workstationLayoutFrame = null;
    window.removeEventListener("resize", scheduleWorkstationLayout);
    document.querySelectorAll(workstationPanelSelector).forEach((panel) => {
      panel.removeAttribute("data-nuyoah-panel-layout");
      panel.style.removeProperty("--nuyoah-panel-width");
      panel.style.removeProperty("--nuyoah-panel-top");
    });
    clearTimeout(syncTimer);
    clearTimeout(anchorRetryTimer);
    document.removeEventListener("pointerover", handlePreviewPointerOver, true);
    document.removeEventListener("pointerout", handlePreviewPointerOut, true);
    document.removeEventListener("pointerdown", handleStatusDocumentPointerDown, true);
    document.removeEventListener("click", handlePinDocumentClick, true);
    document.removeEventListener("keydown", handleWorkspaceEnhancementKeydown, true);
    document.removeEventListener("click", handleWorkspaceCommandClick, true);
    window.removeEventListener("message", handleAssetConsoleMessage);
    window.removeEventListener("message", handleWorkspacePanelMessage);
    closeStatusMenu();
    document.getElementById(STYLE_ID)?.remove();
    window.__nuyoahInteractionTheme__?.destroy?.();
    window.__nuyoahInteractionTheme__ = null;
    window.__nuyoahAppShortcuts__?.destroy?.();
    window.__nuyoahAppShortcuts__ = null;
    window.__nuyoahMagpieQuota__?.destroy?.();
    window.__nuyoahMagpieQuota__ = null;
    document.getElementById(WORKSTATION_ENTRY_ID)?.remove();
    document.documentElement.style.removeProperty("--nuyoah-workstation-font-size");
    document.getElementById(TOGGLE_ID)?.remove();
    document.getElementById(USAGE_ID)?.remove();
    document.getElementById(SHORTCUT_SETTINGS_BUTTON_ID)?.remove();
    document.getElementById(FALLBACK_TOOLTIP_ID)?.remove();
    document.querySelectorAll('[data-codex-sidebar-header-controls="true"]').forEach((host) => {
      const previous = host.dataset.codexSidebarHeaderControlsAppRegion || "";
      if (previous) host.style.setProperty("-webkit-app-region", previous);
      else host.style.removeProperty("-webkit-app-region");
      host.removeAttribute("data-codex-sidebar-header-controls");
      host.removeAttribute("data-codex-sidebar-header-controls-app-region");
    });
    clearShortcutEnhancement();
    document.getElementById(SHORTCUT_SETTINGS_ID)?.remove();
    clearSectionEnhancement();
    closeCustomShortcutPanel(false);
    closeProjectOverview(false);
    projectOverviewPage?.remove();
    projectOverviewPage = null;
    const taskboardPage = document.getElementById("codex-taskboard-page");
    taskboardPage?.querySelector(`:scope > .${WORKSTATION_HEADER_CLASS}`)?.remove();
    taskboardPage?.removeAttribute("data-nuyoah-workstation-frame");
    closeAssetConsolePanel({ restoreFocus: false });
    assetConsolePage?.remove();
    assetConsolePage = null;
    assetConsoleFrame = null;
    clearSkillOrganizer();
    customShortcutPage?.remove();
    customShortcutPage = null;
    customShortcutFrame = null;
    document.documentElement.removeAttribute("data-codex-conversation-view");
    document.querySelectorAll(`.${SUMMARY_CLASS}, .${DETAILS_CLASS}, .${CARD_CONTENT_CLASS}`).forEach((node) => node.remove());
    document.querySelectorAll(`.${STATUS_BUTTON_CLASS}`).forEach((node) => node.remove());
    document.querySelectorAll('[data-codex-conversation-preview-enhanced="true"]').forEach((row) => {
      row.removeAttribute("data-codex-conversation-preview-enhanced");
      row.removeAttribute("data-codex-project-running");
    });
    document.querySelectorAll('[data-codex-conversation-preview-title="true"]').forEach((node) => {
      node.removeAttribute("data-codex-conversation-preview-title");
    });
    document.querySelectorAll('[data-codex-conversation-card-grid="true"]').forEach((node) => {
      node.removeAttribute("data-codex-conversation-card-grid");
    });
    document.querySelectorAll('[data-codex-conversation-card-item="true"]').forEach((node) => {
      node.removeAttribute("data-codex-conversation-card-item");
    });
    document.querySelectorAll('[data-codex-sidebar-search-match="true"]').forEach((node) => {
      node.removeAttribute("data-codex-sidebar-search-match");
    });
    document.querySelectorAll('[data-codex-sidebar-thread-revealed="true"]').forEach((node) => {
      node.removeAttribute("data-codex-sidebar-thread-revealed");
    });
    if (sidebarThreadRevealTimer !== null) window.clearTimeout(sidebarThreadRevealTimer);
    sidebarThreadRevealTimer = null;
    clearLegacySidebarResidue();
  }

  window[SENTINEL] = {
    destroy,
    sidebarMode,
    isWorkstationVisible,
    refresh: sync,
    applySnapshot,
    setPreviews,
    setSearchCatalog,
    setRecentCatalog,
    setTaskCatalog,
    setInterruptedCatalog,
    setPinnedThreads,
    setActiveProjectThreads,
    getTaskboardSnapshot,
    createProjectTask,
    archiveProjectTask,
    revealThread,
    setUsage,
    setAssetConsole,
    setAssetConsolePanel,
    setSkillCatalog,
    takeSkillLabelRequest,
    openSkillsGrouping,
    openAssetConsolePanel,
    openWorkstationPanel,
    openMultiChatTask: entry => openProjectTask(entry, null, { returning: true, fromGrid: true }),
    currentTaskContext: currentCodexTaskContext,
    routeWorkspaceCommand,
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();

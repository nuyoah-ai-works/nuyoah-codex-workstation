# Upstream baseline

- Repository: `https://github.com/yubowen123/codex-sidebar-enhancer`
- Imported commit: `5fa0235c84078de9a7e49f6587eeb301caa77a55`
- Imported version: `1.4.0`
- Imported on: `2026-09-02`
- License: MIT; see `LICENSE` and `THIRD_PARTY_NOTICES.md`
- Import method: clean source snapshot without upstream `.git`, `node_modules`,
  runtime state, logs or generated verification images

This commit is the untouched behavioral baseline for the first local test run.
Nuyoah-specific changes must be documented below and should prefer the
`nuyoah/` adapter layer plus small explicit entry-point patches.

## Local changes

- Central multi-chat 0.22: Nuyoah adapters mount up to four selected local native
  conversations with the existing host React runtime and native per-thread,
  route and composer initialization. The central grid, resizing, focus and
  teardown are owned by `nuyoah/workstation/`; injector, composer and current-task
  context bridges are explicit entry patches. Native identity checks reject
  cross-task initialization, including inherited persistent workspace sessions.
  No signed application, upstream version or execution runtime is replaced.

- Native pane coexistence 0.21.1: coordinate workstation width with the modern
  inline-width native aside; cap its outer pane and explicit content frame only
  while docked together, preserving native preferences and full-width mode.
  Keep the native pane at the right edge, translate native resize deltas, and
  constrain cached inline chat-frame widths to prevent cropped conversations.
  Fix empty Skills closure to keep one workstation module visible at a time.

- ChatGPT attention window 0.21: derive a rolling 72-hour pending window in the
  Nuyoah live-state adapter. The vendor board refreshes age while visible and
  shows expired chats in completed without storing a synthetic acknowledgement.
  Native runtime states and pinned upstream versions remain unchanged.

- Codex shell 0.20.3: mount the workstation entry in the measured native end slot,
  resolve the RPC accessor from the explicit app-shared import, and select visible
  page hosts in both workstation and vendor Taskboard mounting. Pinned versions remain unchanged.

- ChatGPT task cards 0.20: add a metadata-only native chat catalog in `nuyoah/taskboard/`,
  explicitly merge it into the Taskboard snapshot, and route chat card clicks to `/c/:id`.
  The vendor board omits workspace and archive controls for chat cards; its fixed upstream version is unchanged.

- Native sidebar 0.18: leave the host sidebar unchanged by default, with one
  workstation entry in the conversation toolbar. The vendor Taskboard entry is
  suppressed in this mode. Catalog reads reuse the registered native request
  client and pause while hidden; asset frame/proxy lifetimes are paired. The
  pinned vendor versions and signed desktop application remain unchanged.

- Asset runtime 0.7: the product runtime now explicitly selects `nuyoah/assets/`
  instead of the legacy vendor mutation service. Added opt-in folder/Eagle sources,
  SQLite metadata pagination, bounded/cancellable previews and a read-only asset UI.
  The pinned vendor implementation stays as reference; its background auto-import,
  duplicate quarantine and expiry cleanup are not loaded by the active runtime.
  The existing CDP bridge now caps response bodies and concurrency and aborts local
  requests when the panel is disposed, without pausing newly attached renderers.

- Cold-history Skill: `q2522879285-source/codex-thread-cold-history` fixed commit
  `2a040cdae079ab5d36049247d1e0c0aadf91e9c4` (MIT), imported under
  `vendor/codex-thread-cold-history/`. Original synthetic self-test passed before
  adaptation. Local changes add SHA-256 archive verification, a workstation
  reference-registration CLI and local instructions. No active session was changed.
- Added a task-scoped cold-history panel and local snapshot service, including
  opt-in idle snapshots, version selection and query-prefill. Snapshots preserve
  the full source. The query adapter also indexes modern response_item messages.

- Added project governance in `AGENTS.md`.
- Reserved `nuyoah/` for native-style, Skill, Eagle and unified-context adapters.
- Replaced the separate project, Skill and asset shortcuts with one `工作站`
  entry and a shared `项目 / Taskboard / Skills / 资产` right-panel shell.
- Added a project overview that derives its task list from the existing Codex
  project/session catalog and delegates navigation back to native task rows.
- Added `nuyoah/skills/runtime-catalog.mjs`, which treats Codex `skills/list`
  as authoritative and uses the legacy directory scanner only as a runtime
  failure fallback.
- Added deterministic tests plus a unified live GUI verification entry point.

- Selectively adapted the Workspace Enhancer `8552882` read-only preview and MJ
  filename parsing modules; added task-context and Skill configuration adapters
  using our Application Support boundary. See THIRD_PARTY_NOTICES.md. No upstream
  shell, hook activation, project resolver or mutation runtime replaced ours.

- Skill insertion opts into preserving the native composer draft, appending the
  mention after existing text and tags. Explicit new-task prefill keeps its
  replacement behavior. Isolated browser coverage checks rich drafts and retries.

- Simplified project overview hierarchy, inline task counts, current-task emphasis,
  compact context actions and keyboard-accessible typography settings.

### Work items and optional plans (0.10.0)

Mechanism research used q2522879285-source/codex-task-map at
`7eb0acf8cebb8e0accff90274280909edd59933d` (directions, items and multiple
thread associations) and q2522879285-source/codex-workspace-enhancer at
`e718c0c7a945ec7bd22ef1ea942e7e1339e9c75a` (stable per-task plan and manual
state precedence; task-map feature was unreleased at that commit).

The new Nuyoah work-items store, CLI and UI are independently implemented in
`nuyoah/workstation/` and `scripts/work-items.mjs`. No upstream injection script,
Skill, installer or hook is imported. One Application Support record serves
both list and optional plan tree, with explicit structural edits, reversible
manual state overrides and revision conflict checks. Thread metadata and
existing summaries remain authoritative at their existing sources.

Version 0.11 adds an independently implemented spatial canvas for directions,
items, explicit task links and per-item plans, inspired by the same fixed research
commits. Panning, zoom, node dragging and local layout persistence are presentation
features; they do not fork or rewrite the canonical work-item records.

Version 0.12 independently adds evidence-based thread relationship maps and native
activity presentation. Parent, fork and explicit references remain distinct; no
upstream UI, runtime hook or session mutation code is imported.

### Mixed local and remote conversation grid (0.24.0)

The Nuyoah native adapter reuses the desktop's configured host connections and
its local-thread route with the native hostId query parameter for remote devices.
Grid selection and composer scopes retain host/thread identity. Only the native
conversation component renders a selected remote body; the task catalog remains
metadata-only. Local asset endpoints reject remote task identities. No upstream
source, signed application bundle, new runtime, credentials or device settings are
modified.

### Public source packaging (0.24.1)

The first public history is a clean source snapshot, excluding local development
history and runtime/user data. Private fixture IDs are replaced with synthetic
values. The Taskboard manifest keeps its upstream version, ref and baseCommit;
its local task provenance is represented by the existing non-private snapshot ref.
The macOS and Windows installers default to this public repository. Upstream
licenses and font notices are retained.

# Nuyoah adapter rules

This directory contains only Nuyoah-specific adapters that are not part of the
imported upstream behavior. Keep adapters small, independently testable and
called through explicit upstream entry points.

- `skills/`: use local Codex `app-server` `skills/list` as authority, preserve
  personal Skill symlink semantics, and generate/cache user-confirmed Chinese
  card titles and 30-60 character Chinese summaries from only the admitted name
  and description fields. Show the Chinese summary as the card explanation and
  the original callable name as secondary identity. Context filtering may use
  only the current task title and project binding. Manual refresh re-requests
  `skills/list` instead of scanning the whole disk. Cache stable identifiers,
  description hashes and generated Chinese copy under user Application Support;
  never cache source descriptions or write Skill files.
- `taskboard/`: keep the minimal presentation logic for the Codex-backed live
  task view. Codex project threads remain authoritative for the all-tasks view;
  remote task metadata comes from the desktop's existing host bridge and paginated
  thread/list responses, with host-scoped identity and native status notifications.
  ChatGPT chat cards use the desktop's native recent/pinned metadata query, with a
  separate chatgpt identity. Only title, activity state, timestamp and pin metadata
  may cross this adapter; never read conversation bodies or image payloads. Opening
  a card navigates to the native chat. Metadata remains in memory.
  Never read remote session bodies, create connections, or persist remote metadata.
  local view state may hold acknowledgements, pins, priorities, search/project
  filters, expansion counts and scroll positions, never
  synthetic runtime status. The separate orchestrator ledger may store explicit
  request-to-dispatch relationships and short verification evidence, but it must
  never infer workers from titles or directories, redispatch work, or store full
  prompts, outputs, credentials, or conversation bodies.
  Native local status metadata may also use the existing host bridge to identify
  unresolved input/approval waits. Result actions only follow explicit local file
  links in the latest final response after existence checks; never infer ownership.

Add another responsibility or subdirectory only when its first implementation
and tests are introduced. Update this file before adding it.

Do not read Skill bodies, write Eagle data, modify Codex session files, log
private paths, or perform real file deletion from this layer.

- `workstation/`: per-task summaries, separate notes and explicit source references live
  under Application Support. Use revision checks, never infer task ownership from a
  project directory, and never turn stored summaries into execution authorization.
  The central multi-chat layout may mount at most four user-selected local or configured remote native
  conversation components using the existing AppScope and native per-thread,
  route and composer providers, keyed by host and thread identity. Only the native
  component may display a selected remote conversation over the existing connection;
  this adapter never reads or caches its body. Each pane may open a user-requested
  local native client draft; only the user's native send creates the task. Adopt the
  native creation identity without remounting, and discard stale identity callbacks.
  Persist only host/thread or native client-draft identities, explicitly selected
  imported project identities, local draft working directories and layout choices.
  Read only imported native sidebar/project metadata for this chooser; never open
  a system directory dialog or scan the disk. Stale choices must preserve the
  selected pane. No project registration, directory creation or message submission
  accompanies this choice.
  Remote tasks must never be resolved by local asset or session services. Never create an execution runtime, copy bodies,
  inspect credentials or persist messages. Resizing must not remount components;
  failed or stale mounts must clean up and preserve the original native page.
  Cold-history snapshots copy only the selected idle task, keep the source untouched,
  verify the independent copy and index, and expose task-scoped archive metadata.
  Automatic snapshots require an explicit task preference or an enabled persistent global
  default. The global default discovers existing and future local tasks through read-only
  database metadata; explicit task overrides win. Installation does not opt in. Require a completed turn and
  five minutes of source inactivity; at most one snapshot per local calendar day.
  Store archives outside the repository and Codex data. Never log archive contents.
  Automatically derive task outputs from matched successful patch tool records, and
  references from local links and attachment metadata in that task only. Cache only
  file metadata in memory; persist explicit hide preferences under Application Support.
  Final assistant file links may be labeled conversation deliveries, without claiming
  authorship. Related tasks require native parent/fork metadata, actual successful
  task-tool results or explicit task links. Resolve known identities against the local
  catalog or read-only local state DB, never infer relations from titles, cwd or projects.
  Relationship maps may read bounded metadata/session headers and the selected local
  task's bounded tail, never remote bodies. Explicit selection in the map may request
  the selected local task's latest final text through the host for a user-editable
  delivery preview; do not scan other task bodies or persist that text. Unresolved links stay unknown.
  The same bounded parent tail may provide short Chinese delegation descriptions and
  explicit agent completion evidence, matched to native agent paths and real parent edges.
  Ignore completion bodies and encrypted content; a newer task update invalidates old
  completion evidence. Automatic map folding is a reversible display preference only.
  Native child activity reuses the existing local host metadata/status bridge, without
  importing those children into the main Taskboard catalog or persisting runtime state.
  Explicit map commands bind the selected host/thread identity and use the host's native
  controller for follow-ups, child creation and result delivery. Preserve native approval
  and model settings. Keep command IDs, digests and receipts under Application Support;
  never persist prompts or outputs. Journal before dispatch; unknown receipts must not
  automatically retry. Only successful native creation receipts establish map parent edges.
  Large sessions use an identity-checked bounded tail and expose partial coverage.
  Never infer ownership from a project scan or execute recorded commands.
  Native completed image-generation and file-change records also establish outputs;
  image-view records establish references only. For a large rollout or same-task paginated history base,
  read only bounded reference fields from the local thread-history index, restricted
  to that task and its recorded ordinal/byte boundary. Never follow another task's history
  base or return stored image bytes, prompts, diffs, command output or reasoning.
  Project task lists reuse the live Taskboard catalog and state functions with host-scoped
  identity. Keep per-project filters and positions separate from task records. File previews
  require an explicit click on a visible registered local reference, recheck existence,
  bound reads and display text without executing scripts, HTML or archive contents.
- `assets/`: the read-only asset catalog, explicit folder/Eagle source adapters,
  task-reference lookup, paginated local index, bounded previews and embedded UI.
  Only catalog state and derived thumbnails may be written under Application Support.
  Never auto-import projects, rename, move, edit or delete source files, including
  Eagle internals and previously quarantined files. The vendor asset manager is a
  frozen reference, not the active runtime. Source removal only removes its index.

- Skill usage history reads only authorized local session tool-call evidence, never Skill source bodies. Retain names, counts and timestamps in memory; project scans are bounded, on demand and report partial coverage.

- Work items and their optional plans use one revision-checked Application Support store
  shared by the UI and CLI. Thread links retain only explicit host/thread identities;
  resolve titles and live states from the existing catalog. Never infer item completion
  from thread state. Reported plan states and reversible manual overrides remain separate.

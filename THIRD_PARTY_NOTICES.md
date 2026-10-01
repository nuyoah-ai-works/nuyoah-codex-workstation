# Third-party notices

## Codex Taskboard

This package includes a pinned, prebuilt customized snapshot derived from
[chuspeeism/dashi-taskboard](https://github.com/chuspeeism/dashi-taskboard),
based on commit `677b544` and the verified local feature set from 2026-08-13.
The pinned version, source ref and included capabilities are recorded in
[`vendor/codex-taskboard/VERSION.json`](./vendor/codex-taskboard/VERSION.json).

Codex Taskboard is distributed under the Apache License 2.0. The bundled
license copy is available at
[`vendor/codex-taskboard/LICENSE`](./vendor/codex-taskboard/LICENSE).

The vendored web build also contains its own font notice at
[`vendor/codex-taskboard/dist/web/Inter-LICENSE.txt`](./vendor/codex-taskboard/dist/web/Inter-LICENSE.txt).

## Codex Workspace Enhancer asset layer

This package vendors the Asset Console service and embedded web surface from
[q2522879285-source/codex-workspace-enhancer](https://github.com/q2522879285-source/codex-workspace-enhancer),
based on commit `f41a6318fa7ddc9ebaf1e8941a842e7e0273466c`. The sidebar integration in this
repository adapts that Windows-oriented reference layer to the existing macOS
and Windows managed runtime without replacing the project-management feature.

Codex Workspace Enhancer is distributed under the MIT License. The bundled
license copy is available at
[`vendor/codex-workspace-enhancer/LICENSE`](./vendor/codex-workspace-enhancer/LICENSE).

## Workspace 2.0 adaptation

The read-only preview and Midjourney filename parsers in `nuyoah/assets/` are
adapted from q2522879285-source/codex-workspace-enhancer commit
`8552882b06903c49c9bc80c3093b672044208460` under its MIT license. Task-context
adapters use our own Application Support storage and preserve our four-panel
shell; the upstream runtime, hooks, and file mutation endpoints were not imported.

## Codex Thread Cold History

The Skill and archive query utility in `vendor/codex-thread-cold-history/` derive
from [q2522879285-source/codex-thread-cold-history](https://github.com/q2522879285-source/codex-thread-cold-history)
commit `2a040cdae079ab5d36049247d1e0c0aadf91e9c4`, under the MIT license preserved
in that directory's `LICENSE`. Local changes add integrity verification and
task-scoped workstation registration. The upstream workflow is retained; no
automatic active-session migration is installed.

#!/bin/bash
set -euo pipefail

REPOSITORY="${CODEX_SIDEBAR_REPOSITORY:-nuyoah-ai-works/nuyoah-codex-workstation}"
REPOSITORY_REF="${CODEX_SIDEBAR_REF:-main}"
INSTALL_DIR="${CODEX_SIDEBAR_INSTALL_DIR:-${HOME}/Library/Application Support/Codex Sidebar Enhancer}"
SOURCE_DIR="${CODEX_SIDEBAR_SOURCE_DIR:-}"
DEBUG_PORT="${CODEX_SIDEBAR_PORT:-9231}"
TEMP_DIR=""
STAGING_DIR=""
BACKUP_DIR=""

fail() {
  printf 'Install failed: %s\n' "$1" >&2
  exit 1
}

cleanup() {
  if [[ -n "${STAGING_DIR}" && -d "${STAGING_DIR}" ]]; then
    rm -rf "${STAGING_DIR}"
  fi
  if [[ -n "${TEMP_DIR}" && -d "${TEMP_DIR}" ]]; then
    rm -rf "${TEMP_DIR}"
  fi
}
trap cleanup EXIT

[[ "$(uname -s)" == "Darwin" ]] || fail "macOS is required"
case "${INSTALL_DIR}" in
  ""|"/"|"${HOME}") fail "unsafe install directory: ${INSTALL_DIR}" ;;
esac

NODE_PATH="${CODEX_SIDEBAR_NODE:-}"
if [[ -z "${NODE_PATH}" ]] && command -v node >/dev/null 2>&1; then
  NODE_PATH="$(command -v node)"
fi
if [[ -z "${NODE_PATH}" ]]; then
  for CANDIDATE in \
    "/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node" \
    "/Applications/Codex.app/Contents/Resources/cua_node/bin/node"; do
    if [[ -x "${CANDIDATE}" ]]; then
      NODE_PATH="${CANDIDATE}"
      break
    fi
  done
fi
[[ -x "${NODE_PATH}" ]] || fail "Node.js 22+ was not found; install Node.js or the Codex desktop app first"

NODE_MAJOR="$(${NODE_PATH} -p 'Number(process.versions.node.split(".")[0])')"
NODE_MINOR="$(${NODE_PATH} -p 'Number(process.versions.node.split(".")[1])')"
if [[ "${NODE_MAJOR}" -lt 22 || ( "${NODE_MAJOR}" -eq 22 && "${NODE_MINOR}" -lt 5 ) ]]; then
  fail "Node.js 22.5 or newer is required"
fi

if [[ -z "${SOURCE_DIR}" ]]; then
  TEMP_DIR="$(mktemp -d)"
  ARCHIVE_PATH="${TEMP_DIR}/source.tar.gz"
  /usr/bin/curl -fsSL \
    "https://github.com/${REPOSITORY}/archive/refs/heads/${REPOSITORY_REF}.tar.gz" \
    -o "${ARCHIVE_PATH}"
  /usr/bin/tar -xzf "${ARCHIVE_PATH}" -C "${TEMP_DIR}"
  SOURCE_DIR="$(find "${TEMP_DIR}" -mindepth 1 -maxdepth 1 -type d -print -quit)"
fi
[[ -f "${SOURCE_DIR}/scripts/runtime.mjs" ]] || fail "downloaded package is incomplete"
[[ -f "${SOURCE_DIR}/nuyoah/skills/runtime-catalog.mjs" ]] || fail "Nuyoah runtime Skill catalog is missing"
[[ -f "${SOURCE_DIR}/vendor/codex-taskboard/VERSION.json" ]] || fail "bundled Taskboard manifest is missing"
[[ -f "${SOURCE_DIR}/vendor/codex-taskboard/dist/web/index.html" ]] || fail "bundled Taskboard web build is missing"
[[ -f "${SOURCE_DIR}/vendor/codex-workspace-enhancer/asset-browser/server.js" ]] || fail "bundled Asset Console service is missing"
[[ -f "${SOURCE_DIR}/vendor/codex-workspace-enhancer/asset-console/public/index.html" ]] || fail "bundled Asset Console web build is missing"

INSTALL_PARENT="$(dirname "${INSTALL_DIR}")"
mkdir -p "${INSTALL_PARENT}"
STAGING_DIR="${INSTALL_PARENT}/.codex-sidebar-enhancer-new-$$"
BACKUP_DIR="${INSTALL_PARENT}/.codex-sidebar-enhancer-previous-$$"
mkdir -p "${STAGING_DIR}"
/usr/bin/rsync -a \
  --exclude '.git' \
  --exclude 'node_modules' \
  --exclude '/output/' \
  --exclude '/*.png' \
  "${SOURCE_DIR}/" "${STAGING_DIR}/"

if [[ -e "${INSTALL_DIR}" ]]; then
  mv "${INSTALL_DIR}" "${BACKUP_DIR}"
fi
mv "${STAGING_DIR}" "${INSTALL_DIR}"
STAGING_DIR=""

ACTIVATE_ARGS=(
  "${INSTALL_DIR}/scripts/install.mjs"
  "--activate"
  "--home" "${HOME}"
  "--install-dir" "${INSTALL_DIR}"
  "--node-path" "${NODE_PATH}"
  "--port" "${DEBUG_PORT}"
)
if [[ "${CODEX_SIDEBAR_SKIP_LAUNCHCTL:-0}" == "1" ]]; then
  ACTIVATE_ARGS+=("--skip-launchctl")
fi

if ! "${NODE_PATH}" "${ACTIVATE_ARGS[@]}"; then
  rm -rf "${INSTALL_DIR}"
  if [[ -d "${BACKUP_DIR}" ]]; then
    mv "${BACKUP_DIR}" "${INSTALL_DIR}"
  fi
  fail "LaunchAgent activation failed"
fi

if [[ -d "${BACKUP_DIR}" ]]; then
  rm -rf "${BACKUP_DIR}"
fi

if [[ "${CODEX_SIDEBAR_SKIP_OPEN:-0}" != "1" ]]; then
  /usr/bin/open "${HOME}/Applications/Codex Sidebar Enhancer.app"
fi

printf '\nCodex Sidebar Enhancer installed.\n'
printf 'Launcher: %s\n' "${HOME}/Applications/Codex Sidebar Enhancer.app"
printf 'Logs: %s\n' "${HOME}/Library/Logs/CodexSidebarEnhancer"

#!/bin/bash
set -euo pipefail

INSTALL_DIR="${CODEX_SIDEBAR_INSTALL_DIR:-${HOME}/Library/Application Support/Codex Sidebar Enhancer}"
LAUNCHER_PATH="${HOME}/Applications/Codex Sidebar Enhancer.app"
LOGS_DIR="${HOME}/Library/Logs/CodexSidebarEnhancer"
PLIST_PATH="${HOME}/Library/LaunchAgents/com.yubowen.codex-sidebar-enhancer.plist"
LEGACY_PLIST_PATH="${HOME}/Library/LaunchAgents/com.yubowen.codex-conversation-preview.plist"
LEGACY_TASKBOARD_MARKER="${INSTALL_DIR}/.legacy-taskboard-disabled"

case "${INSTALL_DIR}" in
  "${HOME}/Library/Application Support/"*) ;;
  *) printf 'Uninstall refused unsafe path: %s\n' "${INSTALL_DIR}" >&2; exit 1 ;;
esac

if [[ "${CODEX_SIDEBAR_SKIP_LAUNCHCTL:-0}" != "1" ]]; then
  DOMAIN="gui/$(id -u)"
  launchctl bootout "${DOMAIN}" "${PLIST_PATH}" >/dev/null 2>&1 || true
  launchctl bootout "${DOMAIN}" "${LEGACY_PLIST_PATH}" >/dev/null 2>&1 || true
  if [[ -f "${LEGACY_TASKBOARD_MARKER}" ]]; then
    while IFS= read -r LEGACY_LABEL; do
      [[ -n "${LEGACY_LABEL}" ]] || continue
      LEGACY_TASKBOARD_PLIST="${HOME}/Library/LaunchAgents/${LEGACY_LABEL}.plist"
      launchctl enable "${DOMAIN}/${LEGACY_LABEL}" >/dev/null 2>&1 || true
      if [[ -f "${LEGACY_TASKBOARD_PLIST}" ]]; then
        launchctl bootstrap "${DOMAIN}" "${LEGACY_TASKBOARD_PLIST}" >/dev/null 2>&1 || true
      fi
    done < "${LEGACY_TASKBOARD_MARKER}"
  fi
fi

for TARGET in \
  "${PLIST_PATH}" \
  "${LEGACY_PLIST_PATH}" \
  "${LAUNCHER_PATH}" \
  "${INSTALL_DIR}" \
  "${LOGS_DIR}"; do
  if [[ -e "${TARGET}" ]]; then
    rm -rf "${TARGET}"
  fi
done

printf 'Codex Sidebar Enhancer uninstalled.\n'

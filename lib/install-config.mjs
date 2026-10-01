import os from "node:os";
import path from "node:path";

export const LAUNCH_AGENT_LABEL = "com.yubowen.codex-sidebar-enhancer";
export const LEGACY_TASKBOARD_LABELS = [
  "com.yubowen.codex-project-management.injector",
  "com.yubowen.codex-taskboard",
];
export const DEFAULT_DEBUG_PORT = 9231;

function xml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function createInstallPlan({
  home = os.homedir(),
  installDir = path.join(home, "Library", "Application Support", "Codex Sidebar Enhancer"),
  nodePath = process.execPath,
  port = DEFAULT_DEBUG_PORT,
} = {}) {
  const label = LAUNCH_AGENT_LABEL;
  const launchAgentsDir = path.join(home, "Library", "LaunchAgents");
  const logsDir = path.join(home, "Library", "Logs", "CodexSidebarEnhancer");
  const plistPath = path.join(launchAgentsDir, `${label}.plist`);
  const legacyCompatibilityMarker = path.join(installDir, ".legacy-taskboard-disabled");
  const launcherPath = path.join(home, "Applications", "Codex Sidebar Enhancer.app");
  const launcherContentsDir = path.join(launcherPath, "Contents");
  const launcherExecutablePath = path.join(launcherContentsDir, "MacOS", "applet");
  const launcherScriptPath = path.join(launcherContentsDir, "Resources", "launcher.sh");
  const injectorPath = path.join(installDir, "scripts", "runtime.mjs");
  const stdoutPath = path.join(logsDir, "injector.log");
  const stderrPath = path.join(logsDir, "injector.error.log");
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xml(label)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xml(nodePath)}</string>
    <string>${xml(injectorPath)}</string>
    <string>--port</string>
    <string>${xml(port)}</string>
    <string>--watch</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${xml(installDir)}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>5</integer>
  <key>StandardOutPath</key>
  <string>${xml(stdoutPath)}</string>
  <key>StandardErrorPath</key>
  <string>${xml(stderrPath)}</string>
</dict>
</plist>
`;
  const launcherAppleScript = `on run
  set launcherPath to POSIX path of (path to resource "launcher.sh")
  do shell script quoted form of launcherPath & " >/dev/null 2>&1 &"
end run`;
  const launcherScript = `#!/bin/zsh
set -eu

PORT=${port}
if /usr/bin/curl -fsS --max-time 1 "http://127.0.0.1:\${PORT}/json" >/dev/null 2>&1; then
  /usr/bin/open -a "ChatGPT" 2>/dev/null || /usr/bin/open -a "Codex"
  exit 0
fi

APP_PATH=""
APP_NAME=""
for CANDIDATE in "/Applications/ChatGPT.app" "/Applications/Codex.app"; do
  if [[ -d "\${CANDIDATE}" ]]; then
    APP_PATH="\${CANDIDATE}"
    APP_NAME="\${CANDIDATE:t:r}"
    break
  fi
done

if [[ -z "\${APP_PATH}" ]]; then
  /usr/bin/osascript -e 'display alert "Codex Sidebar Enhancer" message "没有找到 ChatGPT.app 或 Codex.app，请先安装 Codex 桌面应用。" as critical'
  exit 1
fi

if /usr/bin/pgrep -x "\${APP_NAME}" >/dev/null 2>&1; then
  RESPONSE=$(/usr/bin/osascript -e 'button returned of (display dialog "需要重启 Codex/ChatGPT 一次以启用侧栏增强。" buttons {"取消", "重启"} default button "重启")')
  [[ "\${RESPONSE}" == "重启" ]] || exit 0
  /usr/bin/osascript -e "tell application \\\"\${APP_NAME}\\\" to quit"
  for _ in {1..40}; do
    /usr/bin/pgrep -x "\${APP_NAME}" >/dev/null 2>&1 || break
    /bin/sleep 0.25
  done
fi

/usr/bin/open -na "\${APP_PATH}" --args \
  "--remote-debugging-port=\${PORT}" \
  "--remote-allow-origins=http://127.0.0.1:\${PORT}" \
  "--enable-features=LocalNetworkAccessForSubframeNavigationsWarningOnly"
`;
  return {
    label,
    port,
    home,
    installDir,
    nodePath,
    launchAgentsDir,
    logsDir,
    plistPath,
    legacyCompatibilityMarker,
    plist,
    launcherPath,
    launcherContentsDir,
    launcherExecutablePath,
    launcherScriptPath,
    launcherAppleScript,
    launcherScript,
  };
}

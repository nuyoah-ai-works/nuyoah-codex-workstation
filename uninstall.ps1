[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Get-Setting([string]$Name, [string]$DefaultValue) {
  $value = [Environment]::GetEnvironmentVariable($Name)
  if ([string]::IsNullOrWhiteSpace($value)) { return $DefaultValue }
  return $value
}

$localAppData = [Environment]::GetFolderPath("LocalApplicationData")
$installDir = Get-Setting "CODEX_SIDEBAR_INSTALL_DIR" (Join-Path $localAppData "Codex Sidebar Enhancer")
$logsDir = Get-Setting "CODEX_SIDEBAR_LOGS_DIR" (Join-Path $localAppData "CodexSidebarEnhancer\Logs")
$startupDir = Get-Setting "CODEX_SIDEBAR_STARTUP_DIR" ([Environment]::GetFolderPath("Startup"))
$startMenuDir = Get-Setting "CODEX_SIDEBAR_START_MENU_DIR" (Join-Path ([Environment]::GetFolderPath("Programs")) "Codex Sidebar Enhancer")
$fullInstallDir = [IO.Path]::GetFullPath($installDir)
$root = [IO.Path]::GetPathRoot($fullInstallDir)
if ($fullInstallDir -eq $root -or $fullInstallDir -eq [IO.Path]::GetFullPath($localAppData)) {
  throw "Unsafe install directory: $fullInstallDir"
}

$injectorPath = Join-Path $fullInstallDir "scripts\runtime.mjs"
$legacyMarker = Join-Path $fullInstallDir ".legacy-taskboard-disabled.json"
try {
  Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -and $_.CommandLine.IndexOf($injectorPath, [StringComparison]::OrdinalIgnoreCase) -ge 0 } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
} catch {}

if (Test-Path -LiteralPath $legacyMarker -PathType Leaf) {
  try {
    $entries = @(Get-Content -LiteralPath $legacyMarker -Raw | ConvertFrom-Json)
    foreach ($entry in $entries) {
      if ($entry.original -and $entry.disabled -and (Test-Path -LiteralPath $entry.disabled -PathType Leaf)) {
        Move-Item -LiteralPath $entry.disabled -Destination $entry.original -Force
      }
    }
  } catch {}
}

$targets = @(
  (Join-Path $startupDir "Codex Sidebar Enhancer.lnk"),
  (Join-Path $startMenuDir "Codex Sidebar Enhancer.lnk"),
  $fullInstallDir,
  $logsDir
)
foreach ($target in $targets) {
  if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Recurse -Force }
}
if (Test-Path -LiteralPath $startMenuDir -PathType Container) {
  if (-not (Get-ChildItem -LiteralPath $startMenuDir -Force | Select-Object -First 1)) {
    Remove-Item -LiteralPath $startMenuDir -Force
  }
}

Write-Output "Codex Sidebar Enhancer uninstalled from Windows."

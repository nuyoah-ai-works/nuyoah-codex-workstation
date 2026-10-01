[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

function Get-Setting([string]$Name, [string]$DefaultValue) {
  $value = [Environment]::GetEnvironmentVariable($Name)
  if ([string]::IsNullOrWhiteSpace($value)) { return $DefaultValue }
  return $value
}

function Test-Node22([string]$Candidate) {
  if ([string]::IsNullOrWhiteSpace($Candidate) -or -not (Test-Path -LiteralPath $Candidate -PathType Leaf)) {
    return $false
  }
  try {
    $versionText = & $Candidate -p "process.versions.node"
    if ($LASTEXITCODE -ne 0) { return $false }
    $version = [Version]$versionText
    return ($version.Major -gt 22 -or ($version.Major -eq 22 -and $version.Minor -ge 5))
  } catch {
    return $false
  }
}

function Copy-Package([string]$From, [string]$To) {
  $entries = @(
    "LICENSE", "README.md", "package.json", "package-lock.json",
    "inject", "lib", "nuyoah", "scripts", "vendor", "windows", "install.ps1", "uninstall.ps1"
  )
  foreach ($entry in $entries) {
    $source = Join-Path $From $entry
    if (Test-Path -LiteralPath $source) {
      Copy-Item -LiteralPath $source -Destination $To -Recurse -Force
    }
  }
}

function Install-PortableNode([string]$Destination, [string]$Scratch) {
  $architecture = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString()
  if ($architecture -eq "Arm64") { $platform = "win-arm64" }
  elseif ($architecture -eq "X64") { $platform = "win-x64" }
  else { throw "Windows architecture $architecture is not supported." }

  $baseUrl = "https://nodejs.org/dist/latest-v22.x"
  $checksumsPath = Join-Path $Scratch "SHASUMS256.txt"
  Invoke-WebRequest -UseBasicParsing -Uri "$baseUrl/SHASUMS256.txt" -OutFile $checksumsPath
  $checksums = Get-Content -LiteralPath $checksumsPath
  $line = $checksums | Where-Object { $_ -match "^([a-fA-F0-9]{64})\s+(node-v.+-$platform\.zip)$" } | Select-Object -First 1
  if (-not $line) { throw "A verified Node.js 22 archive for $platform was not found." }
  $null = $line -match "^([a-fA-F0-9]{64})\s+(.+)$"
  $expectedHash = $Matches[1].ToUpperInvariant()
  $fileName = $Matches[2]
  $archivePath = Join-Path $Scratch $fileName
  Invoke-WebRequest -UseBasicParsing -Uri "$baseUrl/$fileName" -OutFile $archivePath
  $actualHash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToUpperInvariant()
  if ($actualHash -ne $expectedHash) { throw "Node.js archive checksum verification failed." }

  $expanded = Join-Path $Scratch "node-expanded"
  Expand-Archive -LiteralPath $archivePath -DestinationPath $expanded -Force
  $runtimeSource = Get-ChildItem -LiteralPath $expanded -Directory | Select-Object -First 1
  if (-not $runtimeSource -or -not (Test-Path -LiteralPath (Join-Path $runtimeSource.FullName "node.exe"))) {
    throw "The downloaded Node.js runtime is incomplete."
  }
  Copy-Item -LiteralPath $runtimeSource.FullName -Destination $Destination -Recurse -Force
}

function New-Shortcut([string]$Path, [string]$Target, [string]$Arguments, [string]$WorkingDirectory) {
  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($Path)
  $shortcut.TargetPath = $Target
  $shortcut.Arguments = $Arguments
  $shortcut.WorkingDirectory = $WorkingDirectory
  $shortcut.IconLocation = "$Target,0"
  $shortcut.Save()
}

function Suspend-LegacyTaskboard([string]$StartupDirectory, [string]$MarkerPath) {
  $disabled = @()
  $shell = New-Object -ComObject WScript.Shell
  foreach ($shortcutPath in Get-ChildItem -LiteralPath $StartupDirectory -Filter "*.lnk" -File -ErrorAction SilentlyContinue) {
    try {
      $shortcut = $shell.CreateShortcut($shortcutPath.FullName)
      $command = "$($shortcut.TargetPath) $($shortcut.Arguments)"
      if ($command -notmatch "dashi-taskboard" -or $command -notmatch "(?:codex-injector\.mjs|server[\\/]index\.mjs)") { continue }
      $disabledPath = "$($shortcutPath.FullName).disabled-by-codex-sidebar-enhancer"
      Move-Item -LiteralPath $shortcutPath.FullName -Destination $disabledPath -Force
      $disabled += @{ original = $shortcutPath.FullName; disabled = $disabledPath }
    } catch {}
  }
  try {
    Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
      Where-Object { $_.CommandLine -match "dashi-taskboard" -and $_.CommandLine -match "(?:codex-injector\.mjs|server[\\/]index\.mjs)" } |
      ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  } catch {}
  if ($disabled.Count -gt 0) {
    $disabled | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath $MarkerPath -Encoding UTF8
  }
}

$repository = Get-Setting "CODEX_SIDEBAR_REPOSITORY" "nuyoah-ai-works/nuyoah-codex-workstation"
$repositoryRef = Get-Setting "CODEX_SIDEBAR_REF" "main"
$localAppData = [Environment]::GetFolderPath("LocalApplicationData")
$installDir = Get-Setting "CODEX_SIDEBAR_INSTALL_DIR" (Join-Path $localAppData "Codex Sidebar Enhancer")
$logsDir = Get-Setting "CODEX_SIDEBAR_LOGS_DIR" (Join-Path $localAppData "CodexSidebarEnhancer\Logs")
$startupDir = Get-Setting "CODEX_SIDEBAR_STARTUP_DIR" ([Environment]::GetFolderPath("Startup"))
$startMenuDir = Get-Setting "CODEX_SIDEBAR_START_MENU_DIR" (Join-Path ([Environment]::GetFolderPath("Programs")) "Codex Sidebar Enhancer")
$sourceDir = Get-Setting "CODEX_SIDEBAR_SOURCE_DIR" ""
$port = [int](Get-Setting "CODEX_SIDEBAR_PORT" "9231")
if ($port -lt 1 -or $port -gt 65535) { throw "Invalid debugging port: $port" }

$fullInstallDir = [IO.Path]::GetFullPath($installDir)
$root = [IO.Path]::GetPathRoot($fullInstallDir)
if ($fullInstallDir -eq $root -or $fullInstallDir -eq [IO.Path]::GetFullPath($localAppData)) {
  throw "Unsafe install directory: $fullInstallDir"
}

$scratch = Join-Path ([IO.Path]::GetTempPath()) ("codex-sidebar-" + [guid]::NewGuid().ToString("N"))
$stagingDir = Join-Path ([IO.Path]::GetDirectoryName($fullInstallDir)) (".codex-sidebar-new-" + [guid]::NewGuid().ToString("N"))
$backupDir = Join-Path ([IO.Path]::GetDirectoryName($fullInstallDir)) (".codex-sidebar-old-" + [guid]::NewGuid().ToString("N"))
$installed = $false

try {
  New-Item -ItemType Directory -Path $scratch -Force | Out-Null
  if ([string]::IsNullOrWhiteSpace($sourceDir)) {
    $archive = Join-Path $scratch "source.zip"
    Invoke-WebRequest -UseBasicParsing -Uri "https://github.com/$repository/archive/refs/heads/$repositoryRef.zip" -OutFile $archive
    $expandedSource = Join-Path $scratch "source"
    Expand-Archive -LiteralPath $archive -DestinationPath $expandedSource -Force
    $sourceDir = (Get-ChildItem -LiteralPath $expandedSource -Directory | Select-Object -First 1).FullName
  }
  if (-not (Test-Path -LiteralPath (Join-Path $sourceDir "scripts\runtime.mjs"))) {
    throw "Downloaded package is incomplete."
  }
  if (-not (Test-Path -LiteralPath (Join-Path $sourceDir "nuyoah\skills\runtime-catalog.mjs"))) {
    throw "Nuyoah runtime Skill catalog is missing."
  }
  if (-not (Test-Path -LiteralPath (Join-Path $sourceDir "vendor\codex-taskboard\VERSION.json"))) {
    throw "Bundled Taskboard manifest is missing."
  }
  if (-not (Test-Path -LiteralPath (Join-Path $sourceDir "vendor\codex-taskboard\dist\web\index.html"))) {
    throw "Bundled Taskboard web build is missing."
  }
  if (-not (Test-Path -LiteralPath (Join-Path $sourceDir "vendor\codex-workspace-enhancer\asset-browser\server.js"))) {
    throw "Bundled Asset Console service is missing."
  }
  if (-not (Test-Path -LiteralPath (Join-Path $sourceDir "vendor\codex-workspace-enhancer\asset-console\public\index.html"))) {
    throw "Bundled Asset Console web build is missing."
  }

  New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($fullInstallDir)) -Force | Out-Null
  New-Item -ItemType Directory -Path $stagingDir -Force | Out-Null
  Copy-Package $sourceDir $stagingDir

  $nodePath = Get-Setting "CODEX_SIDEBAR_NODE" ""
  if (-not (Test-Node22 $nodePath)) {
    $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
    if ($nodeCommand -and (Test-Node22 $nodeCommand.Source)) { $nodePath = $nodeCommand.Source }
  }
  if (-not (Test-Node22 $nodePath)) {
    $runtimeStaging = Join-Path $stagingDir "runtime"
    Install-PortableNode $runtimeStaging $scratch
    $nodePath = Join-Path $fullInstallDir "runtime\node.exe"
  }

  New-Item -ItemType Directory -Path (Join-Path $stagingDir "windows") -Force | Out-Null
  $config = @{ nodePath = $nodePath; port = $port; logsDir = $logsDir } | ConvertTo-Json
  $utf8 = New-Object System.Text.UTF8Encoding($false)
  [IO.File]::WriteAllText((Join-Path $stagingDir "windows\config.json"), $config, $utf8)

  if (Test-Path -LiteralPath $fullInstallDir) { Move-Item -LiteralPath $fullInstallDir -Destination $backupDir }
  Move-Item -LiteralPath $stagingDir -Destination $fullInstallDir
  $installed = $true

  New-Item -ItemType Directory -Path $logsDir -Force | Out-Null
  New-Item -ItemType Directory -Path $startupDir -Force | Out-Null
  New-Item -ItemType Directory -Path $startMenuDir -Force | Out-Null
  Suspend-LegacyTaskboard $startupDir (Join-Path $fullInstallDir ".legacy-taskboard-disabled.json")
  $powerShellPath = (Get-Process -Id $PID).Path
  $launcherPath = Join-Path $fullInstallDir "windows\launcher.ps1"
  $commonArgs = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$launcherPath`""
  New-Shortcut (Join-Path $startupDir "Codex Sidebar Enhancer.lnk") $powerShellPath "$commonArgs -InjectorOnly" $fullInstallDir
  New-Shortcut (Join-Path $startMenuDir "Codex Sidebar Enhancer.lnk") $powerShellPath $commonArgs $fullInstallDir

  if (Test-Path -LiteralPath $backupDir) { Remove-Item -LiteralPath $backupDir -Recurse -Force }
  if ((Get-Setting "CODEX_SIDEBAR_SKIP_OPEN" "0") -ne "1") {
    & $powerShellPath -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File $launcherPath
  }
  Write-Output "Codex Sidebar Enhancer installed for Windows."
  Write-Output "Launcher: $startMenuDir"
  Write-Output "Logs: $logsDir"
} catch {
  if ($installed -and (Test-Path -LiteralPath $fullInstallDir)) {
    Remove-Item -LiteralPath $fullInstallDir -Recurse -Force
  }
  if (Test-Path -LiteralPath $backupDir) { Move-Item -LiteralPath $backupDir -Destination $fullInstallDir }
  throw
} finally {
  if (Test-Path -LiteralPath $stagingDir) { Remove-Item -LiteralPath $stagingDir -Recurse -Force }
  if (Test-Path -LiteralPath $scratch) { Remove-Item -LiteralPath $scratch -Recurse -Force }
}

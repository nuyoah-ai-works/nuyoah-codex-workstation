[CmdletBinding()]
param([switch]$InjectorOnly)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$configPath = Join-Path $PSScriptRoot "config.json"
if (-not (Test-Path -LiteralPath $configPath)) { throw "Windows installation config is missing." }
$config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
$installDir = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$injectorPath = Join-Path $installDir "scripts\runtime.mjs"
$nodePath = [string]$config.nodePath
$port = [int]$config.port
$logsDir = [string]$config.logsDir

function Test-DebugPort {
  $client = New-Object Net.Sockets.TcpClient
  try {
    $pending = $client.BeginConnect("127.0.0.1", $port, $null, $null)
    if (-not $pending.AsyncWaitHandle.WaitOne(400)) { return $false }
    $client.EndConnect($pending)
    return $true
  } catch {
    return $false
  } finally {
    $client.Dispose()
  }
}

function Get-MainDesktopProcess {
  try {
    return Get-CimInstance Win32_Process -ErrorAction Stop |
      Where-Object {
        $_.Name -in @("ChatGPT.exe", "Codex.exe") -and
        $_.ExecutablePath -and
        $_.CommandLine -notmatch "(?:^|\s)--type="
      } |
      Select-Object -First 1
  } catch {
    return $null
  }
}

function Start-Injector {
  $alreadyRunning = Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -and $_.CommandLine.IndexOf($injectorPath, [StringComparison]::OrdinalIgnoreCase) -ge 0 } |
    Select-Object -First 1
  if ($alreadyRunning) { return }
  New-Item -ItemType Directory -Path $logsDir -Force | Out-Null
  Start-Process -FilePath $nodePath -ArgumentList @($injectorPath, "--port", [string]$port, "--watch") `
    -WorkingDirectory $installDir -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $logsDir "injector.log") `
    -RedirectStandardError (Join-Path $logsDir "injector.error.log")
}

function Find-DesktopExecutable {
  $running = Get-MainDesktopProcess
  if ($running) { return [string]$running.ExecutablePath }

  $candidates = @(
    (Join-Path $env:LOCALAPPDATA "Programs\ChatGPT\ChatGPT.exe"),
    (Join-Path $env:LOCALAPPDATA "Programs\Codex\Codex.exe"),
    (Join-Path $env:ProgramFiles "ChatGPT\ChatGPT.exe"),
    (Join-Path $env:ProgramFiles "Codex\Codex.exe")
  )
  foreach ($candidate in $candidates) {
    if (Test-Path -LiteralPath $candidate -PathType Leaf) { return $candidate }
  }

  try {
    $packages = Get-AppxPackage -ErrorAction Stop |
      Where-Object { $_.Name -match "OpenAI|ChatGPT|Codex" } |
      Sort-Object -Property Version -Descending
    foreach ($package in $packages) {
      $manifest = Get-AppxPackageManifest -Package $package -ErrorAction SilentlyContinue
      foreach ($application in @($manifest.Package.Applications.Application)) {
        $relative = [string]$application.Executable
        if ([string]::IsNullOrWhiteSpace($relative)) { continue }
        $candidate = Join-Path $package.InstallLocation $relative
        if ((Test-Path -LiteralPath $candidate -PathType Leaf) -and $candidate -match "(?:ChatGPT|Codex).*\.exe$") {
          return $candidate
        }
      }
    }
  } catch {}
  return $null
}

Start-Injector
if ($InjectorOnly) { exit 0 }
if (Test-DebugPort) { exit 0 }

$runningApp = Get-MainDesktopProcess
if ($runningApp) {
  Add-Type -AssemblyName PresentationFramework
  $answer = [Windows.MessageBox]::Show(
    "Codex or ChatGPT must restart once to enable the sidebar enhancement.",
    "Codex Sidebar Enhancer",
    [Windows.MessageBoxButton]::YesNo,
    [Windows.MessageBoxImage]::Information
  )
  if ($answer -ne [Windows.MessageBoxResult]::Yes) { exit 0 }
  Stop-Process -Id $runningApp.ProcessId -Force
  for ($attempt = 0; $attempt -lt 40; $attempt += 1) {
    if (-not (Get-Process -Id $runningApp.ProcessId -ErrorAction SilentlyContinue)) { break }
    Start-Sleep -Milliseconds 250
  }
}

$appPath = Find-DesktopExecutable
if (-not $appPath) {
  Add-Type -AssemblyName PresentationFramework
  [Windows.MessageBox]::Show(
    "ChatGPT or Codex was not found. Install the Windows desktop app first.",
    "Codex Sidebar Enhancer",
    [Windows.MessageBoxButton]::OK,
    [Windows.MessageBoxImage]::Error
  ) | Out-Null
  exit 1
}

Start-Process -FilePath $appPath -ArgumentList @(
  "--remote-debugging-port=$port",
  "--remote-allow-origins=http://127.0.0.1:$port",
  "--enable-features=LocalNetworkAccessForSubframeNavigationsWarningOnly"
)

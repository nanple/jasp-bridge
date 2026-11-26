[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$PackageDir,
  [string]$InstallDir = (Join-Path $HOME ".workbuddy\jasp-bridge"),
  [switch]$Force,
  [switch]$SkipNode,
  [switch]$SkipStatus
)

$ErrorActionPreference = "Stop"

function Info([string]$Message) { Write-Host "[jasp-bridge] $Message" }
function Warn([string]$Message) { Write-Warning "[jasp-bridge] $Message" }

$PackageDir = (Resolve-Path $PackageDir).Path
$InstallDir = (Resolve-Path $InstallDir).Path

if (-not (Test-Path (Join-Path $PackageDir "src\server.js"))) {
  throw "PackageDir does not contain src\server.js: $PackageDir"
}
if (-not (Test-Path (Join-Path $PackageDir "package.json"))) {
  throw "PackageDir does not contain package.json: $PackageDir"
}
if (-not (Test-Path (Join-Path $InstallDir "src\server.js"))) {
  throw "InstallDir does not contain src\server.js: $InstallDir"
}

$pluginProcesses = @()
try {
  $pluginProcesses = Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -and $_.CommandLine -like "*jasp-bridge*server.js*" }
} catch {
  $pluginProcesses = @()
}

$running = $pluginProcesses
if (-not $running) {
  $running = Get-Process -Name "WorkBuddy", "WorkBuddy CN" -ErrorAction SilentlyContinue
}

if ($running -and -not $Force) {
  throw "JASP-Bridge MCP server or WorkBuddy is running. Close WorkBuddy first, or pass -Force."
}

$updates = Join-Path $InstallDir "updates"
New-Item -ItemType Directory -Path $updates -Force | Out-Null
$log = Join-Path $updates "update.log"
$stamp = Get-Date -Format "yyyyMMddHHmmss"
$backup = Join-Path $InstallDir "backups\$stamp"
New-Item -ItemType Directory -Path $backup -Force | Out-Null

Add-Content $log "[$stamp] update start: $PackageDir -> $InstallDir"

$managed = @(
  "src",
  "scripts",
  "examples",
  "configs",
  "docs",
  "GUIDE.md",
  "SUPPORT-DEEPSEEK-DOUBAO.md",
  "README.md",
  "CHANGELOG.md",
  "LICENSE",
  "package.json",
  "package-lock.json",
  "node_modules"
)

$moved = @()
foreach ($item in $managed) {
  $existing = Join-Path $InstallDir $item
  if (Test-Path $existing) {
    Move-Item $existing (Join-Path $backup $item) -Force
    $moved += $item
  }
}

$nodeBackedUp = $false
if (-not $SkipNode) {
  $oldNode = Join-Path $InstallDir "node.exe"
  if (Test-Path $oldNode) {
    Move-Item $oldNode (Join-Path $backup "node.exe") -Force
    $nodeBackedUp = $true
  }
}

try {
  foreach ($item in $managed) {
    $source = Join-Path $PackageDir $item
    if (Test-Path $source) {
      Copy-Item $source (Join-Path $InstallDir $item) -Recurse -Force
    } elseif (Test-Path (Join-Path $backup $item)) {
      Move-Item (Join-Path $backup $item) (Join-Path $InstallDir $item) -Force
    }
  }

  if (-not $SkipNode) {
    $newNode = Join-Path $PackageDir "node.exe"
    if (Test-Path $newNode) {
      Copy-Item $newNode (Join-Path $InstallDir "node.exe") -Force
    } elseif ($nodeBackedUp) {
      Move-Item (Join-Path $backup "node.exe") (Join-Path $InstallDir "node.exe") -Force
    }
  }

  $node = Join-Path $InstallDir "node.exe"
  if (-not (Test-Path $node)) {
    $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
    if (-not $nodeCommand) { throw "Node.js not found after update." }
    $node = $nodeCommand.Source
  }

  if (-not $SkipStatus) {
    Info "Running capability check..."
    & $node (Join-Path $InstallDir "src\cli\status.js")
    if ($LASTEXITCODE -ne 0) {
      throw "Capability check failed with exit code $LASTEXITCODE."
    }
  }

  Add-Content $log "[$stamp] update ok; backup: $backup"
  Info "Update complete. Backup: $backup"
  Info "Restart WorkBuddy, then call jasp_status."
} catch {
  $message = $_.Exception.Message
  Add-Content $log "[$stamp] update failed: $message"

  foreach ($item in $managed) {
    $installed = Join-Path $InstallDir $item
    if (Test-Path $installed) {
      Remove-Item $installed -Recurse -Force -ErrorAction SilentlyContinue
    }
  }
  if (-not $SkipNode -and -not (Test-Path (Join-Path $InstallDir "node.exe"))) {
    $oldNode = Join-Path $backup "node.exe"
    if (Test-Path $oldNode) {
      Move-Item $oldNode (Join-Path $InstallDir "node.exe") -Force
    }
  }

  foreach ($item in $moved) {
    $saved = Join-Path $backup $item
    if (Test-Path $saved) {
      Move-Item $saved (Join-Path $InstallDir $item) -Force
    }
  }

  Warn "Update failed and the previous version was restored."
  throw $message
}

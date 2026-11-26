[CmdletBinding()]
param(
  [string]$InstallDir = (Join-Path $HOME ".workbuddy\jasp-bridge"),
  [string]$SourceDir = "",
  [switch]$SkipRuntime,
  [switch]$Force,
  [string]$JaspPath = "",
  [string]$NodePath = "",
  [string]$McpPath = (Join-Path $HOME ".workbuddy\mcp.json"),
  [switch]$NoMcp
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($SourceDir)) {
  $SourceDir = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
}

function Info([string]$Message) { Write-Host "[jasp-bridge] $Message" }
function Warn([string]$Message) { Write-Warning "[jasp-bridge] $Message" }

if (-not (Test-Path (Join-Path $SourceDir "src\server.js"))) {
  throw "SourceDir does not look like jasp-bridge: $SourceDir"
}

if ([System.IO.Path]::GetFullPath($SourceDir) -ne [System.IO.Path]::GetFullPath($InstallDir)) {
  Info "Installing to $InstallDir"
  New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
  foreach ($item in @("src", "scripts", "examples", "configs", "docs", "GUIDE.md", "SUPPORT-DEEPSEEK-DOUBAO.md", "package.json", "package-lock.json", "README.md", "CHANGELOG.md", "LICENSE", "mcp.json.example", "latest.json.example", "update.ps1", "node_modules", "node.exe")) {
    $source = Join-Path $SourceDir $item
    if (-not (Test-Path $source)) { continue }
    $destination = Join-Path $InstallDir $item
    if ($item -eq "node_modules" -and (Test-Path $destination)) { continue }
    if (Test-Path $destination) { Remove-Item $destination -Recurse -Force }
    Copy-Item $source $destination -Recurse -Force
  }
}

$nodeCommand = $null
$portableNode = Join-Path $InstallDir "node.exe"
if (Test-Path $portableNode) {
  $nodeCommand = $portableNode
} elseif ($NodePath -and (Test-Path $NodePath)) {
  $nodeCommand = (Resolve-Path $NodePath).Path
} else {
  $node = Get-Command node -ErrorAction SilentlyContinue
  if ($node) { $nodeCommand = $node.Source }
}

if (-not $nodeCommand) {
  throw "Node.js not found. Install Node 20+ or use the portable release that includes node.exe."
}

$nodeModules = Join-Path $InstallDir "node_modules"
if (-not (Test-Path (Join-Path $nodeModules "@modelcontextprotocol"))) {
  $npm = Get-Command npm -ErrorAction SilentlyContinue
  if (-not $npm) {
    throw "node_modules is missing and npm is not available. Use the portable release with bundled node_modules."
  }
  Info "Installing npm dependencies..."
  Push-Location $InstallDir
  try {
    & $npm.Source install --omit=dev --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw "npm install failed with exit code $LASTEXITCODE" }
  } finally {
    Pop-Location
  }
}

$runtimeDir = Join-Path $InstallDir "runtime"
if (-not $SkipRuntime) {
  Info "Preparing the offline JASP runtime (first run copies ~1.7 GB)..."
  & (Join-Path $InstallDir "scripts\setup_runtime.ps1") -RuntimeDir $runtimeDir -JaspPath $JaspPath -Force:$Force
} else {
  Info "Skipping runtime setup (-SkipRuntime)."
}

$serverPath = Join-Path $InstallDir "src\server.js"
$mcpDir = Split-Path $McpPath -Parent
New-Item -ItemType Directory -Path $mcpDir -Force | Out-Null

$entry = [ordered]@{
  command = $nodeCommand
  args = @($serverPath)
  env = [ordered]@{
    JASP_BRIDGE_HOME = $InstallDir
    JASP_RUNTIME = $runtimeDir
    JASP_BRIDGE_TIMEOUT_MS = "300000"
  }
}

if (-not $NoMcp) {
  $config = $null
  if (Test-Path $McpPath) {
    $backup = "$McpPath.bak-$(Get-Date -Format yyyyMMddHHmmss)"
    Copy-Item $McpPath $backup -Force
    try {
      $config = Get-Content $McpPath -Raw -Encoding UTF8 | ConvertFrom-Json
    } catch {
      Warn "Existing mcp.json is not valid JSON; creating a new one (backup: $backup)."
      $config = $null
    }
  }

  if (-not $config) { $config = [pscustomobject]@{} }
  if (-not ($config.PSObject.Properties.Name -contains "mcpServers")) {
    $config | Add-Member -NotePropertyName mcpServers -NotePropertyValue ([pscustomobject]@{})
  }
  $config.mcpServers | Add-Member -NotePropertyName "jasp-bridge" -NotePropertyValue ([pscustomobject]$entry) -Force

  $json = $config | ConvertTo-Json -Depth 20
  [System.IO.File]::WriteAllText($McpPath, $json, (New-Object System.Text.UTF8Encoding($false)))
  Info "WorkBuddy MCP config written: $McpPath"
} else {
  Info "Skipped mcp.json (-NoMcp). Add this server manually:"
  $entry | ConvertTo-Json -Depth 10
}

Info "Running capability check..."
& $nodeCommand (Join-Path $InstallDir "src\cli\status.js")

Info "Done. Restart WorkBuddy, then ask: 'check JASP status'."

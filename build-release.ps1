[CmdletBinding()]
param(
  [string]$Version = "0.3.3",
  [string]$NodeExe = "",
  [switch]$IncludeNode
)

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$dist = Join-Path $root "dist"
$staging = Join-Path $dist "jasp-bridge-$Version-portable"
$zip = Join-Path $dist "jasp-bridge-$Version-portable.zip"

New-Item -ItemType Directory -Path $dist -Force | Out-Null
if (Test-Path $staging) { Remove-Item $staging -Recurse -Force }
New-Item -ItemType Directory -Path $staging -Force | Out-Null

$items = @(
  "src",
  "scripts",
  "examples",
  "configs",
  "docs",
  "GUIDE.md",
  "SUPPORT-DEEPSEEK-DOUBAO.md",
  "package.json",
  "package-lock.json",
  "README.md",
  "CHANGELOG.md",
  "mcp.json.example",
  "latest.json.example",
  "install.ps1",
  "update.ps1",
  "LICENSE",
  "快速开始.txt"
)

foreach ($item in $items) {
  $source = Join-Path $root $item
  if (Test-Path $source) {
    Copy-Item $source (Join-Path $staging $item) -Recurse -Force
  }
}

if (-not (Test-Path (Join-Path $root "node_modules\@modelcontextprotocol"))) {
  throw "node_modules is missing. Run npm install before building the portable release."
}
Copy-Item (Join-Path $root "node_modules") (Join-Path $staging "node_modules") -Recurse -Force

if ($IncludeNode) {
  $sourceNode = if ($NodeExe) { $NodeExe } else { (Get-Command node).Source }
  Copy-Item $sourceNode (Join-Path $staging "node.exe") -Force
}

if (Test-Path $zip) { Remove-Item $zip -Force }
Compress-Archive -Path (Join-Path $staging "*") -DestinationPath $zip -Force

$hash = Get-FileHash $zip -Algorithm SHA256
Write-Host "Built: $zip"
Write-Host "SHA256: $($hash.Hash)"
Write-Host "Package: $([math]::Round((Get-Item $zip).Length / 1MB, 1)) MB"
Write-Host "Note: the runtime is copied from the user's local JASP at install time; it is not included in this zip."

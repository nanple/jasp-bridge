[CmdletBinding()]
param(
  [string]$RuntimeDir = (Join-Path $HOME ".workbuddy\jasp-bridge\runtime"),
  [string]$JaspPath = "",
  [switch]$Force,
  [switch]$CopyLib
)

$ErrorActionPreference = "Stop"

function Info([string]$Message) { Write-Host "[jasp-bridge] $Message" }
function Warn([string]$Message) { Write-Warning "[jasp-bridge] $Message" }

function Get-PkgVersion([string]$PackageDir) {
  $description = Join-Path $PackageDir "DESCRIPTION"
  if (-not (Test-Path $description)) { return $null }
  $line = Select-String -Path $description -Pattern '^Version:' -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $line) { return $null }
  return ($line.Line -replace '^Version:\s*', '').Trim()
}

function Resolve-JaspSource([string]$ExplicitPath) {
  $candidates = New-Object System.Collections.Generic.List[string]

  if ($ExplicitPath) {
    if (Test-Path $ExplicitPath -PathType Container) {
      $candidates.Add((Join-Path $ExplicitPath "JASPDesktop.exe"))
      $candidates.Add((Join-Path $ExplicitPath "JASP.exe"))
    } else {
      $candidates.Add($ExplicitPath)
    }
  }

  if (Get-Command Get-AppxPackage -ErrorAction SilentlyContinue) {
    $appx = Get-AppxPackage -Name '*JASP*' -ErrorAction SilentlyContinue |
      Sort-Object Version -Descending |
      Select-Object -First 1
    if ($appx -and $appx.InstallLocation) {
      $candidates.Add((Join-Path $appx.InstallLocation "JASPDesktop.exe"))
      $candidates.Add((Join-Path $appx.InstallLocation "JASP.exe"))
    }
  }

  $candidates.Add("C:\Program Files\JASP\JASPDesktop.exe")
  $candidates.Add("C:\Program Files\JASP\JASP.exe")
  $candidates.Add("C:\Program Files (x86)\JASP\JASP.exe")
  if ($env:LOCALAPPDATA) {
    $candidates.Add((Join-Path $env:LOCALAPPDATA "Programs\JASP\JASP.exe"))
    $candidates.Add((Join-Path $env:LOCALAPPDATA "JASP\JASP.exe"))
  }

  foreach ($exe in $candidates) {
    if (-not (Test-Path $exe -PathType Leaf)) { continue }
    $root = Split-Path $exe -Parent
    if (-not (Test-Path (Join-Path $root "R\bin\Rscript.exe"))) { continue }
    if (-not (Test-Path (Join-Path $root "Modules\module_libs"))) { continue }

    $edition = "desktop"
    $version = $null
    if ($exe -like "*\WindowsApps\*") {
      $edition = "store"
      $appx = Get-AppxPackage -Name '*JASP*' -ErrorAction SilentlyContinue |
        Where-Object { $_.InstallLocation -eq $root } |
        Select-Object -First 1
      if ($appx) { $version = $appx.Version }
    } else {
      try { $version = (Get-Item $exe).VersionInfo.FileVersion } catch { }
    }

    return [pscustomobject]@{
      Root = $root
      Exe = $exe
      Edition = $edition
      Version = $version
    }
  }

  throw "No usable JASP installation found. Install JASP from the Microsoft Store or jasp-stats.org, or pass -JaspPath <JASPDesktop.exe>."
}

function Copy-JaspRuntime($Source, [string]$RuntimeDir, [switch]$Force) {
  $needCopy = $Force -or (-not (Test-Path (Join-Path $RuntimeDir "R\bin\Rscript.exe"))) -or (-not (Test-Path (Join-Path $RuntimeDir "Modules\module_libs")))

  if (-not $needCopy) {
    Info "Runtime already exists; skipping copy. Use -Force to refresh."
    return
  }

  New-Item -ItemType Directory -Path $RuntimeDir -Force | Out-Null
  Info "Copying R (~250 MB)..."
  robocopy (Join-Path $Source.Root "R") (Join-Path $RuntimeDir "R") /E /NFL /NDL /NJH /NJS /NP /R:1 /W:1 | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "Failed to copy R (robocopy exit $LASTEXITCODE)." }

  Info "Copying Modules (~1.5 GB)..."
  robocopy (Join-Path $Source.Root "Modules") (Join-Path $RuntimeDir "Modules") /E /NFL /NDL /NJH /NJS /NP /R:1 /W:1 | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "Failed to copy Modules (robocopy exit $LASTEXITCODE)." }
}

function New-FlatLibrary([string]$RuntimeDir, [switch]$CopyLib, [switch]$Force) {
  $lib = Join-Path $RuntimeDir "lib"
  New-Item -ItemType Directory -Path $lib -Force | Out-Null

  $packages = Get-ChildItem (Join-Path $RuntimeDir "Modules\binary_pkgs") -Directory -ErrorAction SilentlyContinue |
    ForEach-Object { Get-ChildItem $_.FullName -Directory -ErrorAction SilentlyContinue } |
    Where-Object { Test-Path (Join-Path $_.FullName "DESCRIPTION") }

  $chosen = $packages | Group-Object Name | ForEach-Object {
    $_.Group | Sort-Object -Property {
      try { [version](Get-PkgVersion $_.FullName) } catch { [version]"0.0.0" }
    } -Descending | Select-Object -First 1
  }

  $created = 0
  $skipped = 0
  foreach ($package in $chosen) {
    $target = Join-Path $lib $package.Name
    $exists = Test-Path $target

    if ($exists) {
      $item = Get-Item $target -Force
      $isJunction = $item.LinkType -eq "Junction"
      $sameTarget = $false
      if ($isJunction) {
        $linkTargets = $item.Target
        if ($linkTargets -isnot [array]) { $linkTargets = @($linkTargets) }
        $sameTarget = $linkTargets -contains $package.FullName
      }
      if ($sameTarget -and -not $Force) { $skipped++; continue }
      if ($isJunction) {
        cmd /c rmdir "$target" | Out-Null
      } else {
        Remove-Item $target -Recurse -Force
      }
    }

    if ($CopyLib) {
      Copy-Item $package.FullName $target -Recurse -Force
    } else {
      try {
        New-Item -ItemType Junction -Path $target -Target $package.FullName -ErrorAction Stop | Out-Null
      } catch {
        cmd /c mklink /J "$target" "$($package.FullName)" | Out-Null
      }
    }
    $created++
  }

  return [pscustomobject]@{
    Total = $chosen.Count
    Created = $created
    Skipped = $skipped
    Mode = if ($CopyLib) { "copy" } else { "junction" }
  }
}

function Repair-JaspTools([string]$LibDir) {
  $link = Join-Path $LibDir "jaspTools"
  if (-not (Test-Path $link)) {
    throw "jaspTools is missing from the flat library. The runtime copy may be incomplete."
  }

  $item = Get-Item $link -Force
  $target = $link
  if ($item.LinkType -eq "Junction") {
    $targets = $item.Target
    if ($targets -is [array]) { $targets = $targets[0] }
    $target = $targets
  }

  New-Item -ItemType Directory -Path (Join-Path $target "html\jasp-html") -Force | Out-Null
  New-Item -ItemType Directory -Path (Join-Path $target "jaspData") -Force | Out-Null
  New-Item -ItemType File -Path (Join-Path $target "setup_complete.txt") -Force | Out-Null
  return $target
}

function Repair-ModuleShims([string]$RuntimeDir) {
  $modules = @(
    @{ Bundle = "jaspDescriptives"; Pkg = "jaspDescriptives" },
    @{ Bundle = "jaspTTests"; Pkg = "jaspTTests" },
    @{ Bundle = "jaspAnova"; Pkg = "jaspAnova" },
    @{ Bundle = "jaspRegression"; Pkg = "jaspRegression" },
    @{ Bundle = "jaspReliability"; Pkg = "jaspReliability" }
  )

  foreach ($module in $modules) {
    $packageDir = Join-Path $RuntimeDir "Modules\module_libs\$($module.Bundle)\$($module.Pkg)"
    if (-not (Test-Path $packageDir)) {
      Warn "Missing module: $packageDir"
      continue
    }

    $inst = Join-Path $packageDir "inst"
    New-Item -ItemType Directory -Path $inst -Force | Out-Null

    $description = Join-Path $packageDir "Description.qml"
    if (Test-Path $description) {
      Copy-Item $description (Join-Path $inst "Description.qml") -Force
    }

    $qml = Join-Path $packageDir "qml"
    if (Test-Path $qml) {
      $qmlTarget = Join-Path $inst "qml"
      if (Test-Path $qmlTarget) { Remove-Item $qmlTarget -Recurse -Force }
      robocopy $qml $qmlTarget /E /NFL /NDL /NJH /NJS /NP | Out-Null
      if ($LASTEXITCODE -ge 8) { throw "Failed to copy qml: $packageDir" }
    }

    $icons = Join-Path $packageDir "icons"
    if (Test-Path $icons) {
      $iconTarget = Join-Path $inst "icons"
      if (Test-Path $iconTarget) { Remove-Item $iconTarget -Recurse -Force }
      robocopy $icons $iconTarget /E /NFL /NDL /NJH /NJS /NP | Out-Null
      if ($LASTEXITCODE -ge 8) { throw "Failed to copy icons: $packageDir" }
    }
  }
}

function Write-RuntimeInfo($Source, [string]$RuntimeDir, $LibInfo, [string]$JaspToolsPath) {
  $info = [ordered]@{
    schema = "jasp-bridge/runtime@1"
    created_at = (Get-Date).ToString("o")
    jasp = [ordered]@{
      path = $Source.Exe
      root = $Source.Root
      edition = $Source.Edition
      version = [string]$Source.Version
    }
    runtime = $RuntimeDir
    lib_mode = $LibInfo.Mode
    package_count = $LibInfo.Total
    jaspTools = $JaspToolsPath
  }
  $json = $info | ConvertTo-Json -Depth 6
  $file = Join-Path $RuntimeDir "runtime.json"
  [System.IO.File]::WriteAllText($file, $json, (New-Object System.Text.UTF8Encoding($false)))
}

$source = Resolve-JaspSource -ExplicitPath $JaspPath
Info "JASP: $($source.Exe)"
Info "Version: $($source.Version) ($($source.Edition))"
Info "Runtime: $RuntimeDir"

Copy-JaspRuntime -Source $source -RuntimeDir $RuntimeDir -Force:$Force

$libInfo = New-FlatLibrary -RuntimeDir $RuntimeDir -CopyLib:$CopyLib -Force:$Force
Info "Flat library: $($libInfo.Total) packages ($($libInfo.Mode)), created $($libInfo.Created), reused $($libInfo.Skipped)"

$jaspToolsPath = Repair-JaspTools -LibDir (Join-Path $RuntimeDir "lib")
Info "jaspTools: $jaspToolsPath"

Repair-ModuleShims -RuntimeDir $RuntimeDir
Info "Module shims: inst/Description.qml and inst/qml are ready."

Write-RuntimeInfo -Source $source -RuntimeDir $RuntimeDir -LibInfo $libInfo -JaspToolsPath $jaspToolsPath
Info "Done. Run 'node src/cli/status.js' to verify, or call jasp_status in WorkBuddy."

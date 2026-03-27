param(
  [string]$SourceAppDir = ".\\simple",
  [string]$SourceSnapshotDir = ".\\Plugin Snapshot",
  [string]$OutputDir = ".\\docs"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$scriptRoot = Split-Path -Parent $PSCommandPath
$buildScript = Join-Path $scriptRoot "build_plugin_snapshots.ps1"

if (-not (Test-Path -LiteralPath $buildScript)) {
  throw "Cannot find build script: $buildScript"
}

function Resolve-ExistingPathOrThrow {
  param([string]$Path, [string]$Label)

  if (-not (Test-Path -LiteralPath $Path)) {
    throw "$Label not found: $Path"
  }

  return (Resolve-Path -LiteralPath $Path).Path
}

$resolvedAppDir = Resolve-ExistingPathOrThrow -Path (Join-Path $scriptRoot $SourceAppDir) -Label "Source app dir"

$resolvedSnapshotDir = $null
$snapshotCandidate = Join-Path $scriptRoot $SourceSnapshotDir
if (Test-Path -LiteralPath $snapshotCandidate) {
  $resolvedSnapshotDir = (Resolve-Path -LiteralPath $snapshotCandidate).Path
}

$outputCandidate = Join-Path $scriptRoot $OutputDir
if (Test-Path -LiteralPath $outputCandidate) {
  $resolvedOutput = (Resolve-Path -LiteralPath $outputCandidate).Path

  # Safety guard: only allow removing output inside current workspace root.
  if (-not $resolvedOutput.StartsWith($scriptRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to remove path outside workspace: $resolvedOutput"
  }

  Remove-Item -LiteralPath $resolvedOutput -Recurse -Force
}

New-Item -ItemType Directory -Path $outputCandidate -Force | Out-Null
$resolvedOutputDir = (Resolve-Path -LiteralPath $outputCandidate).Path

# 1) Copy static app files
Copy-Item -Path (Join-Path $resolvedAppDir '*') -Destination $resolvedOutputDir -Recurse -Force

# 2) Copy processed snapshots if available
$outputSnapshots = Join-Path $resolvedOutputDir "Plugin Snapshot"
New-Item -ItemType Directory -Path $outputSnapshots -Force | Out-Null

if ($resolvedSnapshotDir) {
  Copy-Item -Path (Join-Path $resolvedSnapshotDir '*') -Destination $outputSnapshots -Recurse -Force
}

# 3) Rebuild manifest for docs-relative paths
$emptyUnprocessed = Join-Path $resolvedOutputDir "__manifest_tmp_unprocessed"
New-Item -ItemType Directory -Path $emptyUnprocessed -Force | Out-Null

& $buildScript `
  -UnprocessedDir $emptyUnprocessed `
  -ProcessedDir $outputSnapshots `
  -DataFile (Join-Path $resolvedOutputDir "data.js") `
  -ManifestFile (Join-Path $resolvedOutputDir "plugin_snapshots_manifest.js") `
  -KeepOriginal

Remove-Item -LiteralPath $emptyUnprocessed -Recurse -Force

# 4) GitHub Pages compatibility marker
Set-Content -LiteralPath (Join-Path $resolvedOutputDir ".nojekyll") -Value "" -Encoding ascii

Write-Host ""
Write-Host "GitHub Pages output ready:" $resolvedOutputDir
Write-Host "Next step: push this repo, then set Pages source to branch/main + /docs."

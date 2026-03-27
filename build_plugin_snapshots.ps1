param(
  [string]$UnprocessedDir = ".\unprocessed",
  [string]$ProcessedDir = ".\Plugin Snapshot",
  [string]$DataFile = ".\simple\data.js",
  [string]$ManifestFile = ".\simple\plugin_snapshots_manifest.js",
  [int]$MaxWidth = 1280,
  [int]$MaxHeight = 720,
  [ValidateRange(1,100)][int]$JpegQuality = 82,
  [switch]$KeepOriginal
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Normalize-Name {
  param([string]$Text)

  if ([string]::IsNullOrWhiteSpace($Text)) {
    return ""
  }

  $normalized = $Text.ToLowerInvariant()
  $normalized = [regex]::Replace($normalized, "[^a-z0-9]+", " ")
  return $normalized.Trim()
}

function Get-SafeFileName {
  param([string]$Text)

  $name = [string]$Text
  foreach ($ch in [System.IO.Path]::GetInvalidFileNameChars()) {
    $name = $name.Replace($ch, '_')
  }

  $name = $name.Trim()
  if ([string]::IsNullOrWhiteSpace($name)) {
    return "unnamed"
  }

  return $name
}

function Get-PluginPairs {
  param([string]$Path)

  $plugins = New-Object System.Collections.Generic.List[object]
  $currentId = ""

  foreach ($line in Get-Content -LiteralPath $Path) {
    if ($line -match '^\s*"id"\s*:\s*"([^"]+)"\s*,?\s*$') {
      $currentId = $Matches[1]
      continue
    }

    if ($line -match '^\s*"name"\s*:\s*"([^"]+)"\s*,?\s*$') {
      $currentName = $Matches[1]

      if (-not [string]::IsNullOrWhiteSpace($currentId) -and -not [string]::IsNullOrWhiteSpace($currentName)) {
        $plugins.Add([pscustomobject]@{
          id = $currentId
          name = $currentName
        })
      }

      $currentId = ""
    }
  }

  if ($plugins.Count -eq 0) {
    throw "Cannot parse plugin id/name pairs from data file: $Path"
  }

  return $plugins.ToArray()
}

function Get-JpegCodec {
  $codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() |
    Where-Object { $_.MimeType -eq "image/jpeg" } |
    Select-Object -First 1

  if (-not $codec) {
    throw "JPEG encoder not found on this machine."
  }

  return $codec
}

function Convert-ImageToJpeg {
  param(
    [string]$SourcePath,
    [string]$DestPath,
    [int]$MaxWidth,
    [int]$MaxHeight,
    [int]$JpegQuality,
    [System.Drawing.Imaging.ImageCodecInfo]$JpegCodec
  )

  $image = $null
  $bitmap = $null
  $graphics = $null
  $encoderParams = $null

  try {
    $image = [System.Drawing.Image]::FromFile($SourcePath)

    $scaleX = [double]$MaxWidth / [double]$image.Width
    $scaleY = [double]$MaxHeight / [double]$image.Height
    $scale = [Math]::Min($scaleX, $scaleY)
    if ($scale -gt 1.0) { $scale = 1.0 }

    $newWidth = [Math]::Max(1, [int][Math]::Round($image.Width * $scale))
    $newHeight = [Math]::Max(1, [int][Math]::Round($image.Height * $scale))

    $bitmap = New-Object System.Drawing.Bitmap($newWidth, $newHeight)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $graphics.DrawImage($image, 0, 0, $newWidth, $newHeight)

    $qualityEncoder = [System.Drawing.Imaging.Encoder]::Quality
    $encoderParams = New-Object System.Drawing.Imaging.EncoderParameters(1)
    $encoderParams.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter($qualityEncoder, [int64]$JpegQuality)

    $bitmap.Save($DestPath, $JpegCodec, $encoderParams)
  }
  finally {
    if ($encoderParams) { $encoderParams.Dispose() }
    if ($graphics) { $graphics.Dispose() }
    if ($bitmap) { $bitmap.Dispose() }
    if ($image) { $image.Dispose() }
  }
}

function Build-ImageIndex {
  param([System.IO.FileInfo[]]$Files)

  $byExact = @{}
  $byNormalized = @{}

  foreach ($file in $Files) {
    $exact = $file.BaseName.ToLowerInvariant()
    if (-not $byExact.ContainsKey($exact)) {
      $byExact[$exact] = $file
    }

    $normalized = Normalize-Name -Text $file.BaseName
    if ($normalized -and -not $byNormalized.ContainsKey($normalized)) {
      $byNormalized[$normalized] = $file
    }
  }

  return [pscustomobject]@{
    byExact = $byExact
    byNormalized = $byNormalized
  }
}

function Find-PluginByFileBaseName {
  param(
    [string]$BaseName,
    [hashtable]$PluginByExact,
    [hashtable]$PluginByNormalized
  )

  $exact = $BaseName.ToLowerInvariant()
  if ($PluginByExact.ContainsKey($exact)) {
    return $PluginByExact[$exact]
  }

  $normalized = Normalize-Name -Text $BaseName
  if ($normalized -and $PluginByNormalized.ContainsKey($normalized)) {
    return $PluginByNormalized[$normalized]
  }

  return $null
}

function To-WebRelativePath {
  param(
    [string]$ManifestDir,
    [string]$TargetPath
  )

  # Use a file URI as base so sibling folder paths resolve to ../ correctly.
  $baseFile = Join-Path $ManifestDir '__manifest_base__.txt'
  $baseUri = New-Object System.Uri($baseFile)
  $targetUri = New-Object System.Uri($TargetPath)
  return $baseUri.MakeRelativeUri($targetUri).ToString()
}

Add-Type -AssemblyName System.Drawing

if (-not (Test-Path -LiteralPath $UnprocessedDir)) {
  New-Item -ItemType Directory -Path $UnprocessedDir -Force | Out-Null
}
if (-not (Test-Path -LiteralPath $ProcessedDir)) {
  New-Item -ItemType Directory -Path $ProcessedDir -Force | Out-Null
}

$resolvedUnprocessedDir = (Resolve-Path -LiteralPath $UnprocessedDir).Path
$resolvedProcessedDir = (Resolve-Path -LiteralPath $ProcessedDir).Path
$resolvedDataFile = (Resolve-Path -LiteralPath $DataFile).Path

$manifestDir = Split-Path -Parent $ManifestFile
if ($manifestDir -and -not (Test-Path -LiteralPath $manifestDir)) {
  New-Item -ItemType Directory -Path $manifestDir -Force | Out-Null
}
$resolvedManifestDir = (Resolve-Path -LiteralPath $manifestDir).Path

$plugins = Get-PluginPairs -Path $resolvedDataFile
$jpegCodec = Get-JpegCodec

$pluginByExact = @{}
$pluginByNormalized = @{}
foreach ($plugin in $plugins) {
  $exact = ([string]$plugin.name).ToLowerInvariant()
  if (-not $pluginByExact.ContainsKey($exact)) {
    $pluginByExact[$exact] = $plugin
  }

  $normalized = Normalize-Name -Text ([string]$plugin.name)
  if ($normalized -and -not $pluginByNormalized.ContainsKey($normalized)) {
    $pluginByNormalized[$normalized] = $plugin
  }
}

$validImagePattern = '^(?i)\.(jpg|jpeg|png|bmp|gif|tif|tiff)$'
$unprocessedFiles = Get-ChildItem -LiteralPath $resolvedUnprocessedDir -File |
  Where-Object { $_.Extension -match $validImagePattern }

$convertedCount = 0
$removedRawCount = 0
$unmatchedRawCount = 0

foreach ($file in $unprocessedFiles) {
  $plugin = Find-PluginByFileBaseName -BaseName $file.BaseName -PluginByExact $pluginByExact -PluginByNormalized $pluginByNormalized

  if (-not $plugin) {
    $unmatchedRawCount += 1
    continue
  }

  $safeName = Get-SafeFileName -Text ([string]$plugin.name)
  $targetPath = Join-Path $resolvedProcessedDir ($safeName + '.jpg')

  Convert-ImageToJpeg -SourcePath $file.FullName -DestPath $targetPath -MaxWidth $MaxWidth -MaxHeight $MaxHeight -JpegQuality $JpegQuality -JpegCodec $jpegCodec
  $convertedCount += 1

  if (-not $KeepOriginal) {
    Remove-Item -LiteralPath $file.FullName -Force
    $removedRawCount += 1
  }
}

$processedFiles = Get-ChildItem -LiteralPath $resolvedProcessedDir -File |
  Where-Object { $_.Extension -match $validImagePattern }

$imageIndex = Build-ImageIndex -Files $processedFiles

$manifestMap = [ordered]@{}
$matchedForManifest = 0

foreach ($plugin in $plugins) {
  $exact = ([string]$plugin.name).ToLowerInvariant()
  $imageFile = $null

  if ($imageIndex.byExact.ContainsKey($exact)) {
    $imageFile = $imageIndex.byExact[$exact]
  }
  else {
    $normalized = Normalize-Name -Text ([string]$plugin.name)
    if ($normalized -and $imageIndex.byNormalized.ContainsKey($normalized)) {
      $imageFile = $imageIndex.byNormalized[$normalized]
    }
  }

  if ($imageFile) {
    $relativePath = To-WebRelativePath -ManifestDir $resolvedManifestDir -TargetPath $imageFile.FullName
    $manifestMap[[string]$plugin.id] = $relativePath
    $matchedForManifest += 1
  }
}

$manifestJson = $manifestMap | ConvertTo-Json -Depth 5
$manifestJs = "window.VSTINDER_PLUGIN_IMAGES = $manifestJson;" + [Environment]::NewLine
Set-Content -LiteralPath $ManifestFile -Value $manifestJs -Encoding utf8

Write-Host "Converted from unprocessed:" $convertedCount
Write-Host "Deleted raw files:" $removedRawCount
Write-Host "Unmatched raw files:" $unmatchedRawCount
Write-Host "Images in processed folder:" $processedFiles.Count
Write-Host "Manifest mapped plugins:" $matchedForManifest
Write-Host "Manifest file:" (Resolve-Path -LiteralPath $ManifestFile).Path


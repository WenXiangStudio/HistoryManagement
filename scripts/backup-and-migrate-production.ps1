[CmdletBinding()]
param(
  [string]$IsolatedTestAppData,
  [switch]$IsolatedTestMutateShmAfterPreflight
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot

if (-not $env:APPDATA) { throw 'APPDATA is not defined' }

$sourceRoot = Join-Path $env:APPDATA 'Signal Desk'
$databasePath = Join-Path $sourceRoot 'signal-desk.sqlite'
$backupParent = Join-Path $env:APPDATA 'Signal Desk Backups'
$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
$runId = [Guid]::NewGuid().ToString('N').Substring(0, 8)
$auditRoot = Join-Path $backupParent "pre-r6-migration-$timestamp-$runId"
$backupRoot = Join-Path $auditRoot 'data'
$preflightReport = Join-Path $auditRoot '01-preflight.json'
$raceCheckReport = Join-Path $auditRoot '01b-pre-migration-race-check.json'
$migrationReport = Join-Path $auditRoot '02-migration.json'
$postflightReport = Join-Path $auditRoot '03-postflight.json'
$backupReport = Join-Path $auditRoot '00-backup-verification.json'
$viteNode = Join-Path $repoRoot 'node_modules\vite-node\vite-node.mjs'
$auditScript = Join-Path $repoRoot 'scripts\production-db-migration-audit.ts'

function Get-FileSha256([string]$Path) {
  $stream = [System.IO.File]::OpenRead($Path)
  $sha256 = [System.Security.Cryptography.SHA256]::Create()
  try {
    $hash = $sha256.ComputeHash($stream)
  } finally {
    $stream.Dispose() | Out-Null
    $sha256.Dispose() | Out-Null
  }
  return [string](-join ($hash | ForEach-Object { $_.ToString('X2') }))
}

function Get-Manifest([string]$Root) {
  $rootPath = [System.IO.Path]::GetFullPath($Root).TrimEnd('\')
  $directories = @(Get-ChildItem -LiteralPath $rootPath -Directory -Force -Recurse | Sort-Object FullName | ForEach-Object {
    $_.FullName.Substring($rootPath.Length).TrimStart('\').Replace('\', '/')
  })
  $files = @(Get-ChildItem -LiteralPath $rootPath -File -Force -Recurse | Sort-Object FullName)
  $entries = @($files | ForEach-Object {
    [ordered]@{
      path = $_.FullName.Substring($rootPath.Length).TrimStart('\').Replace('\', '/')
      length = $_.Length
      sha256 = Get-FileSha256 $_.FullName
    }
  })
  $lines = @($directories | ForEach-Object { "D`t{0}" -f $_ })
  $lines += @($entries | ForEach-Object { "F`t{0}`t{1}`t{2}" -f $_.path, $_.length, $_.sha256 })
  $combinedBytes = [System.Text.Encoding]::UTF8.GetBytes(($lines -join "`n"))
  $sha256 = [System.Security.Cryptography.SHA256]::Create()
  try {
    $combinedHash = $sha256.ComputeHash($combinedBytes)
  } finally {
    $sha256.Dispose()
  }
  $totalBytes = [long]0
  foreach ($entry in $entries) {
    $totalBytes += [long]$entry['length']
  }
  [ordered]@{
    directoryCount = $directories.Count
    fileCount = $entries.Count
    totalBytes = $totalBytes
    combinedSha256 = (-join ($combinedHash | ForEach-Object { $_.ToString('X2') }))
    directories = $directories
    entries = $entries
  }
}
function Get-ManifestComparisonSha256($Manifest, [string[]]$ExcludedRelativePaths) {
  $lines = @($Manifest['directories'] | ForEach-Object { "D`t{0}" -f $_ })
  foreach ($entry in @($Manifest['entries'])) {
    $relativePath = [string]$entry['path']
    $excluded = $false
    foreach ($excludedPath in $ExcludedRelativePaths) {
      if ([string]::Equals($relativePath, $excludedPath, [System.StringComparison]::Ordinal)) {
        $excluded = $true
        break
      }
    }
    if (-not $excluded) {
      $lines += "F`t{0}`t{1}`t{2}" -f $relativePath, $entry['length'], $entry['sha256']
    }
  }
  $bytes = [System.Text.Encoding]::UTF8.GetBytes(($lines -join "`n"))
  $sha256 = [System.Security.Cryptography.SHA256]::Create()
  try {
    $hash = $sha256.ComputeHash($bytes)
  } finally {
    $sha256.Dispose() | Out-Null
  }
  return [string](-join ($hash | ForEach-Object { $_.ToString('X2') }))
}


if (-not (Test-Path -LiteralPath $sourceRoot -PathType Container)) { throw "Production data directory not found: $sourceRoot" }
if (-not (Test-Path -LiteralPath $databasePath -PathType Leaf)) { throw "Production database not found: $databasePath" }
if (-not (Test-Path -LiteralPath $viteNode -PathType Leaf)) { throw "vite-node not found: $viteNode" }

$runningApp = @()
if ($IsolatedTestAppData) {
  $actualAppData = [System.IO.Path]::GetFullPath($env:APPDATA).TrimEnd('\')
  $fixtureAppData = [System.IO.Path]::GetFullPath($IsolatedTestAppData).TrimEnd('\')
  $temporaryPrefix = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath()).TrimEnd('\') + '\'
  $fixturePrefix = $fixtureAppData + '\'
  if (-not [string]::Equals($actualAppData, $fixtureAppData, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'Isolated test APPDATA must exactly match the APPDATA environment variable'
  }
  if (-not $fixturePrefix.StartsWith($temporaryPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'Isolated test APPDATA must be inside the system temporary directory'
  }
} else {
  if ($IsolatedTestMutateShmAfterPreflight) {
    throw 'The SHM mutation hook is available only with isolated temporary test APPDATA'
  }
  $runningApp = @(Get-Process -ErrorAction SilentlyContinue | Where-Object {
    $_.ProcessName -in @('Signal Desk', 'electron', 'com.signaldesk.bridge', 'SignalDesk.NativeHost')
  })
}
if ($runningApp.Count -gt 0) {
  throw "Signal Desk/Electron/Native Host must be closed before backup: $($runningApp.ProcessName -join ', ')"
}

New-Item -ItemType Directory -Path $backupRoot | Out-Null
$sourceBefore = Get-Manifest $sourceRoot
Get-ChildItem -LiteralPath $sourceRoot -Force | ForEach-Object {
  Copy-Item -LiteralPath $_.FullName -Destination $backupRoot -Recurse -Force
}
$sourceAfter = Get-Manifest $sourceRoot
$backup = Get-Manifest $backupRoot

if ($sourceBefore.combinedSha256 -ne $sourceAfter.combinedSha256) {
  throw 'Production data changed while the backup was being copied; migration was not started'
}
if ($sourceAfter.combinedSha256 -ne $backup.combinedSha256) {
  throw 'Backup manifest does not match production data; migration was not started'
}

$backupSummary = [ordered]@{
  contract = 'signal-desk-full-backup-verification/v1'
  verifiedAt = (Get-Date).ToUniversalTime().ToString('o')
  source = $sourceRoot
  backup = $backupRoot
  sourceBefore = $sourceBefore
  sourceAfter = $sourceAfter
  backupManifest = $backup
}
[System.IO.File]::WriteAllText($backupReport, (($backupSummary | ConvertTo-Json -Depth 8) + "`n"), [System.Text.UTF8Encoding]::new($false))

& node $viteNode $auditScript preflight $databasePath $preflightReport
if ($LASTEXITCODE -ne 0) { throw "Read-only preflight failed with exit code $LASTEXITCODE; migration was not started" }

$volatileRaceExclusions = @('signal-desk.sqlite-shm')
if ($IsolatedTestMutateShmAfterPreflight) {
  $testShmPath = Join-Path $sourceRoot 'signal-desk.sqlite-shm'
  if (-not (Test-Path -LiteralPath $testShmPath -PathType Leaf)) {
    throw 'The isolated SHM mutation fixture is missing'
  }
  $testShmBytes = [System.IO.File]::ReadAllBytes($testShmPath)
  if ($testShmBytes.Length -eq 0) { throw 'The isolated SHM mutation fixture is empty' }
  $testShmBytes[0] = $testShmBytes[0] -bxor 255
  [System.IO.File]::WriteAllBytes($testShmPath, $testShmBytes)
}

$sourcePreMigration = Get-Manifest $sourceRoot
$sourceAfterRaceSha256 = Get-ManifestComparisonSha256 $sourceAfter $volatileRaceExclusions
$sourcePreMigrationRaceSha256 = Get-ManifestComparisonSha256 $sourcePreMigration $volatileRaceExclusions
$raceCheckPassed = $sourcePreMigrationRaceSha256 -eq $sourceAfterRaceSha256
$raceCheck = [ordered]@{
  contract = 'signal-desk-pre-migration-race-check/v1'
  verifiedAt = (Get-Date).ToUniversalTime().ToString('o')
  verified = $raceCheckPassed
  baselineFullManifestSha256 = $sourceAfter.combinedSha256
  preMigrationFullManifestSha256 = $sourcePreMigration.combinedSha256
  baselineComparisonSha256 = $sourceAfterRaceSha256
  preMigrationComparisonSha256 = $sourcePreMigrationRaceSha256
  volatileExceptions = @([ordered]@{
    path = 'signal-desk.sqlite-shm'
    scope = 'post-preflight pre-migration comparison only'
    rationale = 'SQLite shared-memory sidecar may change during read-only preflight; it remains included in the complete backup and source/backup equality checks'
  })
}
[System.IO.File]::WriteAllText($raceCheckReport, (($raceCheck | ConvertTo-Json -Depth 6) + "`n"), [System.Text.UTF8Encoding]::new($false))
if (-not $raceCheckPassed) {
  throw 'Production data changed after backup verification; migration was not started'
}

& node $viteNode $auditScript migrate $databasePath $migrationReport $preflightReport
if ($LASTEXITCODE -ne 0) { throw "Migration failed with exit code $LASTEXITCODE" }

& node $viteNode $auditScript postflight $databasePath $postflightReport $preflightReport
if ($LASTEXITCODE -ne 0) { throw "Read-only postflight failed with exit code $LASTEXITCODE" }

$preflight = Get-Content -LiteralPath $preflightReport -Raw | ConvertFrom-Json
$postflight = Get-Content -LiteralPath $postflightReport -Raw | ConvertFrom-Json
[ordered]@{
  result = 'PASS'
  backupDirectory = $backupRoot
  auditDirectory = $auditRoot
  sourceFileCount = $sourceAfter.fileCount
  sourceBytes = $sourceAfter.totalBytes
  backupCombinedSha256 = $backup.combinedSha256
  databaseVersionBefore = $preflight.snapshot.userVersion
  databaseVersionAfter = $postflight.snapshot.userVersion
  databaseQuickCheck = $postflight.snapshot.quickCheck
  foreignKeyViolationCount = $postflight.snapshot.foreignKeyViolations.Count
  preMigrationFullManifestSha256 = $sourcePreMigration.combinedSha256
  preMigrationRaceComparisonSha256 = $sourcePreMigrationRaceSha256
  preMigrationRaceVolatileExceptions = $raceCheck.volatileExceptions
  verifiedPreservedTableCount = @($postflight.snapshot.tables.psobject.Properties).Count
} | ConvertTo-Json -Depth 5

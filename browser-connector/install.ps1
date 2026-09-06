param(
  [ValidatePattern('^[a-p]{32}$')]
  [string]$ExtensionId = '',
  [ValidateSet('Chrome', 'Edge', 'Both')]
  [string]$Browser = 'Chrome',
  [string]$HostExe = '',
  [string]$DeploymentDirectory = '',
  [string]$ManifestDirectory = '',
  [switch]$ManifestOnly
)

$ErrorActionPreference = 'Stop'
$connectorRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$identityPath = Join-Path $connectorRoot 'connector-identity.json'
if (-not (Test-Path -LiteralPath $identityPath)) {
  throw "Connector identity metadata was not found: $identityPath"
}

$identity = [IO.File]::ReadAllText($identityPath, [Text.Encoding]::UTF8) | ConvertFrom-Json
$expectedExtensionId = [string]$identity.extensionId
$connectorVersion = [string]$identity.connectorVersion
if ($expectedExtensionId -notmatch '^[a-p]{32}$') {
  throw 'connector-identity.json contains an invalid extension ID.'
}
if (-not $connectorVersion) {
  throw 'connector-identity.json does not contain a connector version.'
}
if ($ExtensionId -and $ExtensionId -ne $expectedExtensionId) {
  throw "The supplied extension ID ($ExtensionId) does not match the fixed Signal Desk extension ID ($expectedExtensionId)."
}
$ExtensionId = $expectedExtensionId

if (-not $env:LOCALAPPDATA) {
  throw 'LOCALAPPDATA is not available for the current user.'
}
if (-not $DeploymentDirectory) {
  $DeploymentDirectory = Join-Path $env:LOCALAPPDATA 'Signal Desk\BrowserConnector'
}
if (-not $ManifestDirectory) {
  $ManifestDirectory = Join-Path $env:LOCALAPPDATA 'Signal Desk\NativeMessagingHosts'
}

$sourceExtensionDirectory = Join-Path $connectorRoot 'extension'
if (-not (Test-Path -LiteralPath (Join-Path $sourceExtensionDirectory 'manifest.json'))) {
  throw "The browser extension source was not found: $sourceExtensionDirectory"
}
if (-not $HostExe) {
  $HostExe = Join-Path $connectorRoot 'native-host\bin\SignalDesk.NativeHost.exe'
}
if (-not (Test-Path -LiteralPath $HostExe)) {
  throw 'SignalDesk.NativeHost.exe was not found. Run build-native-host.ps1 first.'
}
$sourceHostExe = (Resolve-Path -LiteralPath $HostExe).Path

New-Item -ItemType Directory -Force -Path $DeploymentDirectory | Out-Null
$DeploymentDirectory = (Resolve-Path -LiteralPath $DeploymentDirectory).Path
$stableExtensionDirectory = Join-Path $DeploymentDirectory 'extension'
$stableHostDirectory = Join-Path $DeploymentDirectory (Join-Path 'native-host' $connectorVersion)
$stableHostExe = Join-Path $stableHostDirectory 'SignalDesk.NativeHost.exe'
New-Item -ItemType Directory -Force -Path $stableExtensionDirectory | Out-Null
New-Item -ItemType Directory -Force -Path $stableHostDirectory | Out-Null

function Copy-ConnectorFile {
  param(
    [Parameter(Mandatory = $true)][string]$Source,
    [Parameter(Mandatory = $true)][string]$Destination
  )

  $sourcePath = (Resolve-Path -LiteralPath $Source).Path
  $destinationParent = Split-Path -Parent $Destination
  New-Item -ItemType Directory -Force -Path $destinationParent | Out-Null
  $destinationPath = [IO.Path]::GetFullPath($Destination)
  if ([string]::Equals($sourcePath, $destinationPath, [StringComparison]::OrdinalIgnoreCase)) {
    return
  }
  if (Test-Path -LiteralPath $destinationPath) {
    $sourceHash = (Get-FileHash -LiteralPath $sourcePath -Algorithm SHA256).Hash
    $destinationHash = (Get-FileHash -LiteralPath $destinationPath -Algorithm SHA256).Hash
    if ($sourceHash -eq $destinationHash) {
      return
    }
  }
  Copy-Item -LiteralPath $sourcePath -Destination $destinationPath -Force
}

$sourceExtensionRoot = (Resolve-Path -LiteralPath $sourceExtensionDirectory).Path.TrimEnd('\')
foreach ($sourceFile in Get-ChildItem -LiteralPath $sourceExtensionRoot -File -Recurse) {
  $relativePath = $sourceFile.FullName.Substring($sourceExtensionRoot.Length).TrimStart('\')
  Copy-ConnectorFile -Source $sourceFile.FullName -Destination (Join-Path $stableExtensionDirectory $relativePath)
}
Copy-ConnectorFile -Source $sourceHostExe -Destination $stableHostExe

$stableManifestPath = Join-Path $stableExtensionDirectory 'manifest.json'
$stableManifest = [IO.File]::ReadAllText($stableManifestPath, [Text.Encoding]::UTF8) | ConvertFrom-Json
if ([string]$stableManifest.version -ne $connectorVersion) {
  throw "The deployed extension version ($($stableManifest.version)) does not match connector version ($connectorVersion)."
}
if (-not [string]$stableManifest.key) {
  throw 'The deployed extension does not contain its fixed identity key.'
}

$deploymentState = [ordered]@{
  contract = 'signal-desk-browser-connector-deployment/v1'
  connectorVersion = $connectorVersion
  extensionId = $ExtensionId
  extensionPath = $stableExtensionDirectory
  nativeHostPath = $stableHostExe
}
$deploymentStateJson = $deploymentState | ConvertTo-Json -Depth 5
[IO.File]::WriteAllText(
  (Join-Path $DeploymentDirectory 'deployment-state.json'),
  $deploymentStateJson,
  (New-Object Text.UTF8Encoding($false))
)

New-Item -ItemType Directory -Force -Path $ManifestDirectory | Out-Null
$ManifestDirectory = (Resolve-Path -LiteralPath $ManifestDirectory).Path
$manifestPath = Join-Path $ManifestDirectory 'com.signaldesk.bridge.json'
$manifest = [ordered]@{
  name = 'com.signaldesk.bridge'
  description = 'Signal Desk loopback-only native bridge'
  path = $stableHostExe
  type = 'stdio'
  allowed_origins = @("chrome-extension://$ExtensionId/")
}
$manifestJson = $manifest | ConvertTo-Json -Depth 5
[IO.File]::WriteAllText($manifestPath, $manifestJson, (New-Object Text.UTF8Encoding($false)))

if (-not $ManifestOnly) {
  $targets = @()
  if ($Browser -in @('Chrome', 'Both')) { $targets += 'HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.signaldesk.bridge' }
  if ($Browser -in @('Edge', 'Both')) { $targets += 'HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\com.signaldesk.bridge' }
  foreach ($target in $targets) {
    New-Item -Path $target -Force | Out-Null
    Set-Item -Path $target -Value $manifestPath
  }
}

Write-Host "Signal Desk browser connector $connectorVersion deployed."
Write-Host "Fixed extension ID: $ExtensionId"
Write-Host "Load this stable extension directory: $stableExtensionDirectory"
Write-Host "Native Messaging Host: $stableHostExe"
if ($ManifestOnly) {
  Write-Host "Native Messaging manifest generated without registry changes: $manifestPath"
} else {
  Write-Host 'Native Messaging Host registered. Reload the extension and start Signal Desk.'
}

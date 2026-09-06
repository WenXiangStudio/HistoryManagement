param(
  [string]$ManifestDirectory = ''
)

$ErrorActionPreference = 'Stop'
$targets = @(
  'HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.signaldesk.bridge',
  'HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\com.signaldesk.bridge'
)
foreach ($target in $targets) {
  if (Test-Path $target) { Remove-Item -LiteralPath $target -Force }
}

if (-not $ManifestDirectory -and $env:LOCALAPPDATA) {
  $ManifestDirectory = Join-Path $env:LOCALAPPDATA 'Signal Desk\NativeMessagingHosts'
}
if ($ManifestDirectory) {
  $manifestPath = Join-Path $ManifestDirectory 'com.signaldesk.bridge.json'
  if (Test-Path -LiteralPath $manifestPath) { Remove-Item -LiteralPath $manifestPath -Force }
}

Write-Host 'Signal Desk Native Messaging registration was removed. Business data was kept.'

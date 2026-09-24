[CmdletBinding()]
param()

throw '旧逐页 R8 T1 探针已停用。请先按 docs/architecture/r8-acquisition-route-correction-2026-09-24.md 实现并离线验证会话内批量结构化路线。'

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot

Push-Location $repoRoot
try {
  & npm run check:r8-prerequisites
  if ($LASTEXITCODE -ne 0) { throw "R8 offline prerequisite gate failed with exit code $LASTEXITCODE" }
} finally {
  Pop-Location
}

$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
$runId = "r8-t1-$timestamp-$([Guid]::NewGuid().ToString('N').Substring(0, 8))"
$r8Root = Join-Path ([System.IO.Path]::GetTempPath()) 'signal-desk-r8'
$runRoot = Join-Path $r8Root $runId
$extensionRoot = Join-Path $runRoot 'extension'
New-Item -ItemType Directory -Path $extensionRoot | Out-Null

$listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, 0)
$listener.Start()
$port = ([System.Net.IPEndPoint]$listener.LocalEndpoint).Port
$listener.Stop()

$tokenBytes = New-Object byte[] 32
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
try {
  $rng.GetBytes($tokenBytes)
} finally {
  $rng.Dispose() | Out-Null
}
$token = -join ($tokenBytes | ForEach-Object { $_.ToString('x2') })
$controllerOrigin = "http://127.0.0.1:$port"
$startedAt = (Get-Date).ToUniversalTime().ToString('o')

$copyMap = [ordered]@{
  (Join-Path $repoRoot 'poc\r8\extension\manifest.json') = (Join-Path $extensionRoot 'manifest.json')
  (Join-Path $repoRoot 'poc\r8\extension\background.js') = (Join-Path $extensionRoot 'background.js')
  (Join-Path $repoRoot 'poc\r8\extension\popup.html') = (Join-Path $extensionRoot 'popup.html')
  (Join-Path $repoRoot 'poc\r8\extension\popup.js') = (Join-Path $extensionRoot 'popup.js')
  (Join-Path $repoRoot 'poc\r8\extension\popup.css') = (Join-Path $extensionRoot 'popup.css')
  (Join-Path $repoRoot 'poc\r8\extension\r8-trigger.js') = (Join-Path $extensionRoot 'r8-trigger.js')
  (Join-Path $repoRoot 'browser-connector\extension\content.js') = (Join-Path $extensionRoot 'content.js')
  (Join-Path $repoRoot 'browser-connector\extension\network-observer.js') = (Join-Path $extensionRoot 'network-observer.js')
  (Join-Path $repoRoot 'browser-connector\extension\production-envelope-bridge.js') = (Join-Path $extensionRoot 'production-envelope-bridge.js')
}
foreach ($entry in $copyMap.GetEnumerator()) {
  if (-not (Test-Path -LiteralPath $entry.Key -PathType Leaf)) { throw "R8 source file missing: $($entry.Key)" }
  Copy-Item -LiteralPath $entry.Key -Destination $entry.Value
}

$config = [ordered]@{
  runId = $runId
  stage = 'T1-discovery'
  startedAt = $startedAt
  controllerOrigin = $controllerOrigin
  token = $token
}
$configJson = $config | ConvertTo-Json -Compress
[System.IO.File]::WriteAllText(
  (Join-Path $extensionRoot 'session-config.js'),
  "export const R8_CONFIG = Object.freeze($configJson)`n",
  [System.Text.UTF8Encoding]::new($false)
)

$controller = Join-Path $repoRoot 'poc\r8\controller.mjs'
$stdoutLog = Join-Path $runRoot 'controller.stdout.log'
$stderrLog = Join-Path $runRoot 'controller.stderr.log'
$argumentList = @(
  "`"$controller`"",
  '--output', "`"$runRoot`"",
  '--port', [string]$port,
  '--token', $token
)
$process = Start-Process -FilePath 'node' -ArgumentList $argumentList -WindowStyle Hidden -PassThru `
  -RedirectStandardOutput $stdoutLog -RedirectStandardError $stderrLog
[System.IO.File]::WriteAllText((Join-Path $runRoot 'controller.pid'), [string]$process.Id, [System.Text.Encoding]::ASCII)

$headers = @{
  'x-signaldesk-r8-token' = $token
  'x-signaldesk-r8-client' = 'signaldesk-r8-isolated-extension'
}
$ready = $false
for ($attempt = 0; $attempt -lt 40; $attempt += 1) {
  Start-Sleep -Milliseconds 250
  try {
    $health = Invoke-RestMethod -Method Get -Uri "$controllerOrigin/health" -Headers $headers -TimeoutSec 2
    if ($health.ok -eq $true -and $health.runId -eq $runId) { $ready = $true; break }
  } catch {
    if ($process.HasExited) { break }
  }
}
if (-not $ready) {
  if (-not $process.HasExited) { Stop-Process -Id $process.Id -Force }
  $controllerError = if (Test-Path -LiteralPath $stderrLog) { Get-Content -LiteralPath $stderrLog -Raw } else { 'no controller log' }
  throw "R8 T1 controller failed to start: $controllerError"
}

$instructions = @"
Signal Desk R8 T1-discovery is ready.

Run directory:
$runRoot

Load this unpacked extension in the CURRENT LOGGED-IN Chrome profile:
$extensionRoot

1. Open chrome://extensions
2. Enable Developer mode
3. Click Load unpacked
4. Select the extension directory above
5. Pin/open “Signal Desk R8 隔离验证器” and click “开始 T1（3 个入口）”

Do not reload the production Signal Desk connector. Do not close the controller process before the report is generated.
The controller exits automatically after accepting one T1 report.
"@
[System.IO.File]::WriteAllText((Join-Path $runRoot 'START_HERE.txt'), $instructions, [System.Text.UTF8Encoding]::new($false))

[ordered]@{
  result = 'READY'
  runId = $runId
  runDirectory = $runRoot
  extensionDirectory = $extensionRoot
  controllerProcessId = $process.Id
  controllerOrigin = $controllerOrigin
  stage = 'T1-discovery'
  formalDatabaseTouched = $false
  productionCapabilityEnabled = $false
} | ConvertTo-Json -Depth 4

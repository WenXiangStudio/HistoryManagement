[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$featureFlags = Get-Content -LiteralPath (Join-Path $repoRoot 'src\shared\featureFlags.ts') -Raw
if ($featureFlags -notmatch 'export const STRUCTURED_SYNC_AVAILABLE = false') {
  throw '正式同步能力门必须保持关闭。'
}
Push-Location $repoRoot
try {
  & npm run test:r8-harness
  if ($LASTEXITCODE -ne 0) { throw 'R8 离线验证器测试未通过。' }
  & npm run test:network-observer
  if ($LASTEXITCODE -ne 0) { throw 'Observer 离线测试未通过。' }
} finally { Pop-Location }

$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
$runId = "r8-batch-t1-$timestamp-$([Guid]::NewGuid().ToString('N').Substring(0, 8))"
$tempRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
$runRoot = [System.IO.Path]::GetFullPath((Join-Path (Join-Path $tempRoot 'signal-desk-r8') $runId))
if (-not $runRoot.StartsWith($tempRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw '隔离输出目录不在系统临时目录内。'
}
$extensionRoot = Join-Path $runRoot 'extension'
New-Item -ItemType Directory -Path $extensionRoot -Force | Out-Null

$listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, 0)
$listener.Start()
$port = ([System.Net.IPEndPoint]$listener.LocalEndpoint).Port
$listener.Stop()
$tokenBytes = New-Object byte[] 32
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
try { $rng.GetBytes($tokenBytes) } finally { $rng.Dispose() }
$token = -join ($tokenBytes | ForEach-Object { $_.ToString('x2') })

$copyMap = [ordered]@{
  (Join-Path $repoRoot 'poc\r8\batch-extension\manifest.json') = (Join-Path $extensionRoot 'manifest.json')
  (Join-Path $repoRoot 'poc\r8\batch-extension\background.js') = (Join-Path $extensionRoot 'background.js')
  (Join-Path $repoRoot 'poc\r8\batch-extension\popup.html') = (Join-Path $extensionRoot 'popup.html')
  (Join-Path $repoRoot 'poc\r8\batch-extension\popup.js') = (Join-Path $extensionRoot 'popup.js')
  (Join-Path $repoRoot 'poc\r8\extension\r8-trigger.js') = (Join-Path $extensionRoot 'r8-trigger.js')
  (Join-Path $repoRoot 'browser-connector\extension\network-observer.js') = (Join-Path $extensionRoot 'network-observer.js')
  (Join-Path $repoRoot 'browser-connector\extension\r8-browser-transport.js') = (Join-Path $extensionRoot 'r8-browser-transport.js')
}
foreach ($entry in $copyMap.GetEnumerator()) {
  if (-not (Test-Path -LiteralPath $entry.Key -PathType Leaf)) { throw "R8 来源文件缺失：$($entry.Key)" }
  Copy-Item -LiteralPath $entry.Key -Destination $entry.Value
}
$config = @{ runId = $runId; controllerOrigin = "http://127.0.0.1:$port"; token = $token }
$configJson = ConvertTo-Json -InputObject $config -Compress
[System.IO.File]::WriteAllText((Join-Path $extensionRoot 'session-config.js'), "export const R8_CONFIG = Object.freeze($configJson)`n")
$controller = Join-Path $repoRoot 'poc\r8\batch-controller.mjs'
$node = (Get-Command node.exe -ErrorAction Stop).Source
$nodeArgs = @($controller, '--output', $runRoot, '--port', "$port", '--token', $token)
$startInfo = New-Object System.Diagnostics.ProcessStartInfo
$startInfo.FileName = $node
$startInfo.UseShellExecute = $false
$startInfo.CreateNoWindow = $true
foreach ($argument in $nodeArgs) { [void]$startInfo.ArgumentList.Add($argument) }
$process = [System.Diagnostics.Process]::Start($startInfo)
if (-not $process) { throw '无法启动隔离控制器。' }
[System.IO.File]::WriteAllText((Join-Path $runRoot 'controller.pid'), "$($process.Id)`n")
for ($attempt = 0; $attempt -lt 30; $attempt++) {
  if ($process.HasExited) { throw "隔离控制器提前退出：$($process.ExitCode)" }
  Start-Sleep -Milliseconds 300
  if (Test-Path -LiteralPath (Join-Path $runRoot 'controller-session.json')) { break }
}
if (-not (Test-Path -LiteralPath (Join-Path $runRoot 'controller-session.json'))) { throw '隔离控制器未启动。' }
$instructions = @"
R8 批量路线 T1 已准备：$runId

1. Chrome 扩展页面选择“加载已解压的扩展程序”：$extensionRoot
2. 扩展加载后自动开始 T1；可在弹窗查看状态，不必再点击。
3. 结束后查看：$runRoot\acceptance-report.md

只读 GET；正式数据库、历史任务、媒体/ASR/OCR/云服务均不参与。
"@
[System.IO.File]::WriteAllText((Join-Path $runRoot 'START_HERE.txt'), $instructions)
Write-Output $instructions

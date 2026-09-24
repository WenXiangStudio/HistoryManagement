[CmdletBinding()]
param([string]$ReuseExtensionRoot = '')

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$t1Run = 'r8-batch-t1-20260924-184239-072-cf0c7a5b'
$tempRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
$t1ManifestPath = Join-Path (Join-Path (Join-Path $tempRoot 'signal-desk-r8') $t1Run) 'manifest.json'
if (-not (Test-Path -LiteralPath $t1ManifestPath -PathType Leaf)) { throw 'T1 发现报告缺失。' }
$t1Manifest = Get-Content -LiteralPath $t1ManifestPath -Raw | ConvertFrom-Json
if ($t1Manifest.classification -ne 'T1_DISCOVERED' -or $t1Manifest.readyForT2Review -ne $true `
  -or $t1Manifest.formalDatabaseTouched -ne $false) { throw 'T1 未满足进入 T2 的前置条件。' }
$t1ReportPath = Join-Path (Split-Path -Parent $t1ManifestPath) 't1-report.json'
$t1Report = Get-Content -LiteralPath $t1ReportPath -Raw | ConvertFrom-Json
$ownerSecUid = [string]$t1Report.identity.ownerSecUid
if ($ownerSecUid -notmatch '^[A-Za-z0-9._-]{1,240}$') { throw 'T1 owner sec_uid 无效。' }
$featureFlags = Get-Content -LiteralPath (Join-Path $repoRoot 'src\shared\featureFlags.ts') -Raw
if ($featureFlags -notmatch 'export const STRUCTURED_SYNC_AVAILABLE = false') {
  throw '正式同步能力门必须保持关闭。'
}
Push-Location $repoRoot
try {
  & npm run test:r8-harness
  if ($LASTEXITCODE -ne 0) { throw 'R8 离线测试未通过。' }
  & npm run test:network-observer
  if ($LASTEXITCODE -ne 0) { throw 'Observer 离线测试未通过。' }
} finally { Pop-Location }

$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
$runId = "r8-t2-$timestamp-$([Guid]::NewGuid().ToString('N').Substring(0, 8))"
$runRoot = [System.IO.Path]::GetFullPath((Join-Path (Join-Path $tempRoot 'signal-desk-r8') $runId))
if (-not $runRoot.StartsWith($tempRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw 'T2 隔离输出目录无效。'
}
New-Item -ItemType Directory -Path $runRoot -Force | Out-Null
$extensionRoot = if ($ReuseExtensionRoot) { [System.IO.Path]::GetFullPath($ReuseExtensionRoot) }
  else { Join-Path $runRoot 'extension' }
if ($ReuseExtensionRoot) {
  $allowedRoot = [System.IO.Path]::GetFullPath((Join-Path $tempRoot 'signal-desk-r8'))
  if (-not $extensionRoot.StartsWith($allowedRoot + [System.IO.Path]::DirectorySeparatorChar,
      [System.StringComparison]::OrdinalIgnoreCase) `
    -or -not (Test-Path -LiteralPath (Join-Path $extensionRoot 'manifest.json') -PathType Leaf)) {
    throw '复用扩展目录必须是已存在的 R8 系统临时目录。'
  }
} else { New-Item -ItemType Directory -Path $extensionRoot -Force | Out-Null }
$listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, 0)
$listener.Start()
$port = ([System.Net.IPEndPoint]$listener.LocalEndpoint).Port
$listener.Stop()
$tokenBytes = New-Object byte[] 32
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
try { $rng.GetBytes($tokenBytes) } finally { $rng.Dispose() }
$token = -join ($tokenBytes | ForEach-Object { $_.ToString('x2') })
$copyMap = [ordered]@{
  (Join-Path $repoRoot 'poc\r8\batch-extension\t2-manifest.json') = (Join-Path $extensionRoot 'manifest.json')
  (Join-Path $repoRoot 'poc\r8\batch-extension\t2-background.js') = (Join-Path $extensionRoot 'background.js')
  (Join-Path $repoRoot 'poc\r8\batch-extension\t2-popup.html') = (Join-Path $extensionRoot 'popup.html')
  (Join-Path $repoRoot 'poc\r8\batch-extension\t2-popup.js') = (Join-Path $extensionRoot 'popup.js')
  (Join-Path $repoRoot 'poc\r8\extension\r8-trigger.js') = (Join-Path $extensionRoot 'r8-trigger.js')
  (Join-Path $repoRoot 'browser-connector\extension\network-observer.js') = (Join-Path $extensionRoot 'network-observer.js')
  (Join-Path $repoRoot 'browser-connector\extension\r8-browser-transport.js') = (Join-Path $extensionRoot 'r8-browser-transport.js')
  (Join-Path $repoRoot 'browser-connector\extension\r8-batch-core.js') = (Join-Path $extensionRoot 'r8-batch-core.js')
}
foreach ($entry in $copyMap.GetEnumerator()) {
  if (-not (Test-Path -LiteralPath $entry.Key -PathType Leaf)) { throw "T2 来源文件缺失：$($entry.Key)" }
  Copy-Item -LiteralPath $entry.Key -Destination $entry.Value
}
$seed = 'r8-t2-' + $t1Run
$config = @{ runId = $runId; controllerOrigin = "http://127.0.0.1:$port";
  token = $token; ownerSecUid = $ownerSecUid; seed = $seed }
$configJson = ConvertTo-Json -InputObject $config -Compress
[System.IO.File]::WriteAllText((Join-Path $extensionRoot 'session-config.js'), "export const R8_CONFIG = Object.freeze($configJson)`n")
$controller = Join-Path $repoRoot 'poc\r8\t2-controller.mjs'
$node = (Get-Command node.exe -ErrorAction Stop).Source
$startInfo = New-Object System.Diagnostics.ProcessStartInfo
$startInfo.FileName = $node
$startInfo.UseShellExecute = $false
$startInfo.CreateNoWindow = $true
foreach ($argument in @($controller, '--output', $runRoot, '--port', "$port", '--token', $token,
  '--owner-sec-uid', $ownerSecUid)) {
  [void]$startInfo.ArgumentList.Add($argument)
}
$process = [System.Diagnostics.Process]::Start($startInfo)
if (-not $process) { throw 'T2 隔离控制器无法启动。' }
[System.IO.File]::WriteAllText((Join-Path $runRoot 'controller.pid'), "$($process.Id)`n")
for ($attempt = 0; $attempt -lt 30; $attempt++) {
  if ($process.HasExited) { throw "T2 隔离控制器提前退出：$($process.ExitCode)" }
  Start-Sleep -Milliseconds 300
  if (Test-Path -LiteralPath (Join-Path $runRoot 'controller-session.json')) { break }
}
if (-not (Test-Path -LiteralPath (Join-Path $runRoot 'controller-session.json'))) { throw 'T2 隔离控制器未就绪。' }
$instructions = @"
R8 T2 六作品隔离验证已准备：$runId

1. Chrome 扩展页面$(if ($ReuseExtensionRoot) { '重新加载现有 T2 扩展' } else { '加载已解压目录' })：$extensionRoot
2. 扩展运行后查看：$runRoot\acceptance-report.md

固定 6 个作品、每位作者至多 3 个、每作品评论及回复合计至多 20 条。
页面可见内容 shadow 对照在报告中标为待复核；正式数据库和媒体处理不参与。
"@
[System.IO.File]::WriteAllText((Join-Path $runRoot 'START_HERE.txt'), $instructions)
Write-Output $instructions

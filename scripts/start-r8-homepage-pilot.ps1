[CmdletBinding()]
param([string]$ReuseExtensionRoot = '')

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$tempRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
$r8Root = [System.IO.Path]::GetFullPath((Join-Path $tempRoot 'signal-desk-r8'))
$t1Path = Join-Path $r8Root 'r8-batch-t1-20260924-184239-072-cf0c7a5b\t1-report.json'
$catalogPath = Join-Path $r8Root 'verified-catalog.sqlite'
if (-not (Test-Path -LiteralPath $t1Path -PathType Leaf) -or -not (Test-Path -LiteralPath $catalogPath -PathType Leaf)) {
  throw '已验证的 T1 owner 证据或隔离作者目录缺失。'
}
$t1 = Get-Content -LiteralPath $t1Path -Raw | ConvertFrom-Json
$ownerSecUid = [string]$t1.identity.ownerSecUid
if ($ownerSecUid -notmatch '^[A-Za-z0-9._-]{1,240}$') { throw 'owner sec_uid 无效。' }
$featureFlags = Get-Content -LiteralPath (Join-Path $repoRoot 'src\shared\featureFlags.ts') -Raw
if ($featureFlags -notmatch 'export const STRUCTURED_SYNC_AVAILABLE = false') {
  throw '正式同步能力门必须保持关闭。'
}
Push-Location $repoRoot
try {
  & node --test poc/r8/test/homepage-pilot-core.test.mjs poc/r8/test/homepage-pilot-controller.test.mjs
  if ($LASTEXITCODE -ne 0) { throw '主页试跑离线测试未通过。' }
  & npm run test:network-observer
  if ($LASTEXITCODE -ne 0) { throw 'Observer 离线测试未通过。' }
} finally { Pop-Location }
$runId = 'r8-homepage-' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff') + '-' + [Guid]::NewGuid().ToString('N').Substring(0, 8)
$runRoot = [System.IO.Path]::GetFullPath((Join-Path $r8Root $runId))
if (-not $runRoot.StartsWith($r8Root + [System.IO.Path]::DirectorySeparatorChar,
    [System.StringComparison]::OrdinalIgnoreCase)) { throw '隔离 run 目录无效。' }
New-Item -ItemType Directory -Path $runRoot -Force | Out-Null
$extensionRoot = if ($ReuseExtensionRoot) { [System.IO.Path]::GetFullPath($ReuseExtensionRoot) }
  else { Join-Path $runRoot 'extension' }
if ($ReuseExtensionRoot) {
  if (-not $extensionRoot.StartsWith($r8Root + [System.IO.Path]::DirectorySeparatorChar,
      [System.StringComparison]::OrdinalIgnoreCase) `
    -or -not (Test-Path -LiteralPath (Join-Path $extensionRoot 'manifest.json') -PathType Leaf)) {
    throw '复用扩展目录必须是已存在的 R8 系统临时目录。'
  }
} else { New-Item -ItemType Directory -Path $extensionRoot -Force | Out-Null }
$copyMap = [ordered]@{
  (Join-Path $repoRoot 'poc\r8\homepage-extension\manifest.json') = (Join-Path $extensionRoot 'manifest.json')
  (Join-Path $repoRoot 'poc\r8\homepage-extension\background.js') = (Join-Path $extensionRoot 'background.js')
  (Join-Path $repoRoot 'poc\r8\homepage-extension\popup.html') = (Join-Path $extensionRoot 'popup.html')
  (Join-Path $repoRoot 'poc\r8\homepage-extension\popup.js') = (Join-Path $extensionRoot 'popup.js')
  (Join-Path $repoRoot 'browser-connector\extension\network-observer.js') = (Join-Path $extensionRoot 'network-observer.js')
  (Join-Path $repoRoot 'browser-connector\extension\r8-homepage-pilot-core.js') = (Join-Path $extensionRoot 'r8-homepage-pilot-core.js')
  (Join-Path $repoRoot 'browser-connector\extension\r8-homepage-pilot-presentation.js') = (Join-Path $extensionRoot 'r8-homepage-pilot-presentation.js')
}
foreach ($entry in $copyMap.GetEnumerator()) {
  Copy-Item -LiteralPath $entry.Key -Destination $entry.Value
}
$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
$listener.Start()
$port = ([System.Net.IPEndPoint]$listener.LocalEndpoint).Port
$listener.Stop()
$tokenBytes = New-Object byte[] 32
[System.Security.Cryptography.RandomNumberGenerator]::Fill($tokenBytes)
$token = [Convert]::ToHexString($tokenBytes).ToLowerInvariant()
$config = @{ runId = $runId; controllerOrigin = "http://127.0.0.1:$port";
  reportDirectory = $runRoot; token = $token }
$configJson = ConvertTo-Json -InputObject $config -Compress
[System.IO.File]::WriteAllText((Join-Path $extensionRoot 'session-config.js'), "export const PILOT_CONFIG = Object.freeze($configJson)`n")
$node = (Get-Command node.exe -ErrorAction Stop).Source
$startInfo = [System.Diagnostics.ProcessStartInfo]::new()
$startInfo.FileName = $node
$startInfo.UseShellExecute = $false
$startInfo.CreateNoWindow = $true
foreach ($argument in @((Join-Path $repoRoot 'poc\r8\homepage-pilot-controller.mjs'),
    '--output', $runRoot, '--port', "$port", '--token', $token,
    '--owner-sec-uid', $ownerSecUid, '--catalog-path', $catalogPath)) {
  [void]$startInfo.ArgumentList.Add($argument)
}
$process = [System.Diagnostics.Process]::Start($startInfo)
if (-not $process) { throw '隔离控制器无法启动。' }
[System.IO.File]::WriteAllText((Join-Path $runRoot 'controller.pid'), "$($process.Id)`n")
for ($attempt = 0; $attempt -lt 30; $attempt++) {
  if ($process.HasExited) { throw "隔离控制器提前退出：$($process.ExitCode)" }
  Start-Sleep -Milliseconds 300
  if (Test-Path -LiteralPath (Join-Path $runRoot 'controller-session.json')) { break }
}
if (-not (Test-Path -LiteralPath (Join-Path $runRoot 'controller-session.json'))) {
  throw '隔离控制器未就绪。'
}
$instructions = @"
低请求量作者主页隔离试跑已准备：$runId

扩展目录：$extensionRoot
报告目录：$runRoot

扩展$(if ($ReuseExtensionRoot) { '重新加载' } else { '加载' })后不会自动运行。先确认抖音页面已无安全验证提示，再在扩展弹窗中手动选择一位作者并开始。
单轮最多导航一次前置检查首页、一位作者主页和一个作品页；不主动请求作品/详情/评论接口，不下载媒体，不触碰正式数据库。
"@
[System.IO.File]::WriteAllText((Join-Path $runRoot 'START_HERE.txt'), $instructions)
Write-Output $instructions

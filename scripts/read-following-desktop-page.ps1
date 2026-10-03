param(
  [Parameter(Mandatory=$true)][string]$ScriptPath,
  [Parameter(Mandatory=$true)][string]$OutputPath,
  [string]$ConfigPath,
  [int]$ChromeHandle = 0,
  [int]$TimeoutSeconds = 30
)
$ErrorActionPreference='Stop'
$commandStartedAt=[DateTime]::UtcNow.ToString('o')
$commandTimer=[System.Diagnostics.Stopwatch]::StartNew()
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class FollowingPageDesktop { [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd); [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd,int cmd); }'
if (!$ChromeHandle) {
  $windows=@(Get-Process -Name chrome | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -match '抖音' })
  if ($windows.Count -ne 1) { throw 'Expected one Chrome window displaying the Douyin page' }
  $ChromeHandle=$windows[0].MainWindowHandle.ToInt32()
}
$null=[FollowingPageDesktop]::ShowWindow([IntPtr]$ChromeHandle,9)
$null=[FollowingPageDesktop]::SetForegroundWindow([IntPtr]$ChromeHandle)
Start-Sleep -Milliseconds 250
$window=[System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$ChromeHandle)
$address=$window.FindFirst([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::NameProperty,'地址和搜索栏'))
if (!$address) { throw 'Chrome address bar unavailable' }
$addressValue=[System.Windows.Automation.ValuePattern]$address.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
if ($addressValue.Current.Value -notmatch '^(https://)?(www\.)?douyin\.com/user/self([?#].*)?$') { throw 'Chrome must display the current account self page' }
$script=Get-Content -LiteralPath $ScriptPath -Raw
if ((Split-Path -Leaf $ScriptPath) -eq 'read-following-distinct-batch.js') {
  $sharedDirectory=Join-Path (Split-Path -Parent $PSScriptRoot) 'browser-connector/following-extension'
  $timerScript=Get-Content -LiteralPath (Join-Path $sharedDirectory 'following-timing.js') -Raw
  $collectorScript=Get-Content -LiteralPath (Join-Path $sharedDirectory 'following-batch.js') -Raw
  $script="$timerScript`n$collectorScript`n$script"
}
if ($ConfigPath) {
  $config=Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json | ConvertTo-Json -Depth 15 -Compress
  $script="globalThis.SIGNAL_DESK_FOLLOWING_BATCH_CONFIG=$config;`n$script"
}
$quoted=ConvertTo-Json -InputObject $script -Compress
$address.SetFocus()
$addressValue.SetValue("javascript:eval($quoted);void 0")
[System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
$deadline=[DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
$output=$null
do {
  Start-Sleep -Milliseconds 400
  $output=$window.FindFirst([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::NameProperty,'Signal Desk 关注页面读取结果'))
} while (!$output -and [DateTime]::UtcNow -lt $deadline)
if (!$output) { throw 'Following page script did not provide a result before timeout' }
$output.SetFocus()
[System.Windows.Forms.SendKeys]::SendWait('^a')
[System.Windows.Forms.SendKeys]::SendWait('^c')
Start-Sleep -Milliseconds 120
$json=[System.Windows.Forms.Clipboard]::GetText()
$capture=$json | ConvertFrom-Json
$parent=Split-Path -Parent $OutputPath
if ($parent) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
$json | Set-Content -LiteralPath $OutputPath -Encoding utf8
$commandTimer.Stop()
[ordered]@{startedAt=$commandStartedAt;finishedAt=[DateTime]::UtcNow.ToString('o');elapsedMs=$commandTimer.Elapsed.TotalMilliseconds;
  clock='Stopwatch';scope='desktop command including page acquisition and JSON transport; excludes database and APP';
  status= $(if ($capture.ok -eq $false) {'failed'} else {'completed'})} | ConvertTo-Json |
  Set-Content -LiteralPath ($OutputPath + '.command-timing.json') -Encoding utf8
if ($capture.ok -eq $false) { throw "Page read failed: $($capture.error) (see $OutputPath)" }
Write-Output "Saved page result: $OutputPath"

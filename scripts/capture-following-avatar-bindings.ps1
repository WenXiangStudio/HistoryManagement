param([int]$ChromeHandle = 6490296)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class AvatarBindingsDesktop { [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd); [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd,int cmd); }'
$null=[AvatarBindingsDesktop]::ShowWindow([IntPtr]$ChromeHandle,9)
$null=[AvatarBindingsDesktop]::SetForegroundWindow([IntPtr]$ChromeHandle)
Start-Sleep -Milliseconds 300
$window=[System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$ChromeHandle)
$address=$window.FindFirst([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::NameProperty,'地址和搜索栏'))
if(!$address){throw 'Chrome address bar unavailable'}
$script=Get-Content -LiteralPath 'scripts/read-following-avatar-bindings.js' -Raw
$saved=Get-Content -LiteralPath 'local-data/douyin-following-20260930.json' -Raw | ConvertFrom-Json
$targets=@($saved.creators|Select-Object secUid,nickname) | ConvertTo-Json -Compress
$script="globalThis.SIGNAL_DESK_AVATAR_TARGETS=$targets;`n$script"
# JSON quoting safely keeps comment lines and real newlines inside the bookmarklet.
$quoted=ConvertTo-Json -InputObject $script -Compress
$bookmarklet="javascript:eval($quoted);void 0"
$address.SetFocus()
([System.Windows.Automation.ValuePattern]$address.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)).SetValue($bookmarklet)
[System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
Start-Sleep -Milliseconds 1800
$output=$window.FindFirst([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::NameProperty,'Signal Desk 头像归属采集结果'))
if(!$output){throw 'DOM avatar output unavailable'}
$output.SetFocus()
[System.Windows.Forms.SendKeys]::SendWait('^a')
[System.Windows.Forms.SendKeys]::SendWait('^c')
Start-Sleep -Milliseconds 100
$json=[System.Windows.Forms.Clipboard]::GetText()
$capture=$json|ConvertFrom-Json
New-Item -ItemType Directory -Path 'local-data' -Force | Out-Null
$json|Set-Content -LiteralPath 'local-data/following-avatar-bindings.json' -Encoding utf8
if($capture.records.Count -ne 10){throw "Expected ten image/profile bindings, got $($capture.records.Count)"}
$capture.records|Select-Object nickname,imageAlt,imageLoaded|Format-Table

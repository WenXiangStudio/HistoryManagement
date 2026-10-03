$ErrorActionPreference='Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class FollowingEntryInspect { [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd); }'
$windows=[System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children,[System.Windows.Automation.Condition]::TrueCondition)
$window=@($windows|Where-Object{$_.Current.Name -match '.+ - Google Chrome$'})[0]
$null=[FollowingEntryInspect]::SetForegroundWindow([IntPtr]$window.Current.NativeWindowHandle)
$tabs=$window.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ControlTypeProperty,[System.Windows.Automation.ControlType]::TabItem))
$tab=@($tabs|Where-Object{$_.Current.Name -match 'douyin.com/user/self|无限.*抖音'})[-1]
if(!$tab){throw 'Self tab unavailable'}
([System.Windows.Automation.SelectionItemPattern]$tab.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern)).Select()
Start-Sleep -Milliseconds 200
$script=@'
(()=>{const e=document.querySelector('[data-e2e="user-info-follow"]');const r=e?.getBoundingClientRect();const x=r?.left+r?.width/2,y=r?.top+r?.height/2;const hit=document.elementFromPoint(x,y);document.getElementById('signaldesk-entry-inspection')?.remove();const o=document.createElement('textarea');o.id='signaldesk-entry-inspection';o.setAttribute('aria-label','Signal Desk 入口诊断');o.style.cssText='position:fixed;left:0;top:0;width:2px;height:2px;opacity:.01';o.value=JSON.stringify({at:new Date().toISOString(),route:location.pathname,ready:document.readyState,visibility:document.visibilityState,viewport:{width:innerWidth,height:innerHeight},entry:e?.outerHTML,rect:r?.toJSON(),hit:hit?.outerHTML?.slice(0,3000),hitInsideEntry:e?.contains(hit),rootCount:document.querySelectorAll('[data-e2e="user-fans-container"]').length},null,2);document.body.appendChild(o)})()
'@
$address=$window.FindFirst([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::NameProperty,'地址和搜索栏'))
$address.SetFocus()
$quoted=ConvertTo-Json -InputObject $script -Compress
([System.Windows.Automation.ValuePattern]$address.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)).SetValue("javascript:eval($quoted);void 0")
[System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
Start-Sleep -Milliseconds 250
$output=$window.FindFirst([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::NameProperty,'Signal Desk 入口诊断'))
if(!$output){throw 'Entry diagnostic output unavailable'}
$json=([System.Windows.Automation.ValuePattern]$output.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)).Current.Value
$null=$json|ConvertFrom-Json
$json|Set-Content -LiteralPath 'local-data/following-readiness-20261003/entry-inspection.json' -Encoding utf8
$json

$ErrorActionPreference='Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class FollowingWindows { [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd); [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd,int nCmdShow); }'
$windows=[System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children,[System.Windows.Automation.Condition]::TrueCondition)
$extensions=@($windows|Where-Object{$_.Current.Name -match 'Google Chrome'})[0]
if(!$extensions){throw 'Chrome extension management page unavailable'}
$null=[FollowingWindows]::ShowWindow([IntPtr]$extensions.Current.NativeWindowHandle,9)
$null=[FollowingWindows]::SetForegroundWindow([IntPtr]$extensions.Current.NativeWindowHandle)
Start-Sleep -Milliseconds 400
$address=$extensions.FindFirst([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::NameProperty,'地址和搜索栏'))
$address.SetFocus()
([System.Windows.Automation.ValuePattern]$address.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)).SetValue('chrome://extensions/')
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
Start-Sleep -Milliseconds 700
$name=$extensions.FindFirst([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::NameProperty,'Signal Desk 关注目录同步'))
if(!$name){throw 'Following extension not installed'}
$rect=$name.Current.BoundingRectangle
$reloads=$extensions.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::NameProperty,'重新加载'))
$reload=@($reloads|Where-Object{$_.Current.BoundingRectangle.X -gt $rect.X -and $_.Current.BoundingRectangle.X -lt $rect.X+280 -and $_.Current.BoundingRectangle.Y -gt $rect.Y -and $_.Current.BoundingRectangle.Y -lt $rect.Y+200})
if($reload.Count -ne 1){throw 'Following reload button unavailable'}
([System.Windows.Automation.InvokePattern]$reload[0].GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)).Invoke()
Start-Sleep -Milliseconds 700
$startResult=node scripts/inspect-following-live-client.mjs start | ConvertFrom-Json
$setup=$extensions
$null=[FollowingWindows]::ShowWindow([IntPtr]$setup.Current.NativeWindowHandle,9)
$null=[FollowingWindows]::SetForegroundWindow([IntPtr]$setup.Current.NativeWindowHandle)
Start-Sleep -Milliseconds 200
$address=$setup.FindFirst([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::NameProperty,'地址和搜索栏'))
$address.SetFocus()
([System.Windows.Automation.ValuePattern]$address.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)).SetValue($startResult.state.setupUrl)
[System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
Start-Sleep -Milliseconds 2200
$start=$setup.FindFirst([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::NameProperty,'配置完成，开始读取'))
if(!$start -or !$start.Current.IsEnabled){throw 'Chrome start button unavailable'}
([System.Windows.Automation.InvokePattern]$start.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)).Invoke()
'Real Chrome start button clicked'

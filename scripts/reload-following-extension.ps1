$ErrorActionPreference='Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class FollowingUpgrade { [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd); [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd,int command); }'
$windows=[System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children,[System.Windows.Automation.Condition]::TrueCondition)
$window=@($windows|Where-Object{$_.Current.Name -match 'Google Chrome'})[0]
if(!$window){throw 'Chrome window unavailable'}
$null=[FollowingUpgrade]::ShowWindow([IntPtr]$window.Current.NativeWindowHandle,9)
$null=[FollowingUpgrade]::SetForegroundWindow([IntPtr]$window.Current.NativeWindowHandle)
[System.Windows.Forms.SendKeys]::SendWait('^t')
Start-Sleep -Milliseconds 150
$address=$window.FindFirst([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::NameProperty,'地址和搜索栏'))
$address.SetFocus()
([System.Windows.Automation.ValuePattern]$address.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)).SetValue('chrome://extensions/')
[System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
Start-Sleep -Milliseconds 300
$deadline=[DateTime]::UtcNow.AddSeconds(8)
do{
  $name=$window.FindFirst([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::NameProperty,'Signal Desk 关注目录同步'))
  if(!$name){Start-Sleep -Milliseconds 150}
}while(!$name -and [DateTime]::UtcNow -lt $deadline)
if(!$name){throw 'Following extension not installed'}
$rect=$name.Current.BoundingRectangle
$buttons=$window.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::NameProperty,'重新加载'))
$reload=@($buttons|Where-Object{$_.Current.BoundingRectangle.X -gt $rect.X -and $_.Current.BoundingRectangle.X -lt $rect.X+280 -and $_.Current.BoundingRectangle.Y -gt $rect.Y -and $_.Current.BoundingRectangle.Y -lt $rect.Y+200})
if($reload.Count -ne 1){throw 'Following extension reload button unavailable'}
([System.Windows.Automation.InvokePattern]$reload[0].GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)).Invoke()
Start-Sleep -Milliseconds 400
# Leave this unrelated tab selected, so the account page stays in the background.
'Updated following extension; no account page activated or collection started'

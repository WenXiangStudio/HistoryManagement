param([int]$ChromeHandle = 526694)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class FollowingCaptureDesktop { [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd); [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd,int nCmdShow); [DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y); [DllImport("user32.dll")] public static extern void mouse_event(uint flags,uint dx,uint dy,uint data,UIntPtr extra); }'
$null=[FollowingCaptureDesktop]::ShowWindow([IntPtr]$ChromeHandle,9)
$null=[FollowingCaptureDesktop]::SetForegroundWindow([IntPtr]$ChromeHandle)
Start-Sleep -Milliseconds 200
$page=[System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$ChromeHandle)
$elements=$page.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition)
$followingReached=$false
$names=[System.Collections.Generic.List[string]]::new()
$signatures=@{}
$currentName=$null
foreach($element in $elements){
  if($element.Current.ControlType -eq [System.Windows.Automation.ControlType]::TabItem -and $element.Current.Name -match '^关注\s*\('){$followingReached=$true}
  if(!$followingReached){continue}
  if($element.Current.ControlType -eq [System.Windows.Automation.ControlType]::Hyperlink -and $element.Current.Name -and $element.Current.Name -notmatch '头像$'){
    if($names.Count -eq 10){break}
    $currentName=$element.Current.Name
    if(!$names.Contains($currentName)){$names.Add($currentName)}
  }
  if($currentName -and $element.Current.ControlType -eq [System.Windows.Automation.ControlType]::Text -and !$signatures.ContainsKey($currentName) -and $element.Current.Name -notmatch '作品|已关注|相互关注'){
    $signatures[$currentName]=$element.Current.Name
  }
}
if($names.Count -lt 10){throw "Only $($names.Count) author names in the current following list"}
function Copy-MenuValue([string]$menuPattern){
  $menuItems=[System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ControlTypeProperty,[System.Windows.Automation.ControlType]::MenuItem))
  $copy=@($menuItems|Where-Object{$_.Current.Name -match $menuPattern})[0]
  if(!$copy){[System.Windows.Forms.SendKeys]::SendWait('{ESC}');return $null}
  ([System.Windows.Automation.InvokePattern]$copy.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)).Invoke()
  Start-Sleep -Milliseconds 80
  return [System.Windows.Forms.Clipboard]::GetText()
}
$creators=[System.Collections.Generic.List[object]]::new()
foreach($name in $names){
  $link=$page.FindFirst([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::NameProperty,$name))
  ([System.Windows.Automation.ScrollItemPattern]$link.GetCurrentPattern([System.Windows.Automation.ScrollItemPattern]::Pattern)).ScrollIntoView()
  $link.SetFocus()
  [System.Windows.Forms.SendKeys]::SendWait('+{F10}')
  Start-Sleep -Milliseconds 100
  $profileUrl=Copy-MenuValue '^复制链接地址'
  if(!$profileUrl -or $profileUrl -notmatch '^https://www\.douyin\.com/user/([A-Za-z0-9._-]+)'){throw "No profile link copied for $name"}
  $secUid=$Matches[1]
  # Avatar URLs are read later through the exact profile anchor. Screen-position
  # copying here previously attached neighbouring authors' pictures.
  $avatarUrl=$null
  $creators.Add([ordered]@{position=$creators.Count+1;nickname=$name;profileUrl="https://www.douyin.com/user/$secUid";secUid=$secUid;uid=$null;avatarUrl=$avatarUrl;signature=($signatures[$name] ?? '')})
  Write-Host "$($creators.Count). $name $profileUrl"
}
$outputDirectory=Join-Path (Get-Location) 'local-data'
New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
$outputPath=Join-Path $outputDirectory 'douyin-following-20260930.json'
[ordered]@{collectedAt=[DateTime]::UtcNow.ToString('o');sourceUrl='https://www.douyin.com/user/self';sourceKind='current-account-visible-following-list';collectionMethod='Chrome visible list and Copy link address';creators=$creators}|ConvertTo-Json -Depth 6|Set-Content -LiteralPath $outputPath -Encoding utf8
Write-Host "Saved $outputPath"
& "$PSScriptRoot/capture-following-avatar-bindings.ps1" -ChromeHandle $ChromeHandle
$bindings=Get-Content -LiteralPath (Join-Path $outputDirectory 'following-avatar-bindings.json') -Raw|ConvertFrom-Json
$capture=Get-Content -LiteralPath $outputPath -Raw|ConvertFrom-Json
foreach($creator in $capture.creators){
  $binding=@($bindings.records|Where-Object{$_.secUid -eq $creator.secUid -and $_.nickname -eq $creator.nickname -and $_.imageAlt -eq "$($creator.nickname)头像"})
  if($binding.Count -ne 1){throw "Avatar binding missing for $($creator.nickname)"}
  $creator.avatarUrl=$binding[0].avatarUrl
}
$capture|ConvertTo-Json -Depth 6|Set-Content -LiteralPath $outputPath -Encoding utf8

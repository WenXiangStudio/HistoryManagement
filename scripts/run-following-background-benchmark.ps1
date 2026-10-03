param([string]$OutputDirectory='local-data/following-background-20261001')
$ErrorActionPreference='Stop'
Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices; using System.Text;
public static class FollowingForeground {
 public delegate bool EnumProc(IntPtr h,IntPtr l);
 [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc f,IntPtr l);
 [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
 [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd,int nCmdShow);
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd,out uint processId);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h,StringBuilder text,int n);
 public static IntPtr Find(uint pid){IntPtr result=IntPtr.Zero;EnumWindows((h,l)=>{uint p;GetWindowThreadProcessId(h,out p);StringBuilder t=new StringBuilder(500);GetWindowText(h,t,500);if(p==pid&&t.ToString()=="Signal Desk"){result=h;return false;}return true;},IntPtr.Zero);return result;}
}
'@
$appProcess=Get-CimInstance Win32_Process -Filter "Name='Signal Desk.exe'" | Where-Object {$_.CommandLine -like '*release-following-background-final*' -and $_.CommandLine -notlike '*--type=*'} | Select-Object -First 1
$appWindow=[FollowingForeground]::Find($appProcess.ProcessId)
if(!$appWindow.ToInt64()){throw 'APP window unavailable'}
$null=[FollowingForeground]::ShowWindow($appWindow,9)
$null=[FollowingForeground]::SetForegroundWindow($appWindow)
Start-Sleep -Milliseconds 250
$samples=[System.Collections.Generic.List[object]]::new()
$monitor=[System.Diagnostics.Stopwatch]::StartNew()
$benchmark=Start-Process -FilePath (Get-Command node).Source -ArgumentList @('scripts/run-following-live-benchmark.mjs',$OutputDirectory) -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $OutputDirectory 'benchmark-output.txt') -RedirectStandardError (Join-Path $OutputDirectory 'benchmark-error.txt')
do {
  $foreground=[FollowingForeground]::GetForegroundWindow()
  $foregroundProcessId=[uint32]0
  $null=[FollowingForeground]::GetWindowThreadProcessId($foreground,[ref]$foregroundProcessId)
  $samples.Add([ordered]@{elapsedMs=$monitor.Elapsed.TotalMilliseconds;handle=$foreground.ToInt64();processId=$foregroundProcessId;isApp=$foregroundProcessId -eq $appProcess.ProcessId})
  Start-Sleep -Milliseconds 50
  $benchmark.Refresh()
}while(!$benchmark.HasExited -and $monitor.Elapsed.TotalSeconds -lt 38)
$monitor.Stop()
[ordered]@{appProcessId=$appProcess.ProcessId;appWindow=$appWindow.ToInt64();sampleCount=$samples.Count;allSamplesStayedInApp=@($samples|Where-Object{!$_.isApp}).Count -eq 0;samples=$samples} | ConvertTo-Json -Depth 6 | Set-Content (Join-Path $OutputDirectory 'foreground.json') -Encoding utf8
Get-Content (Join-Path $OutputDirectory 'benchmark-output.txt')
Get-Content (Join-Path $OutputDirectory 'benchmark-error.txt')

$ErrorActionPreference='Stop'
Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices; using System.Text;
public static class FollowingReviewWindow {
 public delegate bool Callback(IntPtr h,IntPtr l);
 [DllImport("user32.dll")] public static extern bool EnumWindows(Callback callback,IntPtr l);
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h,out uint pid);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h,StringBuilder t,int count);
 [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h,int mode);
 [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
 public static void Show(uint pid){EnumWindows((h,l)=>{uint p;GetWindowThreadProcessId(h,out p);var t=new StringBuilder(500);GetWindowText(h,t,500);if(p==pid&&t.ToString()=="Signal Desk"){ShowWindow(h,9);SetForegroundWindow(h);return false;}return true;},IntPtr.Zero);}
}
'@
$process=Get-CimInstance Win32_Process -Filter "Name='Signal Desk.exe'"|Where-Object{$_.CommandLine -notlike '*--type=*' -and $_.CommandLine -like '*release-following-background-final*' -and $_.CommandLine -like '*SignalDeskFollowingReview*'}|Select-Object -First 1
if(!$process){throw 'Review APP is not running'}
[FollowingReviewWindow]::Show($process.ProcessId)
'Signal Desk is open with the existing review profile'

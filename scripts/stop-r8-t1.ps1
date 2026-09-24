[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$RunDirectory
)

$ErrorActionPreference = 'Stop'
$resolved = [System.IO.Path]::GetFullPath($RunDirectory).TrimEnd('\')
$tempPrefix = [System.IO.Path]::GetFullPath((Join-Path ([System.IO.Path]::GetTempPath()) 'signal-desk-r8')).TrimEnd('\') + '\'
if (-not ($resolved + '\').StartsWith($tempPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw 'RunDirectory must be inside the system temporary Signal Desk R8 root'
}
$pidPath = Join-Path $resolved 'controller.pid'
if (-not (Test-Path -LiteralPath $pidPath -PathType Leaf)) { throw 'R8 controller PID file not found' }
$controllerPid = [int](Get-Content -LiteralPath $pidPath -Raw)
$process = Get-Process -Id $controllerPid -ErrorAction SilentlyContinue
if ($process) {
  if ($process.ProcessName -ne 'node') { throw "Refusing to stop unexpected process: $($process.ProcessName)" }
  Stop-Process -Id $controllerPid
  Write-Output "Stopped R8 controller PID $controllerPid. Run artifacts were preserved at $resolved"
} else {
  Write-Output "R8 controller is already stopped. Run artifacts remain at $resolved"
}

$ErrorActionPreference = 'Stop'
$candidates = @()
if ($env:SIGNALDESK_PYTHON311) { $candidates += ,@($env:SIGNALDESK_PYTHON311, @()) }
foreach ($registryPath in @('HKCU:\Software\Python\PythonCore\3.11\InstallPath', 'HKLM:\Software\Python\PythonCore\3.11\InstallPath')) {
  try {
    $registered = Get-ItemPropertyValue -LiteralPath $registryPath -Name 'ExecutablePath' -ErrorAction Stop
    if ($registered) { $candidates += ,@($registered, @()) }
  } catch { }
}
if ($env:LOCALAPPDATA) {
  $candidates += ,@((Join-Path $env:LOCALAPPDATA 'Programs\Python\Launcher\py.exe'), @('-3.11'))
  $candidates += ,@((Join-Path $env:LOCALAPPDATA 'Programs\Python\Python311\python.exe'), @())
}
foreach ($drive in Get-PSDrive -PSProvider FileSystem) {
  $candidates += ,@((Join-Path $drive.Root 'Python311\python.exe'), @())
}
$candidates += ,@((Join-Path $PSScriptRoot '..\runtime\python311\python.exe'), @())

$selected = $null
foreach ($candidate in $candidates) {
  $executable = $candidate[0]
  $prefix = @($candidate[1])
  try { if (-not (Test-Path -LiteralPath $executable)) { continue } } catch { continue }
  $version = & $executable @prefix -c 'import sys; print(str(sys.version_info[0])+chr(46)+str(sys.version_info[1]))'
  if ($LASTEXITCODE -eq 0 -and $version.Trim() -eq '3.11') {
    $selected = @($executable, $prefix)
    break
  }
}
if (-not $selected) { throw 'Python 3.11 was not found. Set SIGNALDESK_PYTHON311 to python.exe.' }

& $selected[0] @($selected[1]) -m unittest discover -s worker/tests -p 'test_*.py'
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

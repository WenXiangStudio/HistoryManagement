param(
  [string]$SourceRoot = '',
  [switch]$Force
)

$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$runtimeRoot = Join-Path $projectRoot 'runtime\python311'

if (-not $SourceRoot) {
  $detected = & py -3.11 -c 'import sys; print(sys.prefix)'
  if ($LASTEXITCODE -ne 0 -or -not $detected) {
    throw 'Python 3.11 was not found. Install x64 Python 3.11 or pass -SourceRoot.'
  }
  $SourceRoot = $detected.Trim()
}

$source = (Resolve-Path -LiteralPath $SourceRoot).Path
$sourcePython = Join-Path $source 'python.exe'
if (-not (Test-Path -LiteralPath $sourcePython)) {
  throw "python.exe was not found in: $source"
}

$version = & $sourcePython -c 'import sys; print(str(sys.version_info[0])+chr(46)+str(sys.version_info[1]))'
if ($LASTEXITCODE -ne 0 -or $version.Trim() -ne '3.11') {
  throw "Only Python 3.11 x64 is supported. Detected: $version"
}

if ((Test-Path -LiteralPath (Join-Path $runtimeRoot 'python.exe')) -and -not $Force) {
  throw 'The target runtime already exists. Pass -Force to overwrite files.'
}

New-Item -ItemType Directory -Force -Path $runtimeRoot | Out-Null
Get-ChildItem -LiteralPath $source -Force | Copy-Item -Destination $runtimeRoot -Recurse -Force

$targetPython = Join-Path $runtimeRoot 'python.exe'
& $targetPython -c 'import sys, venv; assert sys.version_info[:2] == (3, 11); assert sys.maxsize > 2**32; print(sys.version)'
if ($LASTEXITCODE -ne 0) {
  throw 'Copied Python 3.11 runtime validation failed.'
}

Write-Host "Python 3.11 x64 runtime prepared: $runtimeRoot"
Write-Host 'Run npm run package next. electron-builder will copy it to resources\python311.'

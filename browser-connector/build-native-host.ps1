$ErrorActionPreference = 'Stop'
$connectorRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$source = Join-Path $connectorRoot 'native-host\SignalDesk.NativeHost.cs'
$binDir = Join-Path $connectorRoot 'native-host\bin'
$output = Join-Path $binDir 'SignalDesk.NativeHost.exe'
$compilerCandidates = @(
  (Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'),
  (Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe')
)
$compiler = $compilerCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $compiler) { throw 'Windows .NET Framework C# compiler was not found.' }

New-Item -ItemType Directory -Force -Path $binDir | Out-Null
& $compiler /nologo /target:exe /platform:x64 /optimize+ /codepage:65001 /reference:System.Web.Extensions.dll "/out:$output" $source
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $output)) { throw 'Native Messaging Host compilation failed.' }
Write-Host "Native Messaging Host generated: $output"
$followingSource = Join-Path $connectorRoot 'native-host\SignalDesk.FollowingHost.cs'
$followingOutput = Join-Path $binDir 'SignalDesk.FollowingHost.exe'
& $compiler /nologo /target:exe /platform:x64 /optimize+ /codepage:65001 /reference:System.Web.Extensions.dll "/out:$followingOutput" $followingSource
if ($LASTEXITCODE -ne 0) { throw 'Following discovery host compilation failed.' }
Write-Host "Following discovery host generated: $followingOutput"

param([int]$ChromeHandle=132028)
$ErrorActionPreference='Stop'
# Replaces the old image right-click by screen coordinate. Each avatar is now
# matched to the already-saved profile link and the same author's image alt.
& "$PSScriptRoot/capture-following-avatar-bindings.ps1" -ChromeHandle $ChromeHandle
node "$PSScriptRoot/apply-following-avatar-bindings.mjs"
if($LASTEXITCODE -ne 0){throw 'Avatar database update failed'}

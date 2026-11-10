# scripts/start-autoapply.ps1
# Clears STOP_AUTOAPPLY.flag, cleans locks, and starts immortal supervisor.

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot
$stateDir = Join-Path $repoRoot "state/autoapply"
$flagPath = Join-Path $stateDir "portal-review/STOP_AUTOAPPLY.flag"

if (Test-Path $flagPath) {
    Remove-Item -Force $flagPath -ErrorAction SilentlyContinue
    Write-Host "[START] Removed sentinel flag: $flagPath" -ForegroundColor Cyan
}

# Clean stale locks
$workerLock = Join-Path $stateDir "worker.lock"
if (Test-Path $workerLock) {
    Remove-Item -Force $workerLock -ErrorAction SilentlyContinue
}
$portalReviewLock = Join-Path $stateDir "portal-review/worker.lock"
if (Test-Path $portalReviewLock) {
    Remove-Item -Force $portalReviewLock -ErrorAction SilentlyContinue
}
Get-ChildItem -Path "$stateDir/browser-profile-*" -Filter "SingletonLock" -Depth 1 -ErrorAction SilentlyContinue | ForEach-Object {
    Remove-Item -Force $_.FullName -ErrorAction SilentlyContinue
}

Write-Host "[START] Starting immortal supervisor in background..." -ForegroundColor Green
Start-Process -FilePath "powershell.exe" -ArgumentList "-ExecutionPolicy Bypass -File `"$PSScriptRoot\immortal-supervisor.ps1`"" -WorkingDirectory $repoRoot -WindowStyle Hidden

Write-Host "[START] Immortal supervisor launched." -ForegroundColor Green

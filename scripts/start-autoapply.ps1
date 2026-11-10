# scripts/start-autoapply.ps1
# Clears STOP_AUTOAPPLY.flag, cleans locks, and starts immortal supervisor.

$stateDir = "state/autoapply"
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
Get-ChildItem -Path "$stateDir/browser-profile-*" -Filter "SingletonLock" -Recurse -ErrorAction SilentlyContinue | ForEach-Object {
    Remove-Item -Force $_.FullName -ErrorAction SilentlyContinue
}

Write-Host "[START] Starting immortal supervisor in background..." -ForegroundColor Green
Start-Process -FilePath "powershell.exe" -ArgumentList "-ExecutionPolicy Bypass -File scripts/immortal-supervisor.ps1" -WindowStyle Hidden

Write-Host "[START] Immortal supervisor launched." -ForegroundColor Green

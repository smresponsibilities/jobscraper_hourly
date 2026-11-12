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

# Ensure Scheduled Task is registered
$TaskName = "Jobscraper Autoapply"
$existingTask = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if (-not $existingTask) {
    Write-Host "[START] Registering Scheduled Task '$TaskName'..." -ForegroundColor Cyan
    & "$PSScriptRoot\install-autoapply-startup.ps1" -Submit
}

Write-Host "[START] Starting Scheduled Task '$TaskName' via Windows Task Scheduler Service..." -ForegroundColor Green
Start-ScheduledTask -TaskName $TaskName

Write-Host "[START] Task Scheduler launched immortal supervisor outside agent job object." -ForegroundColor Green

# scripts/stop-autoapply.ps1
# Sets STOP_AUTOAPPLY.flag and safely stops all auto-apply workers and supervisors.

$stateDir = "state/autoapply"
$portalReview = Join-Path $stateDir "portal-review"
if (-not (Test-Path $portalReview)) {
    New-Item -ItemType Directory -Path $portalReview -Force | Out-Null
}

$flagPath = Join-Path $portalReview "STOP_AUTOAPPLY.flag"
Set-Content -Path $flagPath -Value "STOP_REQUESTED_$(Get-Date -Format 'o')" -Force
Write-Host "[STOP] Sentinel flag set at: $flagPath" -ForegroundColor Red

# Terminate worker processes
$procs = Get-CimInstance Win32_Process | Where-Object { 
    $_.CommandLine -match "run-overnight-marathon|drain-backfill-and-hourly|immortal-supervisor" -and 
    $_.ProcessId -ne $PID 
}

foreach ($p in $procs) {
    Write-Host "[STOP] Terminating process PID $($p.ProcessId)..." -ForegroundColor Yellow
    Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
}

# Clean locks
$workerLock = Join-Path $stateDir "worker.lock"
if (Test-Path $workerLock) {
    Remove-Item -Force $workerLock -ErrorAction SilentlyContinue
}

Write-Host "[STOP] All auto-apply workers and supervisors stopped." -ForegroundColor Green

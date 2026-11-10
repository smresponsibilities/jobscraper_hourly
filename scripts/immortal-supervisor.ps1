# scripts/immortal-supervisor.ps1
# Immortal Sticky Supervisor for Jobscraper-Next Auto-Apply Worker
# Runs worker indefinitely, restarts on exit/crash within 5s, stops ONLY on STOP_AUTOAPPLY.flag

$stateDir = "state/autoapply"
$flagPath = Join-Path $stateDir "portal-review/STOP_AUTOAPPLY.flag"

Write-Host "[SUPERVISOR] Immortal Sticky Supervisor started. Monitoring worker processes..." -ForegroundColor Cyan

while ($true) {
    if (Test-Path $flagPath) {
        Write-Host "[SUPERVISOR] STOP_AUTOAPPLY.flag detected at $flagPath. Explicit operator stop active. Exiting supervisor." -ForegroundColor Yellow
        break
    }

    $workerProc = Get-CimInstance Win32_Process | Where-Object { 
        $_.CommandLine -match "run-overnight-marathon|drain-backfill-and-hourly" -and 
        $_.ProcessId -ne $PID 
    }

    if (-not $workerProc) {
        Write-Host "[SUPERVISOR] No running auto-apply worker found. Cleaning stale locks..." -ForegroundColor Magenta

        # Clean stale locks
        $workerLock = Join-Path $stateDir "worker.lock"
        if (Test-Path $workerLock) {
            Remove-Item -Force $workerLock -ErrorAction SilentlyContinue
        }

        # Clean browser profile singleton locks
        Get-ChildItem -Path "$stateDir/browser-profile-*" -Filter "SingletonLock" -Recurse -ErrorAction SilentlyContinue | ForEach-Object {
            Remove-Item -Force $_.FullName -ErrorAction SilentlyContinue
        }

        Write-Host "[SUPERVISOR] Launching worker: drain-backfill-and-hourly.ts..." -ForegroundColor Green
        $proc = Start-Process -FilePath "node" -ArgumentList "--import tsx scripts/drain-backfill-and-hourly.ts --profile autoapply" -PassThru -NoNewWindow
        
        Write-Host "[SUPERVISOR] Worker spawned with PID: $($proc.Id). Monitoring execution..." -ForegroundColor Green
        # Wait up to 5s before checking again, or wait for process exit
        $proc | Wait-Process -Timeout 5 -ErrorAction SilentlyContinue
    } else {
        Start-Sleep -Seconds 5
    }
}

Write-Host "[SUPERVISOR] Supervisor stopped." -ForegroundColor Yellow

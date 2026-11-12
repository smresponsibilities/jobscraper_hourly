# Keep one project worker alive. The worker owns locks and browser cleanup.
param([switch]$CheckOnly)

$repoRoot = Split-Path -Parent $PSScriptRoot
$stateDir = Join-Path $repoRoot 'state/autoapply/portal-review'
$flagPath = Join-Path $stateDir 'STOP_AUTOAPPLY.flag'
$workerScript = Join-Path $repoRoot 'scripts/drain-backfill-and-hourly.ts'
$profilePath = Join-Path $stateDir 'candidate.json'
$supervisorLock = Join-Path $stateDir 'supervisor.lock'
$logDir = Join-Path $repoRoot 'out'
$logPath = Join-Path $logDir 'supervisor.log'

if (-not (Test-Path $logDir)) {
    New-Item -ItemType Directory -Path $logDir -Force | Out-Null
}

function Log-Supervisor($msg) {
    $ts = (Get-Date).ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
    $line = "[$ts] $msg"
    Write-Host $line
    try {
        Add-Content -Path $logPath -Value $line -ErrorAction SilentlyContinue
    } catch {}
}

function Get-AutoApplyWorker {
    $lockPath = Join-Path $stateDir 'worker.lock'
    if (Test-Path -LiteralPath $lockPath) {
        try {
            $owner = Get-Content -LiteralPath $lockPath -Raw | ConvertFrom-Json
            $ownerProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $([int]$owner.pid)" -ErrorAction Stop
            if ($ownerProcess.Name -eq 'node.exe' -and $ownerProcess.CommandLine -match 'drain-backfill-and-hourly|run-overnight-marathon') { return $ownerProcess }
        } catch {}
    }
    return Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object {
        $_.CommandLine -like "*$workerScript*"
    } | Select-Object -First 1
}

function Get-RunningSupervisorPid {
    if (Test-Path -LiteralPath $supervisorLock) {
        try {
            $supPid = (Get-Content -LiteralPath $supervisorLock -Raw).Trim()
            if ($supPid -match '^\d+$') {
                $p = Get-Process -Id ([int]$supPid) -ErrorAction SilentlyContinue
                if ($p -and $p.ProcessName -match 'powershell|pwsh') {
                    return [int]$supPid
                }
            }
        } catch {}
    }
    return $null
}

if ($CheckOnly) {
    $activeSup = Get-RunningSupervisorPid
    [pscustomobject]@{
        StopRequested = Test-Path -LiteralPath $flagPath
        SupervisorPid = $activeSup
        Worker = Get-AutoApplyWorker
    }
    return
}

# PID-verified lock check
$existingSupPid = Get-RunningSupervisorPid
if ($existingSupPid -and $existingSupPid -ne $PID) {
    Log-Supervisor "Supervisor PID $existingSupPid already running — exiting"
    return
}

try {
    $PID | Set-Content -LiteralPath $supervisorLock -Force
    Log-Supervisor "IMMORTAL SUPERVISOR STARTED (PID: $PID)"
    $restartDelaySeconds = 5

    while (-not (Test-Path -LiteralPath $flagPath)) {
        if (Get-AutoApplyWorker) {
            Start-Sleep -Seconds 5
            continue
        }
        $startedAt = Get-Date
        try {
            $arguments = "--import tsx `"$workerScript`" --profile `"$profilePath`" --state `"$stateDir`" --submit"
            $worker = Start-Process -FilePath 'node' -ArgumentList $arguments -WorkingDirectory $repoRoot -WindowStyle Hidden -PassThru
            Log-Supervisor "Spawned worker PID $($worker.Id)"
            while (-not $worker.HasExited -and -not (Test-Path -LiteralPath $flagPath)) {
                Start-Sleep -Seconds 1
                $worker.Refresh()
            }
            if (Test-Path -LiteralPath $flagPath) { break }
            Log-Supervisor "Worker PID $($worker.Id) exited with code $($worker.ExitCode)"
            if (((Get-Date) - $startedAt).TotalSeconds -ge 60) { $restartDelaySeconds = 5 }
        } catch {
            Log-Supervisor "Launch failed: $($_.Exception.Message)"
        }
        for ($waited = 0; $waited -lt $restartDelaySeconds -and -not (Test-Path -LiteralPath $flagPath); $waited++) {
            Start-Sleep -Seconds 1
        }
        $restartDelaySeconds = [Math]::Min(60, $restartDelaySeconds * 2)
    }
} finally {
    if ((Test-Path -LiteralPath $supervisorLock)) {
        try {
            $currentLock = (Get-Content -LiteralPath $supervisorLock -Raw).Trim()
            if ($currentLock -eq "$PID") {
                Remove-Item -LiteralPath $supervisorLock -Force -ErrorAction SilentlyContinue
                Log-Supervisor "IMMORTAL SUPERVISOR STOPPED (PID: $PID)"
            }
        } catch {}
    }
}

# Keep one project worker alive. The worker owns locks and browser cleanup.
param([switch]$CheckOnly)

$repoRoot = Split-Path -Parent $PSScriptRoot
$stateDir = Join-Path $repoRoot 'state/autoapply/portal-review'
$flagPath = Join-Path $stateDir 'STOP_AUTOAPPLY.flag'
$workerScript = Join-Path $repoRoot 'scripts/drain-backfill-and-hourly.ts'
$profilePath = Join-Path $stateDir 'candidate.json'

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

if ($CheckOnly) {
    [pscustomobject]@{ StopRequested = Test-Path -LiteralPath $flagPath; Worker = Get-AutoApplyWorker }
    return
}

$hash = [System.Security.Cryptography.SHA256]::Create()
$mutexId = [System.BitConverter]::ToString($hash.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($repoRoot.ToLowerInvariant()))).Replace('-', '')
$hash.Dispose()
$mutex = [System.Threading.Mutex]::new($false, "Local\JobscraperSupervisor-$mutexId")
$ownsMutex = $false
try {
    try { $ownsMutex = $mutex.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $ownsMutex = $true }
    if (-not $ownsMutex) { Write-Host '[SUPERVISOR] Another supervisor owns this project.'; return }
    $restartDelaySeconds = 5
    while (-not (Test-Path -LiteralPath $flagPath)) {
        if (Get-AutoApplyWorker) { Start-Sleep -Seconds 5; continue }
        $startedAt = Get-Date
        try {
            $arguments = "--import tsx `"$workerScript`" --profile `"$profilePath`" --state `"$stateDir`" --submit"
            $worker = Start-Process -FilePath 'node' -ArgumentList $arguments -WorkingDirectory $repoRoot -WindowStyle Hidden -PassThru
            Write-Host "[SUPERVISOR] Worker started with PID $($worker.Id)."
            while (-not $worker.HasExited -and -not (Test-Path -LiteralPath $flagPath)) {
                Start-Sleep -Seconds 1
                $worker.Refresh()
            }
            if ((Test-Path -LiteralPath $flagPath)) { break }
            Write-Host "[SUPERVISOR] Worker exited with code $($worker.ExitCode)."
            if (((Get-Date) - $startedAt).TotalSeconds -ge 60) { $restartDelaySeconds = 5 }
        } catch { Write-Warning "[SUPERVISOR] Launch failed: $($_.Exception.Message)" }
        for ($waited = 0; $waited -lt $restartDelaySeconds -and -not (Test-Path -LiteralPath $flagPath); $waited++) { Start-Sleep -Seconds 1 }
        $restartDelaySeconds = [Math]::Min(60, $restartDelaySeconds * 2)
    }
} finally {
    if ($ownsMutex) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
}

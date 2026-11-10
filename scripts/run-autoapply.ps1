[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = "Continue"

# TICKET GEN-445: Check worker.lock liveness AT THE VERY TOP before touching any chrome.exe or doing any work!
$AllLockFiles = @(
    "D:\Jobscraper-next\state\autoapply\portal-review\worker.lock",
    "D:\Jobscraper-next\state\autoapply\worker.lock"
)
foreach ($lf in $AllLockFiles) {
    if (Test-Path $lf) {
        try {
            $lockJson = Get-Content $lf -Raw -ErrorAction SilentlyContinue | ConvertFrom-Json
            if ($lockJson.pid) {
                $workerPid = $lockJson.pid
                $proc = Get-Process -Id $workerPid -ErrorAction SilentlyContinue
                if ($proc -and $proc.ProcessName -match "node") {
                    $now = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
                    $msg = "[$now] [WATCHDOG] Daemon PID $workerPid already active (lock held in $lf) — exiting immediately without killing Chrome."
                    Write-Output $msg
                    exit 0
                }
            }
        } catch {}
    }
}

$env:NODE_NO_WARNINGS = "1"
$PSDefaultParameterValues['Out-File:Encoding'] = 'utf8'
Set-Location "D:\Jobscraper-next"

$env:PATH = "C:\Program Files\nodejs;$env:PATH"
$NodeExe = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
if (-not $NodeExe) { $NodeExe = "C:\Program Files\nodejs\node.exe" }

$LogFile = "D:\Jobscraper-next\out\hourly-daemon.log"
New-Item -ItemType Directory -Path (Split-Path $LogFile) -Force | Out-Null

# GEN-25 & GEN-43 Watchdog Fast Exit & Stale Lock Recovery: If worker.lock exists, verify if PID is actively running node.exe
$LockFile = "D:\Jobscraper-next\state\autoapply\portal-review\worker.lock"
if (Test-Path $LockFile) {
    $isRunning = $false
    $workerPid = $null
    try {
        $lockJson = Get-Content $LockFile -Raw -ErrorAction SilentlyContinue | ConvertFrom-Json
        if ($lockJson.pid) {
            $workerPid = $lockJson.pid
            $proc = Get-Process -Id $workerPid -ErrorAction SilentlyContinue
            if ($proc -and $proc.ProcessName -ieq "node") {
                $isRunning = $true
            }
        }
    } catch {}

    if ($isRunning) {
        $now = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
        $msg = "[$now] [WATCHDOG] Worker PID $workerPid is active (lock held). Exiting in 0.1s."
        Write-Output $msg
        try {
            Add-Content -Path $LogFile -Value $msg -Encoding utf8 -ErrorAction SilentlyContinue
        } catch {}
        exit 0
    } else {
        # Stale lock: PID no longer exists or does not belong to node.exe (e.g. laptop powered off mid-run)
        Remove-Item -Path $LockFile -Force -ErrorAction SilentlyContinue
        $now = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
        $msg = "[$now] [WATCHDOG] Stale worker.lock detected (PID $workerPid not running node.exe). Cleared stale lock."
        Write-Output $msg
        try {
            Add-Content -Path $LogFile -Value $msg -Encoding utf8 -ErrorAction SilentlyContinue
        } catch {}
    }
}

$timestamp = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
Write-Output "[$timestamp] === Jobscraper Autoapply Watchdog Started ===" | Out-File -FilePath $LogFile -Append -Encoding utf8

$env:USERPROFILE = "C:\Users\sm"
$env:TEMP = "D:\Jobscraper-next\out\test-temp"
$env:TMP = "D:\Jobscraper-next\out\test-temp"
$env:AUTOAPPLY_NO_MODEL = "1"
$env:AUTOAPPLY_DISABLE_HITL_POPUP = "1"
New-Item -ItemType Directory -Path $env:TEMP -Force | Out-Null

# 0. Reap any stale automation chrome.exe processes before running (only when lock is NOT held)
Get-CimInstance Win32_Process -Filter "Name = 'chrome.exe'" | Where-Object { $_.CommandLine -match '--enable-automation|portal-review|browser-profile|playwright|patchright|--window-position=-2400' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

# 1. Load .env variables into PowerShell process environment so Email & Password are always present
if (Test-Path ".env") {
    Get-Content ".env" | ForEach-Object {
        $line = $_.Trim()
        if ($line -and -not $line.StartsWith("#") -and $line.Contains("=")) {
            $parts = $line.Split("=", 2)
            $k = $parts[0].Trim()
            $v = $parts[1].Trim().Trim('"').Trim("'")
            [System.Environment]::SetEnvironmentVariable($k, $v, "Process")
        }
    }
}

# 1.5 7-day automatic upstream package updater (GEN-31)
$LibUpdateFile = "D:\Jobscraper-next\state\autoapply\portal-review\last-lib-update.txt"
$shouldUpdate = $true
if (Test-Path $LibUpdateFile) {
    try {
        $lastUpdateStr = (Get-Content $LibUpdateFile -Raw -ErrorAction SilentlyContinue).Trim()
        $lastUpdate = [datetime]::Parse($lastUpdateStr)
        if (((Get-Date) - $lastUpdate).TotalDays -lt 7) {
            $shouldUpdate = $false
        }
    } catch {
        $shouldUpdate = $true
    }
}

if ($shouldUpdate) {
    $nowUtc = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
    Write-Output "[$nowUtc] [UPSTREAM_UPDATE] Checking for 7-day upstream library updates..." | Out-File -FilePath $LogFile -Append -Encoding utf8
    $NpmCmd = (Get-Command npm.cmd -ErrorAction SilentlyContinue).Source
    if (-not $NpmCmd) { $NpmCmd = "npm" }
    try {
        & $NpmCmd update patchright fingerprint-injector fingerprint-generator header-generator got-scraping @crawlee/core 2>&1 | Out-File -FilePath $LogFile -Append -Encoding utf8
        if ($LASTEXITCODE -eq 0) {
            New-Item -ItemType Directory -Path (Split-Path $LibUpdateFile) -Force | Out-Null
            Set-Content -Path $LibUpdateFile -Value $nowUtc -Encoding utf8
        } else {
            Write-Output "[$nowUtc] [UPSTREAM_UPDATE] npm update exited with code $LASTEXITCODE. Retrying on next schedule." | Out-File -FilePath $LogFile -Append -Encoding utf8
        }
    } catch {}
}

# 2. Compile TypeScript to plain JS in out/dist
if (Test-Path "node_modules/typescript/bin/tsc") {
    & $NodeExe "node_modules/typescript/bin/tsc" -p tsconfig.build.json 2>&1 | Out-File -FilePath $LogFile -Append -Encoding utf8
}

# 2.5 Ensure Dashboard Server (port 4321) is running in the background (GEN-46)
$dashPortListening = $false
try {
    $client = New-Object System.Net.Sockets.TcpClient
    $iar = $client.BeginConnect("127.0.0.1", 4321, $null, $null)
    $success = $iar.AsyncWaitHandle.WaitOne(300, $false)
    if ($success -and $client.Connected) {
        $client.EndConnect($iar)
        $dashPortListening = $true
    }
    $client.Close()
} catch {}
if (-not $dashPortListening) {
    try {
        $conn = Get-NetTCPConnection -LocalPort 4321 -State Listen -ErrorAction SilentlyContinue
        if ($conn) { $dashPortListening = $true }
    } catch {}
}

if (-not $dashPortListening) {
    $dashScript = "D:\Jobscraper-next\out\dist\scripts\dashboard-server.js"
    if (Test-Path $dashScript) {
        $dashLogOut = "D:\Jobscraper-next\out\dashboard-server.log"
        $dashLogErr = "D:\Jobscraper-next\out\dashboard-server.err.log"
        Start-Process -FilePath $NodeExe -ArgumentList "out/dist/scripts/dashboard-server.js" -WorkingDirectory "D:\Jobscraper-next" -WindowStyle Hidden -RedirectStandardOutput "D:\Jobscraper-next\out\dashboard.out.log" -RedirectStandardError "D:\Jobscraper-next\out\dashboard.err.log"
        $nowStamp = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
        Write-Output "[$nowStamp] [DASHBOARD] Started background dashboard server on port 4321." | Out-File -FilePath $LogFile -Append -Encoding utf8
    }
}

# 3. Run the compiled dual-queue drainer (hourly fresh sync + backfill drain)
try {
    if ($env:OVERNIGHT_MARATHON -eq "1" -or ($args -contains "--marathon")) {
        & $NodeExe "out/dist/scripts/run-overnight-marathon.js" --profile "state/autoapply/portal-review/candidate.json" --state "state/autoapply/portal-review" --chunk-size 40 --max-hours 10 --max-jobs 1200 --submit @args 2>&1 | Out-File -FilePath $LogFile -Append -Encoding utf8
    } else {
        & $NodeExe "out/dist/scripts/drain-backfill-and-hourly.js" --profile "state/autoapply/portal-review/candidate.json" --state "state/autoapply/portal-review" --max-jobs 80 --submit @args 2>&1 | Out-File -FilePath $LogFile -Append -Encoding utf8
    }
} finally {
    Get-CimInstance Win32_Process -Filter "Name = 'chrome.exe'" | Where-Object { $_.CommandLine -match '--enable-automation|portal-review|browser-profile|playwright|patchright|--window-position=-2400' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    $endStamp = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
    Write-Output "[$endStamp] === Jobscraper Autoapply Watchdog Exited ===" | Out-File -FilePath $LogFile -Append -Encoding utf8
}

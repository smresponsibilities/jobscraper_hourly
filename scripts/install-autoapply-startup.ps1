param([switch]$Submit = $true)
$ErrorActionPreference = "Stop"
$TaskName = "Jobscraper Autoapply"
$ScriptPath = "D:\Jobscraper-next\scripts\run-autoapply.ps1"
$ArgList = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$ScriptPath`""
if ($Submit) {
    $ArgList += " --submit"
}

$Action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $ArgList -WorkingDirectory "D:\Jobscraper-next"
$TriggerLogon = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$TriggerRepeating = New-ScheduledTaskTrigger -Once -At ((Get-Date).Date) -RepetitionInterval (New-TimeSpan -Minutes 15) -RepetitionDuration (New-TimeSpan -Days 3650)
$Principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
$Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -WakeToRun -MultipleInstances IgnoreNew -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 5) -ExecutionTimeLimit (New-TimeSpan -Minutes 55)

Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger @($TriggerLogon, $TriggerRepeating) -Principal $Principal -Settings $Settings -Force | Out-Null
Write-Output "REGISTERED_WATCHDOG_TASK: $TaskName (15m interval, MultipleInstances IgnoreNew, Interactive Limited)"

# Zero-window Windows Startup Folder launcher (GEN-43: survives Fast Startup / hybrid hibernate)
$StartupDir = "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup"
if (-not (Test-Path $StartupDir)) {
    New-Item -ItemType Directory -Path $StartupDir -Force | Out-Null
}
$VbsPath = Join-Path $StartupDir "JobscraperAutoApply.vbs"
$VbsContent = 'CreateObject("WScript.Shell").Run "powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File ""D:\Jobscraper-next\scripts\run-autoapply.ps1"" --submit", 0, False'
[System.IO.File]::WriteAllText($VbsPath, $VbsContent, [System.Text.Encoding]::ASCII)
Write-Output "WROTE_STARTUP_VBS: $VbsPath"

# Start task, wait 8 seconds, and verify out/hourly-daemon.log has live output
Start-ScheduledTask -TaskName $TaskName
Start-Sleep -Seconds 8

$LogFile = "D:\Jobscraper-next\out\hourly-daemon.log"
if (Test-Path $LogFile) {
    Write-Output "=== LIVE OUTPUT FROM $LogFile ==="
    Get-Content $LogFile -Tail 15
} else {
    Write-Warning "Log file $LogFile not yet created after 8s."
}

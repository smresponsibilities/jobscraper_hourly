param([switch]$Submit = $true)
$ErrorActionPreference = "Stop"
$TaskName = "Jobscraper Autoapply"
$SupervisorScript = "D:\Jobscraper-next\scripts\immortal-supervisor.ps1"
$ArgList = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$SupervisorScript`""

$Action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $ArgList -WorkingDirectory "D:\Jobscraper-next"
$TriggerLogon = New-ScheduledTaskTrigger -AtLogOn
$TriggerWatchdog = New-ScheduledTaskTrigger -Once -At ((Get-Date).AddMinutes(1)) -RepetitionInterval (New-TimeSpan -Minutes 15) -RepetitionDuration (New-TimeSpan -Days 3650)
$Principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited

# CRITICAL FIX (GEN-527): -ExecutionTimeLimit ([TimeSpan]::Zero) = UNLIMITED duration (NEVER kill after 55 mins!)
$Settings = New-ScheduledTaskSettingsSet `
  -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -WakeToRun `
  -MultipleInstances IgnoreNew `
  -RestartCount 999 `
  -RestartInterval (New-TimeSpan -Minutes 1)

try {
  Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger @($TriggerLogon, $TriggerWatchdog) -Principal $Principal -Settings $Settings -Force | Out-Null
} catch {
  # If Register-ScheduledTask throws Access Denied on existing task in non-elevated shell, update via Set-ScheduledTask
  Set-ScheduledTask -TaskName $TaskName -Action $Action -Settings $Settings | Out-Null
}
Write-Output "REGISTERED_WATCHDOG_TASK: $TaskName (15m interval, MultipleInstances IgnoreNew, ExecutionTimeLimit=PT0S)"

# Zero-window Windows Startup Folder launcher (GEN-43: survives Fast Startup / hybrid hibernate)
$StartupDir = "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup"
if (-not (Test-Path $StartupDir)) {
    New-Item -ItemType Directory -Path $StartupDir -Force | Out-Null
}
$VbsPath = Join-Path $StartupDir "JobscraperAutoApply.vbs"
$VbsContent = 'CreateObject("WScript.Shell").Run "powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File ""D:\Jobscraper-next\scripts\immortal-supervisor.ps1""", 0, False'
[System.IO.File]::WriteAllText($VbsPath, $VbsContent, [System.Text.Encoding]::ASCII)
Write-Output "WROTE_STARTUP_VBS: $VbsPath"

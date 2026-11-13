<# Start the loopback-only Turnstile helper using installed open-source dependencies. #>
param([int]$Port = 8088)
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$solverDir = Join-Path $repoRoot 'out/captcha-solver-venv'
$python = Join-Path $solverDir 'Scripts/python.exe'
$secretPath = Join-Path $repoRoot 'state/autoapply/portal-review/captcha-solver.secret'
if (-not (Test-Path -LiteralPath $python)) { throw 'Run scripts/install-captcha-solver.ps1 first.' }
if (-not (Test-Path -LiteralPath $secretPath)) { throw 'Local solver secret is missing.' }
$secret = (Get-Content -Raw -LiteralPath $secretPath).Trim()
if ($secret.Length -lt 32) { throw 'Local solver secret is invalid.' }
if (Get-NetTCPConnection -LocalAddress '127.0.0.1' -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) {
    throw "Port $Port is already in use; no process was started."
}
$logDir = Join-Path $repoRoot 'out'
New-Item -ItemType Directory -Path $logDir -Force | Out-Null
$wrapper = Join-Path $repoRoot 'scripts/captcha-solver-local.py'
$argsList = @("`"$wrapper`"", '--port', "$Port", '--secret', $secret)
$process = Start-Process -FilePath $python -ArgumentList $argsList -WorkingDirectory $solverDir -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logDir 'captcha-solver.log') -RedirectStandardError (Join-Path $logDir 'captcha-solver.err.log')
Write-Output "Started local solver process $($process.Id)."

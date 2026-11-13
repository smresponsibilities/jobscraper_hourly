<# Install the local helper's open-source dependencies in an isolated environment. #>
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$environment = Join-Path $repoRoot 'out/captcha-solver-venv'
$venvPython = Join-Path $environment 'Scripts/python.exe'
if (-not (Test-Path -LiteralPath $venvPython)) {
    $python = (Get-Command python -ErrorAction Stop).Source
    & $python -m venv $environment
    if ($LASTEXITCODE -ne 0) { throw 'Failed to create the solver environment.' }
}
& $venvPython -m pip install --disable-pip-version-check 'quart==0.22.0' 'patchright==1.64.4'
if ($LASTEXITCODE -ne 0) { throw 'Failed to install solver dependencies.' }
$secretPath = Join-Path $repoRoot 'state/autoapply/portal-review/captcha-solver.secret'
if (-not (Test-Path -LiteralPath $secretPath)) {
    New-Item -ItemType Directory -Path (Split-Path -Parent $secretPath) -Force | Out-Null
    $bytes = New-Object byte[] 32
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
    $secret = -join ($bytes | ForEach-Object { $_.ToString('x2') })
    $file = [System.IO.File]::Open($secretPath, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
    try { $writer = [System.IO.StreamWriter]::new($file); $writer.Write($secret); $writer.Flush() } finally { $file.Dispose() }
}
Write-Output 'Local CAPTCHA helper dependencies installed.'

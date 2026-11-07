$ErrorActionPreference = 'Stop'
$directory = Join-Path (Split-Path -Parent $PSScriptRoot) 'out\tools\mailpit'
New-Item -ItemType Directory -Path $directory -Force | Out-Null
$archive = Join-Path $directory 'mailpit.zip'
$binary = Join-Path $directory 'mailpit.exe'
$archiveHash = '16915767A6C95DCA569336E8F561F91CF355E9A33C57B91DEEDCC10A4BBA7FD4'
$binaryHash = '9276BBCD182565F2ACD594CA1178DA667C6B5B716A75E8DA979C103C38FC1280'
if (-not (Test-Path -LiteralPath $archive)) {
  Invoke-WebRequest -Uri 'https://github.com/axllent/mailpit/releases/download/v1.32.0/mailpit-windows-amd64.zip' -OutFile $archive
}
if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ne $archiveHash) { throw 'Pinned Mailpit archive hash mismatch' }
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [IO.Compression.ZipFile]::OpenRead($archive)
try {
  $entry = $zip.GetEntry('mailpit.exe')
  if ($null -eq $entry) { throw 'Mailpit executable absent from archive' }
  [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $binary, $true)
} finally { $zip.Dispose() }
if ((Get-FileHash -LiteralPath $binary -Algorithm SHA256).Hash -ne $binaryHash) { throw 'Pinned Mailpit executable hash mismatch' }
Write-Output 'Verified Mailpit v1.32.0 installed for local integration tests.'

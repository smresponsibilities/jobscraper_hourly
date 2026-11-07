param(
  [string]$StateRoot = (Join-Path $PSScriptRoot '..\state\autoapply')
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$root = (Resolve-Path -LiteralPath $StateRoot).Path
$source = (Resolve-Path -LiteralPath (Join-Path $root 'portal-review')).Path
$workers = @(Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object { $_.CommandLine -match 'autoapply[/\\]worker' })
if ($workers.Count) { throw 'Stop the autoapply worker before taking a backup.' }
$directory = Join-Path $root 'backups'
New-Item -ItemType Directory -Path $directory -Force | Out-Null
$rootAcl = Get-Acl -LiteralPath $root
$ownerSid = ([System.Security.Principal.NTAccount]$rootAcl.Owner).Translate([System.Security.Principal.SecurityIdentifier]).Value
$allowed = @($ownerSid, 'S-1-5-18', 'S-1-5-32-544')
foreach ($path in @($root, $directory)) {
  $acl = Get-Acl -LiteralPath $path
  $rules = $acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier])
  if (@($rules | Where-Object { $_.AccessControlType -eq 'Allow' -and $_.IdentityReference.Value -notin $allowed }).Count) {
    throw 'Backup directory permits access beyond the state owner and administrators.'
  }
}
$name = 'portal-review-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N') + '.zip'
$target = Join-Path $directory $name
$temporary = "$target.partial"
try {
  [System.IO.Compression.ZipFile]::CreateFromDirectory($source, $temporary, [System.IO.Compression.CompressionLevel]::Optimal, $false)
  $archive = [System.IO.Compression.ZipFile]::OpenRead($temporary)
  try {
    $files = @(Get-ChildItem -LiteralPath $source -File -Recurse -Force)
    $entries = @($archive.Entries | Where-Object { $_.Name })
    if ($files.Count -ne $entries.Count) { throw 'Backup file count mismatch.' }
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
      foreach ($file in $files) {
        $relative = $file.FullName.Substring($source.TrimEnd('\').Length + 1).Replace('\', '/')
        $entry = $archive.GetEntry($relative)
        if (-not $entry -or $entry.Length -ne $file.Length) { throw 'Backup entry mismatch.' }
        $original = [System.IO.File]::OpenRead($file.FullName)
        try { $originalHash = [BitConverter]::ToString($sha.ComputeHash($original)) } finally { $original.Dispose() }
        $copy = $entry.Open()
        try { $copyHash = [BitConverter]::ToString($sha.ComputeHash($copy)) } finally { $copy.Dispose() }
        if ($originalHash -ne $copyHash) { throw 'Backup content changed or failed verification.' }
      }
    } finally { $sha.Dispose() }
  } finally { $archive.Dispose() }
  Move-Item -LiteralPath $temporary -Destination $target
  Write-Output "Verified backup: $($files.Count) files."
} catch {
  if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force }
  throw
}

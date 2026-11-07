[CmdletBinding(SupportsShouldProcess)]
param(
  [string]$State = (Join-Path $PSScriptRoot '..\state\autoapply')
)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path -LiteralPath $State).Path
$expected = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\state\autoapply')).Path
if ($root -ne $expected) { throw 'Only the project autoapply state directory is supported' }
$before = Get-Acl -LiteralPath $root
$owner = $before.GetOwner([Security.Principal.SecurityIdentifier])
$current = [Security.Principal.WindowsIdentity]::GetCurrent().User
if ($owner.Value -ne $current.Value) { throw 'Run as the existing state owner; ownership will not be changed' }
$trusted = @($owner.Value, 'S-1-5-18', 'S-1-5-32-544')
$allow = [Security.AccessControl.AccessControlType]::Allow
$inherit = [Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit'
$propagate = [Security.AccessControl.PropagationFlags]::None
$rights = [Security.AccessControl.FileSystemRights]::FullControl
$backup = Join-Path $PSScriptRoot ('..\out\autoapply-root-acl-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.txt')
if ($PSCmdlet.ShouldProcess($root, 'Preserve owner, grant owner/SYSTEM/Administrators full access, then restrict inherited access')) {
  New-Item -ItemType Directory -Path (Split-Path -Parent $backup) -Force | Out-Null
  [System.IO.File]::WriteAllText($backup, $before.Sddl)
  try {
    # Grant owner access before removing any inherited access.
    foreach ($sid in $trusted) {
      $rule = [Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new($sid), $rights, $inherit, $propagate, $allow)
      $before.SetAccessRule($rule)
    }
    Set-Acl -LiteralPath $root -AclObject $before
    $restricted = Get-Acl -LiteralPath $root
    $restricted.SetAccessRuleProtection($true, $false)
    foreach ($rule in @($restricted.Access)) {
      if ($rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value -notin $trusted) { $restricted.RemoveAccessRuleSpecific($rule) }
    }
    Set-Acl -LiteralPath $root -AclObject $restricted
    $after = Get-Acl -LiteralPath $root
    if ($after.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $owner.Value -or -not $after.AreAccessRulesProtected) { throw 'Owner or inheritance verification failed' }
    foreach ($sid in $trusted) {
      $rules = @($after.Access | Where-Object { $_.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value -eq $sid -and $_.AccessControlType -eq $allow -and ($_.FileSystemRights -band $rights) -eq $rights })
      if (-not $rules.Count) { throw 'Required full-control access missing' }
    }
    # Exercise actual owner access after the ACL change.
    $probe = Join-Path $root ([guid]::NewGuid().ToString() + '.acl-probe')
    [System.IO.File]::WriteAllText($probe, 'owner-access-check')
    if ([System.IO.File]::ReadAllText($probe) -ne 'owner-access-check') { throw 'Owner read-back failed' }
    Remove-Item -LiteralPath $probe
    Write-Output 'State root restricted. Owner unchanged; owner, SYSTEM and Administrators retain full control. Owner read/write verified. Rollback ACL saved in out.'
  } catch {
    $restore = [Security.AccessControl.DirectorySecurity]::new()
    $restore.SetSecurityDescriptorSddlForm([System.IO.File]::ReadAllText($backup))
    Set-Acl -LiteralPath $root -AclObject $restore
    throw
  }
}

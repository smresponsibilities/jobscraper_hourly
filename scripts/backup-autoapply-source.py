"""Create and verify a protected snapshot of tracked and unignored source files."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import uuid
import zipfile
from datetime import datetime, timezone


root = Path(__file__).resolve().parent.parent
destination = (root / 'state' / 'autoapply' / 'backups').resolve(strict=True)
if destination != (root / 'state' / 'autoapply' / 'backups').absolute():
    raise RuntimeError('Unexpected backup directory')
result = subprocess.run(
    ['git', '-c', f'safe.directory={root.as_posix()}', 'ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    cwd=root, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
)
names = sorted({os.fsdecode(value) for value in result.stdout.split(b'\0') if value})
manifest = {'createdAt': datetime.now(timezone.utc).isoformat(), 'files': {}, 'missing': []}
reserved = '__autoapply_backup__/manifest.json'
if reserved in names:
    raise RuntimeError('Source path conflicts with backup metadata')
target = destination / f'source-{uuid.uuid4().hex}.zip'
temporary = target.with_suffix('.zip.partial')
try:
    with zipfile.ZipFile(temporary, 'x', compression=zipfile.ZIP_DEFLATED, allowZip64=True) as archive:
        for name in names:
            source = root / name
            if source.is_symlink():
                raise RuntimeError('Source snapshot contains a symbolic link')
            if not source.exists():
                manifest['missing'].append(name)
                continue
            if not source.is_file() or not source.resolve().is_relative_to(root):
                raise RuntimeError('Source snapshot contains an unsafe path')
            data = source.read_bytes()
            manifest['files'][name] = hashlib.sha256(data).hexdigest()
            archive.writestr(name, data)
        archive.writestr(reserved, json.dumps(manifest, sort_keys=True))
    with zipfile.ZipFile(temporary) as archive:
        if set(archive.namelist()) != set(manifest['files']) | {reserved}:
            raise RuntimeError('Source backup file count mismatch')
        for name, expected in manifest['files'].items():
            if hashlib.sha256(archive.read(name)).hexdigest() != expected or hashlib.sha256((root / name).read_bytes()).hexdigest() != expected:
                raise RuntimeError('Source backup changed or failed verification')
    os.replace(temporary, target)
    print(f"Verified source backup: {len(manifest['files'])} files; {len(manifest['missing'])} deleted paths recorded.")
finally:
    if temporary.parent == destination and temporary.exists():
        temporary.unlink()

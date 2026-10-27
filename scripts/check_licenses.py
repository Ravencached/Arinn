"""Verify that every distributed source file has an explicit license-map entry.

Uses Git's tracked files, or a clean archive tree. It does not determine
copyright ownership or audit dependencies fetched during a build.
"""
import argparse
from pathlib import Path
import subprocess
import sys
import tomllib

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[1])
args = parser.parse_args()
root = args.root.resolve()
if (root / '.git').exists():
    names = set(subprocess.check_output(['git', '-C', str(root), 'ls-files', '-z']).decode().split('\0')) - {''}
else:
    skip = {'.git', 'node_modules', 'runtime', 'data', 'test-runs', 'downloads', '.venv',
            '__pycache__', 'dist', 'build', 'target', 'releases', '.gradle'}
    names = {p.relative_to(root).as_posix() for p in root.rglob('*')
             if p.is_file() and not set(p.relative_to(root).parts) & skip}
mapping = tomllib.loads((root / 'REUSE.toml').read_text(encoding='utf-8'))
licenses = {'AGPL-3.0-or-later', 'CC-BY-4.0', 'MIT', 'MIT AND AGPL-3.0-or-later'}
seen = set()
for annotation in mapping['annotations']:
    if annotation['SPDX-License-Identifier'] not in licenses:
        raise SystemExit('Unknown license expression in map')
    for name in annotation['path']:
        if name in seen:
            raise SystemExit('Duplicate license assignment: ' + name)
        if name not in names:
            raise SystemExit('Stale license-map path: ' + name)
        seen.add(name)
exempt = {'LICENSE', 'REUSE.toml'} | {name for name in names if name.startswith('LICENSES/')}
missing = names - exempt - seen
if missing:
    raise SystemExit('Missing license-map paths: ' + ', '.join(sorted(missing)))
for name in ['AGPL-3.0-or-later', 'CC-BY-4.0', 'MIT']:
    text = (root / 'LICENSES' / (name + '.txt')).read_text(encoding='utf-8')
    if len(text) < 900:
        raise SystemExit('License text missing/truncated: ' + name)
if (root / 'LICENSE').read_bytes() != (root / 'LICENSES/AGPL-3.0-or-later.txt').read_bytes():
    raise SystemExit('Root AGPL text differs from LICENSES copy')
print(f'License map: {len(seen)} files assigned; {len(exempt)} license/control files exempt; no gaps.')

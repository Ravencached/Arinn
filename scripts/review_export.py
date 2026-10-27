"""Fail closed on common private artifacts. Scan tracked content, or a clean ZIP tree.

This is a deterministic handoff gate, not a claim of comprehensive secret detection.
It prints only paths and rule names, never matched values.
"""
import argparse
import os
from pathlib import Path
import subprocess
import sys
from privacy_rules import RULES

ROOT=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--root',type=Path,default=ROOT)
args=parser.parse_args()
root=args.root.resolve()
skip={'.git','node_modules','.venv','__pycache__','.pytest_cache','.ruff_cache','.wrangler','dist','build','target','runtime','data','test-runs','downloads','.gradle','.kotlin','releases'}
if (root/'.git').exists():
    result=subprocess.run(['git','-C',str(root),'ls-files','-z'],capture_output=True,check=True)
    paths=[root/os.fsdecode(p) for p in result.stdout.split(b'\x00') if p]
else:
    paths=[]
    for current,dirs,files in os.walk(root,followlinks=False):
        dirs[:]=[d for d in dirs if d not in skip]
        paths.extend(Path(current)/f for f in files)
rules=RULES
forbidden_suffixes={'.key','.pem','.p12','.pfx','.jks','.keystore','.sqlite','.db','.aringbackup','.apk','.exe','.dll','.zip','.pdf'}
errors=[]
for path in paths:
    rel=path.relative_to(root)
    if path.is_symlink() or path.is_junction():
        errors.append((rel,'filesystem-link'));continue
    if path.name in {'.env','local.properties','google-services.json'} or path.suffix.lower() in forbidden_suffixes:
        errors.append((rel,'private-or-runtime-artifact'))
    if any(part in skip or part in {'secrets','.aws','.ssh'} for part in rel.parts):
        errors.append((rel,'runtime-directory'))
    data=path.read_bytes()
    for name,pattern in rules.items():
        if pattern.search(data):errors.append((rel,name))
for path,rule in errors:print(f'FAIL {path.as_posix()}: {rule}')
print(f'Export gate: {len(paths)} files checked, {len(errors)} findings.')
sys.exit(bool(errors))

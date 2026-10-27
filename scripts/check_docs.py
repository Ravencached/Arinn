"""Check local Markdown file links without fetching external URLs."""
from pathlib import Path
import re
import subprocess
import sys
from urllib.parse import unquote

root = Path(__file__).resolve().parents[1]
if (root / '.git').exists():
    names = subprocess.check_output(['git', '-C', str(root), 'ls-files', '*.md'], text=True).splitlines()
else:
    names = [p.relative_to(root).as_posix() for p in root.rglob('*.md')
             if not {'node_modules', 'runtime', 'dist', 'build', '.git'} & set(p.relative_to(root).parts)]
errors = []
for name in names:
    path = root / name
    for link in re.findall(r'\[[^\]]*\]\(([^)]+)\)', path.read_text(encoding='utf-8')):
        if '://' in link or link.startswith(('#', 'mailto:')):
            continue
        target = unquote(link.split('#')[0].strip('<>'))
        if target and not (path.parent / target).exists():
            errors.append((name, target))
for name, target in errors:
    print(f'FAIL local documentation link: {name} -> {target}')
print(f'Documentation links: {len(names)} Markdown files; {len(errors)} missing local targets.')
sys.exit(bool(errors))

"""Scan every reachable blob, commit and tag using shared private-data patterns.

Requires full Git history. Does not print matched contents or private identities.
This is a deterministic check, not comprehensive secret or identity detection.
"""
import argparse
from pathlib import Path
import re
import subprocess
import sys

from privacy_rules import findings


def scan(root):
    def git(*args):
        return subprocess.check_output(['git', '-C', str(root), *args])
    if git('rev-parse', '--is-shallow-repository').strip() == b'true':
        raise ValueError('Full-history scan requires a non-shallow checkout')
    ids = git('rev-list', '--objects', '--all', '--no-object-names').splitlines()
    errors = []
    counts = {'blob': 0, 'commit': 0, 'tag': 0}
    with subprocess.Popen(['git', '-C', str(root), 'cat-file', '--batch'],
                          stdin=subprocess.PIPE, stdout=subprocess.PIPE) as process:
        try:
            for object_id in ids:
                process.stdin.write(object_id + b'\n'); process.stdin.flush()
                header = process.stdout.readline().split()
                if len(header) != 3:
                    raise ValueError('Unreadable Git object')
                kind, size = header[1].decode(), int(header[2])
                if size > 32 * 1024 * 1024:
                    raise ValueError('Git object exceeds scan size limit')
                data = process.stdout.read(size)
                if len(data) != size or process.stdout.read(1) != b'\n':
                    raise ValueError('Truncated Git object')
                if kind not in counts:
                    continue
                counts[kind] += 1
                for rule in findings(data):
                    errors.append((object_id.decode()[:12], kind, rule))
                if kind in ('commit', 'tag'):
                    for line in data.partition(b'\n\n')[0].splitlines():
                        if line.startswith((b'author ', b'committer ', b'tagger ')):
                            match = re.search(rb'<([^>]+)>', line)
                            if match and not re.fullmatch(
                                rb'(?:[A-Za-z0-9+_.\[\]-]+@users\.noreply\.github\.com|noreply@github\.com|[^@<>\s]+@example\.(?:invalid|test))',
                                match[1]):
                                errors.append((object_id.decode()[:12], kind, 'review-public-commit-identity'))
        finally:
            process.stdin.close()
            if sys.exc_info()[0] is not None:
                process.kill()
            process.wait(timeout=10)
    for object_id, kind, rule in errors:
        print(f'FAIL history {object_id} ({kind}): {rule}')
    print('History scan: ' + ', '.join(f'{value} {key}s' for key, value in counts.items())
          + f'; {len(errors)} findings.')
    return bool(errors)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[1])
    args = parser.parse_args()
    try:
        sys.exit(scan(args.root.resolve()))
    except (OSError, ValueError, subprocess.SubprocessError) as error:
        print('History scan failed: ' + str(error), file=sys.stderr)
        sys.exit(1)

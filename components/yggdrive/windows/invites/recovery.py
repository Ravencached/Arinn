"""File preservation under SFTPGo's identity; no network or credentials.

Called synchronously for completed uploads and pre-delete, never pre-upload:
the native atomic writer renames the old file before its pre-upload hook.
"""
import argparse
from contextlib import contextmanager
import ctypes
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import sys
import time
import uuid
from datetime import datetime, timezone


def no_links(path, root):
    path, root = Path(os.path.abspath(path)), Path(os.path.abspath(root))
    path.relative_to(root)
    for part in [root, *reversed(list(path.parents))]:
        if part != root and root not in part.parents:
            continue
        if part.exists() and (part.lstat().st_file_attributes & stat.FILE_ATTRIBUTE_REPARSE_POINT):
            raise ValueError('Recovery does not follow filesystem links.')
    if path.exists() and (path.lstat().st_file_attributes & stat.FILE_ATTRIBUTE_REPARSE_POINT):
        raise ValueError('Recovery does not follow filesystem links.')
    return path


@contextmanager
def stable_reader(path):
    # Deny writes to the opened file while copying, but permit atomic rename.
    # An already-open writer makes preservation fail rather than capture a
    # changing file. Native pre-delete then refuses the deletion.
    import msvcrt
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    kernel.CreateFileW.argtypes = [ctypes.c_wchar_p, ctypes.c_ulong, ctypes.c_ulong,
        ctypes.c_void_p, ctypes.c_ulong, ctypes.c_ulong, ctypes.c_void_p]
    kernel.CreateFileW.restype = ctypes.c_void_p
    handle = kernel.CreateFileW(str(path), 0x80000000, 5, None, 3, 0x08200000, None)
    if handle == ctypes.c_void_p(-1).value:
        raise ctypes.WinError(ctypes.get_last_error())
    try:
        fd = msvcrt.open_osfhandle(handle, os.O_RDONLY | os.O_BINARY)
    except Exception:
        kernel.CloseHandle.argtypes = [ctypes.c_void_p]
        kernel.CloseHandle(handle)
        raise
    with os.fdopen(fd, 'rb') as source:
        info = os.fstat(source.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
            raise ValueError('Only ordinary files with one filesystem link can be preserved.')
        yield source, info.st_size


def preserve(source, virtual, event, users_root, recovery_root):
    source = no_links(source, users_root)
    relative = source.relative_to(users_root)
    if len(relative.parts) < 2 or not re.fullmatch(r'owner|u_[a-f0-9]{32}', relative.parts[0]):
        raise ValueError('Unexpected private home.')
    # A native notification supplies both physical and virtual names. Require
    # exact agreement, preventing a forged or unexpected mapping from crossing homes.
    if PurePosixPath('/' + Path(*relative.parts[1:]).as_posix()) != PurePosixPath(virtual):
        raise ValueError('The virtual path does not match its private home.')
    if any(p in ('.', '..') or ':' in p for p in relative.parts):
        raise ValueError('Invalid recovery path.')
    bucket = 'Deleted' if event == 'pre-delete' else 'Versions'
    root = recovery_root / relative.parts[0] / bucket
    no_links(root, recovery_root)
    root.mkdir(parents=True, exist_ok=True)
    identifier = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H%M%SZ_') + uuid.uuid4().hex
    # Incomplete copies live outside every user's mounted recovery directory.
    temporary = recovery_root / '.Staging' / relative.parts[0] / ('.pending_' + uuid.uuid4().hex)
    no_links(temporary, recovery_root)
    final = root / identifier
    destination = temporary.joinpath(*relative.parts[1:])
    destination.parent.mkdir(parents=True)
    try:
        with stable_reader(source) as (reader, expected), destination.open('xb') as writer:
            shutil.copyfileobj(reader, writer, 1024*1024)
            writer.flush(); os.fsync(writer.fileno())
            if writer.tell() != expected:
                raise OSError('Preserved size did not match.')
        temporary.rename(final)
    except Exception:
        # Only our randomly named, validated staging directory is removed.
        safe = no_links(temporary, recovery_root)
        if safe.exists() and safe.name.startswith('.pending_'):
            shutil.rmtree(safe)
        raise
    return final.joinpath(*relative.parts[1:])


def seed(users_root, recovery_root):
    count = 0
    for home in users_root.iterdir():
        if not re.fullmatch(r'owner|u_[a-f0-9]{32}', home.name):
            continue
        no_links(home, users_root)
        if not home.is_dir():
            continue
        for current, dirs, files in os.walk(home, followlinks=False):
            for name in dirs:
                no_links(Path(current)/name, users_root)
            for name in files:
                path = Path(current)/name
                if name.startswith('.sftpgo-upload.'):
                    continue
                preserve(path, '/'+path.relative_to(home).as_posix(), 'upload', users_root, recovery_root)
                count += 1
    return count


def prune(recovery_root, now=None):
    removed = 0
    no_links(recovery_root, recovery_root)
    for home in recovery_root.iterdir():
        if not re.fullmatch(r'owner|u_[a-f0-9]{32}', home.name):
            continue
        no_links(home, recovery_root)
        for bucket in ('Deleted', 'Versions'):
            base = home/bucket
            if not base.exists():
                continue
            no_links(base, recovery_root)
            for item in base.iterdir():
                if not re.fullmatch(r'(?:\d{4}-\d{2}-\d{2}T\d{6}Z_|\.pending_)[a-f0-9]{32}', item.name):
                    continue
                no_links(item, recovery_root)
                age = 86400 if item.name.startswith('.pending_') else 30*86400
                if item.stat().st_mtime >= (now or time.time()) - age:
                    continue
                # Reject any nested junction/link before recursive removal.
                for current, dirs, files in os.walk(item, followlinks=False):
                    for name in dirs+files:
                        no_links(Path(current)/name, recovery_root)
                safe = item.resolve(strict=True)
                safe.relative_to(recovery_root.resolve(strict=True))
                if safe.parent != base.resolve(strict=True):
                    raise ValueError('Unexpected retention target.')
                shutil.rmtree(safe)
                removed += 1
    staging = recovery_root / '.Staging'
    if staging.exists():
        no_links(staging, recovery_root)
        for home in staging.iterdir():
            no_links(home, recovery_root)
            if not re.fullmatch(r'owner|u_[a-f0-9]{32}', home.name):
                continue
            for item in home.iterdir():
                no_links(item, recovery_root)
                if not re.fullmatch(r'\.pending_[a-f0-9]{32}', item.name) or item.stat().st_mtime >= (now or time.time())-86400:
                    continue
                for current, dirs, files in os.walk(item, followlinks=False):
                    for name in dirs+files:
                        no_links(Path(current)/name, recovery_root)
                safe = item.resolve(strict=True)
                safe.relative_to(staging.resolve(strict=True))
                if safe.parent != home.resolve(strict=True):
                    raise ValueError('Unexpected staging retention target.')
                shutil.rmtree(safe)
                removed += 1
    return removed


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--config', type=Path, required=True)
    parser.add_argument('--seed', action='store_true')
    parser.add_argument('--prune', action='store_true')
    args = parser.parse_args()
    config = json.loads(args.config.read_text(encoding='utf-8-sig'))
    users, recovery = Path(config['users_root']), Path(config['recovery_root'])
    if not users.is_absolute() or not recovery.is_absolute() or users.parent != recovery.parent or users == recovery:
        raise ValueError('Recovery roots must be separate absolute siblings.')
    if args.seed:
        print(json.dumps({'seeded': seed(users, recovery)})); return
    if args.prune:
        print(json.dumps({'pruned': prune(recovery)})); return
    event = os.environ.get('SFTPGO_ACTION')
    if event not in ('upload', 'copy', 'rename', 'pre-delete'):
        raise ValueError('Unexpected recovery event.')
    if event != 'pre-delete' and os.environ.get('SFTPGO_ACTION_STATUS') != '1':
        return
    source = Path(os.environ['SFTPGO_ACTION_TARGET'] if event in ('copy', 'rename') else os.environ['SFTPGO_ACTION_PATH'])
    virtual = os.environ['SFTPGO_ACTION_VIRTUAL_TARGET'] if event in ('copy', 'rename') else os.environ['SFTPGO_ACTION_VIRTUAL_PATH']
    # Recovery reads/copies are already preserved. Never recursively archive
    # the recovery mount itself, including native retention operations.
    if source.is_relative_to(recovery):
        return
    if source.is_dir() and event in ('copy', 'rename'):
        return
    preserve(source, virtual, event, users, recovery)


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('YggShare could not preserve this file. Ask the administrator to check recovery storage.', file=sys.stderr)
        sys.exit(1)

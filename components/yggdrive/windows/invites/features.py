"""Native recovery rules. All file operations remain inside SFTPGo."""
from pathlib import Path
import json
import re
from urllib.parse import quote

RECOVERY = '/Ygg Recovery'
TAG = 'YggShare managed recovery v1'


def checked(native, method, route, token, body=None, expected=(200, 201)):
    status, result = native.call(method, route, body, token=token)
    if status not in expected:
        raise RuntimeError('Native recovery configuration failed at ' + route.split('?')[0])
    return result


def managed_home(user, home_base):
    home = Path(user.get('home_dir', ''))
    return home.parent == home_base and bool(re.fullmatch(r'owner|u_[a-f0-9]{32}', home.name)) and not user.get('filesystem', {}).get('provider', 0)


def recovery_mapping(native, token, user, home_base):
    if not managed_home(user, home_base):
        raise RuntimeError('Only YggShare-managed private homes can receive recovery folders.')
    folder_name = 'ygg-recovery-' + Path(user['home_dir']).name
    mapped = str(home_base.parent / 'Recovery' / Path(user['home_dir']).name)
    status, folder = native.call('GET', '/folders/' + quote(folder_name), token=token)
    if status == 404:
        folder = {'name': folder_name, 'mapped_path': mapped, 'description': TAG}
        checked(native, 'POST', '/folders', token, folder)
    elif status != 200 or folder.get('mapped_path', '').casefold() != mapped.casefold() or folder.get('description') != TAG:
        raise RuntimeError('A reserved recovery folder conflicts with existing configuration.')
    mappings = user.setdefault('virtual_folders', [])
    for mapping in mappings:
        if mapping.get('virtual_path', '').casefold() == RECOVERY.casefold():
            if mapping.get('name') != folder_name:
                raise RuntimeError('The recovery mount name is already in use.')
            break
    else:
        mappings.append({'name': folder_name, 'virtual_path': RECOVERY, 'quota_size': 0, 'quota_files': 0})
    # Restores use the native Copy action into the ordinary home. No writes or
    # deletions in the recovery mount are allowed from the user client.
    user.setdefault('permissions', {})[RECOVERY] = ['list', 'download', 'copy']
    return user


def ensure(native, token, home_base):
    users = []
    offset = 0
    while True:
        batch = checked(native, 'GET', '/users?limit=100&offset=' + str(offset), token)
        users.extend(u for u in batch if managed_home(u, home_base))
        if len(batch) < 100:
            break
        offset += 100
    for item in users:
        user = checked(native, 'GET', '/users/' + quote(item['username']), token)
        before = json.dumps(user, sort_keys=True)
        recovery_mapping(native, token, user, home_base)
        if before != json.dumps(user, sort_keys=True):
            user.pop('password', None)
            checked(native, 'PUT', '/users/' + quote(user['username']) + '?disconnect=1', token, user)
    return {'enabled': True, 'retention_days': 30, 'users': len(users), 'folder': RECOVERY}

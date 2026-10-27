"""Real disposable Docker role checks. Requires Docker Linux containers and network for builds.

Runs separate home/storage projects on random loopback test ports. Never uses
installed services or real provider accounts. Synthetic credentials stay in
memory or the private sandbox directory. Removes only its own Compose resources.
"""
import argparse
import base64
import http.client
import http.cookiejar
import json
import os
from pathlib import Path
import secrets
import re
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
import suite


def request(port, method, path, data=None, headers=None, auth=None):
    headers = dict(headers or {})
    if isinstance(data, dict):
        data = json.dumps(data).encode()
        headers['Content-Type'] = 'application/json'
    if auth:
        headers['Authorization'] = 'Basic ' + base64.b64encode(':'.join(auth).encode()).decode()
    conn = http.client.HTTPConnection('127.0.0.1', port, timeout=15)
    try:
        conn.request(method, path, data, headers)
        response = conn.getresponse()
        return response.status, response.read(), dict(response.getheaders())
    finally:
        conn.close()


def check(condition, label):
    if not condition:
        raise AssertionError(label)
    print('PASS ' + label, flush=True)


def browser_login(port, name, password):
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}),
        urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
    url = f'http://127.0.0.1:{port}/web/client/login'
    page = opener.open(url).read().decode()
    token = re.search(r'name="_form_token" value="([^"]+)"', page).group(1)
    form = urllib.parse.urlencode({'username': name, 'password': password, '_form_token': token}).encode()
    with opener.open(url, form) as response:
        check('/web/client/files' in response.url and b'Search Files' in response.read(),
              'Drive browser login with general API disabled: ' + name)
    return opener


def browser_get(opener, port, path):
    try:
        with opener.open(f'http://127.0.0.1:{port}' + path) as response:
            return response.status, response.read()
    except urllib.error.HTTPError as error:
        return error.code, error.read()


def browser_upload(opener, port, payload):
    url = f'http://127.0.0.1:{port}/web/client/files?path=/'
    page = opener.open(url).read().decode()
    token = re.search(r"'X-CSRF-TOKEN': '([^']+)'", page).group(1)
    encoded_path = re.search(r"uploadPath = '([^']+)'\s*\+\s*encodeURIComponent", page).group(1)
    upload_path = json.loads('"' + encoded_path + '"')
    if not upload_path.startswith('/web/client/'):
        raise RuntimeError('Unexpected browser upload endpoint')
    upload_path += urllib.parse.quote('/web-upload.bin', safe='') + '&mkdir_parents=false'
    req = urllib.request.Request(f'http://127.0.0.1:{port}' + upload_path, data=payload,
        headers={'Content-Type': 'application/octet-stream', 'X-CSRF-TOKEN': token})
    with opener.open(req) as response:
        return response.status


def run(command, **kwargs):
    result = subprocess.run(command, capture_output=True, **kwargs)
    if result.returncode:
        raise RuntimeError('Sandbox subprocess failed; inspect private build.log for build diagnostics')
    return result.stdout


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--workdir', type=Path, required=True, help='New private directory outside the checkout')
    args = parser.parse_args()
    os.umask(0o077)
    work = args.workdir.resolve()
    if work == ROOT or ROOT in work.parents:
        parser.error('Use a new directory outside the checkout')
    work.mkdir(parents=True, exist_ok=False)
    nonce = secrets.token_hex(5)
    offset = None
    for _ in range(100):
        candidate = 10000 + secrets.randbelow(35000)
        sockets = []
        try:
            for port in [4387, 8080, 8081, 8088, 8089]:
                sock = socket.socket(); sockets.append(sock)
                sock.bind(('127.0.0.1', port + candidate))
            offset = candidate
            break
        except OSError:
            pass
        finally:
            for sock in sockets:
                sock.close()
    if offset is None:
        raise RuntimeError('No free test-port set found')
    commands = {}
    content = work / 'content'; content.mkdir()
    try:
        for role in ('home', 'storage'):
            state = work / role; state.mkdir()
            options = argparse.Namespace(role=role, components=None,
                mail_url='https://mail.example.test', calendar_url='https://calendar.example.test',
                drive_url='https://drive.example.test', drive_path=str(content),
                project='suite-test-' + nonce + '-' + role, port_offset=offset)
            suite.generate(state, options)
            settings = json.loads((state / 'settings.json').read_text())
            cmd = suite.compose_command(state, settings)
            commands[role] = cmd
            if role == 'storage':
                # Test-only bootstrap. The normal generator never creates users.
                config_path = state / 'drive/sftpgo.json'
                config = json.loads(config_path.read_text())
                config['data_provider']['create_default_admin'] = True
                for binding in config['httpd']['bindings']:
                    binding['security']['allowed_hosts'].append('127.0.0.1:' + str(binding['port'] + offset))
                config_path.write_text(json.dumps(config))
                admin_password = secrets.token_urlsafe(32)
                compose_path = state / 'compose.json'
                compose = json.loads(compose_path.read_text())
                compose['services']['yggdrive']['environment'] = {
                    'SFTPGO_DEFAULT_ADMIN_USERNAME': 'sandbox-admin',
                    'SFTPGO_DEFAULT_ADMIN_PASSWORD': admin_password}
                compose_path.write_text(json.dumps(compose))
            run(cmd + ['config', '--quiet'])
            with (work / 'build.log').open('ab') as log:
                subprocess.run(cmd + ['up', '-d', '--build', '--wait', '--wait-timeout', '180'],
                               stdout=log, stderr=log, check=True)
            listing = json.loads(run(cmd + ['config', '--format', 'json']))
            for service in listing['services'].values():
                check(all(port['host_ip'] == '127.0.0.1' for port in service.get('ports', [])),
                      role + ' service publishes only to loopback')
                check(service.get('read_only') is True, role + ' service has read-only program filesystem')
        check(request(offset + 8089, 'GET', '/')[0] == 200, 'SnappyMail user page serves through Nginx/FPM')
        for query in ['admin', 'admin/0/Json/']:
            check(request(offset + 8089, 'GET', '/?' + query)[0] == 403, 'User mail origin denies ' + query)
        check(request(offset + 8088, 'GET', '/?admin')[0] == 200, 'Separate mail administrator page available')
        check(request(offset + 8089, 'GET', '/include.php')[0] == 404, 'Mail bootstrap file is not served')
        calendar_headers = {'Host': 'calendar.example.test', 'Origin': 'https://calendar.example.test'}
        check(request(offset + 4387, 'GET', '/api/health', headers=calendar_headers)[0] == 200,
              'Container calendar health endpoint responds')
        calendar_password = secrets.token_urlsafe(32)
        run(commands['home'] + ['exec', '-T', 'aring', 'node', 'scripts/account.mjs',
                               'alice@example.test', 'Alice'], input=calendar_password.encode())
        status, body, headers = request(offset + 4387, 'POST', '/api/login',
            {'email': 'alice@example.test', 'password': calendar_password}, calendar_headers)
        check(status == 200 and 'Secure' in headers.get('Set-Cookie', ''), 'Calendar account login sets Secure cookie')
        check(request(offset + 4387, 'POST', '/api/login',
            {'email': 'alice@example.test', 'password': calendar_password},
            {'Host': 'calendar.example.test', 'Origin': 'https://other.example.test'})[0] == 403,
            'Calendar rejects another browser origin')
        check(request(offset + 8080, 'GET', '/web/admin')[0] == 404, 'Drive client hides administrator page')
        check(request(offset + 8080, 'GET', '/api/v2/users')[0] == 404, 'Drive client hides administrator API')
        status, body, _ = request(offset + 8081, 'GET', '/api/v2/token', auth=('sandbox-admin', admin_password))
        check(status == 200, 'Disposable drive administrator authenticates privately')
        admin_headers = {'Authorization': 'Bearer ' + json.loads(body)['access_token']}
        user_password = secrets.token_urlsafe(32)
        for name in ['alice', 'bob']:
            user = {'status': 1, 'username': name, 'password': user_password,
                    'home_dir': '/srv/sftpgo/data/Users/' + name,
                    'permissions': {'/': ['list', 'download', 'upload', 'overwrite', 'create_dirs']},
                    'quota_size': 10485760, 'virtual_folders': [], 'filters': {'web_client': ['shares-disabled']}}
            check(request(offset + 8081, 'POST', '/api/v2/users', user, admin_headers)[0] == 201,
                  'Create isolated synthetic drive account ' + name)
        # Write through the container as its normal UID, then read through the
        # actual authenticated client API. No host share or production path used.
        run(commands['storage'] + ['exec', '-T', 'yggdrive', 'sh', '-c',
            'mkdir -p /srv/sftpgo/data/Users/alice; printf synthetic-canary > /srv/sftpgo/data/Users/alice/canary.txt'])
        check((content / 'data/Users/alice/canary.txt').read_bytes() == b'synthetic-canary',
              'Drive bytes live on storage-role bind directory')
        browsers = {}
        for name in ['alice', 'bob']:
            browsers[name] = browser_login(offset + 8080, name, user_password)
        payload = secrets.token_bytes(1024 * 1024)
        check(browser_upload(browsers['alice'], offset + 8080, payload) == 201,
              'Browser uploads 1 MiB through production client binding')
        check((content / 'data/Users/alice/web-upload.bin').read_bytes() == payload,
              'Browser upload bytes match storage-host bind content')
        check(browser_get(browsers['alice'], offset + 8080, '/web/client/files?path=/web-upload.bin') == (200, payload),
              'Browser downloads uploaded 1 MiB unchanged')
        check(browser_get(browsers['alice'], offset + 8080, '/web/client/files?path=/canary.txt')
              == (200, b'synthetic-canary'), 'Owner downloads correct drive bytes')
        for path in ['/web/client/files?path=/canary.txt',
                     '/web/client/files?path=/../alice/canary.txt']:
            status, body = browser_get(browsers['bob'], offset + 8080, path)
            # The browser UI can render an error page with HTTP 200. Assert
            # actual disclosure, not REST-specific status conventions.
            check(b'synthetic-canary' not in body, 'Other drive account cannot read owner canary: ' + path)
        run(commands['home'] + ['stop'])
        check(browser_get(browsers['alice'], offset + 8080, '/web/client/files?path=/canary.txt')[0] == 200,
              'Storage stays available while home role is stopped')
        run(commands['storage'] + ['restart'])
        for _ in range(30):
            try:
                if request(offset + 8081, 'GET', '/api/v2/token', auth=('sandbox-admin', admin_password))[0] == 200:
                    break
            except OSError:
                pass
            time.sleep(.5)
        alice = browser_login(offset + 8080, 'alice', user_password)
        check(browser_get(alice, offset + 8080, '/web/client/files?path=/canary.txt') == (200, b'synthetic-canary'),
              'Drive content survives storage restart')
        run(commands['home'] + ['up', '-d', '--wait', '--wait-timeout', '180'])
        check(request(offset + 4387, 'POST', '/api/login',
            {'email': 'alice@example.test', 'password': calendar_password}, calendar_headers)[0] == 200,
            'Calendar account survives home stop/start')
        print('PASS separate role container integration. Physical two-host routing/provider/TLS acceptance remains.', flush=True)
    finally:
        for role, cmd in commands.items():
            subprocess.run(cmd + ['down', '--volumes'], stdout=subprocess.DEVNULL, check=True)


if __name__ == '__main__':
    main()

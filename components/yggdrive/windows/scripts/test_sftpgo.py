r"""Real SFTPGo integration checks in a disposable, loopback-only workspace.

Credentials are random, held in memory, and only sent to the test child process.
No production users, S:\Drive content, services, firewall or DNS are modified.
"""
import argparse
import base64
import hashlib
import hmac
import http.client
import http.cookiejar
import json
import os
from pathlib import Path
import re
import secrets
import struct
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

BASE = Path(__file__).resolve().parents[1]
RUNTIME = Path(os.environ.get('YGGS_RUNTIME_PATH', str(BASE / 'runtime' / 'sftpgo-2.7.6')))
PERMS = ['list', 'download', 'upload', 'overwrite', 'delete', 'rename', 'create_dirs', 'copy']


def request(port, method, path, data=None, token=None, auth=None, headers=None):
    extra = dict(headers or {})
    if token:
        extra['Authorization'] = 'Bearer ' + token
    if auth:
        extra['Authorization'] = 'Basic ' + base64.b64encode((':'.join(auth)).encode()).decode()
    if isinstance(data, dict):
        data = json.dumps(data).encode()
        extra['Content-Type'] = 'application/json'
    conn = http.client.HTTPConnection('127.0.0.1', port, timeout=120)
    conn.request(method, path, data, extra)
    resp = conn.getresponse()
    result = resp.status, resp.read(), dict(resp.getheaders())
    conn.close()
    return result


def check(condition, name):
    if not condition:
        raise AssertionError(name)
    print('PASS ' + name, flush=True)


def upload(port, token, filename, payload=None, size=None, folder='/'):
    boundary = 'YggShareTest' + secrets.token_hex(12)
    pre = (f'--{boundary}\r\nContent-Disposition: form-data; name="filenames"; '
           f'filename="{filename}"\r\nContent-Type: application/octet-stream\r\n\r\n').encode()
    post = f'\r\n--{boundary}--\r\n'.encode()
    count = size if size is not None else len(payload)
    conn = http.client.HTTPConnection('127.0.0.1', port, timeout=240)
    conn.putrequest('POST', '/api/v2/user/files?' + urllib.parse.urlencode({'path': folder}))
    conn.putheader('Authorization', 'Bearer ' + token)
    conn.putheader('Content-Type', 'multipart/form-data; boundary=' + boundary)
    conn.putheader('Content-Length', str(len(pre) + count + len(post)))
    conn.endheaders()
    conn.send(pre)
    digest = hashlib.sha256()
    if payload is not None:
        conn.send(payload)
        digest.update(payload)
    else:
        block = b'YGG-SHARE-TRANSFER-TEST\x00' * 45000
        remaining = count
        while remaining:
            piece = block[:min(remaining, len(block))]
            conn.send(piece)
            digest.update(piece)
            remaining -= len(piece)
    conn.send(post)
    resp = conn.getresponse()
    status, body = resp.status, resp.read()
    conn.close()
    return status, body, digest.hexdigest()


def get_token(port, username, password, otp=None):
    headers = {'X-SFTPGO-OTP': otp} if otp else {}
    status, data, _ = request(port, 'GET', '/api/v2/user/token', auth=(username, password), headers=headers)
    return status, json.loads(data).get('access_token') if status == 200 else None


def totp(secret):
    counter = struct.pack('>Q', int(time.time()) // 30)
    digest = hmac.new(base64.b32decode(secret), counter, hashlib.sha1).digest()
    offset = digest[-1] & 15
    return str((struct.unpack('>I', digest[offset:offset+4])[0] & 0x7fffffff) % 1000000).zfill(6)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--large-bytes', type=int, default=0)
    args = parser.parse_args()
    run = BASE / 'test-runs' / uuid.uuid4().hex
    run.mkdir(parents=True)
    state = run / 'state'
    state.mkdir()
    content = run / 'content'
    (content / 'Users').mkdir(parents=True)
    outside = run / 'excluded-canary.txt'
    outside.write_text('YGG_OUTSIDE_HOME_' + secrets.token_hex(20))
    config = state / 'sftpgo.json'
    subprocess.run(['powershell.exe', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
                    str(BASE / 'scripts' / 'New-YggShareConfig.ps1'), '-RuntimePath', str(RUNTIME),
                    '-StatePath', str(state), '-OutputPath', str(config), '-ContentPath', str(content),
                    '-ClientPort', '18080', '-AdminPort', '18081', '-TestApi'], check=True,
                   stdout=subprocess.DEVNULL)
    cfg = json.loads(config.read_text(encoding='utf-8-sig'))
    public = json.loads(json.dumps(cfg['httpd']['bindings'][0]))
    public['port'] = 18082
    public['enable_rest_api'] = False
    public['security']['allowed_hosts'] = ['127.0.0.1:18082']
    cfg['httpd']['bindings'].append(public)
    cfg['data_provider']['create_default_admin'] = True
    config.write_text(json.dumps(cfg), encoding='utf-8')
    admin_pass = secrets.token_urlsafe(32)
    user_pass = secrets.token_urlsafe(32)
    env = os.environ.copy()
    env['SFTPGO_DEFAULT_ADMIN_USERNAME'] = 'test-admin'
    env['SFTPGO_DEFAULT_ADMIN_PASSWORD'] = admin_pass
    log = (run / 'process.log').open('wb')
    child = subprocess.Popen([str(RUNTIME / 'sftpgo.exe'), 'serve', '--config-dir', str(state),
                              '--log-file-path', str(run / 'sftpgo.log'), '--log-level', 'warn'],
                             env=env, stdout=log, stderr=log,
                             creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    try:
        for _ in range(60):
            if child.poll() is not None:
                raise RuntimeError('Test service exited; see process.log')
            try:
                status, body, _ = request(18081, 'GET', '/api/v2/token', auth=('test-admin', admin_pass))
                if status == 200:
                    break
            except OSError:
                pass
            time.sleep(.25)
        else:
            raise RuntimeError('Test service did not become ready')
        admin_token = json.loads(body)['access_token']
        check(status == 200, 'test administrator authenticates')
        header_status, _, headers = request(18082, 'GET', '/web/client/login', headers={'X-Forwarded-Proto':'https'})
        lowered = {k.lower(): v for k, v in headers.items()}
        check("frame-ancestors 'self'" in lowered.get('content-security-policy',''), 'same-origin framing CSP is applied')
        check('max-age=15552000' in lowered.get('strict-transport-security',''), 'HSTS applies to trusted HTTPS proxy context')
        for username in ('a', 'b', 'quota', 'mfa', 'enroll'):
            user = {'status': 1, 'username': username, 'password': user_pass,
                    'home_dir': str(content / 'Users' / username), 'permissions': {'/': PERMS},
                    'quota_size': 16 if username == 'quota' else 8 * 1024**3,
                    'virtual_folders': [], 'filters': {'web_client': ['shares-disabled'],
                                                     'denied_protocols': ['SSH', 'FTP', 'DAV']}}
            if username == 'enroll':
                user['filters']['two_factor_protocols'] = ['HTTP']
            if username == 'mfa':
                user['filters']['two_factor_protocols'] = ['HTTP']
            status, body, _ = request(18081, 'POST', '/api/v2/users', user, token=admin_token)
            check(status == 201, f'provision isolated fixture account {username} (HTTP {status})')
        status, a = get_token(18080, 'a', user_pass)
        check(status == 200, 'ordinary user authenticates')
        _, b = get_token(18080, 'b', user_pass)
        check(request(18080, 'GET', '/api/v2/user/dirs')[0] in (401, 403), 'unauthenticated listing denied')
        check(upload(18080, a, 'a.txt', b'private-a')[0] == 201, 'upload real file')
        check(upload(18080, b, 'b.txt', b'private-b')[0] == 201, 'second home receives its own file')
        status, data, _ = request(18080, 'GET', '/api/v2/user/files?path=/a.txt', token=a)
        check(status == 200 and data == b'private-a', 'download bytes match')
        status, data, _ = request(18080, 'GET', '/api/v2/user/dirs?path=/', token=a)
        names = [entry['name'] for entry in json.loads(data)]
        check(status == 200 and names == ['a.txt'], 'listing reveals only the authenticated home')
        for path in ('../b/b.txt', '../../excluded-canary.txt', str(outside), '/b/b.txt', '/Users/b/b.txt'):
            status, body, _ = request(18080, 'GET', '/api/v2/user/files?' + urllib.parse.urlencode({'path': path}), token=a)
            check(status != 200 and b'private-b' not in body and outside.read_bytes() not in body,
                  'cross-home/physical-path request rejected: ' + path.replace(str(run), '<test-run>'))
        check(request(18080, 'POST', '/api/v2/user/dirs?path=/Documents', token=a)[0] == 201, 'create real directory')
        check(request(18080, 'PATCH', '/api/v2/user/files?path=/a.txt&target=/Documents/renamed.txt', token=a)[0] == 200, 'rename and move inside home')
        check(upload(18080, a, 'renamed.txt', b'replaced', folder='/Documents')[0] == 201, 'overwrite inside home')
        check(request(18080, 'DELETE', '/api/v2/user/files?path=/Documents/renamed.txt', token=a)[0] == 200, 'delete disposable fixture file')
        _, qt = get_token(18080, 'quota', user_pass)
        check(upload(18080, qt, 'too-large.txt', b'x' * 4096)[0] in (403, 413), 'personal quota rejects oversized upload')
        check(request(18080, 'GET', '/api/v2/users', token=a)[0] in (401, 403), 'ordinary token cannot administer users')
        check(request(18082, 'GET', '/api/v2/users')[0] == 404, 'production-style binding hides general admin API')
        check(request(18082, 'GET', '/web/admin')[0] == 404, 'production-style binding hides WebAdmin')
        check(get_token(18082, 'a', user_pass)[0] == 404, 'production-style binding hides general token endpoint')
        _, enroll_token = get_token(18080, 'enroll', user_pass)
        check(request(18080, 'GET', '/api/v2/user/dirs', token=enroll_token)[0] in (401, 403),
              'required-but-unenrolled MFA cannot access files')
        _, mfa_setup = get_token(18080, 'mfa', user_pass)
        status, body, _ = request(18080, 'POST', '/api/v2/user/totp/generate',
                                  {'config_name': 'YggShare'}, token=mfa_setup)
        check(status == 200, 'user can begin real MFA enrollment')
        totp_secret = json.loads(body)['secret']
        status, _, _ = request(18080, 'POST', '/api/v2/user/totp/validate',
                              {'config_name': 'YggShare', 'secret': totp_secret, 'passcode': totp(totp_secret)}, token=mfa_setup)
        check(status == 200, 'enrollment verifies an authenticator code')
        status, _, _ = request(18080, 'POST', '/api/v2/user/totp/save',
                              {'enabled': True, 'config_name': 'YggShare', 'protocols': ['HTTP'],
                               'secret': {'status': 'Plain', 'payload': totp_secret}}, token=mfa_setup)
        check(status == 200, 'save enrolled MFA using the user-specific endpoint')
        check(get_token(18080, 'mfa', user_pass)[0] in (401, 403), 'enrolled MFA cannot be bypassed with password only')
        # Enrollment validation consumes the current passcode. Wait for the next
        # time step rather than incorrectly treating replay rejection as failure.
        time.sleep(30 - time.time() % 30 + .2)
        otp = totp(totp_secret)
        check(get_token(18080, 'mfa', user_pass, otp)[0] == 200, 'valid authenticator code completes sign-in')
        check(get_token(18080, 'mfa', user_pass, otp)[0] in (401, 403), 'authenticator code replay rejected')
        # Exercise the browser login on a binding with the general API disabled.
        jar = http.cookiejar.CookieJar()
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), urllib.request.HTTPCookieProcessor(jar))
        login_url = 'http://127.0.0.1:18082/web/client/login'
        login_html = opener.open(login_url).read().decode()
        form_token = re.search(r'name="_form_token" value="([^"]+)"', login_html).group(1)
        form = urllib.parse.urlencode({'username': 'a', 'password': user_pass, '_form_token': form_token}).encode()
        page = opener.open(login_url, form)
        browser_html = page.read().decode()
        check('/web/client/files' in page.url and 'Search Files' in browser_html,
              'working browser file manager signs in with general API disabled')
        # A request limiter constrains request starts, not transfer bytes. Verify
        # a burst is delayed/denied at a deliberately distinct test IP, without
        # generating defender bans or consuming the functional test user's bucket.
        probe_start = time.monotonic()
        statuses = [request(18080, 'GET', '/web/client/login', headers={'X-Forwarded-For':'198.51.100.77'})[0] for _ in range(90)]
        duration = time.monotonic() - probe_start
        check(duration >= 1 or 429 in statuses, 'per-IP request burst is throttled')
        if args.large_bytes:
            print(f'Transferring {args.large_bytes} bytes through the real server...', flush=True)
            status, _, sent_hash = upload(18080, a, 'multi-gb.bin', size=args.large_bytes)
            check(status == 201, 'multi-GB HTTP upload completes')
            conn = http.client.HTTPConnection('127.0.0.1', 18080, timeout=240)
            conn.request('GET', '/api/v2/user/files?path=/multi-gb.bin', headers={'Authorization': 'Bearer ' + a})
            resp = conn.getresponse()
            got_hash, received = hashlib.sha256(), 0
            while True:
                block = resp.read(1024 * 1024)
                if not block:
                    break
                got_hash.update(block)
                received += len(block)
            conn.close()
            check(resp.status == 200 and received == args.large_bytes and got_hash.hexdigest() == sent_hash,
                  'multi-GB download size and SHA256 match')
            check(request(18080, 'DELETE', '/api/v2/user/files?path=/multi-gb.bin', token=a)[0] == 200,
                  'remove generated multi-GB fixture through file API')
        check(request(18080, 'GET', '/api/v2/user/logout', token=a)[0] == 200, 'logout succeeds')
        check(request(18080, 'GET', '/api/v2/user/dirs', token=a)[0] in (401, 403), 'logged-out token is rejected')
        summary = {'result': 'passed', 'large_transfer_bytes': args.large_bytes,
                   'scope': 'disposable loopback test; no Windows service identity or public network tested'}
        (run / 'result.json').write_text(json.dumps(summary, indent=2))
        print('Results: ' + str(run / 'result.json'), flush=True)
    finally:
        child.terminate()
        child.wait(timeout=15)
        log.close()
        # No recursive deletion: only this known generated large fixture may remain
        # after a failed test. Keep logs/database for diagnosis, without plaintext passwords.
        large_fixture = content / 'Users' / 'a' / 'multi-gb.bin'
        if large_fixture.exists() and large_fixture.is_file() and not large_fixture.is_symlink():
            if large_fixture.resolve().is_relative_to(run.resolve()):
                large_fixture.unlink()


if __name__ == '__main__':
    main()

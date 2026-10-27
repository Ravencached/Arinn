"""YggShare's private invitation manager and public single-use redemption.

Native SFTPGo handles identities, password policy and required MFA. This service
keeps no administrator credential on disk and has no Drive filesystem access.
"""
from __future__ import annotations
import argparse
import base64
import ctypes
from contextlib import contextmanager
from ctypes import wintypes
import hashlib
import http.client
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import ipaddress
import json
from pathlib import Path
import re
import secrets
import sqlite3
import threading
import time
from urllib.parse import quote, urlsplit
import uuid
import features
from health import Monitor

HERE = Path(__file__).resolve().parent
GIB = 1024 ** 3
USER_PERMISSIONS = ['list', 'download', 'upload', 'overwrite', 'delete', 'rename', 'create_dirs', 'copy']


class Failure(Exception):
    def __init__(self, status, message):
        self.status, self.message = status, message


class Blob(ctypes.Structure):
    _fields_ = [('cbData', wintypes.DWORD), ('pbData', ctypes.POINTER(ctypes.c_ubyte))]


def protect(value: str) -> bytes:
    data = value.encode()
    buffer = ctypes.create_string_buffer(data)
    incoming = Blob(len(data), ctypes.cast(buffer, ctypes.POINTER(ctypes.c_ubyte)))
    outgoing = Blob()
    if not ctypes.windll.crypt32.CryptProtectData(ctypes.byref(incoming), None, None, None, None, 5, ctypes.byref(outgoing)):
        raise OSError('Windows could not protect invitation credentials.')
    try:
        return ctypes.string_at(outgoing.pbData, outgoing.cbData)
    finally:
        ctypes.windll.kernel32.LocalFree(outgoing.pbData)


def unprotect(data: bytes) -> str:
    buffer = ctypes.create_string_buffer(data)
    incoming = Blob(len(data), ctypes.cast(buffer, ctypes.POINTER(ctypes.c_ubyte)))
    outgoing = Blob()
    if not ctypes.windll.crypt32.CryptUnprotectData(ctypes.byref(incoming), None, None, None, None, 1, ctypes.byref(outgoing)):
        raise OSError('Windows could not unlock this pending invitation.')
    try:
        return ctypes.string_at(outgoing.pbData, outgoing.cbData).decode()
    finally:
        ctypes.windll.kernel32.LocalFree(outgoing.pbData)


class Native:
    def __init__(self, port):
        self.port = port

    def call(self, method, route, body=None, token=None, basic=None, otp=None):
        headers = {'Accept': 'application/json'}
        if token:
            headers['Authorization'] = 'Bearer ' + token
        if basic:
            headers['Authorization'] = 'Basic ' + base64.b64encode((':'.join(basic)).encode()).decode()
        if otp:
            headers['X-SFTPGO-OTP'] = otp
        if body is not None:
            body = json.dumps(body).encode()
            headers['Content-Type'] = 'application/json'
        conn = http.client.HTTPConnection('127.0.0.1', self.port, timeout=15)
        try:
            conn.request(method, '/api/v2' + route, body, headers)
            response = conn.getresponse()
            data = response.read(1024 * 1024)
            try:
                result = json.loads(data)
            except (ValueError, UnicodeError):
                result = {}
            return response.status, result
        finally:
            conn.close()


class Store:
    def __init__(self, path):
        self.path = path
        with self.connect() as db:
            db.executescript('''
                CREATE TABLE IF NOT EXISTS invitations (
                    id TEXT PRIMARY KEY, token_hash TEXT UNIQUE NOT NULL,
                    username TEXT UNIQUE NOT NULL, home TEXT NOT NULL,
                    quota_gib INTEGER NOT NULL, created INTEGER NOT NULL,
                    expires INTEGER NOT NULL, state TEXT NOT NULL,
                    secret BLOB, claimed INTEGER
                );
                CREATE TABLE IF NOT EXISTS settings (name TEXT PRIMARY KEY, value TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS audit (created INTEGER, action TEXT, username TEXT);
            ''')
            columns = {r[1] for r in db.execute('PRAGMA table_info(invitations)')}
            if 'purpose' not in columns:
                db.execute("ALTER TABLE invitations ADD COLUMN purpose TEXT NOT NULL DEFAULT 'invite'")

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.path, timeout=20)
        db.row_factory = sqlite3.Row
        db.execute('PRAGMA busy_timeout=20000')
        try:
            yield db
            db.commit()
        except Exception:
            db.rollback()
            raise
        finally:
            db.close()

    def listed(self):
        with self.connect() as db:
            rows = db.execute('SELECT id,username,quota_gib,created,expires,state,claimed,purpose FROM invitations ORDER BY created DESC').fetchall()
        result = []
        for row in rows:
            item = dict(row)
            if item['state'] == 'pending' and item['expires'] <= time.time():
                item['state'] = 'expired'
            result.append(item)
        return result


class App:
    def __init__(self, data, native_port, home_base, public_origin, auto_unlimit=False, enable_features=False, admin_username="ygg-admin"):
        self.store = Store(data / 'invitations.db')
        self.native = Native(native_port)
        self.home_base = home_base
        self.public_origin = public_origin
        self.auto_unlimit = auto_unlimit
        self.admin_username = admin_username
        self.sessions = {}
        self.lock = threading.Lock()
        self.buckets = {}
        self.features_enabled = enable_features
        self.feature_lock = threading.Lock()
        self.monitor = Monitor(self.store, home_base.anchor or home_base)

    def audit(self, action, username):
        with self.store.connect() as db:
            db.execute('INSERT INTO audit VALUES (?,?,?)', (int(time.time()), action, username))
            db.execute('DELETE FROM audit WHERE rowid NOT IN (SELECT rowid FROM audit ORDER BY rowid DESC LIMIT 1000)')

    def setup_features(self, token):
        if self.features_enabled:
            with self.feature_lock:
                result = features.ensure(self.native, token, self.home_base)
                with self.store.connect() as db:
                    db.execute("INSERT OR REPLACE INTO settings VALUES ('recovery',?)", (json.dumps(result),))
                return result

    def throttle(self, key, count=10, window=60):
        now = time.monotonic()
        with self.lock:
            if len(self.buckets) > 2048:
                self.buckets = {k: v for k, v in self.buckets.items() if v[1] > now - 300}
                if len(self.buckets) > 2048:
                    self.buckets.pop(next(iter(self.buckets)))
            available, previous = self.buckets.get(key, (count, now))
            available = min(count, available + (now - previous) * count / window)
            if available < 1:
                raise Failure(429, 'A few too many attempts. Please wait a minute and try again.')
            self.buckets[key] = (available - 1, now)

    def login(self, values):
        username = values.get('username', '')
        if username != self.admin_username:
            raise Failure(401, 'Use your YggShare administrator credentials and current authenticator code.')
        status, result = self.native.call('GET', '/token', basic=(username, values.get('password', '')), otp=values.get('otp', ''))
        if status != 200 or 'access_token' not in result:
            raise Failure(401, 'Administrator sign-in did not complete. Check the password and authenticator code.')
        token = result['access_token']
        owner = self.owner_limits(token)
        if self.auto_unlimit:
            with self.store.connect() as db:
                done = db.execute("SELECT value FROM settings WHERE name='owner-unlimited'").fetchone()
            if not done:
                owner = self.unlimit_owner(token)
                with self.store.connect() as db:
                    db.execute("INSERT OR REPLACE INTO settings VALUES ('owner-unlimited','1')")
        self.setup_features(token)
        sid, csrf = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
        with self.lock:
            self.sessions = {k: v for k, v in self.sessions.items() if v['expires'] > time.time()}
            self.sessions[sid] = {'token': token, 'csrf': csrf, 'expires': time.time() + 600}
        return sid, {'csrf': csrf, 'owner': owner}

    def session(self, cookie, csrf=None):
        parsed = SimpleCookie()
        try:
            parsed.load(cookie or '')
            sid = parsed['ygg_invite_admin'].value
        except (KeyError, ValueError):
            raise Failure(401, 'Please sign in to the invitation manager.')
        with self.lock:
            session = self.sessions.get(sid)
            if not session or session['expires'] <= time.time():
                self.sessions.pop(sid, None)
                raise Failure(401, 'Your invitation-manager session expired. Please sign in again.')
            if csrf is not None and not secrets.compare_digest(csrf, session['csrf']):
                raise Failure(403, 'Please reload this page before trying again.')
            return sid, dict(session)

    def owner_limits(self, token):
        status, user = self.native.call('GET', '/users/owner', token=token)
        if status != 200:
            raise Failure(502, 'Could not verify the owner account. No invitation was created.')
        keys = ['max_sessions', 'quota_size', 'quota_files', 'upload_bandwidth', 'download_bandwidth',
                'upload_data_transfer', 'download_data_transfer', 'total_data_transfer', 'expiration_date']
        return {'unlimited': all(not user.get(k, 0) for k in keys) and not user.get('filters', {}).get('max_upload_file_size', 0),
                'mfa_required': 'HTTP' in user.get('filters', {}).get('two_factor_protocols', []),
                'mfa_enrolled': bool(user.get('filters', {}).get('totp_config', {}).get('enabled'))}

    def unlimit_owner(self, token):
        status, user = self.native.call('GET', '/users/owner', token=token)
        if status != 200 or user.get('home_dir', '').casefold() != str(self.home_base / 'owner').casefold():
            raise Failure(409, 'The owner home does not match the expected private folder. No changes were made.')
        before_mfa = bool(user.get('filters', {}).get('totp_config', {}).get('enabled'))
        for key in ['max_sessions', 'quota_size', 'quota_files', 'upload_bandwidth', 'download_bandwidth',
                    'upload_data_transfer', 'download_data_transfer', 'total_data_transfer', 'expiration_date']:
            user[key] = 0
        user.setdefault('filters', {})['max_upload_file_size'] = 0
        user['filters']['bandwidth_limits'] = []
        status, _ = self.native.call('PUT', '/users/owner', user, token=token)
        if status != 200:
            raise Failure(502, 'The owner limits could not be updated.')
        result = self.owner_limits(token)
        if not result['unlimited'] or (before_mfa and not result['mfa_enrolled']) or not result['mfa_required']:
            raise Failure(502, 'The owner update needs administrator review.')
        return result

    def create(self, values, admin_token):
        username = str(values.get('username', '')).strip().lower()
        if not re.fullmatch(r'[a-z][a-z0-9_-]{2,31}', username) or username in ('owner', 'admin', 'ygg-admin'):
            raise Failure(400, 'Choose a new username: 3–32 lowercase letters, numbers, dashes, or underscores; start with a letter.')
        try:
            quota, hours = int(values.get('quota_gib', 100)), int(values.get('hours', 168))
        except (TypeError, ValueError):
            raise Failure(400, 'Choose a valid storage quota and invitation lifetime.')
        if not 0 <= quota <= 100000 or hours not in (1, 24, 168, 336):
            raise Failure(400, 'Choose a supported quota and invitation lifetime.')
        status, _ = self.native.call('GET', '/users/' + quote(username), token=admin_token)
        if status != 404:
            raise Failure(409, 'That username is already in use or could not be checked. Existing accounts are never replaced.')
        invite_id, raw_token, temporary = uuid.uuid4().hex, secrets.token_urlsafe(32), secrets.token_urlsafe(48)
        home = str(self.home_base / ('u_' + invite_id))
        now = int(time.time())
        encrypted = protect(temporary)
        with self.store.connect() as db:
            if db.execute('SELECT 1 FROM invitations WHERE username=?', (username,)).fetchone():
                raise Failure(409, 'An invitation already exists for this username. Use another username or manage the existing account.')
            db.execute('BEGIN IMMEDIATE')
            user = {'status': 1, 'username': username, 'password': temporary, 'home_dir': home,
                    'description': 'YggShare invitation ' + invite_id, 'max_sessions': 5,
                    'quota_size': quota * GIB, 'quota_files': 0, 'permissions': {'/': USER_PERMISSIONS},
                    'virtual_folders': [], 'filters': {'denied_protocols': ['SSH', 'FTP', 'DAV'],
                    'web_client': ['shares-disabled'], 'allow_api_key_auth': False,
                    'two_factor_protocols': ['HTTP'], 'require_password_change': True, 'max_upload_file_size': 0}}
            status, _ = self.native.call('POST', '/users', user, token=admin_token)
            if status != 201:
                raise Failure(502, 'YggShare could not create the account. Please check the administrator session and try again.')
            if self.features_enabled:
                # Add the isolated read-only mount before the account is used.
                features.recovery_mapping(self.native, admin_token, user, self.home_base)
                user.pop('password', None)
                status, _ = self.native.call('PUT', '/users/' + quote(username), user, token=admin_token)
                if status != 200:
                    raise Failure(502, 'The new account needs recovery-folder configuration. Review it in administration.')
            db.execute('INSERT INTO invitations (id,token_hash,username,home,quota_gib,created,expires,state,secret,claimed) VALUES (?,?,?,?,?,?,?,?,?,NULL)',
                       (invite_id, hashlib.sha256(raw_token.encode()).hexdigest(), username, home,
                        quota, now, now + hours * 3600, 'pending', encrypted))
        self.setup_features(admin_token)
        self.audit('invite-created', username)
        return {'id': invite_id, 'username': username, 'expires': now + hours * 3600,
                'url': self.public_origin + '/join#' + raw_token}

    def info(self, raw_token):
        if not isinstance(raw_token, str) or not re.fullmatch(r'[A-Za-z0-9_-]{43}', raw_token):
            raise Failure(410, 'This invitation is unavailable, expired, or already used. Ask your inviter for help.')
        with self.store.connect() as db:
            row = db.execute('SELECT * FROM invitations WHERE token_hash=?',
                             (hashlib.sha256(raw_token.encode()).hexdigest(),)).fetchone()
        if not row or row['state'] != 'pending' or row['expires'] <= time.time():
            raise Failure(410, 'This invitation is unavailable, expired, or already used. Ask your inviter for help.')
        otp_required = False
        if row['purpose'] == 'recovery':
            otp_required = True  # Claim can retry without it only when native MFA has been reset.
        return {'username': row['username'], 'quota_gib': row['quota_gib'], 'expires': row['expires'],
                'purpose': row['purpose'], 'authenticator_prompt': otp_required}

    def claim(self, values):
        raw_token, password = values.get('token'), values.get('password')
        self.info(raw_token)
        if not isinstance(password, str) or not 12 <= len(password) <= 256 or password != values.get('confirm'):
            raise Failure(400, 'Use a password or passphrase of 12–256 characters and enter it twice.')
        with self.store.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            row = db.execute('SELECT * FROM invitations WHERE token_hash=?',
                             (hashlib.sha256(raw_token.encode()).hexdigest(),)).fetchone()
            if not row or row['state'] != 'pending' or row['expires'] <= time.time():
                raise Failure(410, 'This invitation is unavailable, expired, or already used.')
            temporary = unprotect(row['secret'])
            status, result = self.native.call('GET', '/user/token', basic=(row['username'], temporary), otp=values.get('otp', ''))
            if status != 200:
                if row['purpose'] == 'recovery' and status in (401, 403):
                    raise Failure(401, 'Check your current authenticator code. If your authenticator was lost, ask your administrator for an authenticator-reset recovery link.')
                if status in (401, 403):
                    db.execute("UPDATE invitations SET state='needs-help',secret=NULL WHERE id=?", (row['id'],))
                    db.commit()
                raise Failure(409, 'This invitation cannot complete. If you already set a password, try signing in; otherwise contact your inviter.')
            user_token = result['access_token']
            status, _ = self.native.call('PUT', '/user/changepwd',
                                        {'current_password': temporary, 'new_password': password}, token=user_token)
            if status != 200:
                raise Failure(400, 'YggShare did not accept that password. Try a stronger, longer passphrase.')
            db.execute("UPDATE invitations SET state='claimed',secret=NULL,claimed=? WHERE id=?",
                       (int(time.time()), row['id']))
        return {'username': row['username'], 'login_url': self.public_origin + '/web/client/login'}

    def revoke(self, invite_id):
        with self.store.connect() as db:
            db.execute("UPDATE invitations SET state='revoked',secret=NULL WHERE id=? AND state='pending'", (invite_id,))

    def user(self, username, token):
        if not isinstance(username, str) or not re.fullmatch(r'[a-z][a-z0-9_-]{2,31}', username):
            raise Failure(400, 'Choose a valid file-account username.')
        status, user = self.native.call('GET', '/users/' + quote(username), token=token)
        if status != 200 or not features.managed_home(user, self.home_base):
            raise Failure(404, 'This is not a YggShare-managed file account.')
        return user

    def users(self, token):
        output, offset = [], 0
        while True:
            status, batch = self.native.call('GET', '/users?limit=100&offset=' + str(offset), token=token)
            if status != 200 or not isinstance(batch, list):
                raise Failure(502, 'The account list could not be loaded.')
            for user in batch:
                if features.managed_home(user, self.home_base):
                    output.append({key: user.get(key, 0) for key in
                        ('username', 'status', 'quota_size', 'used_quota_size', 'used_quota_files', 'last_login')})
            if len(batch) < 100:
                return output
            offset += 100

    def update_account(self, values, token):
        username = values.get('username')
        with self.feature_lock:
            user = self.user(username, token)
            action = values.get('action')
            if action == 'quota':
                try:
                    quota = int(values.get('quota_gib'))
                except (ValueError, TypeError):
                    raise Failure(400, 'Enter a whole-number storage quota.')
                if username == 'owner' or not 0 <= quota <= 100000:
                    raise Failure(400, 'Owner stays unlimited. Other quotas must be between 0 and 100000 GiB.')
                user['quota_size'] = quota * GIB
            elif action in ('disable', 'enable'):
                if username == 'owner':
                    raise Failure(400, 'Keep the owner account enabled; use native administration for an exceptional change.')
                user['status'] = 0 if action == 'disable' else 1
            elif action != 'revoke-sessions':
                raise Failure(400, 'Choose a supported account action.')
            user.pop('password', None)
            # Native disconnect clears active transfers and invalidates web sessions.
            status, _ = self.native.call('PUT', '/users/' + quote(username) + '?disconnect=1', user, token=token)
            if status != 200:
                raise Failure(502, 'The account update did not complete.')
            if action == 'quota':
                with self.store.connect() as db:
                    db.execute('UPDATE invitations SET quota_gib=? WHERE username=?', (quota, username))
            self.audit(action, username)
        return {'ok': True}

    def replace_link(self, values, token, recovery=False):
        username = values.get('username')
        if values.get('confirm_username') != username:
            raise Failure(400, 'Type the username again to confirm this action.')
        with self.feature_lock, self.store.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            user = self.user(username, token)
            row = db.execute('SELECT * FROM invitations WHERE username=?', (username,)).fetchone()
            if not recovery:
                if not row or row['purpose'] != 'invite' or row['claimed'] is not None or row['state'] not in ('pending', 'revoked'):
                    raise Failure(409, 'Only an unused invitation can be reissued. Use account recovery for an activated account.')
                if user.get('filters', {}).get('totp_config', {}).get('enabled') or not user.get('filters', {}).get('require_password_change'):
                    raise Failure(409, 'This person has already begun account setup. Use account recovery instead.')
            elif user.get('status') != 1:
                raise Failure(409, 'Enable this account before creating a recovery link.')
            temporary, raw = secrets.token_urlsafe(48), secrets.token_urlsafe(32)
            encrypted = protect(temporary)
            user['password'] = temporary
            user.setdefault('filters', {})['require_password_change'] = True
            protocols = user['filters'].setdefault('two_factor_protocols', [])
            if 'HTTP' not in protocols:
                protocols.append('HTTP')
            status, _ = self.native.call('PUT', '/users/' + quote(username) + '?disconnect=1', user, token=token)
            if status != 200:
                raise Failure(502, 'The account could not be prepared. No link was issued.')
            if recovery and values.get('reset_mfa') is True:
                status, _ = self.native.call('PUT', '/users/' + quote(username) + '/2fa/disable', token=token)
                if status != 200:
                    raise Failure(502, 'Authenticator reset did not complete. Review this account in native administration.')
            now, invite_id = int(time.time()), row['id'] if row else uuid.uuid4().hex
            db.execute('''INSERT INTO invitations (id,token_hash,username,home,quota_gib,created,expires,state,secret,claimed,purpose)
                VALUES (?,?,?,?,?,?,?,'pending',?,NULL,?) ON CONFLICT(username) DO UPDATE SET
                token_hash=excluded.token_hash,quota_gib=excluded.quota_gib,created=excluded.created,
                expires=excluded.expires,state='pending',secret=excluded.secret,claimed=NULL,purpose=excluded.purpose''',
                (invite_id, hashlib.sha256(raw.encode()).hexdigest(), username, user['home_dir'], user.get('quota_size', 0)//GIB,
                 now, now + (3600 if recovery else 168*3600), encrypted, 'recovery' if recovery else 'invite'))
        self.audit('recovery-reset-mfa' if recovery and values.get('reset_mfa') else 'recovery' if recovery else 'invite-reissued', username)
        return {'url': self.public_origin + '/join#' + raw, 'username': username, 'expires': now + (3600 if recovery else 168*3600)}


class Server(ThreadingHTTPServer):
    daemon_threads = True
    request_queue_size = 16

    def __init__(self, address, app, mode):
        self.app, self.mode = app, mode
        self.capacity = threading.BoundedSemaphore(12)
        super().__init__(address, Handler)

    def process_request(self, request, address):
        if not self.capacity.acquire(blocking=False):
            request.close()
            return
        try:
            super().process_request(request, address)
        except Exception:
            self.capacity.release()
            raise

    def process_request_thread(self, request, address):
        try:
            super().process_request_thread(request, address)
        finally:
            self.capacity.release()


class Handler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    server_version = 'YggShare'
    sys_version = ''

    def setup(self):
        super().setup()
        self.connection.settimeout(15)

    def log_message(self, *_):
        pass  # Request bodies, credentials, bearer links and query strings are never logged.

    def respond(self, status, data, kind='application/json', cookie=None, head=False):
        # Each helper request owns its connection. In particular, an early Host
        # or Origin rejection must not leave an unread body to be parsed as a
        # second HTTP request on the same socket.
        self.close_connection = True
        if kind == 'application/json':
            data = json.dumps(data).encode()
        self.send_response(status)
        self.send_header('Content-Type', kind + ('; charset=utf-8' if not kind.startswith('image/') else ''))
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Connection', 'close')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Referrer-Policy', 'no-referrer')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'")
        if self.server.mode == 'public' and self.headers.get('X-Forwarded-Proto') == 'https':
            self.send_header('Strict-Transport-Security', 'max-age=15552000')
        if cookie:
            self.send_header('Set-Cookie', cookie)
        self.end_headers()
        if not head:
            self.wfile.write(data)

    def host_origin(self, require_origin=False):
        port = self.server.server_port
        if self.server.mode == 'admin':
            allowed = {'127.0.0.1:' + str(port), 'localhost:' + str(port)}
            origins = {'http://' + host for host in allowed}
        else:
            public = self.server.app.public_origin
            allowed = {urlsplit(public).netloc, '127.0.0.1:' + str(port), 'localhost:' + str(port)}
            origins = {public}
        if self.headers.get('Host') not in allowed:
            raise Failure(403, 'This host is not available.')
        if require_origin and self.headers.get('Origin') not in origins:
            raise Failure(403, 'Open the invitation page in your browser and try again.')

    def client_key(self):
        address = self.client_address[0]
        if self.server.mode == 'public' and address == '127.0.0.1':
            candidate = self.headers.get('X-Forwarded-For', '').split(',')[-1].strip()
            try:
                address = str(ipaddress.ip_address(candidate))
            except ValueError:
                pass
        return address

    def do_HEAD(self):
        self.get(True)

    def do_GET(self):
        self.get(False)

    def get(self, head):
        try:
            self.host_origin()
            path = urlsplit(self.path).path
            if self.server.mode == 'admin' and path == '/api/session':
                _, session = self.server.app.session(self.headers.get('Cookie'))
                self.respond(200, {'csrf': session['csrf'], 'owner': self.server.app.owner_limits(session['token']),
                                   'invitations': self.server.app.store.listed(),
                                   'users': self.server.app.users(session['token']),
                                   'health': self.server.app.monitor.current()}, head=head)
                return
            if (self.server.mode == 'admin' and path == '/') or (self.server.mode == 'public' and path in ('/join', '/join/')):
                name = 'admin.html' if self.server.mode == 'admin' else 'join.html'
                self.respond(200, (HERE / name).read_bytes(), 'text/html', head=head)
                return
            prefix = '/assets/' if self.server.mode == 'admin' else '/join/assets/'
            if path.startswith(prefix):
                name = path[len(prefix):]
                allowed = {'style.css': 'text/css', 'admin.js': 'application/javascript', 'manager.js': 'application/javascript', 'join.js': 'application/javascript',
                           'ygg-mark.svg': 'image/svg+xml', 'ygg-guardian-v2.png': 'image/png'}
                if name in allowed:
                    self.respond(200, (HERE / 'assets' / name).read_bytes(), allowed[name], head=head)
                    return
            raise Failure(404, 'This page is not available.')
        except Failure as error:
            self.respond(error.status, {'error': error.message}, head=head)
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception:
            self.respond(503, {'error': 'YggShare is temporarily unavailable. Please try again.'}, head=head)

    def do_POST(self):
        try:
            self.host_origin(True)
            if self.headers.get('Content-Type', '').split(';')[0] != 'application/json':
                raise Failure(415, 'Send this form from the YggShare page.')
            size = int(self.headers.get('Content-Length', '0'))
            if size < 2 or size > 8192:
                self.close_connection = True
                raise Failure(413, 'This request is too large.')
            try:
                values = json.loads(self.rfile.read(size))
            except (ValueError, UnicodeError):
                raise Failure(400, 'The request could not be read.')
            if not isinstance(values, dict):
                raise Failure(400, 'The request could not be read.')
            path, app = urlsplit(self.path).path, self.server.app
            if self.server.mode == 'admin':
                if path == '/api/login':
                    app.throttle('admin-login:' + self.client_key(), 6, 60)
                    sid, result = app.login(values)
                    self.respond(200, result, cookie='ygg_invite_admin=' + sid + '; HttpOnly; SameSite=Strict; Path=/; Max-Age=600')
                    return
                sid, session = app.session(self.headers.get('Cookie'), self.headers.get('X-Ygg-CSRF', ''))
                if path == '/api/logout':
                    with app.lock:
                        app.sessions.pop(sid, None)
                    try:
                        app.native.call('GET', '/logout', token=session['token'])
                    except OSError:
                        pass
                    self.respond(200, {'ok': True}, cookie='ygg_invite_admin=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0')
                    return
                if path == '/api/invites':
                    self.respond(201, app.create(values, session['token']))
                    return
                if path == '/api/revoke':
                    app.revoke(str(values.get('id', '')))
                    self.respond(200, {'ok': True})
                    return
                if path in ('/api/reissue', '/api/recovery'):
                    self.respond(200, app.replace_link(values, session['token'], path.endswith('/recovery')))
                    return
                if path == '/api/account':
                    self.respond(200, app.update_account(values, session['token']))
                    return
            elif path in ('/join/api/info', '/join/api/claim'):
                app.throttle('public:' + self.client_key(), 12, 60)
                result = app.info(values.get('token')) if path.endswith('/info') else app.claim(values)
                self.respond(200, result)
                return
            raise Failure(404, 'This action is not available.')
        except Failure as error:
            self.respond(error.status, {'error': error.message})
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception:
            self.respond(503, {'error': 'YggShare could not complete that request. Please try again or contact your inviter.'})


def run():
    parser = argparse.ArgumentParser()
    parser.add_argument('--data', type=Path, required=True)
    parser.add_argument('--native-port', type=int, default=8081)
    parser.add_argument('--admin-port', type=int, default=8091)
    parser.add_argument('--public-port', type=int, default=8090)
    parser.add_argument('--home-base', type=Path, required=True)
    parser.add_argument('--public-origin', required=True)
    parser.add_argument('--admin-username', default='ygg-admin')
    parser.add_argument('--unlimit-owner', action='store_true', help='Explicitly remove owner account limits at first admin login')
    parser.add_argument('--enable-recovery', action='store_true', help='Enable Windows-only recovery hook provisioning')
    parser.add_argument('--monitor', action='store_true', help='Enable network and disk health checks')
    args = parser.parse_args()
    args.data.mkdir(exist_ok=True, parents=True)
    parsed = urlsplit(args.public_origin)
    if parsed.scheme != 'https' or not parsed.hostname or parsed.path or parsed.query or parsed.fragment or parsed.username or parsed.password:
        parser.error('--public-origin must be an exact HTTPS origin')
    app = App(args.data, args.native_port, args.home_base, args.public_origin, auto_unlimit=args.unlimit_owner, enable_features=args.enable_recovery, admin_username=args.admin_username)
    app.monitor.hostname = parsed.hostname
    app.monitor.address = '127.0.0.1'
    admin = Server(('127.0.0.1', args.admin_port), app, 'admin')
    public = Server(('127.0.0.1', args.public_port), app, 'public')
    if args.monitor:
        threading.Thread(target=app.monitor.run, daemon=True).start()
    threading.Thread(target=admin.serve_forever, daemon=True).start()
    public.serve_forever()


if __name__ == '__main__':
    run()

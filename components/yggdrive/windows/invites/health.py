"""Credential-free local health checks, change alerts and bounded history."""
import ctypes
import http.client
import json
from pathlib import Path
import shutil
import socket
import ssl
import threading
import time
import urllib.request


def capacity(total, free):
    if free < 5 * 1024**3 or free / total < .03:
        return 'critical'
    if free < 20 * 1024**3 or free / total < .10:
        return 'warning'
    return 'ok'


def event_log(message, severity):
    try:
        api = ctypes.windll.advapi32
        api.RegisterEventSourceW.argtypes = [ctypes.c_wchar_p, ctypes.c_wchar_p]
        api.RegisterEventSourceW.restype = ctypes.c_void_p
        handle = api.RegisterEventSourceW(None, 'YggShare')
        if handle:
            strings = (ctypes.c_wchar_p * 1)(message)
            api.ReportEventW.argtypes = [ctypes.c_void_p, ctypes.c_ushort, ctypes.c_ushort,
                ctypes.c_ulong, ctypes.c_void_p, ctypes.c_ushort, ctypes.c_ulong, ctypes.c_void_p, ctypes.c_void_p]
            api.ReportEventW(handle, 1 if severity == 'critical' else 2 if severity == 'warning' else 4,
                             0, 1001, None, 1, 0, strings, None)
            api.DeregisterEventSource.argtypes = [ctypes.c_void_p]
            api.DeregisterEventSource(handle)
    except Exception:
        pass  # The private dashboard/history remains available if event logging is restricted.


class Monitor:
    def __init__(self, store, volume=Path('S:/'), hostname='drive.example.test', address='127.0.0.1'):
        self.store, self.volume, self.hostname, self.address = store, volume, hostname, address
        self.stop = threading.Event()
        self.wan = None
        self.last_wan = 0
        with store.connect() as db:
            db.execute('CREATE TABLE IF NOT EXISTS health_events (created INTEGER, severity TEXT, message TEXT)')
            db.execute('CREATE TABLE IF NOT EXISTS health_state (id INTEGER PRIMARY KEY CHECK(id=1), body TEXT)')

    def sample(self):
        checks = []
        def add(name, state, detail):
            checks.append({'name': name, 'state': state, 'detail': detail})
        try:
            usage = shutil.disk_usage(self.volume)
            add('Drive capacity', capacity(usage.total, usage.free),
                f'{usage.free / 1024**3:.1f} GiB free of {usage.total / 1024**3:.1f} GiB')
        except OSError:
            add('Drive capacity', 'critical', 'Drive volume is unavailable or inaccessible.')
        for name, port, path in [('File service', 8080, '/web/client/login'), ('Invitation service', 8090, '/join')]:
            conn = http.client.HTTPConnection('127.0.0.1', port, timeout=5)
            try:
                conn.request('GET', path)
                response = conn.getresponse()
                response.read(1024)
                add(name, 'ok' if response.status == 200 else 'critical', 'HTTP ' + str(response.status))
            except OSError:
                add(name, 'critical', 'The local service did not respond.')
            finally:
                conn.close()
        try:
            # Explicit SNI validates the hostname while connecting to the server directly.
            with socket.create_connection((self.address, 443), timeout=8) as raw:
                with ssl.create_default_context().wrap_socket(raw, server_hostname=self.hostname) as secured:
                    expiry = ssl.cert_time_to_seconds(secured.getpeercert()['notAfter'])
                    days = int((expiry - time.time()) / 86400)
            add('HTTPS certificate', 'critical' if days < 7 else 'warning' if days < 21 else 'ok',
                f'Trusted certificate; {days} days remaining. Checked locally, not from the Internet.')
        except (OSError, ValueError):
            add('HTTPS certificate', 'critical', 'Local HTTPS connection or certificate validation failed.')
        if time.time() - self.last_wan >= 3600:
            self.last_wan = time.time()
            try:
                with urllib.request.urlopen('https://api.ipify.org', timeout=6) as response:
                    import ipaddress
                    self.wan = str(ipaddress.IPv4Address(response.read(64).decode().strip()))
            except Exception:
                self.wan = None
        try:
            ips = sorted({v[4][0] for v in socket.getaddrinfo(self.hostname, 443, socket.AF_INET)})
            if self.wan:
                add('Public DNS', 'ok' if self.wan in ips else 'critical',
                    'DNS matches the observed WAN address.' if self.wan in ips else 'DNS differs from the observed WAN address; update the drive A record.')
            else:
                add('Public DNS', 'warning', 'DNS resolves; the WAN comparison is temporarily unavailable.')
        except OSError:
            add('Public DNS', 'critical', 'The drive hostname could not be resolved.')
        add('Automatic DNS updates', 'pending', 'Not enabled: a scoped Cloudflare DNS API token is needed.')
        add('External notifications', 'pending', 'Not configured. Alerts appear here and in the Windows Application event log.')
        return {'checked': int(time.time()), 'checks': checks,
                'scope': 'Local probes do not prove router, ISP or cellular reachability.'}

    def save(self, result):
        with self.store.connect() as db:
            previous = db.execute('SELECT body FROM health_state WHERE id=1').fetchone()
            old = {c['name']: c['state'] for c in json.loads(previous[0])['checks']} if previous else {}
            for check in result['checks']:
                if check['state'] == 'pending':
                    continue
                before = old.get(check['name'])
                if before != check['state'] and (before is not None or check['state'] != 'ok'):
                    message = check['name'] + ': ' + check['state'] + '. ' + check['detail']
                    db.execute('INSERT INTO health_events VALUES (?,?,?)', (result['checked'], check['state'], message))
                    event_log(message, check['state'])
            db.execute('INSERT OR REPLACE INTO health_state VALUES (1,?)', (json.dumps(result),))
            db.execute('DELETE FROM health_events WHERE rowid NOT IN (SELECT rowid FROM health_events ORDER BY rowid DESC LIMIT 200)')

    def current(self):
        with self.store.connect() as db:
            row = db.execute('SELECT body FROM health_state WHERE id=1').fetchone()
            events = [dict(r) for r in db.execute('SELECT * FROM health_events ORDER BY rowid DESC LIMIT 20')]
        result = json.loads(row[0]) if row else {'checked': None, 'checks': []}
        result['events'] = events
        result['stale'] = not result['checked'] or time.time() - result['checked'] > 180
        watchdog_path = Path(r'C:\ProgramData\YggShare\Operations\watchdog.json')
        try:
            watchdog = json.loads(watchdog_path.read_text(encoding='utf-8-sig'))
            checked = int(watchdog['checked'])
            result['checks'].append({'name': 'Independent watchdog',
                'state': 'warning' if time.time()-checked > 900 or watchdog.get('issues') else 'ok',
                'detail': 'Recent local watchdog check; ' + str(len(watchdog.get('issues', []))) + ' issue(s).'
                    if time.time()-checked <= 900 else 'No watchdog check in the last 15 minutes.'})
        except (OSError, ValueError, KeyError):
            result['checks'].append({'name': 'Independent watchdog', 'state': 'pending', 'detail': 'Waiting for its first installed check.'})
        return result

    def run(self):
        while not self.stop.is_set():
            try:
                self.save(self.sample())
            except Exception:
                event_log('YggShare health checks could not complete; check the private manager.', 'warning')
            self.stop.wait(60)

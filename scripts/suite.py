"""Manage one independently deployed home or storage role. Python 3.12+, stdlib only."""
import argparse
import getpass
import html
import json
import os
from pathlib import Path
import re
import subprocess
import sys
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]


def web_url(value):
    parsed = urlsplit(value)
    try:
        port = parsed.port
    except ValueError as error:
        raise ValueError('Invalid URL port') from error
    if (parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password
            or parsed.path not in ('', '/') or parsed.query or parsed.fragment
            or any(c in value for c in '\r\n\t') or port == 0):
        raise ValueError('App addresses must be HTTPS origins without credentials, paths or queries')
    if not re.fullmatch(r'[a-zA-Z0-9.-]+', parsed.hostname):
        raise ValueError('Use a DNS hostname for each app')
    return value.rstrip('/')


def generate(state, args):
    target = state / 'settings.json'
    if target.exists():
        raise ValueError('This role is already configured; existing configuration was preserved')
    components = args.components or (['mail', 'aring'] if args.role == 'home' else ['yggdrive'])
    allowed = {'home': {'mail', 'aring'}, 'storage': {'yggdrive'}}[args.role]
    if not set(components) <= allowed:
        raise ValueError('Home supports mail/aring; storage supports yggdrive')
    offset = getattr(args, 'port_offset', 0)
    if not 0 <= offset <= 50000:
        raise ValueError('Port offset must be between 0 and 50000')
    urls = {name: web_url(value) for name, value in
            [('mail', args.mail_url), ('aring', args.calendar_url), ('yggdrive', args.drive_url)] if value}
    if any(name not in urls for name in components):
        raise ValueError('Supply an HTTPS URL for every enabled app')
    settings = {'version': 1, 'role': args.role, 'components': sorted(set(components)),
                'project': args.project or 'selfhost-' + args.role, 'urls': urls}
    if not re.fullmatch(r'[a-z0-9][a-z0-9_-]{0,47}', settings['project']):
        raise ValueError('Project name must be lowercase letters, numbers, underscores or hyphens')
    services = {}
    volumes = {}
    networks = {}
    if 'aring' in components:
        services['aring'] = {'extends': {'file': str(ROOT / 'compose.yaml'), 'service': 'aring'},
                             'environment': {'ARING_ORIGIN': urls['aring']}}
        volumes['aring-data'] = {}
    if 'mail' in components:
        for name in ('mail-php', 'mail-web'):
            services[name] = {'extends': {'file': str(ROOT / 'compose.mail.yaml'), 'service': name}}
        volumes['mail-state'] = {}
        networks['mail'] = {}
    if 'yggdrive' in components:
        if not args.drive_path:
            raise ValueError('Storage requires --drive-path to an existing dedicated directory')
        content = Path(args.drive_path).expanduser().resolve(strict=True)
        if not content.is_dir() or content == Path(content.anchor):
            raise ValueError('Drive path must be a dedicated directory, not a disk root')
        if content == ROOT or content in ROOT.parents or ROOT in content.parents:
            raise ValueError('Drive content must live outside the source checkout')
        settings['drive_path'] = str(content)
        config_dir = state / 'drive'
        config_dir.mkdir(parents=True, exist_ok=False)
        # Reuse the same reviewed configuration defaults without copying logic.
        # configure.py is a CLI, so run it in an isolated staging copy.
        import tempfile
        import shutil
        with tempfile.TemporaryDirectory(prefix='suite-config-', dir=state) as temporary:
            staging = Path(temporary)
            (staging / 'scripts').mkdir()
            shutil.copyfile(ROOT / 'scripts/configure.py', staging / 'scripts/configure.py')
            subprocess.run([sys.executable, str(staging / 'scripts/configure.py'), '--components', 'yggdrive',
                            '--drive-host', urlsplit(urls['yggdrive']).hostname], check=True, capture_output=True)
            shutil.copyfile(staging / 'runtime/yggdrive/sftpgo.json', config_dir / 'sftpgo.json')
        config_dir.chmod(0o755)
        (config_dir / 'sftpgo.json').chmod(0o644)
        services['yggdrive'] = {
            'extends': {'file': str(ROOT / 'compose.yaml'), 'service': 'yggdrive'},
            'volumes': [
                {'type': 'bind', 'source': str(config_dir), 'target': '/etc/suite', 'read_only': True,
                 'bind': {'create_host_path': False}},
                {'type': 'bind', 'source': str(content), 'target': '/srv/sftpgo',
                 'bind': {'create_host_path': False}}]}
        volumes['yggdrive-state'] = {}
    compose = {'name': settings['project'], 'services': services, 'volumes': volumes}
    if networks:
        compose['networks'] = networks
    with (state / 'compose.env').open('x', encoding='utf-8', newline='\n') as stream:
        for name, port in [('CALENDAR', 4387), ('DRIVE', 8080), ('DRIVE_ADMIN', 8081),
                           ('MAIL', 8089), ('MAIL_ADMIN', 8088)]:
            stream.write(f'SUITE_{name}_PORT={port + offset}\n')
    write_json(state / 'compose.json', compose)
    write_json(target, settings)
    links = '\n'.join('<li><a href="' + html.escape(url, quote=True) + '">' + html.escape(name) + '</a></li>'
                      for name, url in urls.items())
    (state / 'apps.html').write_text('<!doctype html><meta charset="utf-8"><title>Family apps</title>'
                                    '<h1>Family apps</h1><ul>' + links + '</ul>', encoding='utf-8')
    print('Configured ' + args.role + ': ' + ', '.join(settings['components']))
    print('No services started. Review generated configuration, then run check and start.')


def write_json(path, value):
    with path.open('x', encoding='utf-8', newline='\n') as stream:
        json.dump(value, stream, indent=2)
        stream.write('\n')


def compose_command(state, settings):
    # Explicit project directory/env file prevents an unrelated working directory
    # or legacy checkout .env from silently changing role configuration.
    env_file = state / 'compose.env'
    if not env_file.exists():
        env_file.touch(mode=0o600, exist_ok=False)
    return ['docker', 'compose', '--project-directory', str(ROOT), '--env-file', str(env_file),
            '-p', settings['project'], '-f', str(state / 'compose.json'), '--profile', '*']


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--state-dir', type=Path, default=ROOT / 'runtime/suite')
    commands = parser.add_subparsers(dest='command', required=True)
    setup = commands.add_parser('setup')
    setup.add_argument('--role', choices=['home', 'storage'], required=True)
    setup.add_argument('--components', nargs='+', choices=['mail', 'aring', 'yggdrive'])
    setup.add_argument('--mail-url')
    setup.add_argument('--calendar-url')
    setup.add_argument('--drive-url')
    setup.add_argument('--drive-path')
    setup.add_argument('--project', help='Separate Compose project; use unique names for sandboxes')
    setup.add_argument('--port-offset', type=int, default=0, help='Optional loopback port offset for isolated tests')
    for name in ['check', 'start', 'stop', 'status', 'logs', 'update']:
        commands.add_parser(name)
    account = commands.add_parser('account', help='Create an Aring user with a private password prompt')
    account.add_argument('email')
    account.add_argument('display_name')
    args = parser.parse_args(argv)
    os.umask(0o077)
    state = args.state_dir.resolve()
    try:
        if args.command == 'setup':
            state.mkdir(parents=True, exist_ok=True)
            generate(state, args)
            return 0
        settings = json.loads((state / 'settings.json').read_text(encoding='utf-8'))
        cmd = compose_command(state, settings)
        if args.command == 'check':
            subprocess.run(cmd + ['config', '--quiet'], check=True)
            print('Compose configuration valid; this is not a runtime or HTTPS check.')
        elif args.command == 'start':
            subprocess.run(cmd + ['up', '-d', '--build', '--wait', '--wait-timeout', '180'], check=True)
        elif args.command == 'update':
            print('Take and verify role-specific backups before updating. Package floors do not replace advisory review.')
            subprocess.run(cmd + ['build', '--pull', '--no-cache'], check=True)
            subprocess.run(cmd + ['up', '-d', '--force-recreate', '--wait', '--wait-timeout', '180'], check=True)
        elif args.command == 'account':
            if 'aring' not in settings['components']:
                raise ValueError('This role does not run Aring')
            password = getpass.getpass('New calendar password (14–512 characters): ')
            if not 14 <= len(password) <= 512 or password != getpass.getpass('Repeat password: '):
                raise ValueError('Passwords must match and contain 14–512 characters')
            try:
                subprocess.run(cmd + ['exec', '-T', 'aring', 'node', 'scripts/account.mjs', args.email,
                                      args.display_name], input=password, text=True, encoding='utf-8', check=True)
            finally:
                password = ''
        else:
            action = {'stop': ['stop'], 'status': ['ps'], 'logs': ['logs', '--tail', '100']}[args.command]
            subprocess.run(cmd + action, check=True)
        if args.command in ('check', 'start', 'status'):
            for name, url in settings['urls'].items():
                print(name + ': ' + url)
        return 0
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        print('suite: ' + str(error), file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())

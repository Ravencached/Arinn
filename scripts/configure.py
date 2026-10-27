"""Generate non-secret local configuration without changing host services."""
import argparse
import json
import os
from pathlib import Path
from urllib.parse import urlsplit

ROOT=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--components',nargs='+',choices=['aring','yggdrive'],default=['aring','yggdrive'])
parser.add_argument('--calendar-origin',default='http://127.0.0.1:4387')
parser.add_argument('--drive-host',default='drive.example.test')
args=parser.parse_args()
origin=urlsplit(args.calendar_origin)
if (origin.scheme not in ('http','https') or not origin.hostname or origin.username or origin.password
    or origin.path or origin.query or origin.fragment
    or (origin.scheme=='http' and origin.hostname not in ('127.0.0.1','localhost'))):
    parser.error('Calendar origin must be exact HTTPS, or HTTP on loopback; omit a trailing slash')
import re
if not re.fullmatch(r'(?=.{1,253}$)[a-z0-9]+(?:[a-z0-9.-]*[a-z0-9])?',args.drive_host):
    parser.error('Drive hostname must contain only lowercase DNS hostname characters')
os.umask(0o077)
if not (ROOT/'.env').exists():
    with (ROOT/'.env').open('x',encoding='utf-8',newline='\n') as file:
        file.write('ARING_ORIGIN='+args.calendar_origin+'\nNODE_IMAGE=node:24.22.1-bookworm-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205\nSFTPGO_IMAGE=drakkan/sftpgo:v2.7.6@sha256:1edd28d80de2a008863fbfc58c8ff7db47b1b410bae48d4e6076192337809b11\n')
else:
    print('Existing .env preserved; review ARING_ORIGIN there if changing the hostname.')
if 'yggdrive' in args.components:
    folder=ROOT/'runtime/yggdrive';folder.mkdir(parents=True,exist_ok=True,mode=0o700)
    target=folder/'sftpgo.json'
    # No passwords, users, shell hooks or cloud credentials are generated.
    bindings=[]
    for port,admin in [(8080,False),(8081,True)]:
        bindings.append({'port':port,'address':'0.0.0.0','enable_web_admin':admin,
            'enable_web_client':not admin,'enable_rest_api':admin,'render_openapi':False,
            'hide_login_url':3,'security':{'enabled':True,'content_type_nosniff':True,
                'referrer_policy':'no-referrer','cache_control':'private, no-store',
                'allowed_hosts':[f'127.0.0.1:{port}',f'localhost:{port}']+([] if admin else [args.drive_host]),
                'content_security_policy':"base-uri 'self'; form-action 'self'; frame-ancestors 'self'"}})
    config={'common':{'upload_mode':1,'symlink_mode':0,'max_per_host_connections':30,
            'defender':{'enabled':True,'entries_soft_limit':1000,'entries_hard_limit':2000},
            'rate_limiters':[{'average':20,'period':1000,'burst':60,'type':2,'protocols':['HTTP'],
                'generate_defender_events':False,'entries_soft_limit':1000,'entries_hard_limit':2000}]},
        'data_provider':{'driver':'sqlite','name':'/var/lib/sftpgo/sftpgo.db',
            'users_base_dir':'/srv/sftpgo/data/Users','backups_path':'/srv/sftpgo/backups',
            'create_default_admin':False,'track_quota':1,'password_hashing':{'algo':'argon2id'},
            'password_validation':{'admins':{'min_entropy':60},'users':{'min_entropy':60}}},
        'sftpd':{'bindings':[{'port':0}]},'ftpd':{'bindings':[{'port':0}]},
        'webdavd':{'bindings':[{'port':0}]},'telemetry':{'bind_port':0},
        'httpd':{'bindings':bindings,'templates_path':'/usr/share/sftpgo/templates',
            'static_files_path':'/usr/share/sftpgo/static','openapi_path':'',
            'token_validation':2,'cookie_lifetime':30,'jwt_lifetime':20},
        'smtp':{'templates_path':'/usr/share/sftpgo/templates'},
        'mfa':{'totp':[{'name':'YggShare','issuer':'YggShare','algo':'sha1'}]}}
    if target.exists():
        print('Existing runtime/yggdrive/sftpgo.json preserved; edit it deliberately for hostname changes.')
    else:
        with target.open('x',encoding='utf-8',newline='\n') as file:
            json.dump(config,file,indent=2);file.write('\n')
        # Non-secret config must be readable by the container's unprivileged UID.
        folder.chmod(0o755);target.chmod(0o644)
print('Configuration ready. Start only the Compose profiles you need. No services were installed.')

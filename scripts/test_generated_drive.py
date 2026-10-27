"""Check generated drive configuration against an official SFTPGo binary.

Starts a disposable loopback instance, never an installed service. Supply the
executable and its extracted runtime directory (templates/static). No accounts
or credentials are provisioned. Run configure.py first.
"""
import argparse
import http.client
import json
import os
from pathlib import Path
import socket
import subprocess
import tempfile
import time

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--sftpgo',type=Path,required=True)
parser.add_argument('--runtime',type=Path,required=True)
args=parser.parse_args()
root=Path(__file__).resolve().parents[1]
temporary=root/'runtime/tests';temporary.mkdir(parents=True,exist_ok=True)
def unused_port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1',0));return sock.getsockname()[1]
def status(port,path):
    conn=http.client.HTTPConnection('127.0.0.1',port,timeout=2)
    try:
        conn.request('GET',path);response=conn.getresponse();response.read();return response.status
    finally:conn.close()
with tempfile.TemporaryDirectory(prefix='drive-config-',dir=temporary) as folder:
    state=Path(folder)
    config=json.loads((root/'runtime/yggdrive/sftpgo.json').read_text())
    config['data_provider'].update(name=str(state/'provider.sqlite'),users_base_dir=str(state/'files'),backups_path=str(state/'exports'))
    config['httpd'].update(templates_path=str(args.runtime/'templates'),static_files_path=str(args.runtime/'static'))
    config['smtp']['templates_path']=str(args.runtime/'templates')
    ports=[unused_port(),unused_port()]
    while ports[0]==ports[1]:ports[1]=unused_port()
    for binding,port in zip(config['httpd']['bindings'],ports):
        binding.update(address='127.0.0.1',port=port)
        binding['security']['allowed_hosts']=[f'127.0.0.1:{port}']
    (state/'sftpgo.json').write_text(json.dumps(config))
    env={k:v for k,v in os.environ.items() if not k.upper().startswith('SFTPGO_')}
    with (state/'process.log').open('wb') as log:
        process=subprocess.Popen([str(args.sftpgo.resolve()),'serve','--config-dir',str(state),
            '--log-file-path',str(state/'sftpgo.log')],env=env,stdout=log,stderr=log,
            creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
        try:
            for _ in range(60):
                if process.poll() is not None:
                    detail=(state/'process.log').read_text(encoding='utf-8',errors='replace')[-3000:]
                    raise RuntimeError('Fixture exited; no accounts/credentials were loaded. Diagnostic:\n'+detail)
                try:
                    ready_status=status(ports[1],'/web/admin/setup')
                    if ready_status in (200,302):break
                except OSError:pass
                time.sleep(.25)
            else:raise RuntimeError('Fixture did not become ready')
            assert status(ports[0],'/web/admin')==404,'Admin UI exposed on client binding'
            assert status(ports[0],'/api/v2/users')==404,'Admin API exposed on client binding'
            assert status(ports[1],'/web/admin/setup')==200,'Private administrator setup unavailable'
            print('PASS generated configuration: private first-admin setup ready; admin/API absent on client binding; client login status '+str(status(ports[0],'/web/client/login')))
        finally:
            process.terminate();process.wait(timeout=15)

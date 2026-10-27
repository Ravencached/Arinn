"""Invitation end-to-end tests against disposable real SFTPGo accounts only."""
import base64
import concurrent.futures
import importlib.util
import json
import os
from pathlib import Path
import secrets
import subprocess
import sys
import threading
import time
import uuid
from test_sftpgo import request, check, get_token, totp

BASE=Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BASE/'invites'))
spec=importlib.util.spec_from_file_location('ygg_invites', BASE/'invites'/'server.py')
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def main():
    run=BASE/'test-runs'/('invites-'+uuid.uuid4().hex)
    state=run/'native'
    data=run/'invitations'
    content=run/'content'/'Users'
    for p in (state,data,content):p.mkdir(parents=True)
    runtime=Path(os.environ.get('YGGS_RUNTIME_PATH', str(BASE/'runtime'/'sftpgo-2.7.6')))
    cfg=state/'sftpgo.json'
    subprocess.run(['powershell.exe','-NoProfile','-ExecutionPolicy','Bypass','-File',str(BASE/'scripts'/'New-YggShareConfig.ps1'),
        '-RuntimePath',str(runtime),'-StatePath',str(state),'-OutputPath',str(cfg),'-ContentPath',str(content.parent),
        '-ClientPort','18080','-AdminPort','18081','-TestApi'],check=True,stdout=subprocess.DEVNULL)
    config=json.loads(cfg.read_text(encoding='utf-8-sig'))
    config['data_provider']['create_default_admin']=True
    config['common']['rate_limiters']=[]
    config['data_provider']['password_validation']['admins']['min_entropy']=60
    config['data_provider']['password_validation']['users']['min_entropy']=60
    config['httpd']['token_validation']=2
    hook_config=run/'recovery.json'
    hook_config.write_text(json.dumps({'users_root':str(content),'recovery_root':str(content.parent/'Recovery')}))
    (content.parent/'Recovery').mkdir()
    config['common']['actions']={'execute_on':['upload','copy','rename','pre-delete'],'execute_sync':['upload','copy','rename','pre-delete'],'hook':sys.executable}
    config['command']['commands']=[{'path':sys.executable,'hook':'fs_actions','timeout':300,
        'args':['-B',str(BASE/'invites'/'recovery.py'),'--config',str(hook_config)]}]
    cfg.write_text(json.dumps(config))
    admin_pass=secrets.token_urlsafe(32)
    env=os.environ.copy();env['SFTPGO_DEFAULT_ADMIN_USERNAME']='ygg-admin';env['SFTPGO_DEFAULT_ADMIN_PASSWORD']=admin_pass
    log=(run/'process.log').open('wb')
    process=subprocess.Popen([str(runtime/'sftpgo.exe'),'serve','--config-dir',str(state),'--log-file-path',str(run/'native.log'),'--log-level','debug'],env=env,stdout=log,stderr=log,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
    servers=[]
    try:
        for _ in range(80):
            if process.poll() is not None:raise RuntimeError('Native test service exited')
            try:
                status,body,_=request(18081,'GET','/api/v2/token',auth=('ygg-admin',admin_pass))
                if status==200:break
            except OSError:pass
            time.sleep(.2)
        else:raise RuntimeError('Native test service did not start')
        admin=json.loads(body)['access_token']
        owner_pass=secrets.token_urlsafe(32)
        owner={'username':'owner','status':1,'password':owner_pass,'home_dir':str(content/'owner'),
               'quota_size':100*1024**3,'max_sessions':5,'permissions':{'/':['list','download','upload','create_dirs']},
               'filters':{'two_factor_protocols':['HTTP'],'web_client':['shares-disabled']}}
        check(request(18081,'POST','/api/v2/users',owner,token=admin)[0]==201,'create capped test owner')
        _,owner_setup=get_token(18081,'owner',owner_pass)
        _,body,_=request(18081,'POST','/api/v2/user/totp/generate',{'config_name':'YggShare'},token=owner_setup)
        owner_secret=json.loads(body)['secret']
        check(request(18081,'POST','/api/v2/user/totp/validate',{'config_name':'YggShare','secret':owner_secret,'passcode':totp(owner_secret)},token=owner_setup)[0]==200,'verify fixture owner MFA')
        check(request(18081,'POST','/api/v2/user/totp/save',{'enabled':True,'config_name':'YggShare','protocols':['HTTP'],'secret':{'status':'Plain','payload':owner_secret}},token=owner_setup)[0]==200,'enroll fixture owner before updating resource caps')
        origin='http://127.0.0.1:18090'
        app=module.App(data,18081,content,origin,auto_unlimit=True)
        for port,mode in ((18090,'public'),(18091,'admin')):
            server=module.Server(('127.0.0.1',port),app,mode)
            threading.Thread(target=server.serve_forever,daemon=True).start();servers.append(server)
        admin_origin='http://127.0.0.1:18091'
        status,body,headers=request(18091,'POST','/api/login',{'username':'ygg-admin','password':admin_pass,'otp':''},headers={'Origin':admin_origin})
        check(status==200,'private manager authenticates through native administrator')
        login=json.loads(body);cookie=headers['Set-Cookie'].split(';')[0]
        auth={'Cookie':cookie,'X-Ygg-CSRF':login['csrf'],'Origin':admin_origin}
        check(login['owner']['unlimited'] and login['owner']['mfa_required'] and login['owner']['mfa_enrolled'],'owner caps removed and required/enrolled MFA preserved')
        status,owner_after,_=request(18081,'GET','/api/v2/users/owner',token=admin)
        saved=json.loads(owner_after)
        check(saved['home_dir']==str(content/'owner') and saved['filters']['web_client']==['shares-disabled'],'owner namespace and sharing policy preserved')
        check(request(18091,'POST','/api/invites',{'username':'guestone'},headers={'Origin':admin_origin})[0]==401,'anonymous invitation creation rejected')
        check(request(18091,'POST','/api/invites',{'username':'guestone'},headers={'Origin':admin_origin,'Cookie':cookie})[0]==403,'CSRF token required')
        check(request(18091,'POST','/api/invites',{'username':'guestone'},headers={**auth,'Origin':'https://evil.invalid'})[0]==403,'cross-origin admin request rejected')
        status,body,_=request(18091,'POST','/api/invites',{'username':'guestone','quota_gib':100,'hours':168},headers=auth)
        check(status==201,'create a real invitation with 100 GiB default')
        invitation=json.loads(body);token=invitation['url'].split('#')[1]
        raw_db=(data/'invitations.db').read_bytes()
        check(token.encode() not in raw_db,'raw bearer token is absent from invitation storage')
        with app.store.connect() as db:
            row=db.execute('SELECT * FROM invitations WHERE username=?',('guestone',)).fetchone()
            temporary=module.unprotect(row['secret'])
            check(temporary.encode() not in raw_db and len(row['secret'])>len(temporary),'pending password is protected with Windows DPAPI')
        public={'Origin':origin}
        check(request(18090,'POST','/api/invites',{'username':'attacker'},headers=public)[0]==404,'public listener cannot create invitations')
        check(request(18090,'GET','/api/session')[0]==404,'public listener cannot read administrator session')
        check(request(18090,'POST','/join/api/info',{'token':token},headers={'Origin':'https://evil.invalid'})[0]==403,'cross-origin invitation POST rejected')
        status,body,_=request(18090,'POST','/join/api/info',{'token':token},headers=public)
        check(status==200 and json.loads(body)['username']=='guestone','valid recipient can inspect their invitation')
        password=secrets.token_urlsafe(32)
        check(request(18090,'POST','/join/api/claim',{'token':token,'password':password,'confirm':'different'},headers=public)[0]==400,'mismatched passwords do not consume invitation')
        check(request(18090,'POST','/join/api/claim',{'token':token,'password':'aaaaaaaaaaaa','confirm':'aaaaaaaaaaaa'},headers=public)[0]==400,'native strong-password policy is enforced during invitation acceptance')
        status,body,_=request(18090,'POST','/join/api/claim',{'token':token,'password':password,'confirm':password},headers=public)
        check(status==200,'recipient chooses a password through real SFTPGo password-change API')
        check(request(18090,'POST','/join/api/claim',{'token':token,'password':password,'confirm':password},headers=public)[0]==410,'used invitation cannot be replayed')
        check(get_token(18081,'guestone',temporary)[0] in (401,403),'temporary account password no longer authenticates')
        status,user_token=get_token(18081,'guestone',password)
        check(status==200 and request(18081,'GET','/api/v2/user/dirs',token=user_token)[0] in (401,403),'new password works but file access waits for required MFA')
        _,body,_=request(18081,'GET','/api/v2/users/guestone',token=admin)
        guest=json.loads(body)
        check(guest['home_dir']!=str(content/'owner') and guest['quota_size']==100*1024**3 and not guest.get('virtual_folders',[]), 'invited user has private generated home, quota, and no extra mounts')
        check(not guest['filters'].get('require_password_change'),'forced initial password change completed')
        for name,action in (('expiredguest','expire'),('revokedguest','revoke'),('raceguest','race')):
            _,body,_=request(18091,'POST','/api/invites',{'username':name,'quota_gib':100,'hours':1},headers=auth)
            inv=json.loads(body);key=inv['url'].split('#')[1]
            if action=='expire':
                with app.store.connect() as db:db.execute('UPDATE invitations SET expires=0 WHERE id=?',(inv['id'],))
                check(request(18090,'POST','/join/api/info',{'token':key},headers=public)[0]==410,'expired invitation rejected')
            elif action=='revoke':
                check(request(18091,'POST','/api/revoke',{'id':inv['id']},headers=auth)[0]==200,'inviter can revoke unused link')
                check(request(18090,'POST','/join/api/info',{'token':key},headers=public)[0]==410,'revoked invitation rejected')
            else:
                # Use distinct test IPs only to avoid the public rate limit
                # masking the database's one-time claim concurrency contract.
                def redeem(index):
                    return request(18090,'POST','/join/api/claim',{'token':key,'password':password,'confirm':password},headers={**public,'X-Forwarded-For':'198.51.100.'+str(100+index)})[0]
                with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(redeem,range(2)))
                check(sorted(results)==[200,410],'concurrent claims accept exactly one recipient')
        check(request(18091,'POST','/api/invites',{'username':'owner'},headers=auth)[0]==400,'owner cannot be replaced by an invitation')
        check(request(18091,'POST','/api/invites',{'username':'guestone'},headers=auth)[0]==409,'existing account is never overwritten')
        check(request(18090,'GET','/join/assets/../../server.py')[0]==404,'asset traversal rejected')
        check(request(18091,'GET','/',headers={'Host':'evil.invalid'})[0]==403,'unrecognized Host rejected')
        from test_operations import run as test_operations
        test_operations(app, admin, content)
        request(18091,'POST','/api/logout',{},headers=auth)
        check(request(18091,'GET','/api/session',headers={'Cookie':cookie})[0]==401,'manager logout removes session')
        (run/'result.json').write_text(json.dumps({'result':'passed','scope':'disposable native accounts; no production accounts or invitations created'},indent=2))
        print('Results: '+str(run/'result.json'))
    finally:
        for server in servers:server.shutdown();server.server_close()
        process.terminate();process.wait(timeout=15);log.close()


if __name__=='__main__':main()

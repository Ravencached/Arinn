"""Real-native operations checks inside the disposable invitation fixture."""
import json
import os
from pathlib import Path
import secrets
import time
from urllib.parse import urlencode
from test_sftpgo import request, check, get_token, upload, totp


def run(app, admin, content):
    app.features_enabled=True
    app.setup_features(admin)
    invitation=app.create({'username':'opsuser'},admin)
    original=invitation['url'].split('#')[1]
    with app.store.connect() as db:db.execute("UPDATE invitations SET expires=0 WHERE username='opsuser'")
    replacement=app.replace_link({'username':'opsuser','confirm_username':'opsuser'},admin)
    try:app.info(original);raise AssertionError('old link accepted')
    except Exception as e:check(getattr(e,'status',None)==410,'reissue invalidates old invitation')
    password=secrets.token_urlsafe(32)
    app.claim({'token':replacement['url'].split('#')[1],'password':password,'confirm':password})
    user=app.user('opsuser',admin);home=Path(user['home_dir'])
    check(len(user['virtual_folders'])==1 and user['virtual_folders'][0]['virtual_path']=='/Ygg Recovery','one private recovery mount')
    check(user['permissions']['/Ygg Recovery']==['list','download','copy'],'recovery read-only with restore-copy permission')
    # Only this disposable file-operation fixture temporarily removes gating.
    user['filters']['two_factor_protocols']=[];user.pop('password',None)
    request(18081,'PUT','/api/v2/users/opsuser',user,token=admin)
    _,token=get_token(18081,'opsuser',password)
    check(upload(18081,token,'notes.txt',b'first version')[0]==201,'upload initial recovery fixture')
    os.utime(home/'notes.txt',(1000000000,1000000000))
    check(upload(18081,token,'notes.txt',b'second version')[0]==201,'overwrite succeeds after preservation')
    vault=content.parent/'Recovery'/home.name;versions=list(vault.rglob('notes.txt'))
    check(len(versions)==2 and any(p.read_bytes()==b'first version' for p in versions),'overwritten bytes preserved')
    check(versions[0].stat().st_mtime>time.time()-120,'retention starts at copy time, not original modification time')
    check(request(18081,'DELETE','/api/v2/user/files?path=/notes.txt',token=token)[0]==200,'delete succeeds after preservation')
    versions=list(vault.rglob('notes.txt'))
    check(len(versions)==3 and {p.read_bytes() for p in versions}=={b'first version',b'second version'},'delete and overwrite keep distinct copies')
    saved='/Ygg Recovery/'+versions[0].relative_to(vault).as_posix()
    status,body,_=request(18081,'POST','/api/v2/user/file-actions/copy?'+urlencode({'path':saved,'target':'/restored.txt'}),{},token=token)
    check(status==200,'native restore copy: '+str(status)+' '+body.decode()[:120])
    check((home/'restored.txt').read_bytes()==versions[0].read_bytes(),'restored bytes match')
    check(request(18081,'DELETE','/api/v2/user/files?'+urlencode({'path':saved}),token=token)[0]==403,'cannot delete recovery copies')
    check(upload(18081,token,'evil.txt',b'no',folder='/Ygg Recovery')[0]==403,'cannot upload into recovery mount')
    check(upload(18081,token,'empty.txt',b'')[0]==201,'zero-byte fixture')
    check(request(18081,'DELETE','/api/v2/user/files?path=/empty.txt',token=token)[0]==200 and len(list(vault.rglob('empty.txt')))==2,'zero-byte deletion preserved')
    check(len(list(vault.rglob('restored.txt')))==1,'native copy completion is preserved')
    check(upload(18081,token,'before-rename.txt',b'rename me')[0]==201,'rename fixture upload')
    check(request(18081,'POST','/api/v2/user/file-actions/move?'+urlencode({'path':'/before-rename.txt','target':'/after-rename.txt'}),{},token=token)[0]==200 and len(list(vault.rglob('after-rename.txt')))==1,'native rename completion is preserved')
    owner_vault=content.parent/'Recovery'/'owner';owner_vault.mkdir(parents=True,exist_ok=True)
    (owner_vault/'owner-only.txt').write_text('owner fixture')
    check(request(18081,'GET','/api/v2/user/files?'+urlencode({'path':'/Ygg Recovery/../owner/owner-only.txt'}),token=token)[0]!=200,'recovery traversal cannot reach another user')
    check(upload(18081,token,'hard.txt',b'preserve me')[0]==201,'hard-link refusal fixture')
    os.link(home/'hard.txt',home/'hard-other.txt')
    check(request(18081,'DELETE','/api/v2/user/files?path=/hard.txt',token=token)[0]==403 and (home/'hard.txt').read_bytes()==b'preserve me','failed pre-delete preservation leaves live file intact')
    (home/'hard-other.txt').unlink()
    app.update_account({'username':'opsuser','action':'quota','quota_gib':42},admin)
    check(app.user('opsuser',admin)['quota_size']==42*1024**3,'quota update applied')
    check(request(18081,'GET','/api/v2/user/dirs',token=token)[0] in (401,403),'account update revokes old token')
    _,token=get_token(18081,'opsuser',password)
    app.update_account({'username':'opsuser','action':'disable'},admin)
    check(get_token(18081,'opsuser',password)[0]!=200,'disabled account cannot sign in')
    check(request(18081,'GET','/api/v2/user/dirs',token=token)[0] in (401,403),'disable revokes issued token')
    app.update_account({'username':'opsuser','action':'enable'},admin)
    _,token=get_token(18081,'opsuser',password)
    app.update_account({'username':'opsuser','action':'revoke-sessions'},admin)
    check(request(18081,'GET','/api/v2/user/dirs',token=token)[0] in (401,403),'explicit revocation rejects old token')
    recovery=app.replace_link({'username':'opsuser','confirm_username':'opsuser'},admin,True)
    check(get_token(18081,'opsuser',password)[0]!=200,'recovery replaces forgotten password')
    next_password=secrets.token_urlsafe(32)
    app.claim({'token':recovery['url'].split('#')[1],'password':next_password,'confirm':next_password})
    _,setup=get_token(18081,'opsuser',next_password)
    check(request(18081,'GET','/api/v2/user/dirs',token=setup)[0]==403,'recovery requires MFA enrollment')
    _,body,_=request(18081,'POST','/api/v2/user/totp/generate',{'config_name':'YggShare'},token=setup)
    secret=json.loads(body)['secret']
    check(request(18081,'POST','/api/v2/user/totp/save',{'enabled':True,'config_name':'YggShare','protocols':['HTTP'],'secret':{'status':'Plain','payload':secret}},token=setup)[0]==200,'enroll recovery fixture MFA')
    recovery=app.replace_link({'username':'opsuser','confirm_username':'opsuser'},admin,True);key=recovery['url'].split('#')[1]
    try:app.claim({'token':key,'password':password,'confirm':password});raise AssertionError('MFA bypassed')
    except Exception as e:check(getattr(e,'status',None)==401,'password-only recovery requires enrolled authenticator')
    app.claim({'token':key,'password':password,'confirm':password,'otp':totp(secret)})
    check(app.user('opsuser',admin)['filters']['totp_config']['enabled'],'recovery preserves enrolled MFA')
    recovery=app.replace_link({'username':'opsuser','confirm_username':'opsuser','reset_mfa':True},admin,True)
    app.claim({'token':recovery['url'].split('#')[1],'password':next_password,'confirm':next_password})
    user=app.user('opsuser',admin)
    check(not user['filters'].get('totp_config',{}).get('enabled') and 'HTTP' in user['filters']['two_factor_protocols'],'lost-authenticator recovery requires fresh enrollment')
    check(user['home_dir']==str(home) and user['quota_size']==42*1024**3 and len(user['virtual_folders'])==1 and (home/'restored.txt').exists(),'recovery retains files, quota and private scope')
    import recovery
    if os.environ.get('YGGS_TEST_LARGE')=='1':
        import hashlib
        user['filters']['two_factor_protocols']=[];user.pop('password',None)
        request(18081,'PUT','/api/v2/users/opsuser',user,token=admin)
        _,large_token=get_token(18081,'opsuser',next_password)
        size=2148532224
        status,_,digest=upload(18081,large_token,'large.bin',size=size)
        check(status==201,'2.15 GB upload with synchronous recovery hook')
        copies=list(vault.rglob('large.bin'))
        check(len(copies)==1 and copies[0].stat().st_size==size,'large recovery copy has exact size')
        with copies[0].open('rb') as stream:
            check(hashlib.file_digest(stream,'sha256').hexdigest()==digest,'large recovery copy matches upload SHA256')
        # Large disposable fixture bytes are removed, not production files.
        for path in [home/'large.bin',*copies]:
            path.resolve().relative_to(Path(__file__).resolve().parents[1]/'test-runs')
            path.unlink()
    from health import capacity
    check(capacity(100*1024**3,50*1024**3)=='ok' and capacity(100*1024**3,9*1024**3)=='warning' and capacity(100*1024**3,2*1024**3)=='critical','capacity alert thresholds')
    check(recovery.prune(content.parent/'Recovery')==0,'retention keeps recent recovery copies')
    preserved=(home/'restored.txt').read_bytes()
    check(recovery.prune(content.parent/'Recovery',time.time()+31*86400)>0,'retention removes expired snapshots')
    check((home/'restored.txt').read_bytes()==preserved,'retention never removes live user files')
    import health
    notifications=[];original_log=health.event_log
    health.event_log=lambda message,severity:notifications.append((message,severity))
    try:
        sample={'checked':int(time.time()),'checks':[{'name':'Fixture capacity','state':'ok','detail':'sample'}]}
        app.monitor.save(sample)
        sample['checks'][0]['state']='warning';app.monitor.save(sample);app.monitor.save(sample)
        check(len(notifications)==1,'health alerts fire on change and stay quiet while unchanged')
        sample['checks'][0]['state']='ok';app.monitor.save(sample)
        check(len(notifications)==2,'health recovery produces one recovery alert')
    finally:health.event_log=original_log

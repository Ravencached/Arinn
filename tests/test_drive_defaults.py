"""Regression tests for private invitation-manager defaults; no native service."""
import importlib.util
from pathlib import Path
import sys
import tempfile
import unittest

HERE=Path(__file__).resolve().parents[1]/'components/yggdrive/windows/invites'
TEST_TEMP=Path(__file__).resolve().parents[1]/'runtime/tests'
TEST_TEMP.mkdir(parents=True,exist_ok=True)
sys.path.insert(0,str(HERE))
spec=importlib.util.spec_from_file_location('suite_invites',HERE/'server.py')
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class DefaultTests(unittest.TestCase):
    def test_login_preserves_owner_quota_and_does_not_install_recovery_hooks(self):
        with tempfile.TemporaryDirectory(dir=TEST_TEMP) as folder:
            app=module.App(Path(folder),8081,Path(folder)/'Users','https://drive.example.test')
            class Native:
                def __init__(self):self.calls=[]
                def call(self,method,route,**kwargs):
                    self.calls.append((method,route))
                    if route=='/token':return 200,{'access_token':'synthetic-test-token'}
                    if route=='/users/owner':return 200,{'quota_size':100*1024**3,'filters':{'two_factor_protocols':['HTTP'],'totp_config':{'enabled':True}}}
                    raise AssertionError('Unexpected configuration mutation: '+method+' '+route)
            app.native=Native()
            sid,result=app.login({'username':'ygg-admin','password':'synthetic'})
            self.assertTrue(sid)
            self.assertFalse(result['owner']['unlimited'])
            self.assertFalse(app.auto_unlimit)
            self.assertFalse(app.features_enabled)
            self.assertTrue(all(method=='GET' for method,_ in app.native.calls))

    def test_custom_admin_name_is_enforced(self):
        with tempfile.TemporaryDirectory(dir=TEST_TEMP) as folder:
            app=module.App(Path(folder),8081,Path(folder)/'Users','https://drive.example.test',admin_username='custom-admin')
            with self.assertRaises(module.Failure) as error:app.login({'username':'ygg-admin'})
            self.assertEqual(error.exception.status,401)

if __name__=='__main__':unittest.main()

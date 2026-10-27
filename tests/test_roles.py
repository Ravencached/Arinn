"""Role separation and configuration-preservation checks. No daemon required."""
import argparse
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('suite', ROOT / 'scripts/suite.py')
suite = importlib.util.module_from_spec(spec)
spec.loader.exec_module(suite)


def options(**overrides):
    values = dict(role='home', components=None, mail_url='https://mail.example.test',
                  calendar_url='https://calendar.example.test', drive_url='https://drive.example.test',
                  drive_path=None, project='suite-test')
    values.update(overrides)
    return argparse.Namespace(**values)


class RoleTests(unittest.TestCase):
    def test_home_has_no_drive_mount_or_drive_service(self):
        with tempfile.TemporaryDirectory() as folder:
            state = Path(folder)
            suite.generate(state, options())
            result = json.loads((state / 'compose.json').read_text())
            self.assertEqual(set(result['services']), {'aring', 'mail-php', 'mail-web'})
            self.assertNotIn('yggdrive-state', result['volumes'])
            self.assertIn('https://drive.example.test', (state / 'apps.html').read_text())

    def test_existing_configuration_is_preserved(self):
        with tempfile.TemporaryDirectory() as folder:
            state = Path(folder)
            suite.generate(state, options(components=['aring']))
            original = (state / 'compose.json').read_bytes()
            with self.assertRaises(ValueError):
                suite.generate(state, options())
            self.assertEqual(original, (state / 'compose.json').read_bytes())

    def test_role_cannot_start_other_role_components(self):
        with tempfile.TemporaryDirectory() as folder:
            with self.assertRaises(ValueError):
                suite.generate(Path(folder), options(role='home', components=['yggdrive']))

    def test_storage_binds_only_explicit_existing_directory(self):
        with tempfile.TemporaryDirectory() as folder:
            base = Path(folder)
            state = base / 'state'; state.mkdir()
            content = base / 'content'; content.mkdir()
            canary = content / 'existing.txt'; canary.write_text('synthetic fixture')
            suite.generate(state, options(role='storage', drive_path=str(content)))
            result = json.loads((state / 'compose.json').read_text())
            self.assertEqual(set(result['services']), {'yggdrive'})
            mounts = result['services']['yggdrive']['volumes']
            self.assertEqual(mounts[1]['source'], str(content.resolve()))
            self.assertFalse(mounts[1]['bind']['create_host_path'])
            self.assertEqual(canary.read_text(), 'synthetic fixture')

    def test_urls_reject_script_credentials_and_path(self):
        for value in ['javascript:alert(1)', 'https://user:password@example.test',
                      'https://example.test/path', 'http://example.test', 'https://example.test\n']:
            with self.subTest(value=value), self.assertRaises(ValueError):
                suite.web_url(value)

    def test_storage_rejects_checkout_as_content(self):
        with tempfile.TemporaryDirectory() as folder:
            with self.assertRaises(ValueError):
                suite.generate(Path(folder), options(role='storage', drive_path=str(ROOT)))


if __name__ == '__main__':
    unittest.main()

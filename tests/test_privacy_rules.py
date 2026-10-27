"""Source/history scanner fixtures contain generated test strings, not live secrets."""
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from privacy_rules import findings


class PrivacyRulesTests(unittest.TestCase):
    def test_generated_token_shape_is_detected(self):
        self.assertIn('github-token', findings(b'ghp_' + b'x' * 36))

    def test_generated_private_key_block_is_detected(self):
        block = b'-----BEGIN ' + b'PRIVATE KEY-----\n' + b'A' * 80
        self.assertIn('private-key-material', findings(block))

    def test_placeholder_identity_is_not_a_private_path(self):
        value = b'C:' + b'/Users/' + b'OPERATOR/project'
        self.assertNotIn('personal-home-path', findings(value))

    def test_generated_home_path_is_detected(self):
        value = b'C:' + b'/Users/' + b'synthetic-person/project'
        self.assertIn('personal-home-path', findings(value))


if __name__ == '__main__':
    unittest.main()

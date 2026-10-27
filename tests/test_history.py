"""History checks must catch removed data without printing its contents."""
import contextlib
import io
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from review_history import scan


class HistoryTests(unittest.TestCase):
    def git(self, root, *args):
        return subprocess.check_output(['git', '-C', str(root), *args], stderr=subprocess.DEVNULL)

    def commit(self, root):
        self.git(root, 'add', '-A')
        self.git(root, '-c', 'user.name=Synthetic Fixture', '-c', 'user.email=fixture@example.invalid',
                 '-c', 'commit.gpgsign=false', 'commit', '-qm', 'Synthetic fixture')

    def test_deleted_generated_token_is_still_flagged_and_redacted(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            self.git(root, 'init', '-q')
            generated = 'ghp_' + 'x' * 36
            (root / 'fixture.txt').write_text(generated)
            self.commit(root)
            (root / 'fixture.txt').write_text('clean synthetic content')
            self.commit(root)
            output = io.StringIO()
            with contextlib.redirect_stdout(output):
                self.assertTrue(scan(root))
            self.assertIn('github-token', output.getvalue())
            self.assertNotIn(generated, output.getvalue())

    def test_shallow_repository_is_not_reported_as_full_history(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            self.git(root, 'init', '-q')
            (root / 'fixture.txt').write_text('clean synthetic content')
            self.commit(root)
            (root / '.git/shallow').write_bytes(self.git(root, 'rev-parse', 'HEAD'))
            with self.assertRaisesRegex(ValueError, 'non-shallow'):
                scan(root)


if __name__ == '__main__':
    unittest.main()

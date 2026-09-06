import tempfile
import unittest
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from media_worker import ensure_within


class PathSafetyTests(unittest.TestCase):
    def test_allows_child_path(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            self.assertEqual(ensure_within(root / "job" / "file.mp4", root), (root / "job" / "file.mp4").resolve())

    def test_rejects_parent_escape(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / "cache"
            root.mkdir()
            with self.assertRaises(ValueError):
                ensure_within(root / ".." / "outside.txt", root)


if __name__ == "__main__":
    unittest.main()

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from video_content_worker import extract_frames, probe

ROOT = Path(__file__).resolve().parents[2]
FFMPEG = ROOT / 'node_modules/@ffmpeg-installer/win32-x64/ffmpeg.exe'
FFPROBE = ROOT / 'node_modules/@ffprobe-installer/win32-x64/ffprobe.exe'


@unittest.skipUnless(FFMPEG.exists() and FFPROBE.exists(), 'bundled Windows media binaries required')
class ContentCoverageTests(unittest.TestCase):
    def test_ten_minute_video_includes_late_frames_with_source_timestamps(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            media = root / 'long.mp4'
            subprocess.run([str(FFMPEG), '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i',
                            'testsrc=size=64x64:rate=1:duration=600', '-pix_fmt', 'yuv420p', str(media)], check=True)
            result = extract_frames({'ffmpeg':str(FFMPEG),'ffprobe':str(FFPROBE),'mediaPath':str(media),'outputDir':str(root/'result')})
            self.assertEqual(result['metadata']['durationMs'], 600000)
            self.assertGreaterEqual(max(f['timeMs'] for f in result['frames']), 595000)
            self.assertTrue(all(Path(f['path']).is_file() for f in result['frames']))
            self.assertEqual(sorted(f['timeMs'] for f in result['frames']), [f['timeMs'] for f in result['frames']])

    def test_duration_mismatch_is_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            media = Path(temp)/'short.wav'
            subprocess.run([str(FFMPEG),'-hide_banner','-loglevel','error','-f','lavfi','-i','sine=duration=2',str(media)],check=True)
            with self.assertRaisesRegex(ValueError,'VIDEO_MEDIA_DURATION_MISMATCH'):
                probe({'ffprobe':str(FFPROBE),'mediaPath':str(media),'expectedDurationMs':120000})


if __name__ == '__main__':
    unittest.main()

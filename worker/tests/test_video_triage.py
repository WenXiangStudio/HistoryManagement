import sys
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from video_triage import classify_signals


class DetectionRuleTests(unittest.TestCase):
    def test_speech_with_text_remains_speech(self):
        self.assertEqual(classify_signals(.8,.9,8),('speech','较强'))

    def test_no_speech_text_and_visual(self):
        self.assertEqual(classify_signals(0,0,8)[0],'visual_text')
        self.assertEqual(classify_signals(0,0,0)[0],'visual')

    def test_sparse_speech_with_text_requires_review(self):
        self.assertEqual(classify_signals(.1,.2,2)[0],'pending')
        self.assertEqual(classify_signals(.01,.1,7)[0],'pending')
        self.assertEqual(classify_signals(.1001,.2,2)[0],'speech')


if __name__=='__main__':
    unittest.main()

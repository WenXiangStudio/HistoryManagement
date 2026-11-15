"""Local-only verification stages for previously captured samples; never fetches platform data."""
import argparse
import json
import os
from pathlib import Path
import sys

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'worker'))
from video_content_worker import handle

parser=argparse.ArgumentParser()
parser.add_argument('stage',choices=['transcribe','visual'])
args=parser.parse_args()
base=Path(os.environ['LOCALAPPDATA'])/'SignalDeskFollowingReview/video-content/evidence'
for proof_path in sorted(base.glob('*/proof.json')):
    proof=json.loads(proof_path.read_text(encoding='utf-8'))
    folder=proof_path.parent
    params={'mediaPath':str(folder/'source.mp4'),'outputDir':str(folder),
        'ffmpeg':str(ROOT/'node_modules/@ffmpeg-installer/win32-x64/ffmpeg.exe'),
        'ffprobe':str(ROOT/'node_modules/@ffprobe-installer/win32-x64/ffprobe.exe'),
        'expectedDurationMs':proof['capture']['work']['durationMs'],
        'modelPath':str(ROOT/'models/faster-whisper-small'),'modelRevision':'536b0662742c02347bc0e980a01041f333bce120'}
    print(json.dumps({'stage':args.stage,'workId':proof['capture']['work']['workId'],'durationMs':params['expectedDurationMs'],'starting':True}),flush=True)
    if args.stage=='transcribe':
        result=handle('transcribe',params)
    else:
        frames_path=folder/'frames.json'
        frames=json.loads(frames_path.read_text(encoding='utf-8')) if frames_path.exists() else handle('frames',params)
        params.update({'frames':frames['frames'],'detectionModelPath':str(ROOT/'models/paddleocr/PP-OCRv5_mobile_det_infer'),
                       'recognitionModelPath':str(ROOT/'models/paddleocr/PP-OCRv5_mobile_rec_infer')})
        result=json.loads((folder/'ocr.json').read_text(encoding='utf-8')) if (folder/'ocr.json').exists() else handle('ocr',params)
    print(json.dumps({'stage':args.stage,'workId':proof['capture']['work']['workId'],'status':result['status'],
        'segments':len(result.get('segments',[])),'blocks':len(result.get('blocks',[])),'cacheHit':result.get('cacheHit'),'elapsedMs':result.get('elapsedMs')}),flush=True)

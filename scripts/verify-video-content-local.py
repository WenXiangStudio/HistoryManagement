"""Run local-only content verification on an already captured evidence directory."""
import argparse
import json
from pathlib import Path
import sys

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'worker'))
from video_content_worker import handle

parser=argparse.ArgumentParser()
parser.add_argument('directory',type=Path)
parser.add_argument('method',choices=['probe','transcribe','frames'])
args=parser.parse_args()
proof=json.loads((args.directory/'proof.json').read_text(encoding='utf-8'))
params={'mediaPath':str(args.directory/'source.mp4'),'outputDir':str(args.directory),
 'ffmpeg':str(ROOT/'node_modules/@ffmpeg-installer/win32-x64/ffmpeg.exe'),
 'ffprobe':str(ROOT/'node_modules/@ffprobe-installer/win32-x64/ffprobe.exe'),
 'expectedDurationMs':proof['capture']['work']['durationMs'],
 'modelPath':str(ROOT/'models/faster-whisper-small'),'modelRevision':'536b0662742c02347bc0e980a01041f333bce120'}
result=handle(args.method,params)
print(json.dumps({'method':args.method,'status':result.get('status'),'segments':len(result.get('segments',[])),
 'frames':len(result.get('frames',[])),'elapsedMs':result.get('elapsedMs'),'cacheHit':result.get('cacheHit'),'directory':str(args.directory)}))

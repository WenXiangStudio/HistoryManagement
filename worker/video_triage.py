"""Detection-only triage: Silero VAD + PP-OCRv5 mobile detector; no ASR/OCR recognition."""
import contextlib
import hashlib
import json
import math
import os
import re
import subprocess
import sys
import time
from pathlib import Path

_detector = None
_detector_path = None
_guard_installed = False


def classify_signals(fraction, coverage, text_frames):
    if fraction >= .6 and coverage >= .5:
        return 'speech', '较强'
    if fraction > .1:
        return 'speech', '中等' if fraction >= .4 else '较弱'
    if fraction == 0 and text_frames >= 2:
        return 'visual_text', '中等'
    if text_frames < 2:
        return 'visual', '中等'
    return 'pending', '较弱'


def detect(params):
    global _detector, _detector_path, _guard_installed
    started = time.perf_counter()
    os.environ['HF_HUB_OFFLINE'] = '1'
    os.environ['PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK'] = 'True'
    if not _guard_installed:
        def guard(event, args):
            if event in {'socket.connect', 'socket.connect_ex', 'socket.getaddrinfo'}:
                raise RuntimeError('LOCAL_MODEL_NETWORK_BLOCKED')
        sys.addaudithook(guard)
        _guard_installed = True
    with contextlib.redirect_stdout(sys.stderr):
        import numpy as np
        from faster_whisper.vad import get_speech_timestamps, VadOptions
        from paddleocr import TextDetection
        if _detector is None or _detector_path != params['detectionModelPath']:
            _detector = TextDetection(model_name='PP-OCRv5_mobile_det', model_dir=params['detectionModelPath'],
                device='cpu', cpu_threads=2, limit_side_len=960, limit_type='max', thresh=.3, box_thresh=.6)
            _detector_path = params['detectionModelPath']
    loaded = time.perf_counter()

    def run(args):
        result = subprocess.run([str(a) for a in args], capture_output=True, timeout=900,
            creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == 'win32' else 0)
        if result.returncode:
            raise RuntimeError('MEDIA_COMMAND_FAILED')
        return result

    source = Path(params['mediaPath'])
    with source.open('rb') as handle:
        sha = hashlib.file_digest(handle, 'sha256').hexdigest()
    if sha != params['expectedSha256']:
        raise RuntimeError('VIDEO_MEDIA_HASH_MISMATCH')
    metadata = json.loads(run([params['ffprobe'], '-v', 'error', '-show_format', '-show_streams', '-of', 'json', source]).stdout)
    duration = float(metadata['format']['duration'])
    if not math.isfinite(duration) or duration <= 0 or duration > 7200:
        raise RuntimeError('VIDEO_MEDIA_DURATION_INVALID')
    expected = params.get('expectedDurationMs')
    if expected and abs(duration * 1000 - expected) > max(1500, expected * .02):
        raise RuntimeError('VIDEO_MEDIA_DURATION_MISMATCH')
    video = next((s for s in metadata['streams'] if s['codec_type'] == 'video'), None)
    audio = next((s for s in metadata['streams'] if s['codec_type'] == 'audio'), None)
    if not video:
        raise RuntimeError('VIDEO_TRACK_UNAVAILABLE')
    probe_end = time.perf_counter()
    fraction, coverage, intervals = 0, 0, []
    if audio:
        raw = run([params['ffmpeg'], '-hide_banner', '-loglevel', 'info', '-threads', '1', '-i', source,
            '-map', '0:a:0', '-vn', '-af', 'aresample=16000,ashowinfo', '-f', 'f32le', '-acodec', 'pcm_f32le', 'pipe:1'])
        samples = np.frombuffer(raw.stdout, dtype='<f4').reshape(-1, int(audio['channels']))
        stamps = [(float(t), int(count)) for t, count in re.findall(
            r'pts_time:([-+\d.eE]+).*rate:\d+ nb_samples:(\d+)', raw.stderr.decode(errors='replace'))]
        if not stamps or not len(samples) or not np.isfinite(samples).all() or sum(s[1] for s in stamps) != len(samples):
            raise RuntimeError('INVALID_AUDIO_COVERAGE')
        rms = np.sqrt(np.mean(np.square(samples, dtype=np.float64), axis=0))
        mono = np.array(samples[:, int(np.argmax(rms))], dtype=np.float32)
        start_seconds = stamps[0][0]
        del samples, raw
        with contextlib.redirect_stdout(sys.stderr):
            chunks = get_speech_timestamps(mono, VadOptions(threshold=.5, neg_threshold=.35,
                min_speech_duration_ms=250, min_silence_duration_ms=200, speech_pad_ms=0), sampling_rate=16000)
        intervals = [{'startSeconds': round(max(0, start_seconds+c['start']/16000), 6),
            'endSeconds': round(min(duration, start_seconds+c['end']/16000), 6)} for c in chunks if start_seconds+c['start']/16000 < duration]
        fraction = sum(max(0, c['endSeconds']-c['startSeconds']) for c in intervals)/duration
        coverage = sum(any(c['endSeconds']>i*duration/10 and c['startSeconds']<(i+1)*duration/10 for c in intervals) for i in range(10))/10
        del mono
    vad_end = time.perf_counter()
    folder = Path(params['outputDir'])/'classification-v1'
    folder.mkdir(parents=True, exist_ok=True)
    ratio = min(1, 960/max(int(video['width']), int(video['height'])))
    width, height = (max(2, round(int(video[k])*ratio/2)*2) for k in ['width', 'height'])
    frames, retained_frames = [], 0
    for index, seconds in enumerate(np.linspace(0, max(0, duration-.3), 8), 1):
        file = folder/f'frame-{index}.jpg'
        raw = run([params['ffmpeg'], '-hide_banner', '-loglevel', 'info', '-threads', '1', '-ss', f'{seconds:.6f}',
            '-copyts', '-i', source, '-map', '0:v:0', '-an', '-vf', f'scale={width}:{height},showinfo',
            '-frames:v', '1', '-vsync', '0', '-q:v', '4', '-y', file])
        stamps = re.findall(r'\bpts_time:\s*([-+\d.eE]+)', raw.stderr.decode(errors='replace'))
        if not file.exists() or not stamps or abs(float(stamps[0])-seconds)>.15:
            raise RuntimeError('FRAME_TIMESTAMP_MISMATCH')
        with contextlib.redirect_stdout(sys.stderr):
            results = list(_detector.predict(str(file)))
        if len(results) != 1:
            raise RuntimeError('DETECTION_RESULT_COUNT')
        boxes = []
        for polygon, score in zip(results[0]['dt_polys'], results[0]['dt_scores']):
            points = np.asarray(polygon, dtype=float)
            x1, y1, x2, y2 = points[:,0].min()/width, points[:,1].min()/height, points[:,0].max()/width, points[:,1].max()/height
            bw, bh = x2-x1, y2-y1
            area, cx, cy = bw*bh, (x1+x2)/2, (y1+y2)/2
            excluded = float(score)<.6 or area<.0001 or bw<.005 or bh<.003 or (area<=.025 and bh<=.06 and (cy<.1 or cy>.9 or cx<.12 or cx>.88))
            boxes.append({'box':[float(x1),float(y1),float(x2),float(y2)],'score':float(score),'retained':not excluded})
        retained_frames += int(any(b['retained'] for b in boxes))
        frames.append({'id':f'triage-{index}','timeMs':round(float(stamps[0])*1000),'path':str(file),
            'sha256':hashlib.sha256(file.read_bytes()).hexdigest(),'boxes':boxes})
    code, strength = classify_signals(fraction, coverage, retained_frames)
    result = {'code':code,'strength':strength,'ruleVersion':'existence-detection-triage-v1','sourceSha256':sha,
        'basis':{'speechPercent':round(fraction*100,3),'speechBinCoverage':coverage,'retainedTextFrames':retained_frames,'sampledFrames':8},
        'frames':frames,'intervals':intervals,'asrInvoked':False,'textRecognitionInvoked':False,'cloudInvoked':False,
        'timing':{'modelLoadMs':round((loaded-started)*1000),'verifyProbeMs':round((probe_end-loaded)*1000),
            'audioDetectionMs':round((vad_end-probe_end)*1000),'frameDetectionMs':round((time.perf_counter()-vad_end)*1000),
            'detectionTotalMs':round((time.perf_counter()-started)*1000)}}
    (folder/'result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
    return result

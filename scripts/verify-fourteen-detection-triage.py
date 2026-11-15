"""Authorized 14-library-video detection-only classification and local concurrency audit.

No ASR, character recognition, content semantics, cloud inference or APP writes.
Fresh audio/frames and detection each wave; models load once per pool worker.
"""
from __future__ import annotations

import os
import sys
import time

START = time.perf_counter()
os.environ['PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK'] = 'True'
os.environ['HF_HUB_OFFLINE'] = '1'
os.environ['HF_DATASETS_OFFLINE'] = '1'
os.environ['OMP_NUM_THREADS'] = '2'
os.environ['MKL_NUM_THREADS'] = '2'
os.environ['OPENBLAS_NUM_THREADS'] = '2'
os.environ['PYTHONUTF8'] = '1'

import concurrent.futures
import contextlib
import hashlib
import json
import math
import multiprocessing
import re
import sqlite3
import subprocess
import threading
from datetime import datetime, timezone
from pathlib import Path

import psutil

ROOT = Path(__file__).resolve().parents[1]
USER_DATA = Path(os.environ['LOCALAPPDATA'])/'SignalDeskFollowingReview'
ATTEMPT = sys.argv[1] if len(sys.argv)>1 else 'attempt-02'
if not re.fullmatch(r'attempt-\d{2}', ATTEMPT):
    raise ValueError('INVALID_ATTEMPT_RECORD')
OUT = ROOT/'local-data/detection-triage-fourteen-20261013'/ATTEMPT
FFMPEG = ROOT/'node_modules/@ffmpeg-installer/win32-x64/ffmpeg.exe'
FFPROBE = ROOT/'node_modules/@ffprobe-installer/win32-x64/ffprobe.exe'
LEVELS = [1, 2, 4, 8, 14]
RULES = {
    'version': 'existence-detection-triage-v1',
    'classificationThresholdStatus': 'exploratory rules fixed before inference; user accuracy review pending',
    'vad': {'threshold': .5, 'negThreshold': .35, 'minSpeechMs': 250, 'minSilenceMs': 200, 'speechPadMs': 0,
            'highSpeechFraction': .6, 'sparseSpeechFraction': .1, 'temporalBins': 10, 'highSpeechBinCoverage': .5,
            'channelPolicy': 'highest whole-track RMS channel; the other channel is not independently assessed'},
    'frames': {'count': 8, 'longEdge': 960, 'lastTime': 'duration minus 0.30 seconds',
               'method': 'input seeking with showinfo actual source timestamps; no earlier frame cache'},
    'textDetection': {'model': 'PP-OCRv5_mobile_det', 'pixelThreshold': .3, 'boxThreshold': .6,
                      'minimumAreaFraction': .0001, 'minimumWidthFraction': .005, 'minimumHeightFraction': .003,
                      'smallEdgeCandidate': 'area <=2.5% and height <=6%, center in outer 10% vertical or 12% horizontal',
                      'textEvidence': 'at least 2 of 8 frames retain geometric text candidates',
                      'charactersRecognized': False, 'overlayHeuristic': 'geometry only; cannot prove watermark identity'},
    'visualChange': {'graySize': [96, 96], 'changedPixelDelta': 25,
                     'largeMeanDifferenceFraction': .08, 'largeChangedPixelFraction': .25,
                     'nearStaticMeanFraction': .01, 'nearStaticChangedPixelFraction': .01,
                     'scope': 'differences between eight sparse samples, not continuous motion or semantic change'},
    'labels': {'visual': '纯画面主导', 'visual_text': '图文结合（无语音/口播）',
               'speech': '口播主导或口播加图文', 'pending': '待确认'},
    'classification': [
        'speech fraction >=60% and speech in >=50% of timeline bins: speech category, strong rule evidence',
        'speech fraction >10%: speech category candidate, moderate/low rule evidence',
        'zero speech and >=2 retained text frames: visual-text category',
        'speech fraction <=10% and <2 retained text frames: visual category candidate (sparse voice allowed)',
        'speech fraction >0% and <=10% and >=2 retained text frames: unresolved boundary; no forced fourth category',
    ],
    'limits': {'workerCpuThreads': 2, 'ffmpegThreads': 1, 'minimumProjectedAvailableBytes': 6*1024**3,
               'emergencyAvailableBytes': 2*1024**3, 'waveReadyTimeoutSeconds': 180, 'waveTaskTimeoutSeconds': 900},
}
NETWORK_ATTEMPTS = []
NP = None
VAD = None
TEXT = None
WAVE = None


def utc():
    return datetime.now(timezone.utc).isoformat()


def save(path, value):
    Path(path).write_text(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False), encoding='utf-8')


def digest(path):
    with Path(path).open('rb') as handle:
        return hashlib.file_digest(handle, 'sha256').hexdigest()


def stable(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False,
        default=lambda blob: {'binarySha256': hashlib.sha256(blob).hexdigest(), 'bytes': len(blob)}
        if isinstance(blob, bytes) else str(blob))


def guard(event, args):
    if event in {'socket.connect', 'socket.connect_ex', 'socket.getaddrinfo'}:
        NETWORK_ATTEMPTS.append({'event': event})
        raise RuntimeError('LOCAL_MODEL_NETWORK_BLOCKED')


sys.addaudithook(guard)


def audit():
    databases = []
    for name in ['signal-desk.sqlite', 'following-directory.sqlite']:
        db = sqlite3.connect((USER_DATA/name).as_uri()+'?mode=ro', uri=True)
        db.row_factory = sqlite3.Row
        db.execute('BEGIN')
        tables = {}
        for row in db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"):
            table = row['name']
            rows = [dict(r) for r in db.execute('SELECT * FROM "'+table.replace('"', '""')+'"')]
            if table in ['video_content_batches', 'analysis_batches'] and any(r.get('state') in ['running', 'queued'] for r in rows):
                raise RuntimeError('APP_BUSY')
            tables[table] = {'rows': len(rows), 'sha256': hashlib.sha256('\n'.join(sorted(stable(r) for r in rows)).encode()).hexdigest()}
        databases.append({'name': name, 'tables': tables})
        db.close()
    return {'at': utc(), 'databases': databases,
            'credentials': {p.name: digest(p) for p in sorted((USER_DATA/'credentials').iterdir()) if p.is_file()},
            'runtimeSha256': digest(USER_DATA/'video-content/runtime.json'),
            'appAsarSha256': digest(ROOT/'release-following-background-final/win-unpacked/resources/app.asar')}


def command(args, timeout=240):
    result = subprocess.run([str(v) for v in args], capture_output=True, timeout=timeout,
                            creationflags=subprocess.CREATE_NO_WINDOW)
    if result.returncode:
        raise RuntimeError('MEDIA_COMMAND_FAILED:'+result.stderr.decode('utf-8', errors='replace')[-600:])
    return result


def worker_init(folder):
    global NP, VAD, TEXT, WAVE
    WAVE = Path(folder)
    started = time.perf_counter()
    log = (WAVE/f'worker-{os.getpid()}.log').open('w', encoding='utf-8')
    sys.stderr = log
    with contextlib.redirect_stdout(log):
        import numpy as np
        NP = np
        from faster_whisper.vad import get_vad_model
        get_vad_model()
        vad_ms = (time.perf_counter()-started)*1000
        from paddleocr import TextDetection
        det_start = time.perf_counter()
        TEXT = TextDetection(model_name='PP-OCRv5_mobile_det',
            model_dir=str(ROOT/'models/paddleocr/PP-OCRv5_mobile_det_infer'), device='cpu', cpu_threads=2,
            limit_side_len=960, limit_type='max', thresh=.3, box_thresh=.6)
        det_ms = (time.perf_counter()-det_start)*1000
    # No text-recognition class, weights, or prediction pipeline is instantiated.
    save(WAVE/f'ready-{os.getpid()}.json', {'pid': os.getpid(), 'readyAt': utc(),
         'vadImportLoadMs': round(vad_ms, 3), 'detectorConstructMs': round(det_ms, 3),
         'totalInitializationMs': round((time.perf_counter()-started)*1000, 3),
         'rssBytes': psutil.Process().memory_info().rss, 'networkAttemptsBlocked': len(NETWORK_ATTEMPTS),
         'models': ['Silero VAD v6', 'PP-OCRv5_mobile_det'], 'recognitionModelLoaded': False})


def audio_features(path, channels, duration):
    import numpy as np
    from faster_whisper.vad import get_speech_timestamps, VadOptions
    start = time.perf_counter()
    raw = command([FFMPEG, '-hide_banner', '-loglevel', 'info', '-threads', '1', '-i', path,
                   '-map', '0:a:0', '-vn', '-af', 'aresample=16000,ashowinfo', '-f', 'f32le', '-acodec', 'pcm_f32le', 'pipe:1'])
    samples = np.frombuffer(raw.stdout, dtype='<f4').reshape(-1, channels)
    stamps = [(float(t), int(rate), int(count)) for t, rate, count in re.findall(
        r'pts_time:([-+\d.eE]+).*rate:(\d+) nb_samples:(\d+)', raw.stderr.decode(errors='replace'))]
    if not stamps or not len(samples) or not np.isfinite(samples).all() or sum(s[2] for s in stamps) != len(samples):
        raise RuntimeError('INVALID_AUDIO_COVERAGE')
    rms = np.sqrt(np.mean(np.square(samples, dtype=np.float64), axis=0))
    selected = int(np.argmax(rms))
    mono = np.array(samples[:, selected], dtype=np.float32)
    start_seconds, decoded = stamps[0][0], len(mono)/16000
    decode_ms = (time.perf_counter()-start)*1000
    del samples, raw
    start = time.perf_counter()
    chunks = get_speech_timestamps(mono, VadOptions(threshold=.5, neg_threshold=.35,
        min_speech_duration_ms=250, min_silence_duration_ms=200, speech_pad_ms=0), sampling_rate=16000)
    vad_ms = (time.perf_counter()-start)*1000
    intervals = [{'startSeconds': round(max(0, start_seconds+c['start']/16000), 6),
                  'endSeconds': round(min(duration, start_seconds+c['end']/16000), 6)} for c in chunks
                 if start_seconds+c['start']/16000 < duration]
    speech_seconds = sum(max(0, c['endSeconds']-c['startSeconds']) for c in intervals)
    occupied = [any(c['endSeconds']>i*duration/10 and c['startSeconds']<(i+1)*duration/10 for c in intervals) for i in range(10)]
    del mono
    return ({'hasAudio': True, 'suspectedSpeechDetected': bool(intervals), 'speechSeconds': round(speech_seconds, 6),
            'speechFraction': speech_seconds/duration, 'speechPercent': round(speech_seconds/duration*100, 3),
            'speechBinCoverage': sum(occupied)/10, 'intervals': intervals, 'selectedChannelZeroBased': selected,
            'otherChannelAssessed': False, 'channelRms': rms.tolist(), 'audioCoverageStartSeconds': start_seconds,
            'decodedSeconds': decoded, 'audioCoverageEndSeconds': min(duration, start_seconds+decoded),
            'uncoveredInitialSeconds': max(0, start_seconds), 'uncoveredFinalSeconds': max(0, duration-start_seconds-decoded),
            'nonDetectedDecodedSeconds': max(0, min(duration, start_seconds+decoded)-max(0, start_seconds)-speech_seconds),
            'nonHumanAudioConfirmed': False, 'scope': 'speech detection; not exhaustive classification of singing/laughter/all human vocalizations'},
            {'audioDecodeMs': round(decode_ms, 3), 'vadInferenceMs': round(vad_ms, 3)})


def frame_features(path, duration, width, height, folder, keep_frames):
    import numpy as np
    from PIL import Image
    ratio = min(1, 960/max(width, height))
    w, h = max(2, round(width*ratio/2)*2), max(2, round(height*ratio/2)*2)
    frames, gray = [], []
    extract_start = time.perf_counter()
    for index, target in enumerate(np.linspace(0, max(0, duration-.3), 8), 1):
        file = folder/f'frame-{index:02d}.jpg'
        r = command([FFMPEG, '-hide_banner', '-loglevel', 'info', '-threads', '1', '-ss', f'{target:.6f}',
            '-copyts', '-i', path, '-map', '0:v:0', '-an', '-vf', f'scale={w}:{h},showinfo',
            '-frames:v', '1', '-vsync', '0', '-q:v', '4', '-y', file])
        actuals = re.findall(r'\bpts_time:\s*([-+\d.eE]+)', r.stderr.decode(errors='replace'))
        if not file.exists() or not actuals:
            raise RuntimeError('FRAME_TIMESTAMP_UNAVAILABLE')
        actual = float(actuals[0])
        if abs(actual-target) > .15:
            raise RuntimeError('FRAME_TIMESTAMP_MISMATCH')
        with Image.open(file) as im:
            gray.append(np.asarray(im.convert('L').resize((96, 96)), dtype=np.int16))
        frames.append({'frameId': index, 'requestedSeconds': round(float(target), 6), 'timeSeconds': actual,
                       'width': w, 'height': h, 'path': str(file), 'sha256': digest(file)})
    extract_ms = (time.perf_counter()-extract_start)*1000
    det_start = time.perf_counter()
    for frame in frames:
        with contextlib.redirect_stdout(sys.stderr):
            results = TEXT.predict(frame['path'])
        if len(results) != 1:
            raise RuntimeError('DETECTION_RESULT_COUNT')
        result = results[0]
        polygons = result['dt_polys']
        scores = result['dt_scores']
        boxes = []
        for polygon, score in zip(polygons, scores):
            points = np.asarray(polygon, dtype=float)
            x1, y1, x2, y2 = float(points[:,0].min()/w), float(points[:,1].min()/h), float(points[:,0].max()/w), float(points[:,1].max()/h)
            area, bw, bh = (x2-x1)*(y2-y1), x2-x1, y2-y1
            cx, cy = (x1+x2)/2, (y1+y2)/2
            small_edge = area<=.025 and bh<=.06 and (cy<.1 or cy>.9 or cx<.12 or cx>.88)
            exclusions = []
            if float(score)<.6:
                exclusions.append('low-detector-score')
            if area<.0001 or bw<.005 or bh<.003:
                exclusions.append('tiny-region')
            if small_edge:
                exclusions.append('small-edge-region-possible-overlay')
            boxes.append({'normalizedBox': [round(v, 6) for v in [x1, y1, x2, y2]],
                          'score': round(float(score), 6), 'areaFraction': round(area, 6),
                          'exclusionReasons': exclusions, 'retained': not exclusions})
        frame['boxes'] = boxes
        frame['detectedBoxCount'] = len(boxes)
        frame['retainedBoxCount'] = sum(b['retained'] for b in boxes)
        frame['retainedTextAreaFraction'] = min(1, sum(b['areaFraction'] for b in boxes if b['retained']))
        del result, results
    det_ms = (time.perf_counter()-det_start)*1000
    changed = []
    for i in range(1, len(gray)):
        diff = np.abs(gray[i]-gray[i-1])
        mean, fraction = float(diff.mean()/255), float((diff>=25).mean())
        changed.append({'firstFrame': i, 'secondFrame': i+1, 'meanDifferenceFraction': round(mean, 6),
                        'changedPixelFraction': round(fraction, 6), 'largeChange': mean>=.08 and fraction>=.25,
                        'nearStatic': mean<=.01 and fraction<=.01})
    detected_frames = sum(f['detectedBoxCount']>0 for f in frames)
    retained_frames = sum(f['retainedBoxCount']>0 for f in frames)
    visual = {'hasVideo': True, 'sampledFrameCount': 8, 'detectedTextFrames': detected_frames,
              'retainedTextFrames': retained_frames, 'retainedTextFrameFraction': retained_frames/8,
              'rawDetectedBoxes': sum(f['detectedBoxCount'] for f in frames),
              'retainedBoxes': sum(f['retainedBoxCount'] for f in frames),
              'meanRetainedTextAreaFraction': sum(f['retainedTextAreaFraction'] for f in frames)/8,
              'maxRetainedTextAreaFraction': max(f['retainedTextAreaFraction'] for f in frames),
              'sufficientSampledTextEvidence': retained_frames>=2, 'characterRecognitionInvoked': False,
              'largeChangePairs': sum(c['largeChange'] for c in changed),
              'nearStaticPairs': sum(c['nearStatic'] for c in changed), 'sampledPairs': 7,
              'frameChanges': changed, 'frames': frames,
              'coverage': 'Eight uniform frames, not continuous video or proof of absence between samples'}
    return visual, {'frameExtractionMs': round(extract_ms, 3), 'textDetectionMs': round(det_ms, 3)}


def classify(audio, visual):
    fraction, text = audio['speechFraction'], visual['sufficientSampledTextEvidence']
    if fraction>=.6 and audio['speechBinCoverage']>=.5:
        code, strength = 'speech', '较强'
    elif fraction>.1:
        code, strength = 'speech', '中等' if fraction>=.4 else '较弱'
    elif fraction==0 and text:
        code, strength = 'visual_text', '中等'
    elif not text:
        code, strength = 'visual', '中等' if fraction<=.1 else '较弱'
    else:
        code, strength = 'pending', '较弱'
    return {'code': code, 'label': RULES['labels'][code], 'ruleEvidenceStrength': strength,
            'accuracyAccepted': False, 'humanReviewPending': True,
            'basis': {'speechPercent': audio['speechPercent'], 'speechBinCoverage': audio['speechBinCoverage'],
                      'retainedTextFrames': visual['retainedTextFrames'], 'sampledFrames': 8},
            'voiceOnlyCoverageConfirmed': False,
            'note': 'Category describes detected components. Speech with text does not prove independent visual information or permit automatic route execution.'}


def process_sample(record, wave_number):
    while not (WAVE/'go.flag').exists():
        if (WAVE/'abort.flag').exists():
            raise RuntimeError('BENCHMARK_ABORTED')
        time.sleep(.05)
    if (WAVE/'abort.flag').exists():
        raise RuntimeError('BENCHMARK_ABORTED')
    started_at, started = utc(), time.perf_counter()
    folder = WAVE/record['workId']
    folder.mkdir(exist_ok=False)
    path = Path(record['sourcePath'])
    try:
        check_start = time.perf_counter()
        if path.stat().st_size!=record['byteLength'] or digest(path)!=record['sha256']:
            raise RuntimeError('SOURCE_CHANGED')
        meta = json.loads(command([FFPROBE, '-v', 'error', '-show_format', '-show_streams', '-of', 'json', path]).stdout)
        duration = float(meta['format']['duration'])
        video = next(s for s in meta['streams'] if s['codec_type']=='video')
        audio_stream = next(s for s in meta['streams'] if s['codec_type']=='audio')
        check_ms = (time.perf_counter()-check_start)*1000
        audio, atime = audio_features(path, int(audio_stream['channels']), duration)
        visual, vtime = frame_features(path, duration, int(video['width']), int(video['height']), folder, wave_number==1)
        decision_start = time.perf_counter()
        category = classify(audio, visual)
        decision_ms = (time.perf_counter()-decision_start)*1000
        output = {'workId': record['workId'], 'durationSeconds': duration, 'sourceSha256': record['sha256'],
                  'audio': audio, 'visual': visual, 'classification': category,
                  'timing': {'sourceVerifyProbeMs': round(check_ms, 3), **atime, **vtime,
                             'classificationRuleMs': round(decision_ms, 3)},
                  'workerPid': os.getpid(), 'startedAt': started_at, 'success': True,
                  'asrInvoked': False, 'textRecognitionInvoked': False, 'cloudInvoked': False,
                  'semanticModelInvoked': False, 'workerRssBytes': psutil.Process().memory_info().rss}
        save_start = time.perf_counter()
        save(folder/'detection-result.json', output)
        output['timing']['resultSaveMs'] = round((time.perf_counter()-save_start)*1000, 3)
        output['timing']['perSampleMs'] = round((time.perf_counter()-started)*1000, 3)
        output['savedAt'] = utc()
        output['identityForConcurrencyCheck'] = {'speechSeconds': audio['speechSeconds'], 'intervals': audio['intervals'],
            'retainedTextFrames': visual['retainedTextFrames'], 'detectedBoxCounts': [f['detectedBoxCount'] for f in visual['frames']],
            'retainedBoxCounts': [f['retainedBoxCount'] for f in visual['frames']], 'classificationCode': category['code']}
        save(folder/'report.json', output)
        # Baseline frames remain for human review. Later waves retain frames too, preserving raw evidence.
        return output
    except Exception as exc:
        output = {'workId': record['workId'], 'workerPid': os.getpid(), 'success': False,
                  'startedAt': started_at, 'savedAt': utc(), 'error': str(exc),
                  'perSampleMs': round((time.perf_counter()-started)*1000, 3)}
        save(folder/'failure.json', output)
        return output


def observed_peak(results):
    events = []
    for r in results:
        events.extend([(datetime.fromisoformat(r['startedAt']).timestamp(), 1),
                       (datetime.fromisoformat(r['savedAt']).timestamp(), -1)])
    active, peak = 0, 0
    for _, delta in sorted(events, key=lambda item: (item[0], item[1])):
        active += delta
        peak = max(peak, active)
    return peak


def main():
    OUT.mkdir(parents=True, exist_ok=False)
    save(OUT/'rules.json', RULES)
    before = audit()
    save(OUT/'before.json', before)
    inventory = json.loads((ROOT/'docs/evidence/processable-material-inventory-20261013/inventory.json').read_text(encoding='utf-8'))
    records = [{k:r[k] for k in ['workId', 'sourcePath', 'sha256', 'byteLength']} for r in inventory['records'] if r['inLibrary']]
    if len(records)!=14 or len({r['workId'] for r in records})!=14:
        raise RuntimeError('EXACTLY_14_LIBRARY_ORIGINALS_REQUIRED')
    db = sqlite3.connect((USER_DATA/'following-directory.sqlite').as_uri()+'?mode=ro', uri=True)
    live = {r[0] for r in db.execute('SELECT work_id FROM creator_video_information')}
    db.close()
    if any(r['workId'] not in live for r in records):
        raise RuntimeError('LIBRARY_SCOPE_CHANGED')
    vad_path = Path(sys.executable).parent.parent/'Lib/site-packages/faster_whisper/assets/silero_vad_v6.onnx'
    report = {'startedAt': utc(), 'records': records, 'scope': '14 originals already in official library; excludes 3 independent triage samples',
              'models': [{'name': 'Silero VAD v6', 'sha256': digest(vad_path)},
                         {'name': 'PP-OCRv5_mobile_det', 'sha256': digest(ROOT/'models/paddleocr/PP-OCRv5_mobile_det_infer/inference.pdiparams')}],
              'machine': {'physicalCores': psutil.cpu_count(logical=False), 'logicalCores': psutil.cpu_count(),
                          'memoryTotalBytes': psutil.virtual_memory().total, 'memoryAvailableBytes': psutil.virtual_memory().available},
              'rules': RULES, 'waves': [], 'noCloud': True, 'noASR': True, 'noTextRecognition': True,
              'noSemanticClassification': True, 'humanAccuracyAssessment': 'pending'}
    save(OUT/'report.json', report)
    baseline, worker_estimate = None, None
    for level in LEVELS:
        available = psutil.virtual_memory().available
        estimated = (worker_estimate or 800*1024**2)*level*1.15+1024**3
        if available-estimated < RULES['limits']['minimumProjectedAvailableBytes']:
            report['resourceStop'] = {'requestedConcurrency': level, 'availableBytes': available,
                                      'estimatedBytes': round(estimated), 'reason': 'Projected available memory below reserved 6GiB'}
            print(json.dumps({'phase': 'resource-limit', **report['resourceStop']}), flush=True)
            break
        folder = OUT/f'concurrency-{level}'
        folder.mkdir()
        wave_start = time.perf_counter()
        metrics = {'minAvailableBytes': available, 'peakChildRssBytes': 0, 'emergency': False, 'samples': 0}
        stop_monitor = threading.Event()
        def monitor():
            while not stop_monitor.is_set():
                vm = psutil.virtual_memory()
                metrics['minAvailableBytes'] = min(metrics['minAvailableBytes'], vm.available)
                try:
                    children = psutil.Process().children(recursive=True)
                    rss = sum(p.memory_info().rss for p in children if p.is_running())
                    metrics['peakChildRssBytes'] = max(metrics['peakChildRssBytes'], rss)
                except (psutil.NoSuchProcess, psutil.AccessDenied):
                    pass
                metrics['samples'] += 1
                if vm.available < RULES['limits']['emergencyAvailableBytes']:
                    metrics['emergency'] = True
                    (folder/'abort.flag').touch()
                    for child in psutil.Process().children(recursive=True):
                        try: child.terminate()
                        except psutil.Error: pass
                    return
                stop_monitor.wait(.25)
        watcher = threading.Thread(target=monitor, daemon=True)
        watcher.start()
        results = []
        print(json.dumps({'phase': 'wave-started', 'concurrency': level, 'availableGiB': round(available/1024**3, 2)}), flush=True)
        try:
            with concurrent.futures.ProcessPoolExecutor(max_workers=level, mp_context=multiprocessing.get_context('spawn'),
                initializer=worker_init, initargs=(str(folder),)) as pool:
                futures = [pool.submit(process_sample, record, level) for record in records]
                deadline = time.perf_counter()+180
                while len(list(folder.glob('ready-*.json')))<level:
                    if time.perf_counter()>deadline or any(f.done() and f.exception() for f in futures) or metrics['emergency']:
                        (folder/'abort.flag').touch()
                        raise RuntimeError('WORKER_INITIALIZATION_FAILED_OR_RESOURCE_LIMIT')
                    time.sleep(.1)
                ready = [json.loads(p.read_text(encoding='utf-8')) for p in folder.glob('ready-*.json')]
                warm_start = time.perf_counter()
                (folder/'go.flag').touch()
                print(json.dumps({'phase': 'workers-ready', 'concurrency': level,
                      'initializationWallMs': round((warm_start-wave_start)*1000, 3)}), flush=True)
                for future in concurrent.futures.as_completed(futures, timeout=900):
                    value = future.result()
                    results.append(value)
                    print(json.dumps({'phase': 'sample-completed', 'concurrency': level, 'workId': value['workId'],
                        'success': value['success'], 'perSampleMs': value.get('timing', {}).get('perSampleMs', value.get('perSampleMs')),
                        'classification': value.get('classification', {}).get('label'),
                        'speechPercent': value.get('audio', {}).get('speechPercent'),
                        'textFrames': value.get('visual', {}).get('retainedTextFrames')}), flush=True)
                warm_ms = (time.perf_counter()-warm_start)*1000
                cold_ms = (time.perf_counter()-wave_start)*1000
        finally:
            stop_monitor.set()
            watcher.join(timeout=2)
        successful = all(r['success'] for r in results) and len(results)==14
        identity = {r['workId']: r.get('identityForConcurrencyCheck') for r in results}
        if baseline is None and successful:
            baseline = identity
        deterministic = successful and stable(identity)==stable(baseline)
        wave = {'concurrencyConfigured': level, 'observedPeakActiveVideos': observed_peak(results),
                'initializationWallMs': round((warm_start-wave_start)*1000, 3), 'warmBatchMs': round(warm_ms, 3),
                'coldBatchThroughSavedResultsMs': round(cold_ms, 3), 'coldIncludesPoolShutdown': False,
                'videosPerMinuteWarm': round(14/(warm_ms/60000), 3),
                'meanPerVideoProcessingMs': round(sum(r.get('timing', {}).get('perSampleMs', r.get('perSampleMs',0)) for r in results)/14, 3),
                'all14Completed': successful, 'sameDetectionAndClassificationAsBaseline': deterministic,
                'resource': metrics, 'workers': ready, 'results': sorted(results, key=lambda r:r['workId'])}
        save(folder/'wave-report.json', wave)
        report['waves'].append(wave)
        save(OUT/'report.json', report)
        worker_estimate = max(r.get('workerRssBytes',0) for r in results) if successful else None
        print(json.dumps({'phase': 'wave-completed', 'concurrency': level, 'warmBatchMs': wave['warmBatchMs'],
                         'coldBatchMs': wave['coldBatchThroughSavedResultsMs'], 'sameResults': deterministic,
                         'peakChildRssGiB': round(metrics['peakChildRssBytes']/1024**3, 2)}), flush=True)
        if not successful or not deterministic or metrics['emergency']:
            report['qualityStop'] = {'concurrency': level, 'reason': 'Failure, output mismatch or emergency memory limit'}
            break
    after = audit()
    save(OUT/'after.json', after)
    report['retention'] = {name: stable(before[name])==stable(after[name]) for name in
                           ['databases', 'credentials', 'runtimeSha256', 'appAsarSha256']}
    good = [wave for wave in report['waves'] if wave['all14Completed'] and wave['sameDetectionAndClassificationAsBaseline']]
    report['highestVerifiedConcurrency'] = max((w['observedPeakActiveVideos'] for w in good), default=0)
    report['fastestWarmConcurrency'] = min(good, key=lambda w:w['warmBatchMs'])['concurrencyConfigured'] if good else None
    report['fastestColdConcurrency'] = min(good, key=lambda w:w['coldBatchThroughSavedResultsMs'])['concurrencyConfigured'] if good else None
    report['scriptElapsedMs'] = round((time.perf_counter()-START)*1000, 3)
    report['finishedAt'] = utc()
    report['status'] = 'complete' if len(good)==len(report['waves']) and all(report['retention'].values()) else 'needs-review'
    save(OUT/'report.json', report)
    print(json.dumps({'phase': 'complete', 'highestVerifiedConcurrency': report['highestVerifiedConcurrency'],
                     'fastestWarmConcurrency': report['fastestWarmConcurrency'], 'fastestColdConcurrency': report['fastestColdConcurrency'],
                     'scriptElapsedMs': report['scriptElapsedMs'], 'retention': report['retention']}), flush=True)


if __name__ == '__main__':
    multiprocessing.freeze_support()
    try:
        main()
    except Exception as error:
        if OUT.exists():
            save(OUT/'failure.json', {'at': utc(), 'error': str(error)})
        print(json.dumps({'phase': 'failed', 'error': str(error)}), flush=True)
        raise

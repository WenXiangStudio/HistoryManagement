"""Authorized three-video trial: local Silero VAD + eight-frame mobile OCR.

No ASR, language-model summary, cloud request, title-based classification or
Codex visual/audio judgement. Raw OCR stays in local evidence. Console output
contains only numerical measurements and fixed-rule labels.
"""
from __future__ import annotations

import os
import sys
import time

START = time.perf_counter()
os.environ['PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK'] = 'True'
os.environ['HF_HUB_OFFLINE'] = '1'
os.environ['HF_DATASETS_OFFLINE'] = '1'
os.environ['OMP_NUM_THREADS'] = '4'

import contextlib
import hashlib
import importlib.metadata
import json
import math
import re
import subprocess
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'local-data/type-boundary-20261011'
OUTPUT = ROOT / 'local-data/local-video-triage-20261011'
FFMPEG = ROOT / 'node_modules/@ffmpeg-installer/win32-x64/ffmpeg.exe'
FFPROBE = ROOT / 'node_modules/@ffprobe-installer/win32-x64/ffprobe.exe'
RULES = {
    'version': 'local-vad-ocr-triage-v1',
    'vad': {'model': 'silero_vad_v6.onnx', 'samplingRate': 16000, 'threshold': .5,
            'negThreshold': .35, 'minSpeechDurationMs': 250, 'minSilenceDurationMs': 200,
            'speechPadMs': 0, 'channelPolicy': 'choose the decoded channel with highest whole-track RMS; no phase-cancelling mix',
            'highSpeechFraction': .6, 'someSpeechFraction': .05},
    'ocr': {'models': ['PP-OCRv5_mobile_det', 'PP-OCRv5_mobile_rec'],
            'framesPerVideo': 8, 'lastRequestedFrame': 'video stream duration minus 0.25 seconds',
            'maximumDimension': 1280, 'minimumRecognitionScore': .8, 'minimumAlphanumericCharacters': 2,
            'identityRegex': r'(?i)(抖音|douyin|https?://|^@)',
            'persistentSmallEdgeRule': 'same normalized text in >=50% frames, height<=6%, area<=2.5%, center in outer 10% vertical or 12% horizontal',
            'sufficientTextEvidence': 'at least 2 frames retain text and at least 4 unique alphanumeric characters',
            'overlayRemovalStatus': 'heuristic only; original text and boxes retained'},
    'classification': [
        'speech fraction >=60%: speech-rich candidate, talking head versus audiovisual demonstration unresolved',
        'speech fraction >=5%: mixed/intermittent speech candidate, information dominance unresolved',
        'speech fraction >0% but <5%: sparse suspected speech, semantic type unresolved',
        'zero detected speech + sufficient retained OCR: visual-text candidate, music not verified',
        'zero detected speech + some retained OCR: limited visual-text evidence, unresolved',
        'zero detected speech + no retained OCR: non-speech visual candidate, neither music nor whole-video absence of text verified',
    ],
    'groundTruth': 'pending user adjudication',
    'thresholdStatus': 'fixed before running these three samples; no accuracy claim',
}
NETWORK_ATTEMPTS = []


def guard(event, args):
    if event in {'socket.connect', 'socket.connect_ex', 'socket.getaddrinfo'}:
        NETWORK_ATTEMPTS.append({'event': event})
        raise RuntimeError('LOCAL_ONLY_NETWORK_BLOCKED')


sys.addaudithook(guard)

import numpy as np


def save(name, value):
    (OUTPUT / name).write_text(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False), encoding='utf-8')


def command(args):
    result = subprocess.run([str(a) for a in args], capture_output=True, timeout=180,
                            creationflags=subprocess.CREATE_NO_WINDOW)
    if result.returncode:
        raise RuntimeError('LOCAL_MEDIA_COMMAND_FAILED:' + result.stderr.decode('utf-8', errors='replace')[-900:])
    return result


def digest(path):
    with Path(path).open('rb') as source:
        return hashlib.file_digest(source, 'sha256').hexdigest()


def prepare_audio(path, channels):
    result = command([FFMPEG, '-hide_banner', '-loglevel', 'info', '-threads', '2', '-i', path,
                      '-map', '0:a:0', '-vn', '-af', 'aresample=16000,ashowinfo',
                      '-f', 'f32le', '-acodec', 'pcm_f32le', 'pipe:1'])
    samples = np.frombuffer(result.stdout, dtype='<f4').reshape(-1, channels)
    stamps = [(float(t), int(rate), int(count)) for t, rate, count in re.findall(
        r'pts_time:([-+\d.eE]+).*rate:(\d+) nb_samples:(\d+)', result.stderr.decode(errors='replace'))]
    if not len(samples) or not np.isfinite(samples).all() or not stamps:
        raise RuntimeError('INVALID_AUDIO')
    if sum(x[2] for x in stamps) != len(samples) or any(x[1] != 16000 for x in stamps):
        raise RuntimeError('AUDIO_TIMESTAMP_COUNT_MISMATCH')
    if any(abs(stamps[i][0]-stamps[i-1][0]-stamps[i-1][2]/16000) > .002 for i in range(1, len(stamps))):
        raise RuntimeError('AUDIO_TIMELINE_DISCONTINUITY')
    channel_rms = np.sqrt(np.mean(np.square(samples, dtype=np.float64), axis=0))
    selected = int(np.argmax(channel_rms))
    return np.array(samples[:, selected], dtype=np.float32), {'startSeconds': stamps[0][0],
        'decodedSeconds': len(samples)/16000, 'selectedChannelZeroBased': selected,
        'channelRms': channel_rms.tolist(), 'unassessedInitialSeconds': max(0, stamps[0][0])}


def frame_samples(path, video, folder):
    width, height = int(video['width']), int(video['height'])
    ratio = min(1, 1280/max(width, height))
    scaled_w, scaled_h = round(width*ratio/2)*2, round(height*ratio/2)*2
    samples = []
    end = max(0, float(video['duration'])-.25)
    for n, target in enumerate(np.linspace(0, end, RULES['ocr']['framesPerVideo'])):
        destination = folder / f'frame-{n+1:02d}.jpg'
        result = command([FFMPEG, '-hide_banner', '-loglevel', 'info', '-threads', '2', '-y', '-i', path,
                          '-map', '0:v:0', '-an', '-vf', f"select='gte(t,{float(target):.6f})',scale={scaled_w}:{scaled_h},showinfo",
                          '-frames:v', '1', '-vsync', '0', '-q:v', '3', destination])
        times = re.findall(r'\bpts_time:\s*([-+\d.eE]+)', result.stderr.decode(errors='replace'))
        if not destination.is_file() or not times:
            raise RuntimeError('FRAME_TIMESTAMP_UNAVAILABLE')
        actual = float(times[0])
        if abs(actual-float(target)) > .1:
            raise RuntimeError('FRAME_TIMESTAMP_MISMATCH')
        samples.append({'id': n+1, 'requestedSeconds': round(float(target), 6), 'timeSeconds': actual,
                        'path': str(destination), 'width': scaled_w, 'height': scaled_h,
                        'sha256': digest(destination)})
    return samples


def normalize(text):
    return ''.join(c.casefold() for c in text if c.isalnum())


def ocr_features(frames, blocks):
    usable = [b for b in blocks if b['confidence'] >= .8 and len(normalize(b['text'])) >= 2]
    occurrences = {}
    for b in usable:
        occurrences.setdefault(normalize(b['text']), set()).add(b['frameId'])
    for b in blocks:
        exclusions = []
        if b['confidence'] < .8:
            exclusions.append('low-recognition-score')
        if len(normalize(b['text'])) < 2:
            exclusions.append('too-few-characters')
        if re.search(RULES['ocr']['identityRegex'], b['text']):
            exclusions.append('identity-pattern-candidate')
        x1, y1, x2, y2 = b['normalizedBox']
        cx, cy = (x1+x2)/2, (y1+y2)/2
        small = y2-y1 <= .06 and (x2-x1)*(y2-y1) <= .025
        edge = cy < .10 or cy > .90 or cx < .12 or cx > .88
        repeated = len(occurrences.get(normalize(b['text']), set())) >= math.ceil(len(frames)*.5)
        if small and edge and repeated:
            exclusions.append('persistent-small-edge-candidate')
        b['exclusionReasons'] = exclusions
        b['retainedTextCandidate'] = not exclusions
    retained = [b for b in blocks if b['retainedTextCandidate']]
    unique = set(normalize(b['text']) for b in retained)
    ids = set(b['frameId'] for b in retained)
    chars = sum(len(t) for t in unique)
    return {'sampledFrameCount': len(frames),
            'framesWithDetectedBoxes': sum(f['detectedBoxCount']>0 for f in frames),
            'detectedBoxCount': sum(f['detectedBoxCount'] for f in frames),
            'recognizedBlockCount': len(blocks), 'highScoreBlockCount': len(usable),
            'retainedTextBlockCount': len(retained), 'framesWithRetainedText': len(ids),
            'retainedFramePercent': round(len(ids)/len(frames)*100, 3),
            'uniqueRetainedTextCount': len(unique), 'uniqueRetainedCharacterCount': chars,
            'excludedReasonCounts': dict(Counter(reason for b in blocks for reason in b['exclusionReasons'])),
            'sufficientSampledTextEvidence': len(ids)>=2 and chars>=4,
            'substantiveTextHumanVerified': False}


def classify(vad, ocr):
    fraction = vad['speechFraction']
    if fraction >= .6:
        code, label = 'speech_rich_unresolved_visual_role', '疑似讲述较多；口播主导与音画结合待区分'
    elif fraction >= .05:
        code, label = 'intermittent_speech_unresolved_dominance', '检测到间歇性疑似语音；信息主导类型待确认'
    elif fraction > 0:
        code, label = 'sparse_speech_unresolved', '检测到少量疑似语音；内容类型待确认'
    elif ocr['sufficientSampledTextEvidence']:
        code, label = 'no_speech_detected_visual_text_candidate', '未检出疑似语音；画面文字类候选，是否纯音乐待确认'
    elif ocr['retainedTextBlockCount']:
        code, label = 'no_speech_detected_limited_text', '未检出疑似语音；少量文字线索，类型待确认'
    else:
        code, label = 'no_speech_detected_no_retained_text_candidate', '未检出疑似语音或保留文字；非讲述画面类候选，音乐及全片无字均未确认'
    return {'code': code, 'label': label, 'finalFourWayType': 'undetermined',
            'musicPresence': 'not-tested', 'needsHumanAdjudication': True,
            'basis': 'fixed numerical rules only; no title, transcript or semantic visual judgement'}


def main():
    OUTPUT.mkdir(parents=True, exist_ok=False)
    save('rules.json', RULES)
    report = {'startedAt': datetime.now(timezone.utc).isoformat(), 'rules': RULES,
              'modelsLoaded': [], 'samples': [], 'asrInvoked': False, 'languageModelInvoked': False,
              'cloudInvoked': False, 'codexViewedMedia': False, 'networkAttemptsBlocked': NETWORK_ATTEMPTS}
    save('report.json', report)
    start = time.perf_counter()
    from faster_whisper.vad import VadOptions, get_speech_timestamps, get_vad_model
    get_vad_model()
    report['vadImportAndLoadMs'] = round((time.perf_counter()-start)*1000, 3)
    vad_path = Path(sys.executable).parent.parent/'Lib/site-packages/faster_whisper/assets/silero_vad_v6.onnx'
    report['modelsLoaded'].append({'name': 'Silero VAD v6', 'sha256': digest(vad_path)})
    print(json.dumps({'phase': 'vad-ready', 'elapsedMs': report['vadImportAndLoadMs']}), flush=True)
    start = time.perf_counter()
    with contextlib.redirect_stdout(sys.stderr):
        from paddleocr import PaddleOCR
        ocr = PaddleOCR(device='cpu', cpu_threads=4,
            text_detection_model_name='PP-OCRv5_mobile_det', text_recognition_model_name='PP-OCRv5_mobile_rec',
            text_detection_model_dir=str(ROOT/'models/paddleocr/PP-OCRv5_mobile_det_infer'),
            text_recognition_model_dir=str(ROOT/'models/paddleocr/PP-OCRv5_mobile_rec_infer'),
            use_doc_orientation_classify=False, use_doc_unwarping=False, use_textline_orientation=False)
    report['ocrImportAndLoadMs'] = round((time.perf_counter()-start)*1000, 3)
    for name in ['PP-OCRv5_mobile_det', 'PP-OCRv5_mobile_rec']:
        report['modelsLoaded'].append({'name': name, 'sha256': digest(ROOT/f'models/paddleocr/{name}_infer/inference.pdiparams')})
    report['versions'] = {name: importlib.metadata.version(name) for name in ['faster-whisper', 'onnxruntime', 'paddleocr', 'paddlepaddle']}
    print(json.dumps({'phase': 'ocr-ready', 'elapsedMs': report['ocrImportAndLoadMs']}), flush=True)
    prior = json.loads((SOURCE/'report.json').read_text(encoding='utf-8'))
    technical = json.loads((ROOT/'local-data/video-signals-no-model-20261011/report.json').read_text(encoding='utf-8'))
    for sample in prior['records']:
        total = time.perf_counter()
        index = sample['index']
        folder = OUTPUT/f'sample-{index}'
        folder.mkdir()
        receipt = json.loads((SOURCE/f'sample-{index}-acquisition.json').read_text(encoding='utf-8'))
        path = Path(receipt['evidence']['mediaPath'])
        if digest(path) != sample['media']['sha256']:
            raise RuntimeError('SOURCE_HASH_MISMATCH')
        metadata = json.loads(command([FFPROBE, '-v', 'error', '-show_format', '-show_streams', '-of', 'json', path]).stdout)
        audio_stream = next(s for s in metadata['streams'] if s['codec_type']=='audio')
        video_stream = next(s for s in metadata['streams'] if s['codec_type']=='video')
        start = time.perf_counter()
        audio, audio_meta = prepare_audio(path, int(audio_stream['channels']))
        audio_prep = round((time.perf_counter()-start)*1000, 3)
        start = time.perf_counter()
        chunks = get_speech_timestamps(audio, VadOptions(threshold=.5, neg_threshold=.35,
            min_speech_duration_ms=250, min_silence_duration_ms=200, speech_pad_ms=0), sampling_rate=16000)
        vad_elapsed = round((time.perf_counter()-start)*1000, 3)
        speech_samples = sum(c['end']-c['start'] for c in chunks)
        vad = {**audio_meta, 'speechFraction': speech_samples/len(audio),
               'speechPercent': round(speech_samples/len(audio)*100, 3),
               'speechSeconds': speech_samples/16000, 'intervalCount': len(chunks),
               'intervals': [{'startSeconds': round(audio_meta['startSeconds']+c['start']/16000, 4),
                              'endSeconds': round(audio_meta['startSeconds']+c['end']/16000, 4)} for c in chunks]}
        del audio
        print(json.dumps({'phase': 'vad-completed', 'index': index, 'speechPercent': vad['speechPercent'], 'elapsedMs': vad_elapsed}), flush=True)
        start = time.perf_counter()
        frames = frame_samples(path, video_stream, folder)
        frame_elapsed = round((time.perf_counter()-start)*1000, 3)
        start = time.perf_counter()
        blocks = []
        for frame in frames:
            frame['detectedBoxCount'] = 0
            with contextlib.redirect_stdout(sys.stderr):
                for result in ocr.predict(frame['path']):
                    payload = result.json
                    if callable(payload):
                        payload = payload()
                    value = payload.get('res', payload)
                    frame['detectedBoxCount'] += len(value.get('dt_polys', []))
                    texts, scores = value.get('rec_texts', []), value.get('rec_scores', [])
                    polygons = value.get('rec_polys', [])
                    if len(texts) != len(scores) or len(texts) != len(polygons):
                        raise RuntimeError('OCR_TEXT_GEOMETRY_MISMATCH')
                    for text, score, polygon in zip(texts, scores, polygons):
                        coords = np.asarray(polygon, dtype=float)
                        if not str(text).strip():
                            continue
                        box = [float(coords[:,0].min()/frame['width']), float(coords[:,1].min()/frame['height']),
                               float(coords[:,0].max()/frame['width']), float(coords[:,1].max()/frame['height'])]
                        blocks.append({'frameId': frame['id'], 'timeSeconds': frame['timeSeconds'],
                                       'text': str(text), 'confidence': float(score), 'normalizedBox': box})
            print(json.dumps({'phase': 'ocr-frame-completed', 'index': index, 'frame': frame['id']}), flush=True)
        ocr_elapsed = round((time.perf_counter()-start)*1000, 3)
        features = ocr_features(frames, blocks)
        save(f'sample-{index}/ocr-raw.json', {'frames': frames, 'blocks': blocks})
        previous = next(s for s in technical['samples'] if s['index']==index)
        output = {'index': index, 'shareUrl': sample['shareUrl'], 'workId': sample['workId'],
                  'sha256': sample['media']['sha256'], 'durationSeconds': sample['media']['durationSeconds'],
                  'vad': vad, 'ocr': features, 'samplingTimesSeconds': [f['timeSeconds'] for f in frames],
                  'existingTechnicalEvidence': {'largePixelChangePairPercent': previous['video']['largeChangePairPercent'],
                      'source': 'video-signals-no-model-20261011/report.json'},
                  'classification': classify(vad, features), 'timing': {'audioDecodeMs': audio_prep, 'vadInferenceMs': vad_elapsed,
                      'frameExtractionMs': frame_elapsed, 'ocrInferenceMs': ocr_elapsed,
                      'perSampleElapsedMs': round((time.perf_counter()-total)*1000, 3)},
                  'accuracyAccepted': False}
        report['samples'].append(output)
        save('report.json', report)
        print(json.dumps({'phase': 'sample-completed', **output}, ensure_ascii=False), flush=True)
    report['scriptElapsedMs'] = round((time.perf_counter()-START)*1000, 3)
    report['finishedAt'] = datetime.now(timezone.utc).isoformat()
    report['stopReason'] = 'BOUNDED_LOCAL_TRIAGE_COMPLETED_WAITING_FOR_USER_ADJUDICATION'
    save('report.json', report)
    print(json.dumps({'phase': 'completed', 'scriptElapsedMs': report['scriptElapsedMs'],
                      'networkAttemptsBlocked': len(NETWORK_ATTEMPTS)}), flush=True)


if __name__ == '__main__':
    main()

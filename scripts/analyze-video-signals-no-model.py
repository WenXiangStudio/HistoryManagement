"""Deterministic signal audit of the three authorized media files. No inference.

Dependencies: Python standard library, NumPy, bundled FFmpeg/FFprobe.
No network, ASR, VAD, OCR, model loading, image export, or playback.
Reads only identity/path/hash fields from existing acquisition receipts.
"""
from __future__ import annotations

import hashlib
import json
import math
import re
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
PRIOR = ROOT / 'local-data/type-boundary-20261011'
OUTPUT = ROOT / 'local-data/video-signals-no-model-20261011'
FFMPEG = ROOT / 'node_modules/@ffmpeg-installer/win32-x64/ffmpeg.exe'
FFPROBE = ROOT / 'node_modules/@ffprobe-installer/win32-x64/ffprobe.exe'
RATE = 16000
WINDOW_SECONDS = .02
RULES = {
    'audio': {'sampleRate': RATE, 'windowSeconds': WINDOW_SECONDS,
              'energy': 'mean square across all channels; never sum channels before squaring',
              'lowLevelThresholdsDbfs': [-50, -40, -30], 'minimumQuietRunSeconds': .3,
              'noDigitalSignalRule': 'maximum absolute decoded sample is exactly zero',
              'sustainedSignalRule': 'at least 95% of analyzed time has window RMS >= -40 dBFS'},
    'video': {'sampleFps': 2, 'scaledWidth': 160, 'pixelFormat': 'gray',
              'nearUnchangedPair': 'mean absolute pixel delta <= 1% of 255 AND fraction of pixels with delta >= 25 <= 1%',
              'largeChangePair': 'mean absolute pixel delta >= 8% of 255 AND fraction of pixels with delta >= 25 >= 25%',
              'labels': '>=95% near-unchanged pairs: mostly stable samples; >=20% large-change pairs: frequent large changes; otherwise: other sampled changes'},
    'semanticClassification': 'undetermined; these rules do not identify speech, music, text, objects, or information dominance',
    'thresholdStatus': 'fixed before reading numerical results; exploratory, not calibrated or validated classifiers',
}


def run(args):
    started = time.perf_counter()
    result = subprocess.run([str(a) for a in args], capture_output=True, timeout=180,
                            creationflags=subprocess.CREATE_NO_WINDOW)
    if result.returncode:
        raise RuntimeError('MEDIA_COMMAND_FAILED: ' + result.stderr.decode('utf-8', errors='replace')[-1200:])
    return result, round((time.perf_counter() - started) * 1000, 3)


def dbfs(amplitude):
    return round(20 * math.log10(float(amplitude)), 3) if amplitude > 0 else None


def quiet_runs(mask, durations, start_time):
    result = []
    start = None
    cursor = start_time
    for low, duration in zip(mask, durations):
        if low and start is None:
            start = cursor
        if not low and start is not None:
            if cursor - start >= .3 - 1e-8:
                result.append({'startSeconds': round(start, 3), 'endSeconds': round(cursor, 3), 'durationSeconds': round(cursor - start, 3)})
            start = None
        cursor += float(duration)
    if start is not None and cursor - start >= .3 - 1e-8:
        result.append({'startSeconds': round(start, 3), 'endSeconds': round(cursor, 3), 'durationSeconds': round(cursor - start, 3)})
    return result


def analyze_audio(path, stream, index):
    channels = int(stream['channels'])
    raw, elapsed = run([FFMPEG, '-hide_banner', '-loglevel', 'info', '-threads', '2', '-i', path,
                        '-map', '0:a:0', '-vn', '-af', f'aresample={RATE},ashowinfo',
                        '-f', 'f32le', '-acodec', 'pcm_f32le', 'pipe:1'])
    samples = np.frombuffer(raw.stdout, dtype='<f4').reshape(-1, channels)
    if not len(samples) or not np.isfinite(samples).all():
        raise RuntimeError('INVALID_DECODED_AUDIO')
    stamps = [(float(t), int(rate), int(count)) for t, rate, count in re.findall(
        r'pts_time:([-+\d.eE]+).*rate:(\d+) nb_samples:(\d+)', raw.stderr.decode('utf-8', errors='replace'))]
    if not stamps or sum(s[2] for s in stamps) != len(samples) or any(s[1] != RATE for s in stamps):
        raise RuntimeError('AUDIO_TIMESTAMPS_MISMATCH')
    timestamp_error = max(abs(stamps[i][0] - stamps[i-1][0] - stamps[i-1][2]/RATE) for i in range(1, len(stamps)))
    if timestamp_error > .002:
        raise RuntimeError('AUDIO_TIMELINE_GAP_REQUIRES_REVIEW')
    samples_per_window = round(RATE * WINDOW_SECONDS)
    whole = len(samples) // samples_per_window
    split = whole * samples_per_window
    blocks = samples[:split].reshape(whole, samples_per_window, channels)
    energy = np.mean(np.square(blocks, dtype=np.float64), axis=(1, 2))
    sizes = np.full(whole, samples_per_window)
    if split < len(samples):
        energy = np.append(energy, np.mean(np.square(samples[split:], dtype=np.float64)))
        sizes = np.append(sizes, len(samples) - split)
    durations = sizes / RATE
    rms = np.sqrt(energy)
    levels = 20 * np.log10(np.maximum(rms, 1e-12))
    start = stamps[0][0]
    thresholds = []
    for threshold in RULES['audio']['lowLevelThresholdsDbfs']:
        low = levels < threshold
        runs = quiet_runs(low, durations, start)
        seconds = float(np.sum(durations[low]))
        thresholds.append({'thresholdDbfs': threshold, 'lowLevelSeconds': round(seconds, 3),
                           'lowLevelPercent': round(seconds / durations.sum() * 100, 3),
                           'quietRunsAtLeast300ms': runs})
    peak = float(np.max(np.abs(samples)))
    main = next(t for t in thresholds if t['thresholdDbfs'] == -40)
    label = 'digital_silence' if peak == 0 else ('sustained_signal_above_threshold' if main['lowLevelPercent'] <= 5 else 'signal_with_low_level_intervals')
    rows = [{'startSeconds': round(start + i * WINDOW_SECONDS, 3), 'durationSeconds': round(float(durations[i]), 5),
             'rmsDbfs': round(float(level), 3)} for i, level in enumerate(levels)]
    (OUTPUT / f'sample-{index}-audio-windows.json').write_text(json.dumps(rows, indent=2), encoding='utf-8')
    return {'decodedSeconds': round(len(samples) / RATE, 6), 'startSeconds': start,
            'decodedEndSeconds': round(start + len(samples) / RATE, 6),
            'maximumTimestampDiscontinuitySeconds': round(timestamp_error, 6),
            'initialUnassessedSeconds': max(0, start),
            'percentageDenominator': 'decoded PCM duration; initial uncovered interval is not counted as silence',
            'limitations': ['AAC decoding may start after container time zero; timestamps reflect actual decoded samples',
                            '20 ms RMS thresholds are energy measurements, not speech or music detection'],
            'channelCount': channels, 'windowCount': len(levels),
            'overallRmsDbfs': dbfs(np.sqrt(np.sum(energy * sizes) / sizes.sum())),
            'peakDbfs': dbfs(peak), 'allDecodedSamplesZero': peak == 0,
            'windowLevelP10Dbfs': round(float(np.percentile(levels, 10)), 3),
            'windowLevelP90Dbfs': round(float(np.percentile(levels, 90)), 3),
            'thresholdChecks': thresholds, 'technicalLabel': label, 'decodeElapsedMs': elapsed}


def analyze_video(path, stream, index):
    width = RULES['video']['scaledWidth']
    height = round(width * int(stream['height']) / int(stream['width']))
    vf = f'fps=2:start_time=0,scale={width}:{height}:flags=area,format=gray,showinfo'
    raw, elapsed = run([FFMPEG, '-hide_banner', '-loglevel', 'info', '-threads', '2', '-i', path,
                        '-map', '0:v:0', '-an', '-vf', vf, '-vsync', '0', '-f', 'rawvideo', '-pix_fmt', 'gray', 'pipe:1'])
    frames = np.frombuffer(raw.stdout, dtype=np.uint8).reshape(-1, height, width)
    times = [float(m) for m in re.findall(r'\bpts_time:\s*([-+\d.eE]+)', raw.stderr.decode('utf-8', errors='replace'))]
    if len(times) != len(frames) or len(frames) < 2:
        raise RuntimeError('FRAME_TIMESTAMPS_MISMATCH')
    diff = np.abs(frames[1:].astype(np.int16) - frames[:-1].astype(np.int16))
    means = np.mean(diff, axis=(1, 2)) / 255
    changed = np.mean(diff >= 25, axis=(1, 2))
    stable = (means <= .01) & (changed <= .01)
    large = (means >= .08) & (changed >= .25)
    rows = [{'fromSeconds': times[i], 'toSeconds': times[i+1],
             'meanPixelDeltaPercent': round(float(means[i] * 100), 3),
             'changedPixelsPercent': round(float(changed[i] * 100), 3),
             'nearUnchanged': bool(stable[i]), 'largeChange': bool(large[i])} for i in range(len(means))]
    (OUTPUT / f'sample-{index}-pixel-differences.json').write_text(json.dumps(rows, indent=2), encoding='utf-8')
    label = 'mostly_stable_samples' if np.mean(stable) >= .95 else ('frequent_large_sample_changes' if np.mean(large) >= .2 else 'other_sampled_changes')
    return {'sampleFps': 2, 'frameCount': len(frames), 'pairCount': len(means), 'firstSampleSeconds': times[0],
            'lastSampleSeconds': times[-1], 'scaledDimensions': [width, height],
            'meanPixelDeltaPercent': round(float(np.mean(means) * 100), 3),
            'p90PixelDeltaPercent': round(float(np.percentile(means, 90) * 100), 3),
            'nearUnchangedPairCount': int(np.sum(stable)), 'nearUnchangedPairPercent': round(float(np.mean(stable)*100), 3),
            'largeChangePairCount': int(np.sum(large)), 'largeChangePairPercent': round(float(np.mean(large)*100), 3),
            'technicalLabel': label, 'decodeElapsedMs': elapsed,
            'limitations': ['2 fps grayscale samples; short changes between samples, color-only changes and fine text may be missed',
                            'pixel changes do not identify objects, scene cuts, subtitles, actions, speech or semantic information']}


def main():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    started = time.perf_counter()
    report = {'startedAt': datetime.now(timezone.utc).isoformat(), 'rules': RULES, 'samples': [],
              'noModelExecution': True, 'noNetworkOperations': True, 'rawImagesOrAudioPresentedToCodex': False}
    (OUTPUT / 'rules.json').write_text(json.dumps(RULES, indent=2), encoding='utf-8')
    prior = json.loads((PRIOR / 'report.json').read_text(encoding='utf-8'))
    for sample in prior['records']:
        sample_started = time.perf_counter()
        i = sample['index']
        receipt = json.loads((PRIOR / f'sample-{i}-acquisition.json').read_text(encoding='utf-8'))
        path = Path(receipt['evidence']['mediaPath'])
        with path.open('rb') as source:
            digest = hashlib.file_digest(source, 'sha256').hexdigest()
        if digest != sample['media']['sha256']:
            raise RuntimeError('MEDIA_HASH_MISMATCH')
        raw, _ = run([FFPROBE, '-v', 'error', '-show_format', '-show_streams', '-of', 'json', path])
        metadata = json.loads(raw.stdout)
        audio = next(s for s in metadata['streams'] if s['codec_type'] == 'audio')
        video = next(s for s in metadata['streams'] if s['codec_type'] == 'video')
        result = {'index': i, 'shareUrl': sample['shareUrl'], 'workId': sample['workId'], 'sha256': digest,
                  'containerDurationSeconds': float(metadata['format']['duration']),
                  'audio': analyze_audio(path, audio, i), 'video': analyze_video(path, video, i),
                  'contentType': 'undetermined', 'speechPresent': 'undetermined', 'musicPresent': 'undetermined',
                  'substantiveVisualTextPresent': 'undetermined', 'informationDominance': 'undetermined'}
        result['localAnalysisElapsedMs'] = round((time.perf_counter()-sample_started)*1000, 3)
        report['samples'].append(result)
        print(json.dumps({'index': i, 'completed': True, 'localAnalysisElapsedMs': result['localAnalysisElapsedMs']}), flush=True)
    report['analysisScriptElapsedMs'] = round((time.perf_counter()-started)*1000, 3)
    report['finishedAt'] = datetime.now(timezone.utc).isoformat()
    report['stopReason'] = 'UNABLE_TO_DETERMINE_SEMANTIC_TYPE_FROM_THESE_NON_MODEL_SIGNALS'
    (OUTPUT / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False), encoding='utf-8')


if __name__ == '__main__':
    main()

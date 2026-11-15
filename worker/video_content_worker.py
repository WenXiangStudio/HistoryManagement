"""Local content worker. Models are explicit local artifacts; inference never downloads them."""
from __future__ import annotations

import contextlib
import hashlib
import importlib.metadata
import json
import math
import re
import subprocess
import sys
import time
from pathlib import Path

_asr = None
_asr_key = None
_ocr = None


def run(command, timeout=1800):
    result = subprocess.run(command, capture_output=True, timeout=timeout)
    if result.returncode:
        raise RuntimeError("MEDIA_COMMAND_FAILED")
    return result


def save(path: Path, value):
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")
    temporary.replace(path)


def digest(path: Path):
    h = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def probe(params):
    source = Path(params["mediaPath"])
    result = json.loads(run([params["ffprobe"], "-v", "error", "-show_streams", "-show_format", "-of", "json", str(source)]).stdout)
    duration = float(result.get("format", {}).get("duration", 0))
    if not math.isfinite(duration) or duration <= 0:
        raise ValueError("INVALID_MEDIA_DURATION")
    expected = params.get("expectedDurationMs")
    if expected and abs(duration * 1000 - expected) > max(1500, expected * .02):
        raise ValueError("VIDEO_MEDIA_DURATION_MISMATCH")
    content_hash = digest(source)
    if params.get("expectedSha256") and params["expectedSha256"] != content_hash:
        raise ValueError("VIDEO_MEDIA_HASH_MISMATCH")
    return {"durationMs": round(duration * 1000), "hasAudio": any(s.get("codec_type") == "audio" for s in result["streams"]),
            "hasVideo": any(s.get("codec_type") == "video" for s in result["streams"]), "sha256": content_hash}


def transcribe(params):
    global _asr, _asr_key, _ocr
    started = time.monotonic()
    output = Path(params["outputDir"])
    output.mkdir(parents=True, exist_ok=True)
    metadata = probe(params)
    model_path = Path(params["modelPath"])
    if not (model_path / "model.bin").is_file():
        raise RuntimeError("ASR_MODEL_UNAVAILABLE")
    config = {"provider": "faster-whisper", "version": importlib.metadata.version("faster-whisper"),
              "model": "small", "modelRevision": params.get("modelRevision", "local"), "computeType": "int8", "language": "zh", "beamSize": 5}
    key = hashlib.sha256(json.dumps({"input": metadata["sha256"], "config": config}, sort_keys=True).encode()).hexdigest()
    path = output / "transcript.json"
    if path.exists():
        cached = json.loads(path.read_text(encoding="utf-8"))
        if cached.get("inputHash") == key:
            return {**cached, "cacheHit": True}
    if not metadata["hasAudio"]:
        result = {"status": "empty", "emptyReason": "no-audio-track", "segments": [], "metadata": metadata, "config": config, "inputHash": key}
        save(path, result)
        return result
    audio = output / "audio.wav"
    run([params["ffmpeg"], "-hide_banner", "-loglevel", "error", "-y", "-i", params["mediaPath"],
         "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", str(audio)])
    with contextlib.redirect_stdout(sys.stderr):
        from faster_whisper import WhisperModel
        if _asr is None or _asr_key != str(model_path):
            _ocr = None
            _asr = WhisperModel(str(model_path), device="cpu", compute_type="int8", cpu_threads=8, local_files_only=True)
            _asr_key = str(model_path)
        segments, info = _asr.transcribe(str(audio), language="zh", beam_size=5, vad_filter=True, word_timestamps=False)
        rows = []
        for segment in segments:
            text = segment.text.strip()
            if text:
                rows.append({"id": f"speech-{len(rows)+1}", "startMs": round(segment.start * 1000), "endMs": round(segment.end * 1000),
                             "text": text, "avgLogprob": segment.avg_logprob, "noSpeechProbability": segment.no_speech_prob})
    result = {"status": "succeeded" if rows else "empty", "emptyReason": None if rows else "no-speech-detected",
              "segments": rows, "metadata": metadata, "config": config, "inputHash": key,
              "elapsedMs": round((time.monotonic()-started)*1000), "cacheHit": False}
    save(path, result)
    return result


def extract_frames(params):
    started = time.monotonic()
    output = Path(params["outputDir"])
    output.mkdir(parents=True, exist_ok=True)
    metadata = probe(params)
    if not metadata["hasVideo"]:
        return {"status": "empty", "frames": [], "metadata": metadata}
    frame_dir = output / "frames"
    frame_dir.mkdir(exist_ok=True)
    interval = float(params.get('frameIntervalSeconds') or max(2., metadata["durationMs"] / 1000 / 120))
    frames = []
    for kind, expression in [("timeline", f"isnan(prev_selected_t)+gte(t-prev_selected_t\\,{interval:.6f})"),
                              ("scene", f"gt(scene\\,0.25)*(isnan(prev_selected_t)+gte(t-prev_selected_t\\,{interval:.6f}))")]:
        result = run([params["ffmpeg"], "-hide_banner", "-y", "-i", params["mediaPath"], "-an", "-vf",
                      f"select='{expression}',scale='min(1280,iw)':-2,showinfo", "-vsync", "vfr", "-q:v", "4", str(frame_dir / f"{kind}-%04d.jpg")])
        times = [float(t) for t in re.findall(r"pts_time:([0-9.]+)", result.stderr.decode("utf-8", errors="replace"))]
        paths = sorted(frame_dir.glob(f"{kind}-*.jpg"))
        if len(times) != len(paths):
            raise ValueError("FRAME_TIMESTAMPS_UNVERIFIED")
        for path, seconds in zip(paths, times):
            frames.append({"id": path.stem, "timeMs": round(seconds*1000), "path": str(path), "sha256": digest(path), "kind": kind})
    unique = {}
    for frame in sorted(frames, key=lambda f: f["timeMs"]):
        unique.setdefault((frame["timeMs"], frame["sha256"]), frame)
    result = {"status": "succeeded", "frames": list(unique.values()), "metadata": metadata, "sampleIntervalMs": round(interval*1000),
              "coverage": "sampled-whole-timeline", "elapsedMs": round((time.monotonic()-started)*1000)}
    save(output / "frames.json", result)
    return result


def recognize_frames(params):
    global _ocr, _asr, _asr_key
    from paddleocr import PaddleOCR
    with contextlib.redirect_stdout(sys.stderr):
        if _ocr is None:
            _asr = None
            _asr_key = None
            _ocr = PaddleOCR(device="cpu", text_detection_model_name="PP-OCRv5_mobile_det", text_recognition_model_name="PP-OCRv5_mobile_rec", text_detection_model_dir=params["detectionModelPath"],
                            text_recognition_model_dir=params["recognitionModelPath"],
                            use_doc_orientation_classify=False, use_doc_unwarping=False, use_textline_orientation=False)
        blocks = []
        for frame in params["frames"]:
            for result in _ocr.predict(frame["path"]):
                payload = result.json
                if callable(payload):
                    payload = payload()
                value = payload.get("res", payload)
                for text, score in zip(value.get("rec_texts", []), value.get("rec_scores", [])):
                    if str(text).strip():
                        blocks.append({"id": f"ocr-{len(blocks)+1}", "frameId": frame["id"], "timeMs": frame["timeMs"],
                                       "text": str(text), "confidence": float(score), "needsReview": float(score)<.8})
    result = {"status": "succeeded" if blocks else "empty", "blocks": blocks}
    save(Path(params["outputDir"]) / "ocr.json", result)
    return result


def handle(method, params):
    if method == "classify":
        from video_triage import detect
        return detect(params)
    if method == "probe":
        return probe(params)
    if method == "transcribe":
        return transcribe(params)
    if method == "frames":
        return extract_frames(params)
    if method == "ocr":
        return recognize_frames(params)
    raise ValueError("UNKNOWN_CONTENT_METHOD")


if __name__ == "__main__":
    for line in sys.stdin:
        request = {}
        try:
            request = json.loads(line)
            value = handle(request["method"], request.get("params", {}))
            message = {"id": request.get("id"), "result": value}
        except Exception as error:
            message = {"id": request.get("id"), "error": {"code": str(error) if re.fullmatch(r"[A-Z_]{3,100}", str(error)) else type(error).__name__}}
        sys.stdout.write(json.dumps(message, ensure_ascii=False)+"\n")
        sys.stdout.flush()

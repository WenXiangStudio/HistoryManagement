#!/usr/bin/env python3
"""Signal Desk media worker using an NDJSON request/response protocol.

Heavy dependencies are optional. The worker reports a structured degraded
result when faster-whisper or PaddleOCR is not installed; collection and local
search can continue while the job remains resumable.
"""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path
from typing import Any


def emit(value: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(value, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def run(command: list[str], timeout: int = 300) -> subprocess.CompletedProcess[str]:
    return subprocess.run(command, capture_output=True, text=True, check=False, timeout=timeout)


def ensure_within(path: Path, root: Path) -> Path:
    resolved = path.resolve()
    resolved_root = root.resolve()
    if resolved != resolved_root and resolved_root not in resolved.parents:
        raise ValueError(f"Refusing path outside cache root: {resolved}")
    return resolved


def download_media(url: str, destination: Path, max_bytes: int) -> Path:
    request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 SignalDesk/0.1"})
    with urllib.request.urlopen(request, timeout=45) as response, destination.open("wb") as output:
        total = 0
        while True:
            chunk = response.read(1024 * 1024)
            if not chunk:
                break
            total += len(chunk)
            if total > max_bytes:
                raise ValueError("Media exceeds configured per-file size limit")
            output.write(chunk)
    if destination.stat().st_size == 0:
        raise ValueError("Downloaded media is empty")
    return destination


def probe_media(ffprobe: str, media: Path) -> dict[str, Any]:
    result = run([ffprobe, "-v", "error", "-show_streams", "-show_format", "-of", "json", str(media)])
    if result.returncode != 0:
        raise RuntimeError(f"ffprobe failed: {result.stderr[-1000:]}")
    return json.loads(result.stdout)


def extract_audio(ffmpeg: str, media: Path, audio: Path) -> Path | None:
    result = run([ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-i", str(media), "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", str(audio)])
    if result.returncode != 0 or not audio.exists():
        return None
    return audio


def transcribe(audio: Path, model_name: str) -> tuple[list[dict[str, Any]], str | None]:
    try:
        from faster_whisper import WhisperModel  # type: ignore
    except ImportError:
        return [], "faster-whisper is not installed"
    model = WhisperModel(model_name, device="cpu", compute_type="int8", cpu_threads=max(2, min(8, os.cpu_count() or 4)))
    segments, _ = model.transcribe(str(audio), language="zh", vad_filter=True)
    output = []
    for segment in segments:
        output.append({
            "startMs": round(segment.start * 1000),
            "endMs": round(segment.end * 1000),
            "text": segment.text.strip(),
            "provider": f"faster-whisper-{model_name}",
            "confidence": None,
        })
    return output, None


def extract_frames(ffmpeg: str, media: Path, frame_dir: Path, max_frames: int) -> tuple[list[dict[str, Any]], str | None]:
    frame_dir.mkdir(parents=True, exist_ok=True)
    pattern = frame_dir / "frame-%04d.jpg"
    result = run([
        ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-i", str(media),
        "-vf", "fps=1/2,scale='min(1280,iw)':-2", "-frames:v", str(max_frames), "-q:v", "4", str(pattern)
    ])
    if result.returncode != 0:
        return [], result.stderr[-1000:]
    frames: list[dict[str, Any]] = []
    seen: set[str] = set()
    for index, path in enumerate(sorted(frame_dir.glob("frame-*.jpg"))):
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        if digest in seen:
            path.unlink(missing_ok=True)
            continue
        seen.add(digest)
        frames.append({"frameRef": path.stem, "timeMs": index * 2000, "path": str(path), "sha256": digest})
    return frames, None


def ocr_frames(frames: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], str | None]:
    try:
        from paddleocr import PaddleOCR  # type: ignore
    except ImportError:
        return [], "PaddleOCR is not installed"
    engine = PaddleOCR(use_doc_orientation_classify=False, use_doc_unwarping=False, use_textline_orientation=False, lang="ch")
    blocks: list[dict[str, Any]] = []
    for frame in frames:
        try:
            results = engine.predict(frame["path"])
            for result in results:
                payload = result.json if hasattr(result, "json") else {}
                if callable(payload):
                    payload = payload()
                texts = payload.get("res", {}).get("rec_texts", []) if isinstance(payload, dict) else []
                scores = payload.get("res", {}).get("rec_scores", []) if isinstance(payload, dict) else []
                for index, text in enumerate(texts):
                    if str(text).strip():
                        blocks.append({"frameRef": frame["frameRef"], "timeMs": frame["timeMs"], "text": str(text).strip(), "confidence": float(scores[index]) if index < len(scores) else None})
        except Exception as error:  # a single corrupt frame must not abort the video
            blocks.append({"frameRef": frame["frameRef"], "timeMs": frame["timeMs"], "text": "", "confidence": None, "error": str(error)})
    return blocks, None


def process_media(params: dict[str, Any]) -> dict[str, Any]:
    cache_root = Path(params["cacheRoot"])
    cache_root.mkdir(parents=True, exist_ok=True)
    work_id = str(params["workId"]).replace("/", "_").replace("\\", "_")
    job_dir = ensure_within(cache_root / work_id, cache_root)
    if job_dir.exists():
        shutil.rmtree(job_dir)
    job_dir.mkdir(parents=True)
    media = job_dir / "source.mp4"
    ffmpeg = str(params.get("ffmpeg") or "ffmpeg")
    ffprobe = str(params.get("ffprobe") or "ffprobe")
    keep_evidence = bool(params.get("keepEvidence", True))
    try:
        download_media(str(params["mediaUrl"]), media, int(params.get("maxBytes", 2 * 1024**3)))
        metadata = probe_media(ffprobe, media)
        audio = extract_audio(ffmpeg, media, job_dir / "audio.wav")
        transcript, asr_warning = transcribe(audio, str(params.get("asrModel", "small"))) if audio else ([], "media has no usable audio")
        frames, frame_warning = extract_frames(ffmpeg, media, job_dir / "frames", int(params.get("maxFrames", 120)))
        ocr, ocr_warning = ocr_frames(frames)
        media.unlink(missing_ok=True)
        if audio:
            audio.unlink(missing_ok=True)
        if not keep_evidence:
            shutil.rmtree(job_dir / "frames", ignore_errors=True)
            frames = []
        return {
            "ok": True,
            "metadata": metadata,
            "transcript": transcript,
            "frames": frames,
            "ocr": ocr,
            "warnings": [warning for warning in [asr_warning, frame_warning, ocr_warning] if warning],
            "mediaDeleted": not media.exists(),
            "jobDir": str(job_dir),
        }
    except Exception:
        media.unlink(missing_ok=True)
        raise


def cleanup(params: dict[str, Any]) -> dict[str, Any]:
    root = Path(params["cacheRoot"])
    target = ensure_within(Path(params["path"]), root)
    if target.is_dir():
        shutil.rmtree(target)
    else:
        target.unlink(missing_ok=True)
    return {"ok": True, "removed": str(target)}


def handle(request: dict[str, Any]) -> dict[str, Any]:
    method = request.get("method")
    params = request.get("params") or {}
    if method == "ping":
        return {"ok": True, "python": sys.version, "pid": os.getpid(), "time": time.time()}
    if method == "preflight":
        optional = {}
        for module in ("faster_whisper", "paddleocr"):
            try:
                __import__(module)
                optional[module] = True
            except Exception:
                optional[module] = False
        ffmpeg = str(params.get("ffmpeg") or "ffmpeg")
        ffprobe = str(params.get("ffprobe") or "ffprobe")
        return {
            "ok": all(optional.values()), "python": sys.version,
            "modules": optional,
            "ffmpeg": run([ffmpeg, "-version"], timeout=15).returncode == 0,
            "ffprobe": run([ffprobe, "-version"], timeout=15).returncode == 0,
        }
    if method == "probe":
        return {"ok": True, "metadata": probe_media(str(params.get("ffprobe") or "ffprobe"), Path(params["path"]))}
    if method == "process_media":
        return process_media(params)
    if method == "cleanup":
        return cleanup(params)
    raise ValueError(f"Unknown method: {method}")


def main() -> None:
    for line in sys.stdin:
        try:
            request = json.loads(line)
            request_id = request.get("id")
            result = handle(request)
            emit({"id": request_id, "result": result})
        except Exception as error:
            emit({"id": locals().get("request_id"), "error": {"type": type(error).__name__, "message": str(error)}})


if __name__ == "__main__":
    main()

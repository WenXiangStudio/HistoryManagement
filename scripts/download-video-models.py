"""Download explicit public model artifacts with resumable writes and SHA256 verification."""
import argparse
import concurrent.futures
import hashlib
import json
from pathlib import Path
import time
import urllib.request
import zipfile

SMALL_REV = "536b0662742c02347bc0e980a01041f333bce120"
QWEN_REV = "ae44f08e1392f39c0e474af10c3ff8355c8b6688"
ROOT = Path(__file__).resolve().parents[1]


def sha(path):
    with path.open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest()


def download(url, path, checksum=None):
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists() and (checksum is None or sha(path) == checksum):
        print(json.dumps({"file": path.name, "cached": True}), flush=True)
        return path
    part = path.with_suffix(path.suffix + ".part")
    for attempt in range(4):
        try:
            offset = part.stat().st_size if part.exists() else 0
            headers = {"User-Agent": "SignalDesk-local-model-setup"}
            if offset:
                headers["Range"] = f"bytes={offset}-"
            with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=60) as response:
                append = offset > 0 and response.status == 206
                total = offset if append else 0
                progress = total
                with part.open("ab" if append else "wb") as output:
                    while chunk := response.read(1024 * 1024):
                        output.write(chunk)
                        total += len(chunk)
                        if total-progress >= 100*1024*1024:
                            print(json.dumps({"file": path.name, "MiB": round(total/1024**2)}), flush=True)
                            progress = total
            digest = sha(part)
            if checksum and digest != checksum:
                raise ValueError("ARTIFACT_CHECKSUM_MISMATCH")
            part.replace(path)
            path.with_suffix(path.suffix+".source.json").write_text(json.dumps({"url": url, "sha256": digest, "bytes": total}, indent=2), encoding="utf-8")
            print(json.dumps({"file": path.name, "bytes": total, "verified": bool(checksum)}), flush=True)
            return path
        except Exception as error:
            print(json.dumps({"file": path.name, "attempt": attempt+1, "error": type(error).__name__}), flush=True)
            if attempt == 3:
                raise RuntimeError("ARTIFACT_DOWNLOAD_FAILED") from None
            time.sleep(2)


def small():
    base = f"https://huggingface.co/Systran/faster-whisper-small/resolve/{SMALL_REV}/"
    for name in ["config.json", "tokenizer.json", "vocabulary.txt", "model.bin"]:
        download(base+name, ROOT/"models"/"faster-whisper-small"/name,
                 "3e305921506d8872816023e4c273e75d2419fb89b24da97b4fe7bce14170d671" if name == "model.bin" else None)


def qwen():
    name = "Qwen_Qwen3-4B-Instruct-2507-Q4_K_M.gguf"
    download(f"https://huggingface.co/bartowski/Qwen_Qwen3-4B-Instruct-2507-GGUF/resolve/{QWEN_REV}/{name}",
             ROOT/"models"/"qwen3-4b-instruct"/name, "2fde00ce69dd4899c70d020845e2638353015bba0fdf161b3eb965f2bca4464e")


def llama():
    path = download("https://github.com/ggml-org/llama.cpp/releases/download/b11429/llama-b11429-bin-win-cpu-x64.zip",
                    ROOT/"local-data"/"video-content-20261010"/"llama-b11429.zip")
    destination = ROOT/"local-data"/"video-content-20261010"/"llama"
    with zipfile.ZipFile(path) as archive:
        for info in archive.infolist():
            if not (destination/info.filename).resolve().is_relative_to(destination.resolve()):
                raise ValueError("ARCHIVE_PATH_REJECTED")
        archive.extractall(destination)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("artifact", choices=["small", "qwen", "llama", "all"])
    args = parser.parse_args()
    actions = [small, qwen, llama] if args.artifact == "all" else [globals()[args.artifact]]
    with concurrent.futures.ThreadPoolExecutor(max_workers=len(actions)) as executor:
        for future in [executor.submit(action) for action in actions]:
            future.result()

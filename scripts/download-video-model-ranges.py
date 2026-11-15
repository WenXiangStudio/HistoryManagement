"""Bounded parallel ranges for unreliable large public artifact connections."""
import concurrent.futures
import hashlib
import json
from pathlib import Path
import sys
import time
import urllib.request

ROOT=Path(__file__).resolve().parents[1]
SPECS={
 'qwen35':('https://modelscope.cn/models/unsloth/Qwen3.5-4B-GGUF/resolve/master/Qwen3.5-4B-Q4_K_M.gguf',ROOT/'models/qwen35-4b/Qwen3.5-4B-Q4_K_M.gguf',2740937888,'00fe7986ff5f6b463e62455821146049db6f9313603938a70800d1fb69ef11a4'),
 'small':('https://huggingface.co/Systran/faster-whisper-small/resolve/536b0662742c02347bc0e980a01041f333bce120/model.bin',ROOT/'models/faster-whisper-small/model.bin',483546902,'3e305921506d8872816023e4c273e75d2419fb89b24da97b4fe7bce14170d671'),
 'qwen':('https://huggingface.co/bartowski/Qwen_Qwen3-4B-Instruct-2507-GGUF/resolve/ae44f08e1392f39c0e474af10c3ff8355c8b6688/Qwen_Qwen3-4B-Instruct-2507-Q4_K_M.gguf',ROOT/'models/qwen3-4b-instruct/Qwen_Qwen3-4B-Instruct-2507-Q4_K_M.gguf',2497280736,'2fde00ce69dd4899c70d020845e2638353015bba0fdf161b3eb965f2bca4464e')}
name=sys.argv[1];url,target,total,checksum=SPECS[name]
url='https://modelscope.cn/models/Systran/faster-whisper-small/resolve/master/model.bin' if name=='small' else url.replace('https://huggingface.co/','https://hf-mirror.com/')
target.parent.mkdir(parents=True,exist_ok=True)
if target.exists():
 with target.open('rb') as f: existing=hashlib.file_digest(f,'sha256').hexdigest()
 if existing==checksum:
  print(json.dumps({'artifact':name,'cached':True,'sha256':existing}),flush=True);sys.exit(0)
partial=target.with_suffix(target.suffix+'.part');offset=partial.stat().st_size if partial.exists() else 0
chunks=target.parent/(target.name+'.chunks');chunks.mkdir(exist_ok=True)
step=8*1024*1024

def read(start):
 end=min(start+step,total)-1;length=end-start+1;path=chunks/str(start)
 if path.exists() and path.stat().st_size==length:return path
 for attempt in range(4):
  try:
   req=urllib.request.Request(url+'?download=true',headers={'Range':f'bytes={start}-{end}','User-Agent':'Mozilla/5.0'})
   with urllib.request.urlopen(req,timeout=30) as r:
    if r.status!=206 or not r.headers.get('Content-Range','').startswith(f'bytes {start}-'):raise RuntimeError('RANGE_MISMATCH')
    data=r.read(length+1)
   if len(data)!=length:raise RuntimeError('RANGE_INCOMPLETE')
   path.write_bytes(data)
   print(json.dumps({'artifact':name,'rangeMiB':round(start/1024**2),'done':True}),flush=True)
   return path
  except Exception as e:
   print(json.dumps({'artifact':name,'rangeMiB':round(start/1024**2),'attempt':attempt+1,'error':type(e).__name__}),flush=True)
   if attempt==3:raise
   time.sleep(1)
starts=list(range(offset,total,step))
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
 for path in pool.map(read,starts):
  with partial.open('ab') as out:out.write(path.read_bytes())
with partial.open('rb') as f:digest=hashlib.file_digest(f,'sha256').hexdigest()
if digest!=checksum:raise RuntimeError('ARTIFACT_CHECKSUM_MISMATCH')
partial.replace(target)
target.with_suffix(target.suffix+'.source.json').write_text(json.dumps({'url':url,'sha256':digest,'bytes':total},indent=2))
print(json.dumps({'artifact':name,'complete':True,'sha256':digest}),flush=True)

"""Isolated public-video acquisition for the explicitly requested single-model experiment."""
import hashlib, json, os, re, sqlite3, time, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'local-data' / 'single-cloud-video-20261011'
OUT.mkdir(parents=True, exist_ok=True)
SOURCE = Path(os.environ['LOCALAPPDATA']) / 'SignalDeskFollowingReview'
WORK_ID = '7691353360976416034'
started = time.perf_counter()
bridge = json.loads((SOURCE / 'following-bridge.json').read_text())
req = urllib.request.Request(bridge['origin'] + '/status', headers={'Authorization': 'Bearer ' + bridge['token']})
try:
    state = json.load(urllib.request.urlopen(req, timeout=8))
    print(json.dumps({'app': {k: state.get(k) for k in ['phase', 'connection', 'readiness']}, 'activityPhase': (state.get('activity') or {}).get('phase')}, ensure_ascii=False))
except Exception as exc:
    print(json.dumps({'appStatusError': type(exc).__name__}))
for dbname in ['signal-desk.sqlite', 'following-directory.sqlite']:
    db = sqlite3.connect((SOURCE / dbname).as_uri() + '?mode=ro', uri=True)
    tables = [r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")]
    print(json.dumps({'db': dbname, 'tables': tables}))
    db.close()

headers = {'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 Version/16.0 Mobile/15E148 Safari/604.1', 'Referer': 'https://www.douyin.com/'}
for name, url in [('share', f'https://www.iesdouyin.com/share/video/{WORK_ID}/'), ('web', f'https://www.douyin.com/video/{WORK_ID}')]:
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=30) as response:
            raw = response.read(8 * 1024 * 1024).decode('utf-8')
            (OUT / (name + '.html')).write_text(raw, encoding='utf-8')
            print(json.dumps({'page': name, 'status': response.status, 'bytes': len(raw), 'scripts': re.findall(r'<script[^>]*(?:id="[^"]+"|src="[^"]+")[^>]*>', raw)[:20], 'routerData': '_ROUTER_DATA' in raw, 'renderData': 'RENDER_DATA' in raw}, ensure_ascii=False))
    except Exception as exc:
        print(json.dumps({'page': name, 'error': str(exc)}))
print(json.dumps({'acquisitionProbeMs': round((time.perf_counter() - started) * 1000)}))

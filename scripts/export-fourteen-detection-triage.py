"""Offline export: numerical rule classifications, concurrency results, human review.
Never loads a recognition model, derives content from titles, or rewrites APP data.
"""
from pathlib import Path
import json
import hashlib
import html
import os
import re
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT/'local-data/detection-triage-fourteen-20261013/attempt-02'
OUT = ROOT/'docs/evidence/detection-triage-fourteen-20261013'
report = json.loads((SOURCE/'report.json').read_text(encoding='utf-8'))
if report.get('status') not in ['complete', 'needs-review'] or not report['waves']:
    raise RuntimeError('Classification and concurrency run not finished')
baseline = report['waves'][0]
if baseline['concurrencyConfigured'] != 1 or not baseline['all14Completed']:
    raise RuntimeError('Complete 14-video baseline required')
catalog = json.loads((ROOT/'docs/evidence/processable-material-inventory-20261013/inventory.json').read_text(encoding='utf-8'))
metadata = {r['workId']: r for r in catalog['records'] if r['inLibrary']}
if len(metadata) != 14:
    raise RuntimeError('Scope must be exactly 14 library originals')
OUT.mkdir(parents=True, exist_ok=False)


def save(name, value):
    (OUT/name).write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding='utf-8')


def esc(value):
    return html.escape(str(value), quote=True)


def seconds(value):
    return f'{value/1000:.3f}'


records = []
for raw in baseline['results']:
    meta = metadata[raw['workId']]
    # Titles/nicknames are attached only after numerical classification completes.
    item = {'workId': raw['workId'], 'title': meta['title'], 'author': meta['author'],
            'durationDisplay': meta['durationDisplay'], 'sourcePath': meta['sourcePath'],
            **raw, 'manualCategory': None, 'manualCorrect': None, 'manualNote': ''}
    for frame in item['visual']['frames']:
        frame_path = Path(frame['path'])
        assert hashlib.sha256(frame_path.read_bytes()).hexdigest() == frame['sha256']
    records.append(item)
records.sort(key=lambda r: (r['author'], r['title']))
save('classification-results.json', {'createdAt': datetime.now(timezone.utc).isoformat(),
     'scope': 'Only 14 formal-library originals; existing 3 independent samples excluded',
     'humanAccuracyAssessment': 'pending', 'records': records})
save('rules.json', report['rules'])
save('concurrency-report.json', {k:v for k,v in report.items() if k!='waves'} | {
    'waves': [{k:v for k,v in wave.items() if k!='results'} for wave in report['waves']]})
save('manual-review-template.json', {'labels': report['rules']['labels'], 'records': [
     {'workId': r['workId'], 'title': r['title'], 'predictedCategory': r['classification']['label'],
      'manualCategory': None, 'manualCorrect': None, 'note': ''} for r in records]})
save('data-retention.json', report['retention'])
counts = {code: sum(r['classification']['code']==code for r in records) for code in report['rules']['labels']}

lines = ['# 14条原片：仅检测特征的分类结果及本地并发测试', '',
    '本次由本地Silero VAD v6检测语音区间、PP-OCRv5 mobile文字检测器检测文字区域；未加载文字识别模型、ASR权重、语言/视觉语义模型，未调用云端。程序按预先固定的阈值给出初步类别，最终准确性由用户人工校验。', '',
    '查看[人工校验页面](review.html)、[分类JSON](classification-results.json)及[并发记录](concurrency-report.json)。页面可播放本地原片、查看8帧及检测框，并填写人工类别与备注；填写只保存在浏览器，可导出JSON，不改APP。', '',
    '素材范围为正式视频库的14条本地原片，未包含此前独立三条分类样本。分类器只读取原片路径、哈希、字节数和检测数值，未读取标题、旧转写、旧OCR或旧摘要来判断；标题仅在本报告中用于定位素材。', '',
    '| 序号 | 作者／作品 | 时长 | 初步类别 | 语音占总时长 | 有文字候选的帧 | 检测处理 |',
    '| --- | --- | ---: | --- | ---: | ---: | ---: |']
for i, r in enumerate(records, 1):
    title = r['title'].replace('|', '／')
    lines.append(f"| {i} | {r['author']} · [{title}](https://www.douyin.com/video/{r['workId']}) | {r['durationDisplay']} | {r['classification']['label']} | {r['audio']['speechPercent']:.3f}% | {r['visual']['retainedTextFrames']}/8 | {seconds(r['timing']['perSampleMs'])}秒 |")
lines += ['', '## 判定规则与边界', '',
    '本轮阈值在运行前固定：语音≥60%且覆盖≥一半时间段，归口播主导或口播加图文；语音>10%也可给出口播类候选，但依据较弱；未检出语音且≥2/8帧有保留文字区域，归图文；语音≤10%且<2/8帧有保留文字，归画面主导候选；少量语音同时文字较多时保留待确认。10%与60%为本轮试验规则，尚未由人工样本校准，不是最终产品阈值。', '',
    '文字只检测区域，不识字。低分、过小区域和边缘小区域按几何规则标记过滤；边缘过滤可能错排字幕、也可能保留水印，原始检测框及排除原因完整保留供审阅。画面变化来自8个稀疏采样点的灰度差，不等于连续运动或画面信息重要性。', '',
    'VAD输出疑似语音，不能证明识别了全部歌声、笑声等人声。语音比例分母为原片总时长，实际音频覆盖区间及开头未覆盖时间另外保存。未检出与确认不存在有区别。音轨中未检出语音的时间不自动称为非人声或音乐。', '',
    '第三类包含口播加图文；检测到大量语音与字幕，并不能证明画面是否承担独立信息。本轮只做分类，不执行后续转写或视觉任务，也不自动修改处理路线。较强/中等/较弱只是规则依据强弱，不是校准后的正确概率。', '',
    '## 并发实测', '',
    '| 配置并发 | 实际同时处理峰值 | 模型载入后14条完成 | 含进程启动／模型加载 | 平均单条执行 | 吞吐量，条/分钟 | 与顺序检测结果一致 | 实测子进程内存峰值 |',
    '| ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: |']
for wave in report['waves']:
    lines.append(f"| {wave['concurrencyConfigured']} | {wave['observedPeakActiveVideos']} | {seconds(wave['warmBatchMs'])}秒 | {seconds(wave['coldBatchThroughSavedResultsMs'])}秒 | {seconds(wave['meanPerVideoProcessingMs'])}秒 | {wave['videosPerMinuteWarm']:.2f} | {'是' if wave['sameDetectionAndClassificationAsBaseline'] else '否'} | {wave['resource']['peakChildRssBytes']/1024**3:.2f}GiB |")
lines += ['', f"本次最高实际验证并发为**{report['highestVerifiedConcurrency']}条**，模型载入后整批最快档为**{report['fastestWarmConcurrency']}条并发**，含启动加载最快档为**{report['fastestColdConcurrency']}条并发**。这是此设备、本套检测参数和14条样本的测试结果，不是绝对并发上限。", '',
    '每档完整重新解码音频、定位抽8帧并运行检测，没有复用前一档的分类/检测缓存；模型在各自工作进程内复用，不共享可变预测器。一次工作进程只处理一条视频；各档在所有工作进程加载完成后同时放行。模型载入后批处理含首次推理的引擎开销，不是完全预热的稳定吞吐基准。', '',
    '子进程内存峰值为采样统计（每0.25秒），包含Python工作进程与FFmpeg，不是系统总内存。准备前预估内存，保留6GiB；可用内存低于2GiB会终止本轮。进程启动、重复权重加载、单条处理及整批耗时分别记录。', '',
    '不同档为顺序测试，磁盘/系统缓存和后台负载可能影响结果；每档仅一轮，没有多轮随机顺序统计。检测结果一致只验证并发没有改变输出，不等于用户已经确认分类准确。', '',
    f"本轮从检测脚本启动到所有已测档结果及审计保存共{seconds(report['scriptElapsedMs'])}秒，包含全部重复性能测试，不是只分类一次的用时，也不是APP点击至结果显示时间。", '',
    '本地权重路径显式固定，依赖在加载时可能尝试检查模型站点，网络审计阻止所有连接／域名解析；不下载模型或发出云端识别请求。数据库53表、加密凭据、runtime、APP包前后核对结果见[data-retention.json](data-retention.json)。', '',
    '完整本机资料在`local-data/detection-triage-fourteen-20261013/attempt-02/`。根目录保留0模型调用的前置审计序列化失败记录。分类结果、原片引用、采样图片/框、语音区间、分项计时、并发每档结果与资源记录全部保留；未写入正式APP分类或摘要。']
if report.get('resourceStop'):
    lines += ['', '停止增加并发的原因：'+json.dumps(report['resourceStop'], ensure_ascii=False)]
if report.get('qualityStop'):
    lines += ['', '停止增加并发的原因：'+json.dumps(report['qualityStop'], ensure_ascii=False)]
(OUT/'README.md').write_text('\n'.join(lines)+'\n', encoding='utf-8')

cards = []
for i, r in enumerate(records, 1):
    frames = []
    for f in r['visual']['frames']:
        url = Path(os.path.relpath(f['path'], OUT)).as_posix()
        boxes = []
        for b in f['boxes']:
            x1,y1,x2,y2 = b['normalizedBox']
            boxes.append(f'<span class="box {"keep" if b["retained"] else "excluded"}" style="left:{x1*100}%;top:{y1*100}%;width:{(x2-x1)*100}%;height:{(y2-y1)*100}%" title="{esc(", ".join(b["exclusionReasons"]) or "保留候选")}"></span>')
        frames.append(f'<figure><div class="picture"><img loading="lazy" src="{esc(url)}" alt="第{f["frameId"]}帧">{"".join(boxes)}</div><figcaption>{f["timeSeconds"]:.2f}秒 · 候选{f["retainedBoxCount"]}框</figcaption></figure>')
    options = ''.join(f'<option value="{esc(label)}">{esc(label)}</option>' for label in report['rules']['labels'].values())
    cards.append(f'''<article data-work="{r['workId']}"><h2>{i}. {esc(r['title'])}</h2><p>{esc(r['author'])} · {r['durationDisplay']} · 作品{r['workId']}</p>
<p class="prediction">初步分类：<strong>{esc(r['classification']['label'])}</strong> · 疑似语音{r['audio']['speechPercent']:.3f}% · 文字候选{r['visual']['retainedTextFrames']}/8帧 · 顺序检测{seconds(r['timing']['perSampleMs'])}秒</p>
<p>音轨：存在 · 画面：存在 · 抽样帧明显变化 {r['visual']['largeChangePairs']}/{r['visual']['sampledPairs']} 对 · 近乎不变 {r['visual']['nearStaticPairs']}/{r['visual']['sampledPairs']} 对</p>
<div class="inputs"><label>人工确认类别 <select class="manual"><option value="">尚未填写</option>{options}</select></label><label>备注 <input class="note" type="text"></label><span class="status"></span></div>
<details><summary>播放本地原片</summary><video controls preload="none" src="{esc(Path(r['sourcePath']).as_uri())}"></video><p><a href="https://www.douyin.com/video/{r['workId']}" target="_blank">原作品页面</a></p></details>
<details><summary>8帧与文字检测框（绿：保留，橙：过滤候选）</summary><div class="frames">{''.join(frames)}</div></details>
<details><summary>疑似语音区间</summary><p>{esc('；'.join(f"{s['startSeconds']:.2f}—{s['endSeconds']:.2f}秒" for s in r['audio']['intervals']))}</p></details></article>''')
manual = json.dumps([{'workId':r['workId'],'title':r['title'],'predictedCategory':r['classification']['label']} for r in records], ensure_ascii=False).replace('<','\\u003c')
page = '''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>14条素材分类人工校验</title><style>
body{margin:0;background:#f3f5f8;color:#202733;font-family:system-ui,"Microsoft YaHei",sans-serif}main{max-width:1250px;margin:auto;padding:24px}h1{font-size:26px}h2{font-size:19px}p{line-height:1.7}article{background:white;border:1px solid #d9dfe7;border-radius:12px;margin:20px 0;padding:20px}.prediction{background:#eef3fa;padding:12px}.inputs{display:flex;flex-wrap:wrap;gap:14px;align-items:center;margin:16px 0}label{display:flex;gap:8px;align-items:center}select,input,button{font:inherit;padding:8px;border:1px solid #aeb9c8;border-radius:6px}input{width:300px}details{margin:16px 0}summary{cursor:pointer}video{width:min(100%,800px);max-height:550px;margin-top:14px}.frames{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-top:16px}figure{margin:0}.picture{position:relative}.picture img{display:block;width:100%}.box{position:absolute;border:1.5px solid;box-sizing:border-box;pointer-events:none}.keep{border-color:#17a76c}.excluded{border-color:#e89b24}figcaption{font-size:12px;margin-top:6px}.toolbar{position:sticky;top:0;background:#f3f5f8;padding:12px 0;z-index:5;display:flex;gap:20px;align-items:center}.status{font-size:14px}a{color:#22569b}@media(max-width:800px){.frames{grid-template-columns:repeat(2,1fr)}main{padding:12px}.inputs{display:block}.inputs label{margin:10px 0}input{width:180px}}</style>
<main><h1>14条素材：分类人工校验</h1><p>只检测人声、画面变化和文字区域。以下为规则初步分类，正确与否由你确认。填写自动保存在当前浏览器，可导出记录；不会写入APP。<a href="README.md">耗时、并发和规则记录</a></p><div class="toolbar"><button id="export">导出人工校验JSON</button><span id="progress"></span></div>'''+''.join(cards)+'''</main><script>
const source='''+manual+''',storageKey='signaldesk-triage-fourteen-20261013';let saved={};try{saved=JSON.parse(localStorage.getItem(storageKey)||'{}')}catch{}
function update(){let count=0;for(const item of source){const card=document.querySelector('[data-work="'+item.workId+'"]'),category=card.querySelector('.manual').value,note=card.querySelector('.note').value;saved[item.workId]={manualCategory:category||null,note};const status=card.querySelector('.status');if(category){count++;status.textContent=category===item.predictedCategory?'与初步分类一致':'与初步分类不同';status.style.color=category===item.predictedCategory?'#14734b':'#b36a10'}else status.textContent='';}try{localStorage.setItem(storageKey,JSON.stringify(saved))}catch{}document.querySelector('#progress').textContent='已确认 '+count+' / '+source.length+' 条';}
for(const item of source){const card=document.querySelector('[data-work="'+item.workId+'"]');card.querySelector('.manual').value=saved[item.workId]?.manualCategory||'';card.querySelector('.note').value=saved[item.workId]?.note||'';card.querySelector('.manual').addEventListener('change',update);card.querySelector('.note').addEventListener('input',update);}update();
document.querySelector('#export').onclick=()=>{const data={reviewedAt:new Date().toISOString(),records:source.map(item=>({...item,...saved[item.workId],manualCorrect:saved[item.workId]?.manualCategory? saved[item.workId].manualCategory===item.predictedCategory:null}))};const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download='14条素材-人工分类校验.json';link.click();setTimeout(()=>URL.revokeObjectURL(link.href),1000);};</script></html>'''
(OUT/'review.html').write_text(page, encoding='utf-8')
print(json.dumps({'counts':counts,'highestVerifiedConcurrency':report['highestVerifiedConcurrency'],
    'fastestWarmConcurrency':report['fastestWarmConcurrency'],'fastestColdConcurrency':report['fastestColdConcurrency'],
    'waves': [{k:wave[k] for k in ['concurrencyConfigured','observedPeakActiveVideos','warmBatchMs','coldBatchThroughSavedResultsMs','meanPerVideoProcessingMs','sameDetectionAndClassificationAsBaseline']} for wave in report['waves']],
    'classifications': [{'title':r['title'],'author':r['author'],'label':r['classification']['label'],'speechPercent':r['audio']['speechPercent'],'textFrames':r['visual']['retainedTextFrames'],'perSampleMs':r['timing']['perSampleMs']} for r in records],
    'retention':report['retention']},ensure_ascii=True))

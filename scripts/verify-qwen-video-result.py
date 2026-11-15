"""Audit the saved APP result without treating machine text as human ground truth."""
import collections,hashlib,json,os,sqlite3
from datetime import datetime
from pathlib import Path

root=Path(__file__).resolve().parents[1]
local=root/'local-data/qwen-video-app-20261011'
public=root/'docs/evidence/qwen-video-app-20261011'
public.mkdir(parents=True,exist_ok=True)
source=Path(os.environ['LOCALAPPDATA'])/'SignalDeskFollowingReview'
result=json.loads((local/'app-processing.json').read_text(encoding='utf-8'))
batch=result['batch'];detail=result['result'];summary=detail['summary']
assert batch['state']=='completed' and batch['provider']=='cloud-omni'
assert result['summaryInVisibleDetail'] is True
stages={s['stage']:s['result'] for s in detail['stages']}
assert all(s['state']=='completed' for s in detail['stages'])
speech,visual=stages['transcript'],stages['visual']
assert speech['modelVersion']==visual['modelVersion']==summary['modelVersion']=='qwen3.8-omni-flash'
assert speech['protocol']==visual['protocol']==summary['protocol']=='responses'
assert speech['fullAudioSubmitted'] and speech['timestampPrecision']=='chunk'
intervals=speech['intervals'];assert intervals[0]['startMs']==0 and intervals[-1]['endMs']==speech['durationMs']
assert all(intervals[i]['startMs']==intervals[i-1]['endMs'] for i in range(1,len(intervals)))
assert len(intervals)==len(speech['segments'])==8 and len(visual['frames'])==18
ids={e['id'] for e in summary['evidence']}
assert set(summary['overviewEvidenceIds'])<=ids
assert all(set(p['evidenceIds'])<=ids for p in summary['keyPoints'])
assert '币值' in speech['segments'][4]['text']
actual_subtitles=['当美国以5%的利率借钱','回报率才能对抗','它给到5%以上的收益率','但日本在其中的问题其实不大',
 '然后去美国的市场上投资套利','支持下的这个半导体产业集群','而通胀物价上涨','一直没传导到我这来','资本市场的重新复苏',
 '要么我就观望上几个月','资本不允许自由流通','这才是关键','真分红真回购','资金流动的压力大','我持有到期',
 '票面利息和收益率','并且有资本所得的税收优惠的话','用这么高的利率去借钱']
assert [b['text'] for b in visual['blocks']]==actual_subtitles
report={'model':summary['modelVersion'],'protocol':'responses','appVersion':'0.1.20','workId':detail['workId'],
 'sourceSha256':stages['media']['sha256'],'audioDurationMs':speech['durationMs'],'audioChunks':len(intervals),'audioIntervals':intervals,
 'transcriptCharacters':sum(len(s['text']) for s in speech['segments']),'frameCount':len(visual['frames']),
 'frameTimesMs':[f['timeMs'] for f in visual['frames']],'allStagesCompleted':True,'summaryDisplayedInApp':True,
 'summaryReferenceChecks':'passed','sameModelForAllSemanticStages':True,'localAsrOcrUsed':False,
 'timingsMs':{'mediaPreprocessing':speech['preprocessMs'],'audioTranscription':speech['elapsedMs'],'sampledFrameReading':visual['elapsedMs'],
   'appTaskStartToSaved':batch['elapsedMs'],'appTaskStartToDisplayed':batch.get('displayedTotalMs'),'operatorClickToVerificationReport':result['operatorClickToReportMs']},
 'usage':{'transcript':speech['usage'],'visual':visual['usage'],'summary':summary['usage']},
 'frameSubtitleAudit':{'matches':18,'checked':18,'basis':'Agent inspection of the actual 18 input images; not an independent human audio benchmark'},
 'qualityLimits':['Full audio timeline submitted; no independent word-by-word human listening benchmark.',
   'Minute-sized chunks can split words at boundaries; timestamps are chunk ranges, not word/sentence alignments.',
   'The final subtitle uses 用 while the audio model wrote 有; this is an audio/subtitle discrepancy requiring listening, not an independently confirmed ASR error.',
   'Visual reading uses static sampled frames, not continuous motion analysis.'],
 'summaryQualityAccepted':False,
 'summaryFidelityIssues':[{'kind':'comparison-basis','summaryQuote':'其他国家若要吸引资金就必须提供高于5%的风险溢价',
   'transcriptBasis':'speech-cloud-1 distinguishes a >5% total return benchmark from additional risk premium. The summary assigns the 5% threshold to the premium itself.',
   'assessment':'Material mismatch against the saved transcript; raw model output retained for user review.'},
  {'kind':'citation-coverage','summaryPoint':6,'phrase':'美股扮演抽水机效应','providedReferences':['speech-cloud-7','speech-cloud-8'],
   'actualPhraseReference':'speech-cloud-6','assessment':'Reference IDs exist, but the cited segments do not contain this phrase.'}],
 'databases':{}}
for name in ['signal-desk.sqlite','following-directory.sqlite']:
 with sqlite3.connect((source/name).as_uri()+'?mode=ro',uri=True) as db,sqlite3.connect((local/'before-app'/name).as_uri()+'?mode=ro',uri=True) as old:
  additions=[]
  for (table,) in old.execute("SELECT name FROM sqlite_master WHERE type='table'"):
   def rows(conn):return collections.Counter(json.dumps(list(r),ensure_ascii=False,default=lambda x:bytes(x).hex()) for r in conn.execute('SELECT * FROM "'+table.replace('"','""')+'"'))
   a,b=rows(old),rows(db);assert not a-b,(name,table,'original data changed')
   if a!=b:additions.append({'table':table,'rowsAdded':sum((b-a).values())})
  report['databases'][name]={'originalRowsPreserved':True,'additions':additions,'integrity':db.execute('PRAGMA integrity_check').fetchone()[0],'foreignKeyErrors':len(db.execute('PRAGMA foreign_key_check').fetchall())}
  if name=='following-directory.sqlite':
   report['videosAfter']=db.execute('SELECT count(*) FROM creator_video_information').fetchone()[0]
   report['formalSummariesAfter']=db.execute("SELECT count(DISTINCT work_id) FROM video_content_stages WHERE stage='summary' AND state='completed' AND result_json<>'null'").fetchone()[0]
   timing_rows=db.execute("SELECT state,updated_at FROM video_content_stages WHERE work_id=? AND stage='summary' ORDER BY id",(detail['workId'],)).fetchall()
   start=next(at for state,at in reversed(timing_rows) if state in ['running','interrupted']);end=next(at for state,at in reversed(timing_rows) if state=='completed')
   report['timingsMs']['successfulSummaryStage']=round((datetime.fromisoformat(end)-datetime.fromisoformat(start)).total_seconds()*1000)
creds={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in (source/'credentials').glob('*.bin')}
assert creds==json.loads((local/'before-app/credential-hashes.json').read_text());report['credentialsUnchanged']=True
report['usage']['total']={key:sum(report['usage'][stage][key] for stage in ['transcript','visual','summary']) for key in ['inputTokens','outputTokens']}
report['appAsarSha256']=hashlib.sha256((root/'release-following-background-final/win-unpacked/resources/app.asar').read_bytes()).hexdigest()
failed=[]
for name in ['app-processing-first-summary-failed.json','app-processing-second-json-failed.json']:
 previous=json.loads((local/name).read_text(encoding='utf-8'))
 failed.append({'elapsedMs':previous['batch']['elapsedMs'],'error':next(s['error'] for s in previous['result']['stages'] if s['stage']=='summary')})
report['previousFailedAttempts']=failed
report['timingsMs']['totalActiveAttempts']=sum(f['elapsedMs'] for f in failed)+batch['elapsedMs']
report['timingsMs']['firstTaskStartToFinalDisplayIncludingManualFixes']=round((datetime.fromisoformat(batch['attemptStartedAt'])-datetime.fromisoformat(batch['startedAt'])).total_seconds()*1000+batch['displayedTotalMs'])
report['performanceLimitation']='This run includes two failed summaries and manual application fixes. The final attempt reused audio and frame results; its elapsed time is not a clean full-video end-to-end benchmark.'
(public/'verification.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
(public/'result.json').write_text(json.dumps({'transcript':speech,'visual':{'blocks':visual['blocks'],'vision':visual['vision']},'summary':summary},ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps(report,ensure_ascii=False))

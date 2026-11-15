"""Validate saved experiment output and export reviewable, credential-free evidence."""
import json
from pathlib import Path

root = Path(__file__).resolve().parents[1]
local = root / 'local-data/single-cloud-video-20261011'
public = root / 'docs/evidence/single-cloud-video-20261011'
public.mkdir(parents=True, exist_ok=True)
load = lambda name: json.loads((local / (name + '.json')).read_text(encoding='utf-8'))
names = ['image-control', 'audio-inline-control', 'audio-file-control', 'video-file-control',
         'real-audio-inline', 'real-video-inline', 'real-sampled-frames', 'real-frame11-focused-recheck']
calls = [load(name) for name in names]
assert all(c['requestedModel'] == 'gpt-6.1-sol' and c['protocol'] == 'responses' for c in calls)
assert all(c['otherAiModelsUsed'] is False for c in calls)
result = json.loads(calls[6]['reply'])
manifest = load('real-manifest')
expected_ids = [f'F{i:02}' for i in range(1, 19)]
frames = result['frame_observations']
assert [f['frame_id'] for f in frames] == expected_ids
assert [f['time_seconds'] for f in frames] == manifest['sampleTimesSeconds']
assert result['input_acknowledgment']['images_received'] == 18
assert result['input_acknowledgment']['audio_received'] is False
assert result['speech_transcription']['status'] == 'unavailable'
assert result['speech_transcription']['text'] is None
assert result['overview'] and result['key_points'] and result['missing_information']
assert all(p['frame_refs'] and set(p['frame_refs']) <= set(expected_ids) for p in result['key_points'])
assert calls[1]['error']['message'] == calls[4]['error']['message'] == 'Audio input is not available.'
assert all(calls[i]['httpStatus'] == 400 for i in [1, 2, 3, 4, 5])

# These readings come from the root agent's inspection of the actual submitted frames.
# They are a transparent spot-check record, not independent human ground truth or audio truth.
readings = ['当美债以超过5%的收益率', '他客观上是为了拉爆他的竞争对手', '美债的无风险收益率超过5%',
 '计价的资产该怎么办', '首当其冲面临的国家', '日元理论上也是一种', '更高良品率试运行的',
 '日本从民间到政府', '触底反弹的这个过程中', '这还只是持有市值', '好再说下一个问题币值',
 '越是存在不确定性的地区和国家', '现在美股的吸引力和赚钱效应更大', '造各种新的词汇能掩盖的差距',
 '哎呀美债5%-5.1%的年化收益率了', '不得不提供更高的', '并且有资本所得的税收优惠的话', '用这么高的利率去借钱']
audit = []
for frame, observed in zip(frames, readings):
    returned = frame['visible_text'].split('\n')[0].removeprefix('字幕：')
    audit.append({'frameId': frame['frame_id'], 'timeSeconds': frame['time_seconds'],
                  'agentReadFromActualFrame': observed, 'firstModelSubtitle': returned, 'matches': returned == observed})
assert [r['frameId'] for r in audit if not r['matches']] == ['F11']
recheck = json.loads(calls[7]['reply'])
assert recheck['visible_text'] == readings[10]

proof = load('source-proof')
preservation = load('preservation-check')
assert all(not db['changedTables'] and db['integrity'] == 'ok' and db['foreignKeyErrors'] == 0
           for db in preservation['databases'].values())
assert preservation['videos'] == 78 and preservation['runningContentBatches'] == 0
summary = {
 'experimentDate': '2026-10-11', 'workId': '7691353360976416034', 'shareUrl': 'https://v.douyin.com/s5upJSy-QXI/',
 'creator': proof['creatorNickname'], 'description': proof['capture']['work']['description'],
 'durationSeconds': manifest['durationSeconds'], 'mediaBytes': proof['evidence']['byteLength'],
 'mediaSha256': proof['evidence']['sha256'], 'ownerAndAuthorVerified': True,
 'sameConfiguredModel': 'gpt-6.1-sol', 'protocol': 'responses', 'semanticPreprocessing': False,
 'completeSingleModelGoalPassed': False, 'audioTranscriptionProduced': False,
 'sampledFrameCount': 18, 'sampleTimesSeconds': manifest['sampleTimesSeconds'],
 'fullVideoCoverageProven': False, 'formalSummarySaved': False,
 'actualClipMetadata': load('clip-metadata'),
 'timingsMs': {'browserReadAndOwnership': proof['capture']['acquisitionMs'],
   'captureStartToDownloadedSource': proof['savedTotalMs'],
   'captureStartToWorkspaceCopy': proof['captureToLocalCopyMs'],
   'ffmpegPreparationAndContactSheets': manifest['preprocessMs'],
   'sampledFrameModelRequest': calls[6]['elapsedMs'], 'focusedRecheckModelRequest': calls[7]['elapsedMs'],
   'appClickToContentUsable': None},
 'requests': [], 'frameAudit': audit,
 'auditLimitations': 'Actual frame inspection by the root agent, not an independent human/audio benchmark. Background book titles were not audited.',
 'focusedRecheck': {'providedExpectedAnswer': False, 'sameModel': True, 'visibleText': recheck['visible_text']},
 'summaryErrorImpact': 'First result misread 币值 as 市值 at F11 and incorrectly merged it with F10 in key_points[2]. Raw output retained; this point is not accepted as validated.',
 'preservation': preservation
}
for c in calls:
    usage = c.get('usage') or {}
    summary['requests'].append({k: c.get(k) for k in ['name','startedAt','requestedModel','returnedModel','protocol','httpStatus','completed','error','elapsedMs']} |
      {'inputs': c['inputs'], 'inputTokens': usage.get('input_tokens'), 'outputTokens': usage.get('output_tokens')})
summary['reportedSuccessfulRequestUsage'] = {
 'inputTokens': sum((c.get('usage') or {}).get('input_tokens', 0) for c in calls),
 'outputTokens': sum((c.get('usage') or {}).get('output_tokens', 0) for c in calls),
 'failedRequestUsageUnknown': True
}
for name, data in [('verification', summary), ('sampled-frames-model-output', result)]:
    (public / (name + '.json')).write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'schemaAndReferenceChecks': 'passed', 'framesChecked': 18, 'firstPassSubtitleDisagreements': 1,
                  'focusedRecheckCorrected': True, 'completeSingleModelGoalPassed': False,
                  'allOriginalDatabaseTablesUnchanged': True, 'requestCount': len(calls)}, ensure_ascii=False))

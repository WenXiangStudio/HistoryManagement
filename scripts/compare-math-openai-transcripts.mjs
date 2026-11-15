// Read existing evidence only. No network, model inference, credential access or APP writes.
import {readFileSync,writeFileSync,mkdirSync,copyFileSync} from 'node:fs'
import {join,resolve} from 'node:path'
import {createHash} from 'node:crypto'
const out=resolve('docs/evidence/math-openai-transcript-comparison-20261012')
const local=join(process.env.LOCALAPPDATA,'SignalDeskFollowingReview','video-content','evidence','video-info-6308b5485e404fbe8a60d170')
const read=path=>JSON.parse(readFileSync(path,'utf8'))
const whisper=read(join(local,'transcript.json')),sense=read(join(local,'sensevoice-comparison.json'))
const qwenRoot=resolve('local-data/qwen-transcript-only-20261012')
const qwen=read(join(qwenRoot,'result.json')),report=read(join(qwenRoot,'report.json')),input=read(join(qwenRoot,'input-manifest.json'))
const doubaoRoot=resolve('docs/evidence/doubao-flash-20261012'),doubao=read(join(doubaoRoot,'success-verification.json'))
const doubaoBody=JSON.parse(read(join(doubaoRoot,'response-original.json')).body)
let completion
for(const line of readFileSync(join(qwenRoot,'response.sse'),'utf8').split(/\r?\n/)){
  if(!line.startsWith('data:'))continue
  let event;try{event=JSON.parse(line.slice(5).trim())}catch{continue}
  if(event.type==='response.completed')completion=event.response
}
if(!completion||completion.id!==qwen.responseId)throw Error('Qwen completion provenance mismatch')
if(whisper.metadata.sha256!==input.sourceSha256)throw Error('Original source differs')
mkdirSync(out,{recursive:true})
copyFileSync(join(local,'transcript.json'),join(out,'whisper-segments-original.json'))
copyFileSync(join(local,'sensevoice-comparison.json'),join(out,'sensevoice-original.json'))
const texts={whisper:whisper.segments.map(s=>s.text).join('\n'),sensevoice:sense.text,
  qwen:readFileSync(resolve('docs/evidence/qwen-transcript-only-20261012/transcript-original.txt'),'utf8'),
  doubao:readFileSync(join(doubaoRoot,'transcript-original.txt'),'utf8')}
if(texts.qwen!==qwen.segments[0].text||texts.doubao!==doubaoBody.result.text)throw Error('Original text mismatch')
for(const [model,text] of Object.entries(texts))writeFileSync(join(out,model+'-transcript.txt'),text,'utf8')
const hash=text=>createHash('sha256').update(text).digest('hex')
const result={workId:'7694535682575860393',title:'数学彻底怒openai了',transcriptionModelCount:4,
  sourceSha256:input.sourceSha256,cloudAudioSha256:input.chunks[0].sha256,cloudAudioDurationMs:input.durationMs,
  countedModels:['faster-whisper small','SenseVoiceSmall','qwen3.8-omni-flash','Doubao recording flash / volc.bigasr.auc_turbo'],
  excludedFromTranscriptionCount:['Qwen3-4B-Instruct-2507: summary only','Qwen3.5-4B: summary only','PaddleOCR: frame text recognition'],
  results:{
    whisper:{config:whisper.config,stageElapsedMs:whisper.elapsedMs,fullAppElapsedMs:null,
      segments:whisper.segments.length,characters:whisper.segments.reduce((n,s)=>n+Array.from(s.text).length,0),
      timestampPrecision:'segment',humanAccuracyPercent:null,cloudApiFeeCny:0,costNote:'Local hardware/electricity not measured'},
    sensevoice:{stageElapsedMs:sense.elapsedMs,fullAppElapsedMs:null,characters:Array.from(sense.text).length,
      characterNote:'Unicode code points including one emotion emoji; UTF-16 length is 396',timestampPrecision:'none in saved output',
      humanAccuracyPercent:null,cloudApiFeeCny:0,costNote:'Local hardware/electricity not measured',timingBoundary:'Saved comparison elapsedMs; initialization inclusion not established'},
    qwen:{model:qwen.modelVersion,responseId:completion.id,serverCreatedAtSeconds:completion.created_at,
      serverCompletedAtSeconds:completion.completed_at,serverIntervalMs:(completion.completed_at-completion.created_at)*1000,
      appRunToTimeoutMs:Date.parse(report.finishedAt)-Date.parse(report.startedAt),fullAppClickToVisibleMs:null,
      outcome:'Same completed response recovered after adapter timeout; no repeated request',
      characters:Array.from(texts.qwen).length,segments:qwen.segments.length,timestampPrecision:qwen.timestampPrecision,
      humanAccuracyPercent:100,humanAccuracyScope:'User verified this sample only',usage:completion.usage,
      feeCnyByUserReportedTokenDirection:0.0456886,feeCnyByApiTokenDirection:0.1475989,
      billingNote:'Two directions for one request; unresolved, not additive, neither independently verified cash debit'},
    doubao:{resourceId:doubao.resourceId,requestId:doubao.requestId,fullAppClickToVisibleMs:doubao.displayedTotalMs,
      preparationMs:doubao.preparationMs,requestMs:doubao.requestMs,saveMs:doubao.saveMs,
      sourceDurationMs:doubao.sourceDurationMs,returnedDurationMs:doubao.returnedDurationMs,
      characters:Array.from(texts.doubao).length,utterances:doubaoBody.result.utterances.length,
      utteranceTimestampFields:Object.keys(doubaoBody.result.utterances[0]??{}),humanAccuracyPercent:100,
      humanAccuracyScope:'User verified this sample only',audioUsageSeconds:77,userCalculatedFeeCny:0.017,
      billingNote:'User reported console duration and fee conversion; prior 401 fee not reported'}
  },
  rawTextSha256:Object.fromEntries(Object.entries(texts).map(([key,value])=>[key,hash(value)])),
  exportNote:'Whisper text joins unchanged original segments with newline; JSON retains original segmentation. Other text files preserve exact saved text.',
  newModelRequests:0}
writeFileSync(join(out,'comparison.json'),JSON.stringify(result,null,2))
console.log(JSON.stringify({models:result.transcriptionModelCount,characters:Object.fromEntries(Object.entries(result.results).map(([k,v])=>[k,v.characters])),
  qwenServerSeconds:result.results.qwen.serverIntervalMs/1000,whisperSegments:whisper.segments.length,doubaoUtterances:result.results.doubao.utterances,
  doubaoTimestampFields:result.results.doubao.utteranceTimestampFields,newModelRequests:0}))

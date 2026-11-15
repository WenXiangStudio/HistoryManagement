import {readFileSync,writeFileSync,existsSync} from 'node:fs'
import {resolve,join} from 'node:path'
import {generateVideoSummary} from '../src/main/videoSummary'
import type {ContentEvidence} from '../src/shared/videoContent'

const directory=resolve(process.argv.at(-1)!)
const transcript=JSON.parse(readFileSync(join(directory,'transcript.json'),'utf8'))
const evidence:ContentEvidence[]=transcript.segments.map((s:{id:string;startMs:number;endMs:number;text:string})=>({id:s.id,kind:'speech',startMs:s.startMs,endMs:s.endMs,text:s.text}))
const limitations=['口播为机器转写，专有名词和数字可能有误。','画面仅抽样和文字识别，未完成动态画面理解；内容为作者表达，未经外部事实核验。']
if(existsSync(join(directory,'ocr.json'))){
  const ocr=JSON.parse(readFileSync(join(directory,'ocr.json'),'utf8')),seen=new Set<string>()
  for(const b of ocr.blocks){if(b.confidence<.8||seen.has(b.text))continue;seen.add(b.text);evidence.push({id:b.id,kind:'frame-text',startMs:b.timeMs,endMs:b.timeMs,text:b.text,frameRef:b.frameId})}
}else limitations.push('尚未提取画面文字。')
evidence.sort((a,b)=>a.startMs-b.startMs)
const started=performance.now()
const summary=await generateVideoSummary({kind:'local',baseUrl:'http://127.0.0.1:8093/v1',model:process.env.SIGNALDESK_SUMMARY_MODEL||'Qwen3-4B-Instruct-2507-Q4_K_M'},evidence,limitations,
  AbortSignal.timeout(30*60000),(completed,total)=>console.log(JSON.stringify({completed,total})))
writeFileSync(join(directory,'summary.json'),JSON.stringify({...summary,elapsedMs:performance.now()-started},null,2))
console.log(JSON.stringify({overview:summary.overview,topics:summary.topics,keyPoints:summary.keyPoints,usage:summary.usage,elapsedMs:performance.now()-started},null,2))

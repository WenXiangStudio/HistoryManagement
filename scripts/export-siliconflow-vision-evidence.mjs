// Exports existing APP/model results only; no inference and no source data mutations.
import {mkdirSync,readFileSync,writeFileSync,copyFileSync} from 'node:fs'
import {join,resolve} from 'node:path'
import {createHash} from 'node:crypto'
const source=resolve('local-data/siliconflow-vision-20261012'),out=resolve('docs/evidence/siliconflow-vision-20261012')
const saved=JSON.parse(readFileSync(join(source,'app-result.json'),'utf8')),visual=saved.visual
const probes=JSON.parse(readFileSync(join(source,'connection-report.json'),'utf8'))
if(visual.mode!=='cloud-frames-only'||visual.modelVersion!=='Qwen/Qwen3.5-4B'||visual.localModelsUsed||visual.audioSubmitted||visual.summaryGenerated)throw Error('Unexpected processing scope')
if(saved.ui.cards!==12||saved.ui.images!==12||visual.requests.length!==4||probes.length!==2||!probes.every(r=>r.ok))throw Error('Verification incomplete')
mkdirSync(out,{recursive:true});mkdirSync(join(out,'frames'),{recursive:true})
const frames=visual.frames.map(f=>{
  const bytes=readFileSync(f.path)
  if(createHash('sha256').update(bytes).digest('hex')!==f.sha256)throw Error('Frame hash mismatch')
  const file='frames/'+f.id+'.jpg';copyFileSync(f.path,join(out,file));return {...f,path:file}
})
const result={...visual,frames}
writeFileSync(join(out,'visual-result.json'),JSON.stringify(result,null,2))
writeFileSync(join(out,'connection-report.json'),JSON.stringify(probes,null,2))
writeFileSync(join(out,'verification.json'),JSON.stringify({workId:'7694535682575860393',appVersion:'0.1.24',batchId:saved.batch.id,
  state:saved.batch.state,displayedTotalMs:saved.batch.displayedTotalMs,backendElapsedMs:saved.batch.elapsedMs,frameCount:frames.length,
  model:visual.modelVersion,usage:visual.usage,timing:visual.timing,appImagesLoaded:saved.ui.images,appTextsMatch:true,
  localModelsUsed:false,audioSubmitted:false,summaryGenerated:false,modelRequests:{glmConnection:1,qwenImageConnection:1,qwenVideoFrames:4},
  rendererErrors:saved.rendererErrors,humanAccuracyReview:'pending',actualFeeCny:null},null,2))
const lines=['# 云端Qwen3.5-4B逐帧原始读取结果','','来自APP已保存的同次结果。文字、描述与不确定项均原样保留；下方图片为提交给硅基流动的原帧。','']
for(const row of visual.readings){
  lines.push(`## ${(row.timeMs/1000).toFixed(3)}秒 · ${row.frameId}`,'',`![原始抽帧](frames/${row.frameId}.jpg)`,'','画面文字：','',row.text?'```text\n'+row.text+'\n```':'（模型返回空文本）','','画面描述：','',row.description,'','不确定项：',JSON.stringify(row.uncertainties),'')
}
writeFileSync(join(out,'frame-readings.md'),lines.join('\n'))
console.log(JSON.stringify({out,frames:frames.length,readingTextCharacters:visual.readings.reduce((n,r)=>n+Array.from(r.text).length,0),requests:6,displayedTotalMs:saved.batch.displayedTotalMs}))

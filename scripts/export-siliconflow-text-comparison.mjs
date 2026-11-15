// Offline export and field verification. Never requests inference or modifies the APP.
import {readFileSync,writeFileSync,mkdirSync,copyFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {join,resolve} from 'node:path'
const root=resolve('local-data/siliconflow-text-comparison-20261012')
const first=join(root,'attempt-02'),recovery=join(root,'attempt-03')
const target=resolve('docs/evidence/siliconflow-text-comparison-20261012')
const hash=value=>createHash('sha256').update(value).digest('hex')
const json=path=>JSON.parse(readFileSync(path,'utf8'))
const manifest=json(join(first,'manifest.json')),initial=json(join(first,'comparison.json')),fixed=json(join(recovery,'comparison.json'))
const sourceBytes=readFileSync(join(first,'transcript-original.txt')),source=sourceBytes.toString('utf8')
if(hash(sourceBytes)!==manifest.source.sha256)throw Error('Source changed')
const models=[{slug:'glm',label:'GLM-5.3-Flash',dir:recovery},{slug:'deepseek',label:'DeepSeek-V4-Flash',dir:first}]
let commonMessages
function reconstruct(path){
  const raw=readFileSync(path,'utf8'),frames=raw.split(/\r?\n\r?\n/)
  let content='',done=false,finish=null
  for(const frame of frames){
    const text=frame.split(/\r?\n/).filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart()).join('\n').trim()
    if(!text)continue
    if(text==='[DONE]'){done=true;continue}
    const item=JSON.parse(text)
    for(const choice of item.choices||[])if(choice.index===0){
      content+=choice.delta?.content||choice.message?.content||''
      finish=choice.finish_reason||finish
    }
  }
  return {content,done,finish}
}
const checked=models.map(model=>{
  const request=json(join(model.dir,model.slug+'-request.json')),report=json(join(model.dir,model.slug+'-report.json'))
  const output=readFileSync(join(model.dir,model.slug+'-output.txt'),'utf8'),raw=reconstruct(join(model.dir,model.slug+'-response.sse'))
  if(!report.complete||request.body.messages[1]?.content!==source||hash(JSON.stringify(request.body.messages))!==manifest.messagesSha256||
    hash(output)!==report.replySha256||raw.content!==output||!raw.done||raw.finish!=='stop')throw Error('Incomplete or changed model output: '+model.slug)
  const messages=JSON.stringify(request.body.messages)
  if(commonMessages&&commonMessages!==messages)throw Error('Models received different messages')
  commonMessages=messages
  const lines=output.split(/\r?\n/),headings=manifest.headings
  const headingPositions=headings.map(heading=>lines.map((line,index)=>line===heading?index:-1).filter(index=>index!==-1))
  const exactlyThreeHeadings=headingPositions.every(p=>p.length===1)&&headingPositions[0][0]<headingPositions[1][0]&&headingPositions[1][0]<headingPositions[2][0]
  const second=exactlyThreeHeadings?lines.slice(headingPositions[1][0]+1,headingPositions[2][0]).join('\n'):''
  const third=exactlyThreeHeadings?lines.slice(headingPositions[2][0]+1).join('\n'):''
  const labels=Object.fromEntries(['主要观点：','展开分析：','原文依据：'].map(label=>[label,second.split(label).length-1]))
  const numberedViewpointLabels=[...second.matchAll(/主要观点[一二三四五六七八九十0-9]+：/g)].length
  const quotes=[]
  for(let index=0;index<lines.length;index++)for(const match of lines[index].matchAll(/“([^”]+)”/g)){
    const exact=source.includes(match[1])
    const line=lines[index],mainStart=line.indexOf('原文依据：'),clueStart=line.indexOf('文本线索：'),reasonStart=line.indexOf('推测理由：')
    const mainEvidence=mainStart!==-1&&match.index>mainStart
    const eventClue=clueStart!==-1&&match.index>clueStart&&(reasonStart===-1||match.index<reasonStart)
    const domainEvidence=exactlyThreeHeadings&&index>headingPositions[2][0]&&index<lines.findIndex((line,i)=>i>headingPositions[2][0]&&line==='可能相关事件（推测）：')
    quotes.push({line:index+1,text:match[1],isExactSourceSubstring:exact,
      ...(exact?{sourceStart:source.indexOf(match[1]),sourceEnd:source.indexOf(match[1])+match[1].length}:{}),
      role:mainEvidence?'main-point-evidence':eventClue?'event-clue':domainEvidence?'domain-evidence':'other'})
  }
  const mainEvidence=quotes.filter(q=>q.role==='main-point-evidence'),eventClues=quotes.filter(q=>q.role==='event-clue')
  const verification={rawStreamMatchesSavedOutput:true,inputMessagesMatchOtherModel:true,inputTextExact:true,exactlyThreeRequiredHeadings:exactlyThreeHeadings,
    startsWithFirstHeading:output.startsWith(headings[0]+'\n')||output.startsWith(headings[0]+'\r\n'),
    viewpointLabels:labels,numberedViewpointLabels,viewpointsHaveAllThreeExactLabels:labels['主要观点：']>0&&new Set(Object.values(labels)).size===1,
    viewpointsHaveAllThreeLabelsIncludingNumbered:labels['主要观点：']+numberedViewpointLabels>0&&labels['主要观点：']+numberedViewpointLabels===labels['展开分析：']&&labels['展开分析：']===labels['原文依据：'],
    mainEvidenceCount:mainEvidence.length,mainEvidenceExact:mainEvidence.length>=labels['原文依据：']&&mainEvidence.every(q=>q.isExactSourceSubstring),
    eventClueCount:eventClues.length,eventCluesExact:eventClues.length>0&&eventClues.every(q=>q.isExactSourceSubstring),
    allQuotedSpansExact:quotes.every(q=>q.isExactSourceSubstring),
    domainsSectionPresent:third.includes('涉及领域'),speculationSectionPresent:third.includes('可能相关事件（推测）'),
    eventUncertaintyLabelPresent:third.includes('不能确定的部分'),quotes,
    scope:'Mechanical source/format checks only. Does not score factual truth, completeness of analysis, or quality of event inference.'}
  return {...model,model:report.model,output,report,parameters:request.body,verification}
})
const usage=report=>({input:report.usage.prompt_tokens,output:report.usage.completion_tokens,reasoning:report.usage.completion_tokens_details?.reasoning_tokens??null,total:report.usage.total_tokens})
const requests=[...initial.reports,...fixed.reports]
const totals=requests.reduce((sum,report)=>{const current=usage(report);for(const key of ['input','output','reasoning','total'])sum[key]+=current[key]??0;return sum},{input:0,output:0,reasoning:0,total:0})
const comparison={exportedAt:new Date().toISOString(),source:manifest.source,messagesSha256:manifest.messagesSha256,
  totalRequestCount:requests.reduce((sum,report)=>sum+report.requestCount,0),totalUsage:totals,
  initialExperimentElapsedMs:initial.executionElapsedMs,recoveryExperimentElapsedMs:fixed.executionElapsedMs,
  inferenceRequestSumMs:requests.reduce((sum,r)=>sum+r.requestElapsedMs,0),
  firstRequestAt:initial.reports[0].startedAt,lastResultSavedAt:fixed.reports.at(-1).resultsSavedAt,
  firstRequestToLastSavedMs:Date.parse(fixed.reports.at(-1).resultsSavedAt)-Date.parse(initial.reports[0].startedAt),
  wholeRecordedSessionStartedAt:json(join(root,'run-started.json')).startedAt,
  preflightFailure:{requestCount:0,reason:json(join(root,'run-failure.json')).error},
  completedModels:checked.map(({slug,label,model,report,verification})=>({slug,label,model,report,verification})),
  failedRequests:initial.reports.filter(r=>!r.complete),
  sameTranscript:true,sameMessages:true,sameParameters:false,
  parameterDifference:'GLM recovery max_tokens=16384 and thinking_budget=1024; DeepSeek initial max_tokens=4096 without thinking_budget. Other request settings and all messages identical.',
  retention:{initial:initial.retention,recovery:fixed.retention},
  timingScope:'Independent tests, not APP click-to-display. Session intervals include agent parameter investigation and recovery preparation; summed request durations exclude those gaps.'}
mkdirSync(target,{recursive:true})
for(const filename of ['manifest.json','system-prompt.txt','transcript-original.txt'])copyFileSync(join(first,filename),join(target,filename))
for(const model of checked){
  for(const [name,suffix] of [['output.txt','output.txt'],['report.json','report.json'],['request.json','request.json']])copyFileSync(join(model.dir,model.slug+'-'+name),join(target,model.slug+'-'+suffix))
  writeFileSync(join(target,model.slug+'-verification.json'),JSON.stringify(model.verification,null,2))
}
copyFileSync(join(first,'glm-report.json'),join(target,'glm-first-failed-report.json'))
writeFileSync(join(target,'comparison.json'),JSON.stringify(comparison,null,2))
writeFileSync(join(root,'final-comparison.json'),JSON.stringify(comparison,null,2))
const metricRows=checked.map(model=>{const u=usage(model.report);return `| ${model.label} | ${(model.report.requestElapsedMs/1000).toFixed(3)}秒 | ${(model.report.firstContentMs/1000).toFixed(3)}秒 | ${u.input} | ${u.output} | ${u.reasoning} | ${u.total} | ${model.report.replyCharacters} |`}).join('\n')
const full=`# 两款模型的原始文本结果\n\n本页两份结果逐字来自API返回正文，未修改措辞、引文、结构或推测。输入为同一份479字豆包极速版人工验收原文。原始回答中的事件描述仍是作者主张或模型推测，不因转写验收而成为已核实事实。\n\n| 模型 | 完整请求 | 首段正文 | 输入token | 输出token | 思考token（包含于输出） | 总token | 输出字符 |\n|---|---:|---:|---:|---:|---:|---:|---:|\n${metricRows}\n\nGLM列为一次修正请求结果；首次4096思考token截断、无正文的失败请求另行保留并计入总用量。两次成功请求的预算参数不同，不能作完全同参数性能排名。\n\n`+
  checked.map(model=>`## ${model.label}\n\n以下代码块完整保留正文，另有[原始文本](${model.slug}-output.txt)和[请求记录](${model.slug}-request.json)。\n\n\`\`\`text\n${model.output}\n\`\`\`\n`).join('\n')
writeFileSync(join(target,'full-results.md'),full)
const escape=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;')
const html=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>同文案文本测试：GLM / DeepSeek</title><style>body{margin:0;background:#f4f5f7;color:#20242b;font-family:system-ui,"Microsoft YaHei",sans-serif}main{max-width:1500px;margin:auto;padding:24px}h1{font-size:24px}p{line-height:1.7}details,article{background:white;border:1px solid #d5dbe3;border-radius:12px;padding:20px}summary{cursor:pointer;font-weight:600}.grid{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-top:24px}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:15px/1.85 system-ui,"Microsoft YaHei",sans-serif}.meta{font-size:14px;background:#f0f3f8;padding:10px;border-radius:8px}a{color:#2356a4}@media(max-width:850px){.grid{grid-template-columns:1fr}main{padding:12px}}</style><main><h1>同一份转写文案，两款模型文本测试</h1><p>《数学彻底怒openai了》 · 479字豆包极速版人工验收原文。仅总结、观点分析与原文依据、领域及事件推测。两侧逐字显示API原始正文；<a href="README.md">测试记录与检查说明</a>。</p><p>GLM首次请求因思考用完上限而无正文，下面显示有记录的修正结果；DeepSeek保留首次完整结果。预算参数差异已记录，耗时为API完整请求，包含网络。</p><details><summary>查看两款模型收到的同一份原文</summary><pre>${escape(source)}</pre></details><details><summary>查看完全相同的处理指令</summary><pre>${escape(readFileSync(join(first,'system-prompt.txt'),'utf8'))}</pre></details><div class="grid">${checked.map(model=>{const u=usage(model.report);return `<article><h2>${escape(model.label)}</h2><p class="meta">${(model.report.requestElapsedMs/1000).toFixed(3)}秒 · 输入${u.input} / 输出${u.output} / 思考${u.reasoning} token · ${model.report.replyCharacters}字符</p><pre>${escape(model.output)}</pre></article>`}).join('')}</div></main></html>`
writeFileSync(join(target,'review.html'),html)
console.log(JSON.stringify({totalRequestCount:comparison.totalRequestCount,totalUsage:totals,models:checked.map(model=>({slug:model.slug,usage:usage(model.report),requestElapsedMs:model.report.requestElapsedMs,firstContentMs:model.report.firstContentMs,characters:model.report.replyCharacters,verification:{...model.verification,quotes:undefined},quoteMismatches:model.verification.quotes.filter(q=>!q.isExactSourceSubstring)}))},null,2))

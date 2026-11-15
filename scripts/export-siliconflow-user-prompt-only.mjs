// Offline verification/export of the user's prompt-only redo; no inference or APP writes.
import {readFileSync,writeFileSync,copyFileSync,mkdirSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {join,resolve} from 'node:path'
const root=resolve('local-data/siliconflow-text-user-prompt-only-20261012')
const out=resolve('docs/evidence/siliconflow-text-user-prompt-only-20261012')
const hash=value=>createHash('sha256').update(value).digest('hex')
const readJson=name=>JSON.parse(readFileSync(join(root,name),'utf8'))
const manifest=readJson('manifest.json'),comparison=readJson('comparison.json')
const transcript=readFileSync(join(root,'transcript-original.txt'),'utf8')
const prompt=readFileSync(join(root,'user-prompt.txt'),'utf8')
const input=readFileSync(join(root,'input-exact.txt'),'utf8')
const expectedPrompt=['严格参照以下格式处理转写文案：',' - 对转写文案做内容的总结与概括 ；',
  ' — 对转写文案做分析，并展开文案内容的主要观点与原文依据；',
  ' - 根据文案内容和分析，推理推测此段文本内容涉及的领域、可能相关的事件；'].join('\n')
if(prompt!==expectedPrompt||input!==transcript+'\n\n'+expectedPrompt||hash(transcript)!==manifest.source.sha256||hash(input)!==manifest.inputSha256)
  throw Error('Input must exactly equal original transcript plus original user prompt')
const labels={glm:'GLM-5.3-Flash',deepseek:'DeepSeek-V4-Flash'}
let commonBody
const checked=comparison.reports.map(report=>{
  const request=readJson(report.slug+'-request.json'),body=request.body
  if(body.messages.length!==1||body.messages[0].role!=='user'||body.messages[0].content!==input||
    Object.keys(body.messages[0]).sort().join(',')!=='content,role'||'instructions' in body||'tools' in body||'system' in body||'prompt' in body)
    throw Error('Unexpected instruction or context in request: '+report.slug)
  const {model,...rest}=body
  if(commonBody&&commonBody!==JSON.stringify(rest))throw Error('Different content or parameters between models')
  commonBody=JSON.stringify(rest)
  if(hash(JSON.stringify(body.messages))!==manifest.messagesSha256)throw Error('Messages changed')
  const raw=readFileSync(join(root,report.slug+'-response.sse'),'utf8')
  const output=readFileSync(join(root,report.slug+'-output.txt'),'utf8')
  let rebuilt='',reasoning='',done=false,finish=null
  for(const frame of raw.split(/\r?\n\r?\n/)){
    const data=frame.split(/\r?\n/).filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart()).join('\n').trim()
    if(!data)continue
    if(data==='[DONE]'){done=true;continue}
    const event=JSON.parse(data)
    for(const choice of event.choices||[])if(choice.index===0){
      rebuilt+=choice.delta?.content||choice.message?.content||''
      reasoning+=choice.delta?.reasoning_content||choice.message?.reasoning_content||''
      finish=choice.finish_reason||finish
    }
  }
  if(rebuilt!==output||hash(output)!==report.replySha256||hash(reasoning)!==report.reasoningSha256||done!==report.streamDone||finish!==report.finishReason)
    throw Error('Saved output does not match original response: '+report.slug)
  return {slug:report.slug,label:labels[report.slug],report,output,
    verification:{oneUserMessage:true,exactTranscriptAndUserPromptOnly:true,noSystemMessage:true,noDeveloperMessage:true,noAssistantHistory:true,
      noAddedInstructionFields:true,sameMessagesAndParameters:true,rawResponseMatchesSavedOutput:true,streamDone:done,finishReason:finish}}
})
if(checked.length!==2||comparison.totalRequestCount!==2)throw Error('Expected exactly two recorded requests')
const totals=checked.reduce((sum,{report})=>{sum.input+=report.usage?.prompt_tokens??0;sum.output+=report.usage?.completion_tokens??0;
  sum.reasoning+=report.usage?.completion_tokens_details?.reasoning_tokens??0;sum.total+=report.usage?.total_tokens??0;return sum},
  {input:0,output:0,reasoning:0,total:0})
mkdirSync(out,{recursive:true})
for(const file of ['manifest.json','comparison.json','transcript-original.txt','user-prompt.txt','input-exact.txt','messages-exact.json'])
  copyFileSync(join(root,file),join(out,file))
for(const {slug,verification} of checked){
  for(const suffix of ['output.txt','report.json','request.json'])copyFileSync(join(root,slug+'-'+suffix),join(out,slug+'-'+suffix))
  writeFileSync(join(out,slug+'-input-verification.json'),JSON.stringify(verification,null,2),{flag:'wx'})
}
const verification={verifiedAt:new Date().toISOString(),inputSha256:manifest.inputSha256,messagesSha256:manifest.messagesSha256,
  sourceSha256:manifest.source.sha256,userPromptSha256:manifest.userPromptSha256,
  messageCount:1,roles:['user'],systemMessages:0,developerMessages:0,assistantMessages:0,additionalInstructionCharacters:0,
  sameMessagesAndParameters:true,totalRequestCount:2,totalUsage:totals,models:checked.map(({slug,report,verification})=>({slug,report,verification})),
  retention:comparison.retention,executionElapsedMs:comparison.executionElapsedMs,
  scope:'Input composition, API completion and verbatim output verification only; no editorial changes or extra model instructions.'}
writeFileSync(join(out,'verification.json'),JSON.stringify(verification,null,2),{flag:'wx'})
writeFileSync(join(root,'verification.json'),JSON.stringify(verification,null,2),{flag:'wx'})
const result=`# 仅用户提示词：两款模型完整原始回答\n\n本次只发送原始转写文案、两个换行及用户指定的三项提示词。每个请求仅一条user消息，未添加system/developer消息或其他指令。以下正文逐字来自API返回。\n\n`+
  checked.map(({slug,label,report,output})=>`## ${label}\n\n[独立原始文本](${slug}-output.txt) · [完整请求](${slug}-request.json) · 完整请求 ${(report.requestElapsedMs/1000).toFixed(3)}秒 · ${report.replyCharacters}字符\n\n\`\`\`text\n${output}\n\`\`\`\n`).join('\n')
writeFileSync(join(out,'full-results.md'),result,{flag:'wx'})
const escape=text=>String(text).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;')
const html=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>仅用户提示词：GLM / DeepSeek 原始结果</title><style>body{margin:0;background:#f4f5f7;color:#20242b;font-family:system-ui,"Microsoft YaHei",sans-serif}main{max-width:1500px;margin:auto;padding:24px}h1{font-size:24px}p{line-height:1.7}details,article{background:white;border:1px solid #d5dbe3;border-radius:12px;padding:20px}summary{cursor:pointer;font-weight:600}.grid{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-top:24px}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:15px/1.85 system-ui,"Microsoft YaHei",sans-serif}.meta{font-size:14px;background:#f0f3f8;padding:10px;border-radius:8px}a{color:#2356a4}@media(max-width:850px){.grid{grid-template-columns:1fr}main{padding:12px}}</style><main><h1>仅用户提示词：GLM / DeepSeek 完整原始回答</h1><p>《数学彻底怒openai了》 · 479字原文。两模型收到相同内容及相同请求参数，每个请求只有一条user消息。点击下方可查看实际发送的全文。<a href="README.md">本次记录</a></p><details><summary>实际发送的全部内容：原文＋用户提示词</summary><pre>${escape(input)}</pre></details><div class="grid">${checked.map(({slug,label,report,output})=>`<article><h2>${escape(label)}</h2><p class="meta">${(report.requestElapsedMs/1000).toFixed(3)}秒 · 输入${report.usage?.prompt_tokens??'未返回'} / 输出${report.usage?.completion_tokens??'未返回'} / 思考${report.usage?.completion_tokens_details?.reasoning_tokens??'未返回'} token · ${report.replyCharacters}字符</p><p><a href="${slug}-output.txt">原始文本</a> · <a href="${slug}-request.json">完整请求</a></p><pre>${escape(output)}</pre></article>`).join('')}</div></main></html>`
writeFileSync(join(out,'review.html'),html,{flag:'wx'})
console.log(JSON.stringify({totalRequestCount:2,totalUsage:totals,inputAudit:manifest.inputAudit,
  executionElapsedMs:comparison.executionElapsedMs,retention:comparison.retention,
  models:checked.map(({slug,report,verification})=>({slug,complete:report.complete,requestElapsedMs:report.requestElapsedMs,
    firstContentMs:report.firstContentMs,replyCharacters:report.replyCharacters,usage:report.usage,verification}))},null,2))

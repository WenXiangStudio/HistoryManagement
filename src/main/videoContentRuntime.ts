import {spawn,type ChildProcessWithoutNullStreams} from 'node:child_process'
import {readFileSync,existsSync,mkdirSync,writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {createRequire} from 'node:module'
import {randomBytes} from 'node:crypto'
import {createServer} from 'node:net'
import {z} from 'zod'
import type {VideoContentRuntime} from '../shared/videoContent'
import type {SummaryProvider} from './videoSummary'
const require=createRequire(import.meta.url)
export type VideoRuntimeConfiguration={python:string;asrModel:string;ocrDetection:string;ocrRecognition:string;llamaServer:string;summaryModel:string;summaryModelId?:string;localSummaryValidated?:boolean}
const runtimeConfigSchema=z.object({python:z.string().min(1),asrModel:z.string().min(1),ocrDetection:z.string().min(1),ocrRecognition:z.string().min(1),
  llamaServer:z.string().min(1),summaryModel:z.string().min(1),summaryModelId:z.string().optional(),localSummaryValidated:z.boolean().optional()}).strict()
export class VideoContentRuntimeClient{
  private child:ChildProcessWithoutNullStreams|null=null
  private server:ReturnType<typeof spawn>|null=null
  private pending=new Map<number,{resolve:(value:any)=>void;reject:(reason:Error)=>void;timer:ReturnType<typeof setTimeout>}>()
  private id=0
  private provider:SummaryProvider|null=null
  constructor(private userData:string,private script:string){}
  config():VideoRuntimeConfiguration|null{
    try{return runtimeConfigSchema.parse(JSON.parse(readFileSync(join(this.userData,'video-content','runtime.json'),'utf8')))}catch{return null}
  }
  status():VideoContentRuntime{
    const c=this.config(),pythonAvailable=!!c&&existsSync(c.python),asrAvailable=!!c&&existsSync(join(c.asrModel,'model.bin')),
      ocrAvailable=!!c&&existsSync(join(c.ocrDetection,'inference.yml'))&&existsSync(join(c.ocrRecognition,'inference.yml')),
      summaryAvailable=!!c&&existsSync(c.llamaServer)&&existsSync(c.summaryModel)
    const localSummaryValidated=c?.localSummaryValidated===true
    return {ready:pythonAvailable&&asrAvailable,pythonAvailable,asrAvailable,ocrAvailable,summaryAvailable,localSummaryValidated,triageAvailable:pythonAvailable&&!!c&&existsSync(join(c.ocrDetection,'inference.yml')),
      message:pythonAvailable&&asrAvailable?(localSummaryValidated?'本地内容处理已就绪':'本地转写和画面文字已就绪；本地摘要尚未通过质量验证，可使用云端生成摘要。'): '本地处理环境尚未就绪，请先配置已安装的模型运行环境'}
  }
  fork(){return new VideoContentRuntimeClient(this.userData,this.script)}
  configure(c:VideoRuntimeConfiguration){
    if(this.child||this.server)throw Error('请先停止内容任务再修改环境')
    for(const key of ['python','asrModel','ocrDetection','ocrRecognition','llamaServer','summaryModel'] as const)if(typeof c[key]!=='string'||!existsSync(c[key]))throw Error('运行环境路径不存在')
    mkdirSync(join(this.userData,'video-content'),{recursive:true});writeFileSync(join(this.userData,'video-content','runtime.json'),JSON.stringify(c,null,2));return this.status()
  }
  paths(){return {ffmpeg:(require('@ffmpeg-installer/ffmpeg') as {path:string}).path.replace('app.asar','app.asar.unpacked'),
    ffprobe:(require('@ffprobe-installer/ffprobe') as {path:string}).path.replace('app.asar','app.asar.unpacked')}}
  async request(method:string,params:Record<string,unknown>,signal:AbortSignal):Promise<any>{
    signal.throwIfAborted();const config=this.config();if(!config)throw Error('VIDEO_RUNTIME_UNAVAILABLE')
    if(!this.child){
      const child=spawn(config.python,['-B',this.script],{windowsHide:true,stdio:['pipe','pipe','pipe'],env:{...process.env,PYTHONUTF8:'1',PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK:'True'}})
      this.child=child;let buffer=''
      child.stdout.on('data',chunk=>{buffer+=chunk.toString('utf8');const lines=buffer.split('\n');buffer=lines.pop()||''
        for(const line of lines){try{const m=JSON.parse(line),task=this.pending.get(m.id);if(task){clearTimeout(task.timer);this.pending.delete(m.id);m.error?task.reject(Error(m.error.code)):task.resolve(m.result)}}catch{ /* Dependency chatter never becomes a success receipt. */ }}})
      child.stderr.on('data',()=>{})
      const stopped=()=>{if(this.child!==child)return;this.child=null;for(const t of this.pending.values()){clearTimeout(t.timer);t.reject(Error('VIDEO_WORKER_STOPPED'))}this.pending.clear()}
      child.on('error',stopped);child.on('exit',stopped)
    }
    const id=++this.id,abort=()=>this.stopWorker()
    signal.addEventListener('abort',abort,{once:true})
    try{return await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.pending.delete(id);reject(Error('VIDEO_WORKER_TIMEOUT'));this.stopWorker()},2*60*60*1000)
      this.pending.set(id,{resolve,reject,timer})
      this.child!.stdin.write(JSON.stringify({id,method,params:{...params,...this.paths(),modelPath:config.asrModel,
        modelRevision:'536b0662742c02347bc0e980a01041f333bce120',detectionModelPath:config.ocrDetection,recognitionModelPath:config.ocrRecognition}})+'\n')
    })}finally{signal.removeEventListener('abort',abort)}
  }
  async summaryProvider(signal:AbortSignal):Promise<SummaryProvider>{
    if(this.provider&&this.server&&!this.server.killed)return this.provider
    const config=this.config();if(!config||!this.status().summaryAvailable)throw Error('SUMMARY_MODEL_UNAVAILABLE')
    // Only one compute stage is active; release speech/OCR memory before starting the LLM.
    this.stopWorker()
    const port=await new Promise<number>((resolve,reject)=>{const s=createServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const p=(s.address() as {port:number}).port;s.close(()=>resolve(p))})})
    const key=randomBytes(32).toString('hex')
    const child=spawn(config.llamaServer,['-m',config.summaryModel,'--host','127.0.0.1','--port',String(port),'-c','12288','-ngl','0','-t','8','--parallel','1','--jinja','--reasoning-budget','0','--api-key',key],{windowsHide:true,stdio:['ignore','ignore','ignore']})
    this.server=child
    let spawnError=false;child.on('error',()=>{spawnError=true});child.on('exit',()=>{if(this.server===child){this.server=null;this.provider=null}})
    const abort=()=>{child.kill();this.provider=null};signal.addEventListener('abort',abort,{once:true})
    try{
      const deadline=Date.now()+120000
      while(Date.now()<deadline){signal.throwIfAborted();if(spawnError||child.exitCode!==null)throw Error('SUMMARY_SERVER_FAILED')
        try{const r=await fetch(`http://127.0.0.1:${port}/health`,{headers:{authorization:'Bearer '+key},signal:AbortSignal.timeout(2000)});if(r.ok){this.provider={kind:'local',baseUrl:`http://127.0.0.1:${port}/v1`,model:config.summaryModelId||'Qwen3-4B-Instruct-2507-Q4_K_M',apiKey:key};return this.provider}}catch{}
        await new Promise(r=>setTimeout(r,300))
      }
      throw Error('SUMMARY_SERVER_TIMEOUT')
    }finally{signal.removeEventListener('abort',abort)}
  }
  private terminate(child:ReturnType<typeof spawn>|null){
    if(!child||child.exitCode!==null||!child.pid)return
    if(process.platform==='win32'){
      const killer=spawn('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'})
      killer.on('error',()=>child.kill())
    }else child.kill()
  }
  stopSummary(){const server=this.server;this.server=null;this.provider=null;this.terminate(server)}
  stopWorker(){const child=this.child;this.child=null;for(const task of this.pending.values()){clearTimeout(task.timer);task.reject(Error('VIDEO_WORKER_STOPPED'))}this.pending.clear();this.terminate(child)}
  stop(){this.stopWorker();this.stopSummary()}
}

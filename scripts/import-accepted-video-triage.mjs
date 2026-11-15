// One-time import of the explicitly accepted 14 classifications. No model, interest or cloud calls.
import {createHash} from 'node:crypto'
import {readFileSync,mkdirSync,copyFileSync,existsSync,statSync,writeFileSync} from 'node:fs'
import {join,resolve,dirname} from 'node:path'
import {DatabaseSync} from 'node:sqlite'

const userData=resolve(process.argv[2]||join(process.env.LOCALAPPDATA,'SignalDeskFollowingReview'))
const raw=readFileSync('docs/evidence/detection-triage-fourteen-20261013/classification-results.json')
const evidence=JSON.parse(raw),review=JSON.parse(readFileSync('docs/evidence/detection-triage-fourteen-20261013/user-adjudication.json','utf8'))
const hash=bytes=>createHash('sha256').update(bytes).digest('hex')
if(hash(raw)!==review.rawClassifierSnapshotSha256||review.correctCount!==14||review.incorrectCount!==0)throw Error('Accepted evidence mismatch')
const db=new DatabaseSync(join(userData,'following-directory.sqlite'))
const report={at:new Date().toISOString(),sourceHash:hash(raw),imported:[],skipped:[],newModelCalls:0,interestChanged:false}
const rows=[]
try{
  for(const record of evidence.records){
    if(!review.records.some(r=>r.workId===record.workId&&r.manualCorrect))throw Error('Missing human acceptance')
    const work=db.prepare('SELECT v.*,s.capture_json FROM creator_video_information v JOIN video_information_snapshots s ON s.snapshot_id=v.snapshot_id WHERE v.work_id=?').get(record.workId)
    if(!work)throw Error('Accepted work no longer in library')
    const previous=db.prepare("SELECT result_json FROM video_content_stages WHERE owner_sec_uid=? AND work_id=? AND stage='classification' AND state='completed' ORDER BY id DESC LIMIT 1").get(work.owner_sec_uid,record.workId)
    if(previous){report.skipped.push(record.workId);continue}
    const saved=db.prepare("SELECT result_json FROM video_content_stages WHERE owner_sec_uid=? AND work_id=? AND stage='media' AND state='completed' ORDER BY id DESC LIMIT 1").get(work.owner_sec_uid,record.workId)
    const media=saved?JSON.parse(saved.result_json):{directory:dirname(record.sourcePath),mediaPath:record.sourcePath}
    const proof=JSON.parse(readFileSync(join(media.directory,'proof.json'),'utf8')),source=readFileSync(media.mediaPath)
    if(hash(source)!==record.sourceSha256||proof.capture?.work?.workId!==record.workId||proof.capture?.work?.authorUid!==work.author_uid||proof.capture?.work?.authorSecUid!==work.creator_sec_uid||proof.capture?.ownerVerification?.secUid!==work.owner_sec_uid)throw Error('Accepted media identity mismatch')
    const frames=record.visual.frames.map((f,i)=>{
      if(!existsSync(f.path)||hash(readFileSync(f.path))!==f.sha256)throw Error('Accepted frame evidence unavailable')
      const path=join(media.directory,'classification-accepted-20261013',`frame-${i+1}.jpg`)
      mkdirSync(dirname(path),{recursive:true});copyFileSync(f.path,path)
      return {id:`triage-${i+1}`,timeMs:Math.round(f.timeSeconds*1000),path,sha256:f.sha256}
    })
    const result={code:record.classification.code,ruleVersion:'existence-detection-triage-v1',sourceSha256:record.sourceSha256,
      strength:record.classification.ruleEvidenceStrength,basis:record.classification.basis,frames,timing:record.timing??{},
      manualReview:{code:record.classification.code,note:'2026-10-13 用户逐条人工验收：本轮14条分类全部正确。',at:review.recordedAt},
      asrInvoked:false,textRecognitionInvoked:false,cloudInvoked:false,importedEvidence:{sourceHash:hash(raw),reviewedAt:review.recordedAt}}
    rows.push({owner:work.owner_sec_uid,id:record.workId,result,media:{...media,sha256:record.sourceSha256,byteLength:statSync(media.mediaPath).size}})
  }
  db.exec('BEGIN IMMEDIATE')
  try{
    const insert=db.prepare("INSERT INTO video_content_stages(owner_sec_uid,work_id,stage,input_hash,state,updated_at,result_json) VALUES(?,?,?,?,'completed',?,?)")
    for(const row of rows){
      insert.run(row.owner,row.id,'media',row.media.sha256,report.at,JSON.stringify(row.media))
      insert.run(row.owner,row.id,'classification',row.result.sourceSha256,report.at,JSON.stringify(row.result))
      report.imported.push(row.id)
    }
    db.exec('COMMIT')
  }catch(error){db.exec('ROLLBACK');throw error}
}finally{db.close()}
const output=resolve('local-data/video-workflow-20261013');mkdirSync(output,{recursive:true});writeFileSync(join(output,'accepted-triage-import.json'),JSON.stringify(report,null,2))
console.log(JSON.stringify(report,null,2))

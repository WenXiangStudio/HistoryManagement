"""Prepare a temporary review entry; does not edit shipped application code."""
import json, os, sqlite3
from pathlib import Path

root = Path(__file__).resolve().parents[1]
out = root / 'local-data/single-cloud-video-20261011'
source = Path(os.environ['LOCALAPPDATA']) / 'SignalDeskFollowingReview'
backup = out / 'before-acquisition'
backup.mkdir(exist_ok=True)
for name in ['signal-desk.sqlite', 'following-directory.sqlite']:
    with sqlite3.connect((source / name).as_uri() + '?mode=ro', uri=True) as db:
        with sqlite3.connect(backup / name) as dest:
            db.backup(dest)

entry = root / 'out/main/single-cloud-acquire.mjs'
code = (root / 'out/main/index.js').read_text(encoding='utf-8')
# The review instance performs no automatic external synchronization.
code = code.replace('feishuProbe.startAutomatic()', 'void 0').replace('feishuProbe?.dataChanged()', 'void 0')
prefix = "import { app as experimentApp } from 'electron';\n"
prefix += 'experimentApp.setPath("userData", ' + json.dumps(str(source)) + ');\n'
prefix += 'experimentApp.setAppPath(' + json.dumps(str(root)) + ');\n'
suffix = r'''
const experimentRoot = EXPERIMENT_ROOT;
const experimentFs = await import('node:fs');
const experimentTarget = JSON.parse(experimentFs.readFileSync(experimentRoot+'/known-work.json','utf8'));
const experimentOldCapture = JSON.parse(experimentFs.readFileSync(experimentRoot+'/existing-capture.json','utf8'));
const experimentStart = performance.now();
let experimentRunning = false;
const experimentTimer=setInterval(async()=>{
 if(experimentRunning)return;
 if(performance.now()-experimentStart>90000){clearInterval(experimentTimer);experimentFs.writeFileSync(experimentRoot+'/acquisition-error.json',JSON.stringify({error:'REVIEW_NOT_READY'}));app.quit();return;}
 if(!followingSync||!videoContent||followingSync.status().readiness?.phase!=='ready'||!followingSync.status().connection?.online)return;
 experimentRunning=true;clearInterval(experimentTimer);
 try{
  const s=followingSync.status();
  if([s.phase,s.activity?.phase,s.basic?.phase,s.videoInformation?.phase].includes('running'))throw Error('APP_NOT_IDLE');
  const owner=followingSync.preferences.value.activeOwnerSecUid;
  if(owner!==experimentOldCapture.ownerSecUid)throw Error('OWNER_CHANGED');
  const creator=followingSync.listCreators().find(c=>c.nativeUid===experimentTarget.authorUid&&c.profileUrl.endsWith(experimentTarget.authorSecUid));
  const identity=followingSync.store.account(owner);
  if(!creator||!identity?.uid)throw Error('AUTHOR_OR_OWNER_UNAVAILABLE');
  const started=performance.now();
  const command=followingSync.videoInformation.begin(owner,identity.uid,creator,true,{...experimentTarget,creatorId:creator.id,nickname:creator.nickname});
  followingSync.command={...command,origin:followingSync.origin,token:followingSync.token};followingSync.dispatch();
  experimentFs.writeFileSync(experimentRoot+'/acquisition-start.json',JSON.stringify({workId:experimentTarget.workId,creator:creator.nickname,startedAt:new Date().toISOString()}));
  let result;
  for(let n=0;n<610;n++){
   await new Promise(r=>setTimeout(r,1000));result=followingSync.videoInformationStatus();
   if(result.runId!==command.runId)throw Error('SESSION_CHANGED');
   if(result.phase!=='running')break;
  }
  if(result?.phase!=='completed'||!result.evidence)throw Error(result?.errorCode||'CAPTURE_FAILED');
  experimentFs.copyFileSync(result.evidence.mediaPath,experimentRoot+'/source.mp4');
  experimentFs.writeFileSync(experimentRoot+'/source-proof.json',JSON.stringify({...result,creatorNickname:creator.nickname,captureToLocalCopyMs:Math.round(performance.now()-started),isolatedExperiment:true,formalVideoInformationSaved:false},null,2));
 }catch(e){experimentFs.writeFileSync(experimentRoot+'/acquisition-error.json',JSON.stringify({error:e.message}));}
 finally{app.quit();}
},500);
'''.replace('EXPERIMENT_ROOT', json.dumps(str(out)))
entry.write_text(prefix + code + suffix, encoding='utf-8')
print(json.dumps({'backupCreated': True, 'temporaryEntry': str(entry)}))

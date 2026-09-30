import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const inputPath = resolve(process.argv[2] || 'local-data/douyin-following-20260930.json')
const outputDirectory = resolve('local-data')
const input = JSON.parse(readFileSync(inputPath, 'utf8').replace(/^\uFEFF/, ''))
const creators = input.creators
if (creators.length !== 10 || new Set(creators.map(item => item.secUid)).size !== 10) throw new Error('Need ten distinct captured profiles')
for (const creator of creators) {
  if (!creator.nickname || creator.profileUrl !== `https://www.douyin.com/user/${creator.secUid}`) throw new Error('Captured profile binding mismatch')
}
mkdirSync(outputDirectory, { recursive: true })
const databasePath = join(outputDirectory, 'douyin-following.sqlite')
const database = new DatabaseSync(databasePath)
database.exec(`PRAGMA foreign_keys=ON;
  CREATE TABLE IF NOT EXISTS following_runs(run_id TEXT PRIMARY KEY,collected_at TEXT NOT NULL,
    source_url TEXT NOT NULL,collection_method TEXT NOT NULL,creator_count INTEGER NOT NULL) STRICT;
  CREATE TABLE IF NOT EXISTS following_creators(run_id TEXT NOT NULL REFERENCES following_runs(run_id),
    position INTEGER NOT NULL,nickname TEXT NOT NULL,sec_uid TEXT NOT NULL,profile_url TEXT NOT NULL,
    avatar_url TEXT,signature TEXT NOT NULL,PRIMARY KEY(run_id,position),UNIQUE(run_id,sec_uid)) STRICT;`)
const runId = `desktop-following-${input.collectedAt.replace(/[^0-9]/g,'').slice(0,14)}`
database.exec('BEGIN IMMEDIATE')
try {
  database.prepare('INSERT OR IGNORE INTO following_runs VALUES(?,?,?,?,?)').run(runId,input.collectedAt,input.sourceUrl,input.collectionMethod,10)
  const insert = database.prepare(`INSERT INTO following_creators VALUES(?,?,?,?,?,?,?)
    ON CONFLICT(run_id,position) DO UPDATE SET nickname=excluded.nickname,sec_uid=excluded.sec_uid,
    profile_url=excluded.profile_url,avatar_url=excluded.avatar_url,signature=excluded.signature`)
  creators.forEach(item=>insert.run(runId,item.position,item.nickname,item.secUid,item.profileUrl,item.avatarUrl,item.signature))
  database.exec('COMMIT')
} catch(error) { database.exec('ROLLBACK'); throw error }
const rows=database.prepare(`SELECT position,nickname,sec_uid AS secUid,profile_url AS profileUrl,
  avatar_url AS avatarUrl,signature FROM following_creators WHERE run_id=? ORDER BY position`).all(runId)
if(rows.length!==10 || rows.some((row,i)=>row.nickname!==creators[i].nickname || row.profileUrl!==creators[i].profileUrl)) throw new Error('Database readback differs from capture')
const integrity=database.prepare('PRAGMA integrity_check').get().integrity_check
if(integrity!=='ok')throw new Error('Database integrity failed')
database.close()

// Also put the same visible-list capture into the existing APP directory so its cards can display it.
const appDirectoryPath=join(process.env.LOCALAPPDATA,'SignalDeskFollowingReview','following-directory.sqlite')
const appDirectory=new DatabaseSync(appDirectoryPath)
const appCreators=creators.map(({position,...item})=>({uid:null,secUid:item.secUid,nickname:item.nickname,
  avatarUrl:item.avatarUrl,signature:item.signature,profileUrl:item.profileUrl}))
const report={contract:'signaldesk-visible-following/v1',runId,collectedAt:input.collectedAt,
  ownerSecUid:null,ownerNickname:'无限♾️进步',sourceUrl:input.sourceUrl,sourceKind:'visible-following-list',
  activeFollowingTab:true,listStartedAtTop:true,hasMore:true,visibleItemCount:10,creators:appCreators,
  projectionSha256:createHash('sha256').update(JSON.stringify(appCreators)).digest('hex'),activeApiRequests:0,workResponseBodiesRead:0}
appDirectory.exec('BEGIN IMMEDIATE')
try{
  appDirectory.prepare('INSERT INTO visible_directory_runs VALUES(?,?,?,?,?) ON CONFLICT(run_id) DO UPDATE SET report_json=excluded.report_json').run(runId,input.collectedAt,'无限♾️进步','scope-limited',JSON.stringify(report))
  const insert=appDirectory.prepare(`INSERT INTO visible_directory_creators(run_id,sec_uid,nickname,avatar_url,signature,profile_url,position)
    VALUES(?,?,?,?,?,?,?) ON CONFLICT(run_id,sec_uid) DO UPDATE SET avatar_url=excluded.avatar_url`)
  creators.forEach(item=>insert.run(runId,item.secUid,item.nickname,item.avatarUrl,item.signature,item.profileUrl,item.position))
  appDirectory.exec('COMMIT')
}catch(error){appDirectory.exec('ROLLBACK');throw error}
const appCount=appDirectory.prepare('SELECT COUNT(*) AS n FROM visible_directory_creators WHERE run_id=?').get(runId).n
appDirectory.close()
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
const html=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>已保存 10 位抖音关注博主</title>
<style>body{font:16px/1.7 system-ui;max-width:1050px;margin:40px auto;color:#24392c;background:#f4f1ea}h1{font-size:30px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}.card{background:white;border-radius:14px;padding:20px;display:flex;gap:15px;align-items:flex-start}.avatar{width:58px;height:58px;border-radius:50%;object-fit:cover;background:#dce6d9}.body{min-width:0}h2{font-size:19px;margin:0}p{margin:5px 0;color:#647264}a{display:block;overflow-wrap:anywhere;font-size:12px;color:#247641}code{overflow-wrap:anywhere}</style>
<h1>已保存 10 位抖音关注博主</h1><p>账号：无限♾️进步 · 当前关注列表“综合排序”的前 10 位 · ${escape(input.collectedAt)}</p>
<p>本地 SQLite：<code>${escape(databasePath)}</code> · 数据库读取核验：10 条 · 完整性：ok</p><div class="grid">
${rows.map(item=>`<article class="card">${item.avatarUrl?`<img class="avatar" src="${escape(item.avatarUrl)}" alt="${escape(item.nickname)}头像">`:'<div class="avatar"></div>'}<div class="body"><h2>${item.position}. ${escape(item.nickname)}</h2><p>${escape(item.signature)}</p><a href="${escape(item.profileUrl)}" target="_blank">${escape(item.profileUrl)}</a></div></article>`).join('')}</div></html>`
const htmlPath=join(outputDirectory,'douyin-following-result.html')
writeFileSync(htmlPath,html)
const verification={runId,collectedAt:input.collectedAt,databasePath,count:rows.length,integrity,
  appDirectoryPath,appCount,profileLinks:rows.map(row=>({position:row.position,nickname:row.nickname,profileUrl:row.profileUrl})),
  avatarUrlCount:rows.filter(row=>row.avatarUrl).length,workCollectionCount:0,commentCollectionCount:0,
  source:'Current logged-in account following popup, Chrome copy-link action',htmlPath}
writeFileSync(join(outputDirectory,'douyin-following-verification.json'),JSON.stringify(verification,null,2))
console.log(JSON.stringify(verification,null,2))

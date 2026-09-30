import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const capturePath = resolve('local-data/douyin-following-20260930.json')
const bindingPath = resolve('local-data/following-avatar-bindings.json')
const capture = JSON.parse(readFileSync(capturePath, 'utf8').replace(/^\uFEFF/, ''))
const bindings = JSON.parse(readFileSync(bindingPath, 'utf8').replace(/^\uFEFF/, ''))
const byId = new Map(bindings.records.map(item => [item.secUid, item]))
if (byId.size !== 10) throw new Error('Expected ten distinct observed avatar/profile bindings')
const correction = []
for (const creator of capture.creators) {
  const binding = byId.get(creator.secUid)
  if (!binding || binding.nickname !== creator.nickname || binding.profileUrl !== creator.profileUrl
    || binding.anchorProfileUrl.replace(/\/$/, '') !== creator.profileUrl
    || binding.imageAlt !== `${creator.nickname}头像` || !binding.imageLoaded
    || binding.bindingMethod !== 'image-inside-exact-profile-anchor') throw new Error(`Observed avatar does not match ${creator.nickname}`)
  if (creator.avatarUrl !== binding.avatarUrl) correction.push({nickname: creator.nickname, before:creator.avatarUrl, after:binding.avatarUrl})
}
const beforePath = resolve('local-data/douyin-following-before-avatar-fix.json')
if (!existsSync(beforePath)) copyFileSync(capturePath, beforePath)
capture.creators.forEach(creator => { creator.avatarUrl = byId.get(creator.secUid).avatarUrl })
capture.avatarBindingMethod = 'Exact profile anchor contains img with matching nickname alt; verified in live Chrome DOM'
capture.avatarVerifiedAt = bindings.collectedAt
writeFileSync(capturePath, JSON.stringify(capture,null,2))
const saved = spawnSync(process.execPath,['scripts/save-following-desktop.mjs'],{encoding:'utf8'})
if(saved.status !== 0) throw new Error(saved.stderr || saved.stdout)
const db = new DatabaseSync(resolve('local-data/douyin-following.sqlite'),{readOnly:true})
const rows = db.prepare('SELECT nickname,sec_uid AS secUid,profile_url AS profileUrl,avatar_url AS avatarUrl FROM following_creators ORDER BY position').all()
if(rows.length!==10 || rows.some(row=>byId.get(row.secUid)?.avatarUrl!==row.avatarUrl))throw new Error('Stored avatars differ from observed bindings')
const integrity=db.prepare('PRAGMA integrity_check').get().integrity_check
db.close()
const result = { correctedAt:new Date().toISOString(), count:rows.length, avatarCount:rows.filter(row=>row.avatarUrl).length,
  correctionCount:correction.length, corrections:correction, integrity, bindingsSha256:createHash('sha256').update(readFileSync(bindingPath)).digest('hex'),
  observedImageLoadedCount:bindings.records.filter(item=>item.imageLoaded).length,
  bindingMethod:capture.avatarBindingMethod }
writeFileSync(resolve('local-data/avatar-correction-verification.json'),JSON.stringify(result,null,2))
console.log(JSON.stringify(result,null,2))

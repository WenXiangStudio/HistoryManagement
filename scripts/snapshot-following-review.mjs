import {mkdirSync,writeFileSync} from 'node:fs'
import {join,resolve} from 'node:path'
import {DatabaseSync,backup} from 'node:sqlite'
const output=resolve(process.argv[2])
mkdirSync(output,{recursive:true})
const db=new DatabaseSync(join(process.env.LOCALAPPDATA,'SignalDeskFollowingReview','following-directory.sqlite'),{readOnly:true})
try{
  const tables=['directory_runs','directory_creators','visible_directory_runs','visible_directory_creators']
  const rows=Object.fromEntries(tables.map(table=>[table,db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]))
  writeFileSync(join(output,'database-before.json'),JSON.stringify(rows,null,2))
  await backup(db,join(output,'directory-before.sqlite'))
  console.log(JSON.stringify({previousCount:rows.visible_directory_creators.length,snapshot:output}))
}finally{db.close()}

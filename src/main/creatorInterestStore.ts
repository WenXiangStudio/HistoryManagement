import type {DatabaseSync} from 'node:sqlite'
import type {CreatorListItem} from '../shared/contracts'
import {creatorInterestInputSchema,type CreatorInterestState} from '../shared/creatorInterest'

/** Only explicit additions create membership. Account + homepage identity survives partial syncs. */
export class CreatorInterestStore{
  constructor(private readonly db:DatabaseSync){
    db.exec(`CREATE TABLE IF NOT EXISTS creator_interest_memberships(
      owner_sec_uid TEXT NOT NULL,creator_sec_uid TEXT NOT NULL,
      tier TEXT CHECK(tier IN ('high','medium','weak')),revision INTEGER NOT NULL CHECK(revision>0),updated_at TEXT NOT NULL,
      PRIMARY KEY(owner_sec_uid,creator_sec_uid)) STRICT`)
  }
  private parse(row:Record<string,unknown>):CreatorInterestState{
    return {tier:row.tier as CreatorInterestState['tier'],revision:Number(row.revision)}
  }
  decorate(owner:string|null,creators:CreatorListItem[]):CreatorListItem[]{
    const secUid=creators.length===1?new URL(creators[0].profileUrl).pathname.split('/').at(-1):undefined
    const saved=new Map(owner?this.db.prepare(`SELECT * FROM creator_interest_memberships WHERE owner_sec_uid=?${secUid?' AND creator_sec_uid=?':''}`)
      .all(owner,...(secUid?[secUid]:[])).map(row=>[String(row.creator_sec_uid),this.parse(row)]):[])
    return creators.map(creator=>({...creator,interest:saved.get(new URL(creator.profileUrl).pathname.split('/').at(-1)!)??{tier:null,revision:0}}))
  }
  update(owner:string|null,creators:CreatorListItem[],input:unknown):CreatorInterestState{
    const values=creatorInterestInputSchema.parse(input)
    if(!owner||owner!==values.ownerSecUid)throw Error('账号已切换，请重新打开博主资料库后设置兴趣度')
    if(!creators.some(creator=>!creator.isDemo&&new URL(creator.profileUrl).pathname.split('/').at(-1)===values.secUid))throw Error('该博主不属于当前账号')
    this.db.exec('BEGIN IMMEDIATE')
    try{
      const row=this.db.prepare('SELECT * FROM creator_interest_memberships WHERE owner_sec_uid=? AND creator_sec_uid=?').get(owner,values.secUid)
      const current=row?this.parse(row):{tier:null,revision:0}
      if(current.revision!==values.revision)throw Error('该博主兴趣度已发生变化，请等待页面更新后重试')
      if(current.tier===values.tier){this.db.exec('COMMIT');return current}
      const next={tier:values.tier,revision:current.revision+1}
      this.db.prepare(`INSERT INTO creator_interest_memberships VALUES(?,?,?,?,?) ON CONFLICT(owner_sec_uid,creator_sec_uid)
        DO UPDATE SET tier=excluded.tier,revision=excluded.revision,updated_at=excluded.updated_at`)
        .run(owner,values.secUid,next.tier,next.revision,new Date().toISOString())
      this.db.exec('COMMIT');return next
    }catch(error){this.db.exec('ROLLBACK');throw error}
  }
}

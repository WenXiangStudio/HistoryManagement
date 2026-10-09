import type {DatabaseSync} from 'node:sqlite'
import type {CreatorListItem} from '../shared/contracts'
import {creatorAutomaticTier} from '../shared/creatorRefreshPolicy'
import {adjustedCreatorTier,creatorPriorityInputSchema,DEFAULT_CREATOR_PRIORITY,type CreatorPriorityState} from '../shared/creatorPriority'

/** Manual priority is attached to owner + profile identity, independent of collection batches. */
export class CreatorPriorityStore {
  constructor(private readonly db:DatabaseSync){
    const old=db.prepare("SELECT sql FROM sqlite_schema WHERE name='creator_refresh_priorities'").get()
    if(old&&!String(old.sql).includes("'dormant'")){
      db.exec(`BEGIN IMMEDIATE;
        ALTER TABLE creator_refresh_priorities RENAME TO creator_refresh_priorities_before_four;
        CREATE TABLE creator_refresh_priorities(
          owner_sec_uid TEXT NOT NULL,creator_sec_uid TEXT NOT NULL,
          mode TEXT CHECK(mode IN ('boost','reduce')),tier TEXT CHECK(tier IN ('active','regular','inactive','dormant')),
          revision INTEGER NOT NULL CHECK(revision>0),updated_at TEXT NOT NULL,
          CHECK((mode IS NULL AND tier IS NULL) OR (mode IS NOT NULL AND tier IS NOT NULL)),
          PRIMARY KEY(owner_sec_uid,creator_sec_uid)) STRICT;
        INSERT INTO creator_refresh_priorities SELECT * FROM creator_refresh_priorities_before_four;
        DROP TABLE creator_refresh_priorities_before_four;
        COMMIT;`)
    }
    db.exec(`CREATE TABLE IF NOT EXISTS creator_refresh_priorities(
      owner_sec_uid TEXT NOT NULL,creator_sec_uid TEXT NOT NULL,
      mode TEXT CHECK(mode IN ('boost','reduce')),tier TEXT CHECK(tier IN ('active','regular','inactive','dormant')),
      revision INTEGER NOT NULL CHECK(revision>0),updated_at TEXT NOT NULL,
      CHECK((mode IS NULL AND tier IS NULL) OR (mode IS NOT NULL AND tier IS NOT NULL)),
      PRIMARY KEY(owner_sec_uid,creator_sec_uid)) STRICT`)
  }
  private parse(row:Record<string,unknown>):CreatorPriorityState{
    return {mode:row.mode as CreatorPriorityState['mode'],tier:row.tier as CreatorPriorityState['tier'],revision:Number(row.revision)}
  }
  decorate(owner:string|null,creators:CreatorListItem[]):CreatorListItem[]{
    const saved=new Map(owner?this.db.prepare('SELECT * FROM creator_refresh_priorities WHERE owner_sec_uid=?').all(owner).map(row=>[String(row.creator_sec_uid),this.parse(row)]):[])
    return creators.map(creator=>({...creator,refreshPriority:saved.get(new URL(creator.profileUrl).pathname.split('/').at(-1)!)??{...DEFAULT_CREATOR_PRIORITY}}))
  }
  update(owner:string|null,creators:CreatorListItem[],input:unknown):CreatorPriorityState{
    const values=creatorPriorityInputSchema.parse(input)
    if(!owner||owner!==values.ownerSecUid)throw Error('账号已切换，请重新打开博主资料库后设置权重')
    const creator=creators.find(item=>!item.isDemo&&new URL(item.profileUrl).pathname.split('/').at(-1)===values.secUid)
    if(!creator)throw Error('该博主不属于当前账号')
    this.db.exec('BEGIN IMMEDIATE')
    try{
      const row=this.db.prepare('SELECT * FROM creator_refresh_priorities WHERE owner_sec_uid=? AND creator_sec_uid=?').get(owner,values.secUid)
      const current=row?this.parse(row):DEFAULT_CREATOR_PRIORITY
      if(current.revision!==values.revision)throw Error('该博主权重已发生变化，请等待页面更新后重试')
      // Repeated delivery of the same enabled mode must not move another level.
      if(current.mode===values.mode){this.db.exec('COMMIT');return {...current}}
      const next:CreatorPriorityState={mode:values.mode,tier:values.mode?adjustedCreatorTier(creatorAutomaticTier(creator),values.mode):null,revision:current.revision+1}
      this.db.prepare(`INSERT INTO creator_refresh_priorities VALUES(?,?,?,?,?,?) ON CONFLICT(owner_sec_uid,creator_sec_uid)
        DO UPDATE SET mode=excluded.mode,tier=excluded.tier,revision=excluded.revision,updated_at=excluded.updated_at`)
        .run(owner,values.secUid,next.mode,next.tier,next.revision,new Date().toISOString())
      this.db.exec('COMMIT');return next
    }catch(error){this.db.exec('ROLLBACK');throw error}
  }
}

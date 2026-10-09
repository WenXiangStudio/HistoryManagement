import type {DatabaseSync} from 'node:sqlite'
import type {CreatorActivityAnomaly,CreatorContinuityComparison} from '../shared/creatorActivityContinuity'

/** Reviews reference immutable raw snapshots; only a successful explicit repair resolves a pending review. */
export class CreatorActivityIntegrityStore{
  constructor(private readonly db:DatabaseSync){
    db.exec(`CREATE TABLE IF NOT EXISTS creator_activity_reviews(
      snapshot_id INTEGER PRIMARY KEY REFERENCES creator_activity_snapshots(id),
      owner_sec_uid TEXT NOT NULL,creator_sec_uid TEXT NOT NULL,
      baseline_snapshot_id INTEGER NOT NULL REFERENCES creator_activity_snapshots(id),
      detected_at TEXT NOT NULL,comparison_json TEXT NOT NULL,
      resolved_snapshot_id INTEGER REFERENCES creator_activity_snapshots(id)) STRICT;
      CREATE INDEX IF NOT EXISTS creator_activity_reviews_owner ON creator_activity_reviews(owner_sec_uid,creator_sec_uid);`)
  }
  pending(owner:string,secUid:string):CreatorActivityAnomaly|null{
    const row=this.db.prepare('SELECT * FROM creator_activity_reviews WHERE owner_sec_uid=? AND creator_sec_uid=? AND resolved_snapshot_id IS NULL ORDER BY snapshot_id DESC LIMIT 1').get(owner,secUid)
    return row?{detectedAt:String(row.detected_at),baselineSnapshotId:Number(row.baseline_snapshot_id),comparison:JSON.parse(String(row.comparison_json))}:null
  }
  quarantine(snapshotId:number,owner:string,secUid:string,baselineId:number,checked:string,comparison:CreatorContinuityComparison):void{
    this.db.prepare('INSERT INTO creator_activity_reviews VALUES(?,?,?,?,?,?,NULL)').run(snapshotId,owner,secUid,baselineId,checked,JSON.stringify(comparison))
  }
  resolve(owner:string,secUid:string,snapshotId:number):void{
    this.db.prepare('UPDATE creator_activity_reviews SET resolved_snapshot_id=? WHERE owner_sec_uid=? AND creator_sec_uid=? AND resolved_snapshot_id IS NULL').run(snapshotId,owner,secUid)
  }
}

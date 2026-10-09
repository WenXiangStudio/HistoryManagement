import {performance} from 'node:perf_hooks'
import {createHash,randomUUID} from 'node:crypto'
import {feishuConfigurationSchema,feishuProbeSchema,feishuOwnerSchema,feishuAutomaticSchema,parseFeishuTableUrl,
  type FeishuProbeReceipt,type FeishuState,type FeishuSyncRun} from '../shared/feishu'
import {FeishuClient,type FeishuField,type FeishuRecord} from './feishuClient'
import {FEISHU_KEY_FIELD,equalFeishuValue,feishuText,projectFeishuSource,feishuSourceHash,
  type FeishuSource,type ProjectedCreator} from './feishuProjection'
export {FEISHU_KEY_FIELD,equalFeishuValue,feishuText} from './feishuProjection'

type SecretStore = {getApiKey(): string | null; setApiKey(value: string): void}
type SavedConnection = {
  appId: string; appSecret: string; tableUrl: string; fieldIds: Record<string, string>; receipt: FeishuProbeReceipt | null
  automatic?: boolean; sync?: FeishuSyncRun | null; lastHash?: string; pendingCreates?: Record<string,string>
}
type Prepared = {client: FeishuClient; appToken: string; tableId: string; fields: Map<string,FeishuField>; existing: Map<string,FeishuRecord>}
type Timings = {debounceMs: number; pollMs: number; retryMs: number}

/** One shared implementation for a one-row proof, full incremental sync and background source updates. */
export class FeishuCreatorProbe {
  private busy = false
  private timer: ReturnType<typeof setTimeout> | null = null
  private poller: ReturnType<typeof setInterval> | null = null
  private stopped = false
  private readonly retry = new Map<string,{at: number; failures: number}>()
  constructor(private readonly source: () => FeishuSource, private readonly secrets: (owner: string) => SecretStore,
    private readonly clientFactory: () => FeishuClient = () => new FeishuClient(), private readonly changed: () => void = () => {},
    private readonly timings: Timings = {debounceMs: 5000, pollMs: 60000, retryMs: 60000}) {}
  private load(owner: string): SavedConnection | null {
    const value = this.secrets(owner).getApiKey()
    if (!value) return null
    try { return JSON.parse(value) as SavedConnection } catch { throw Error('飞书配置无法读取，请重新保存连接配置') }
  }
  private persist(owner: string, value: SavedConnection): void { this.secrets(owner).setApiKey(JSON.stringify(value)) }
  state(): FeishuState {
    const ownerSecUid = this.source().view.ownerSecUid, saved = ownerSecUid ? this.load(ownerSecUid) : null
    let sync = saved?.sync ?? null
    if (sync?.phase === 'running' && !this.busy) sync = {...sync,phase:'error',error:'上次同步已中断，重试会先核对飞书现有记录'}
    return {ownerSecUid, appId: saved?.appId ?? '', tableUrl: saved?.tableUrl ?? '', hasSecret: !!saved?.appSecret,
      busy: this.busy, receipt: saved?.receipt ?? null, automatic: saved?.automatic ?? false, sync}
  }
  save(input: unknown): FeishuState {
    if (this.busy) throw Error('正在同步飞书，请等待完成后修改配置')
    const parsed = feishuConfigurationSchema.safeParse(input)
    if (!parsed.success) throw Error('飞书配置无效，请检查账号、App ID、App Secret 和表格链接')
    const values = parsed.data
    this.assertOwner(values.ownerSecUid)
    const table = parseFeishuTableUrl(values.tableUrl), previous = this.load(values.ownerSecUid)
    const appSecret = values.appSecret || (previous?.appId === values.appId ? previous.appSecret : '')
    if (!appSecret) throw Error('首次连接或更换应用时，请填写 App Secret')
    const oldTarget = previous ? parseFeishuTableUrl(previous.tableUrl) : null
    const sameTarget = oldTarget?.appToken === table.appToken && oldTarget?.tableId === table.tableId
    const unchanged = sameTarget && previous?.appId === values.appId && previous?.appSecret === appSecret
    this.persist(values.ownerSecUid, {...(unchanged ? previous! : {}),appId: values.appId, appSecret, tableUrl: table.tableUrl,
      fieldIds: sameTarget ? previous!.fieldIds : {}, receipt: unchanged ? previous!.receipt : null,
      automatic: unchanged ? previous!.automatic : false})
    this.retry.delete(values.ownerSecUid); this.changed(); this.dataChanged()
    return this.state()
  }
  private assertOwner(owner: string): void {
    if (this.stopped) throw Error('应用正在关闭，本次同步已停止；重新打开后可重试')
    if (this.source().view.ownerSecUid !== owner) throw Error('资料账号已切换，请重新打开飞书连接面板')
  }
  private requireSaved(owner: string): SavedConnection {
    this.assertOwner(owner)
    const saved = this.load(owner)
    if (!saved) throw Error('请先保存飞书连接配置')
    return saved
  }
  private indexRecords(rows: ProjectedCreator[], records: FeishuRecord[], fields: Map<string,FeishuField>, owner: string): Map<string,FeishuRecord> {
    const keyName = fields.get('$key')?.field_name ?? FEISHU_KEY_FIELD, found = new Map<string,FeishuRecord>()
    const keys = new Set(rows.map(row => row.key)), profileField = fields.get('$url'), ownerField = fields.get('$owner')
    for (const record of records) {
      if (!record.record_id || !record.fields) throw Error('飞书记录响应不完整，已停止以避免重复写入')
      const key = feishuText(record.fields[keyName])
      if (!keys.has(key)) continue
      if (found.has(key)) throw Error('飞书表中存在重复的博主同步标识，请先处理重复记录')
      found.set(key,record)
    }
    for (const row of rows) {
      const existing = found.get(row.key)
      if (profileField && records.some(record => record.record_id !== existing?.record_id
        && equalFeishuValue(record.fields[profileField.field_name],{link:row.profileUrl},15)
        && (!ownerField || !feishuText(record.fields[ownerField.field_name]) || feishuText(record.fields[ownerField.field_name]) === owner))) {
        throw Error('飞书已有同主页记录但同步标识不一致，请先核对该记录，避免重复新增')
      }
      if (!existing) continue
      for (const id of ['$owner','$creator','$url']) {
        const field = fields.get(id), expected = row.fields.find(item => item.id === id)!
        if (!field || !equalFeishuValue(existing.fields[field.field_name],expected.value,expected.type)) throw Error('飞书已有记录的资料账号、博主身份或主页不一致，已停止写入')
      }
    }
    return found
  }
  private async prepare(owner: string, saved: SavedConnection, rows: ProjectedCreator[]): Promise<Prepared> {
    const {appToken,tableId} = parseFeishuTableUrl(saved.tableUrl), client = this.clientFactory()
    await client.authenticate(saved.appId,saved.appSecret)
    const remoteFields = await client.fields(appToken,tableId), fields = new Map<string,FeishuField>()
    for (const field of rows[0].fields) {
      const mappedId = saved.fieldIds[field.id]
      const existing = mappedId ? remoteFields.find(item => item.field_id === mappedId) : remoteFields.find(item => item.field_name === field.field_name)
      if (mappedId && !existing) throw Error(`飞书字段“${field.field_name}”已删除，请恢复该字段后重试`)
      if (existing && existing.type !== field.type) throw Error(`飞书字段“${existing.field_name}”类型不匹配，请恢复字段类型后重试`)
      if (existing) fields.set(field.id,existing)
    }
    if (new Set([...fields.values()].map(field => field.field_id)).size !== fields.size) throw Error('飞书字段映射重复，请检查字段名称')
    const records = await client.records(appToken,tableId), existing = this.indexRecords(rows,records,fields,owner)
    for (const field of rows[0].fields) {
      this.assertOwner(owner)
      if (!fields.has(field.id)) {
        const created = await client.createField(appToken,tableId,{field_name:field.field_name,type:field.type,...(field.property ? {property:field.property} : {})})
        if (created.type !== field.type || created.field_name !== field.field_name) throw Error('飞书新建字段与预期不一致')
        fields.set(field.id,created)
        await new Promise(resolve => setTimeout(resolve,150))
      }
      const id = fields.get(field.id)!.field_id
      if (saved.fieldIds[field.id] !== id) {saved.fieldIds[field.id] = id; this.persist(owner,saved)}
    }
    return {client,appToken,tableId,fields,existing}
  }
  private values(row: ProjectedCreator, fields: Map<string,FeishuField>): Record<string,unknown> {
    return Object.fromEntries(row.fields.map(field => [fields.get(field.id)!.field_name,field.value]))
  }
  private mismatches(row: ProjectedCreator, remote: FeishuRecord, fields: Map<string,FeishuField>): string[] {
    return row.fields.filter(field => !equalFeishuValue(remote.fields[fields.get(field.id)!.field_name],field.value,field.type)).map(field => field.field_name)
  }
  async probe(input: unknown): Promise<FeishuProbeReceipt> {
    if (this.busy) throw Error('已有飞书验证或同步正在进行，请等待完成')
    const parsed = feishuProbeSchema.safeParse(input)
    if (!parsed.success) throw Error('请选择当前账号中的一位真实博主')
    const {ownerSecUid:owner,secUid} = parsed.data, saved = this.requireSaved(owner)
    const row = projectFeishuSource(this.source()).find(row => row.secUid === secUid)
    if (!row) throw Error('所选博主身份或归属不一致，已停止同步')
    const started = performance.now(); this.busy = true; saved.receipt = null
    try {
      this.persist(owner,saved); this.changed()
      const {client,appToken,tableId,fields,existing} = await this.prepare(owner,saved,[row])
      this.assertOwner(owner)
      const recordId = await client.writeRecord(appToken,tableId,this.values(row,fields),existing.get(row.key)?.record_id)
      const readBack = await client.record(appToken,tableId,recordId), mismatch = this.mismatches(row,readBack,fields)
      if (mismatch.length) throw Error(`飞书已写入，但读回核验未通过：${mismatch.join('、')}。可重试核对，已有记录保留`)
      this.assertOwner(owner)
      const receipt: FeishuProbeReceipt = {ownerSecUid:owner,secUid,nickname:row.nickname,recordId,action:existing.has(row.key)?'updated':'created',
        verifiedFields:row.fields.length,verifiedAt:new Date().toISOString(),elapsedMs:Math.round(performance.now()-started)}
      saved.receipt = receipt; this.persist(owner,saved); return receipt
    } finally {this.busy = false; this.changed(); this.dataChanged()}
  }
  async syncAll(input: unknown, trigger: 'manual' | 'automatic' = 'manual'): Promise<FeishuSyncRun> {
    if (this.busy) throw Error('已有飞书验证或同步正在进行，请等待完成')
    const parsed = feishuOwnerSchema.safeParse(input)
    if (!parsed.success) throw Error('请先选择资料账号')
    const owner = parsed.data.ownerSecUid, saved = this.requireSaved(owner)
    if (!saved.receipt) throw Error('请先写入一位博主并通过读回核验')
    const rows = projectFeishuSource(this.source()), sourceHash = feishuSourceHash(rows), started = performance.now()
    const run: FeishuSyncRun = {phase:'running',stage:'reading',runId:randomUUID(),trigger,total:rows.length,written:0,verified:0,
      created:0,updated:0,unchanged:0,startedAt:new Date().toISOString(),finishedAt:null,elapsedMs:0,error:null}
    const publish = ():void => {run.elapsedMs = Math.round(performance.now()-started); saved.sync = {...run}; this.persist(owner,saved); this.changed()}
    this.busy = true
    try {
      publish()
      if (rows.length) {
        const {client,appToken,tableId,fields,existing} = await this.prepare(owner,saved,rows)
        const creates = rows.filter(row => !existing.has(row.key)), updates = rows.filter(row => existing.has(row.key) && this.mismatches(row,existing.get(row.key)!,fields).length)
        run.unchanged = rows.length-creates.length-updates.length; run.stage = 'writing'; publish()
        for (const [list,update] of [[creates,false],[updates,true]] as const) {
          for (let offset = 0; offset < list.length; offset += 100) {
            this.assertOwner(owner)
            const chunk = list.slice(offset,offset+100), records = chunk.map(row => ({...(update ? {record_id:existing.get(row.key)!.record_id} : {}),fields:this.values(row,fields)}))
            const hash = createHash('sha256').update(JSON.stringify(records)).digest('hex')
            const tokens = saved.pendingCreates ??= {}, token = update ? randomUUID() : tokens[hash] ??= randomUUID()
            if (!update) this.persist(owner,saved)
            await client.writeBatch(appToken,tableId,records,update,token)
            if (!update) delete tokens[hash]
            run.written += chunk.length; if (update) run.updated += chunk.length; else run.created += chunk.length
            publish()
          }
        }
        run.stage = 'verifying'; publish()
        const readBack = this.indexRecords(rows,await client.records(appToken,tableId),fields,owner)
        for (const row of rows) {
          const remote = readBack.get(row.key)
          if (!remote) throw Error(`飞书读回缺少博主“${row.nickname}”，已写入记录保留，可重试`)
          const mismatch = this.mismatches(row,remote,fields)
          if (mismatch.length) throw Error(`“${row.nickname}”读回核验未通过：${mismatch.join('、')}。可重试，已有记录保留`)
          run.verified++
        }
      }
      this.assertOwner(owner)
      run.phase = 'success'; run.stage = 'done'; run.finishedAt = new Date().toISOString(); saved.lastHash = sourceHash; saved.pendingCreates = {}
      this.retry.delete(owner); publish(); return {...run}
    } catch (error) {
      run.phase = 'error'; run.finishedAt = new Date().toISOString(); run.error = error instanceof Error ? error.message : '飞书同步未完成'
      const failures = (this.retry.get(owner)?.failures ?? 0)+1
      this.retry.set(owner,{failures,at:Date.now()+Math.min(this.timings.retryMs*2**(failures-1),300000)})
      publish(); throw error
    } finally {this.busy = false; this.changed(); this.dataChanged()}
  }
  setAutomatic(input: unknown): FeishuState {
    if (this.busy) throw Error('正在同步飞书，请等待完成后修改自动同步')
    const parsed = feishuAutomaticSchema.safeParse(input)
    if (!parsed.success) throw Error('自动同步设置无效')
    const {ownerSecUid:owner,enabled} = parsed.data, saved = this.requireSaved(owner)
    if (enabled && !saved.receipt) throw Error('请先写入一位博主并通过读回核验')
    saved.automatic = enabled; this.persist(owner,saved); this.retry.delete(owner); this.changed(); this.dataChanged()
    return this.state()
  }
  startAutomatic(): void {
    if (this.poller) return
    this.stopped = false
    this.poller = setInterval(() => this.dataChanged(),this.timings.pollMs); this.poller.unref?.(); this.dataChanged()
  }
  dataChanged(): void {
    if (!this.poller || this.stopped || this.timer) return
    this.timer = setTimeout(() => {this.timer = null; void this.checkAutomatic()},this.timings.debounceMs); this.timer.unref?.()
  }
  private async checkAutomatic(): Promise<void> {
    if (this.stopped || this.busy) return
    try {
      const source = this.source(), owner = source.view.ownerSecUid
      if (!owner) return
      const saved = this.load(owner)
      if (!saved?.automatic || !saved.receipt || Date.now() < (this.retry.get(owner)?.at ?? 0)) return
      if (saved.lastHash === feishuSourceHash(projectFeishuSource(source)) && saved.sync?.phase === 'success') return
      await this.syncAll({ownerSecUid:owner},'automatic')
    } catch { /* syncAll persists the failure and retry time; existing records stay intact. */ }
  }
  stop(): void {
    this.stopped = true
    if (this.timer) clearTimeout(this.timer)
    if (this.poller) clearInterval(this.poller)
    this.timer = null; this.poller = null
  }
}

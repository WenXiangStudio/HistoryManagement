import {randomUUID} from 'node:crypto'

export type FeishuField = {field_id: string; field_name: string; type: number}
export type FeishuRecord = {record_id: string; fields: Record<string, unknown>}
type ApiResponse = {code: number; data?: any; tenant_access_token?: string; msg?: string}

/** Only the official API origin receives credentials. Never surface API bodies (which can echo secrets). */
export class FeishuClient {
  private token = ''
  constructor(private readonly fetcher: typeof fetch = fetch) {}
  private async request(path: string, method = 'GET', body?: unknown): Promise<ApiResponse> {
    let response: Response
    try {
      response = await this.fetcher(`https://open.feishu.cn/open-apis/${path}`, {
        method, redirect: 'error', signal: AbortSignal.timeout(20000),
        headers: {'Content-Type': 'application/json; charset=utf-8', ...(this.token ? {Authorization: `Bearer ${this.token}`} : {})},
        ...(body === undefined ? {} : {body: JSON.stringify(body)})
      })
    } catch { throw Error('飞书请求超时或网络不可用。若已写入，重试会先按身份查找已有记录') }
    if (!response.ok) throw Error(`飞书 HTTP ${response.status}；请检查应用权限、表格协作者授权或稍后重试`)
    let result: ApiResponse
    try { result = await response.json() as ApiResponse } catch { throw Error('飞书返回了无法解析的响应') }
    if (result.code !== 0) {
      const code = Number.isSafeInteger(result.code) ? result.code : '未知'
      throw Error(`飞书错误码 ${code}；请检查 App ID / Secret、应用是否发布、多维表格权限及文档协作者授权`)
    }
    return result
  }
  async authenticate(appId: string, appSecret: string): Promise<void> {
    const result = await this.request('auth/v3/tenant_access_token/internal', 'POST', {app_id: appId, app_secret: appSecret})
    if (typeof result.tenant_access_token !== 'string' || !result.tenant_access_token) throw Error('飞书未返回应用访问凭证')
    this.token = result.tenant_access_token
  }
  private path(appToken: string, tableId: string): string {
    return `bitable/v1/apps/${encodeURIComponent(appToken)}/tables/${encodeURIComponent(tableId)}`
  }
  private async list<T>(path: string, pageSize: number): Promise<T[]> {
    const items: T[] = [], seen = new Set<string>()
    let pageToken = ''
    for (let page = 0; page < 1000; page++) {
      const result = await this.request(`${path}?page_size=${pageSize}${pageToken ? `&page_token=${encodeURIComponent(pageToken)}` : ''}`)
      if (!Array.isArray(result.data?.items)) throw Error('飞书列表响应缺少 items，已停止以避免重复写入')
      items.push(...result.data.items)
      if (result.data.has_more === false) return items
      const next = result.data.page_token
      if (result.data.has_more !== true || typeof next !== 'string' || !next || seen.has(next)) throw Error('飞书分页不完整，已停止以避免重复写入')
      seen.add(next); pageToken = next
    }
    throw Error('飞书数据量超出当前验证范围')
  }
  fields(appToken: string, tableId: string): Promise<FeishuField[]> { return this.list(`${this.path(appToken, tableId)}/fields`, 100) }
  records(appToken: string, tableId: string): Promise<FeishuRecord[]> { return this.list(`${this.path(appToken, tableId)}/records`, 500) }
  async createField(appToken: string, tableId: string, field: {field_name: string; type: number; property?: unknown}): Promise<FeishuField> {
    const result = await this.request(`${this.path(appToken, tableId)}/fields?client_token=${randomUUID()}`, 'POST', field)
    if (!result.data?.field?.field_id) throw Error('飞书未返回新建字段，请重新验证')
    return result.data.field
  }
  async writeRecord(appToken: string, tableId: string, fields: Record<string, unknown>, recordId?: string): Promise<string> {
    const path = `${this.path(appToken, tableId)}/records`
    const result = recordId
      ? await this.request(`${path}/${encodeURIComponent(recordId)}`, 'PUT', {fields})
      : await this.request(`${path}/batch_create?client_token=${randomUUID()}`, 'POST', {records: [{fields}]})
    const id = recordId ? result.data?.record?.record_id : result.data?.records?.[0]?.record_id
    if (typeof id !== 'string' || !id) throw Error('飞书未返回写入记录身份；请重试并核对已有记录')
    if (recordId && id !== recordId) throw Error('飞书写入返回的记录身份不一致')
    return id
  }
  async record(appToken: string, tableId: string, recordId: string): Promise<FeishuRecord> {
    const result = await this.request(`${this.path(appToken, tableId)}/records/${encodeURIComponent(recordId)}`)
    if (result.data?.record?.record_id !== recordId || !result.data.record.fields) throw Error('飞书读回记录身份不一致')
    return result.data.record
  }
  async writeBatch(appToken: string, tableId: string, records: {record_id?: string; fields: Record<string, unknown>}[], update: boolean, clientToken: string): Promise<void> {
    if (!records.length || records.length > 100 || records.some(record => update !== !!record.record_id)) throw Error('飞书写入批次无效')
    const result = await this.request(`${this.path(appToken, tableId)}/records/${update ? 'batch_update' : 'batch_create'}?client_token=${encodeURIComponent(clientToken)}`, 'POST', {records})
    if (!Array.isArray(result.data?.records) || result.data.records.length !== records.length
      || result.data.records.some((record: FeishuRecord) => !record.record_id)) throw Error('飞书批次回执不完整，请重试核对已写入记录')
  }
}

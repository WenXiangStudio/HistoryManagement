import {createHash} from 'node:crypto'
import type {CreatorListItem} from '../shared/contracts'
import {formatDatabaseCell,type CreatorDatabaseView} from '../shared/creatorDatabase'

export type FeishuSource = {view: CreatorDatabaseView; creators: CreatorListItem[]}
export type ProjectedField = {id: string; field_name: string; type: number; value: unknown; property?: unknown}
export type ProjectedCreator = {secUid: string; nickname: string; profileUrl: string; key: string; fields: ProjectedField[]}
export const FEISHU_KEY_FIELD = 'APP · 同步标识'

export function projectFeishuSource(source: FeishuSource): ProjectedCreator[] {
  const owner = source.view.ownerSecUid
  if (!owner) throw Error('请先绑定资料账号')
  const creators = new Map(source.creators.filter(item => !item.isDemo).map(item => [item.profileUrl, item]))
  const seen = new Set<string>()
  return source.view.rows.map(row => {
    const creator = creators.get(row.profileUrl), url = new URL(row.profileUrl)
    if (!creator || url.origin !== 'https://www.douyin.com' || url.pathname !== `/user/${row.secUid}` || seen.has(row.secUid)) {
      throw Error('博主身份重复或归属不一致，已停止同步')
    }
    seen.add(row.secUid)
    const key = `douyin:${owner}:${row.secUid}`
    const fields: ProjectedField[] = [
      {id: '$key', field_name: FEISHU_KEY_FIELD, type: 1, value: key},
      {id: '$owner', field_name: 'APP · 资料账号', type: 1, value: owner},
      {id: '$creator', field_name: 'APP · 博主标识', type: 1, value: row.secUid},
      {id: '$url', field_name: 'APP · 主页链接', type: 15, value: {text: row.nickname, link: row.profileUrl}},
      ...source.view.columns.map(column => {
        const raw = row.values[column.id] ?? null
        return {id: column.id, field_name: `APP · ${column.name}`, type: column.kind === 'date' ? 5 : column.kind === 'count' ? 2 : 1,
          ...(column.kind === 'date' ? {property: {date_formatter: 'yyyy/MM/dd', auto_fill: false}} : {}),
          value: raw === null || raw === '' ? null : column.kind === 'date' ? Date.parse(`${raw}T00:00:00+08:00`)
            : column.kind === 'interval' || column.kind === 'tier' ? formatDatabaseCell(column, raw) : raw}
      }),
      {id: '$star', field_name: 'APP · 星标', type: 7, value: creator.isStarred},
      {id: '$note', field_name: 'APP · 批注', type: 1, value: creator.note || null}
    ]
    if (new Set(fields.map(field => field.field_name)).size !== fields.length) throw Error('自定义列与同步字段名称重复，请先调整自定义列名称')
    if (fields.some(field => typeof field.value === 'number' && !Number.isFinite(field.value))) throw Error('博主数据包含无效数字或日期')
    return {secUid: row.secUid, nickname: row.nickname, profileUrl: row.profileUrl, key, fields}
  })
}

export function feishuSourceHash(rows: ProjectedCreator[]): string {
  return createHash('sha256').update(JSON.stringify([...rows].sort((a,b) => a.secUid.localeCompare(b.secUid)))).digest('hex')
}

export function feishuText(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value) && value.every(part => part && typeof part.text === 'string')) return value.map(part => part.text).join('')
  return ''
}
export function equalFeishuValue(actual: unknown, expected: unknown, type: number): boolean {
  if (expected === null) return actual === undefined || actual === null || actual === '' || Array.isArray(actual) && actual.length === 0
  if (type === 1) return feishuText(actual) === expected
  // Real Feishu number reads can be decimal strings. Never coerce a missing value into zero.
  if (type === 2 && typeof expected === 'number' && typeof actual === 'string') {
    return /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(actual) && Number.isFinite(Number(actual)) && Number(actual) === expected
  }
  if (type === 15) return !!actual && typeof actual === 'object' && 'link' in actual && actual.link === (expected as {link: string}).link
  return actual === expected
}

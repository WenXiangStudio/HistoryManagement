import {z} from 'zod'

const identity = z.string().regex(/^[A-Za-z0-9._-]{1,240}$/)
export const feishuConfigurationSchema = z.object({
  ownerSecUid: identity,
  appId: z.string().trim().regex(/^cli_[A-Za-z0-9]+$/, '请输入飞书自建应用的 App ID'),
  appSecret: z.string().trim().max(256).optional(),
  tableUrl: z.string().trim().max(2000)
}).strict()
export type FeishuConfigurationInput = z.infer<typeof feishuConfigurationSchema>
export const feishuProbeSchema = z.object({ownerSecUid: identity, secUid: identity}).strict()
export type FeishuProbeInput = z.infer<typeof feishuProbeSchema>
export type FeishuProbeReceipt = {
  ownerSecUid: string; secUid: string; nickname: string; recordId: string
  action: 'created' | 'updated'; verifiedFields: number; verifiedAt: string; elapsedMs: number
}
export const feishuOwnerSchema = z.object({ownerSecUid: identity}).strict()
export const feishuAutomaticSchema = z.object({ownerSecUid: identity, enabled: z.boolean()}).strict()
export type FeishuSyncRun = {
  phase: 'running' | 'success' | 'error'; stage: 'reading' | 'writing' | 'verifying' | 'done'
  runId: string; trigger: 'manual' | 'automatic'; total: number; written: number; verified: number
  created: number; updated: number; unchanged: number; startedAt: string; finishedAt: string | null
  elapsedMs: number; error: string | null
}
export type FeishuState = {
  ownerSecUid: string | null; appId: string; tableUrl: string; hasSecret: boolean
  busy: boolean; receipt: FeishuProbeReceipt | null
  automatic: boolean; sync: FeishuSyncRun | null
}

export function parseFeishuTableUrl(value: string): {appToken: string; tableId: string; tableUrl: string} {
  let url: URL
  try { url = new URL(value) } catch { throw Error('请粘贴飞书多维表格中具体数据表的完整链接') }
  if (url.protocol !== 'https:' || !/^(?:[a-z0-9-]+\.)*feishu\.cn$/i.test(url.hostname) || url.username || url.password || url.port) {
    throw Error('请使用 https:// 开头的飞书多维表格链接')
  }
  if (url.pathname.startsWith('/wiki/')) throw Error('此阶段请新建独立多维表格，使用含 /base/ 的链接；知识库链接尚未接入')
  const match = url.pathname.match(/^\/base\/([A-Za-z0-9]+)\/?$/)
  const tableId = url.searchParams.get('table')
  if (!match || !tableId || !/^tbl[A-Za-z0-9]+$/.test(tableId)) throw Error('链接须包含 /base/ 和 ?table=tbl…；请先打开具体数据表再复制地址')
  return {appToken: match[1], tableId, tableUrl: `${url.origin}/base/${match[1]}?table=${tableId}`}
}

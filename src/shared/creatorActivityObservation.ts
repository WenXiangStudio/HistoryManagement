import {z} from 'zod'
import {activityBrowserTraceSchema,activityNetworkTraceSchema} from './creatorActivityDiagnostics'
const time=z.string().datetime(),number=z.number().finite().nonnegative(),error=z.string().regex(/^[A-Z0-9_-]{1,100}$/)
export const creatorActivityObservationSchema=z.object({
  contract:z.literal('signaldesk-activity-observation/v1'),creatorId:z.number().int().negative(),secUid:z.string().regex(/^[A-Za-z0-9._-]{1,240}$/),
  capturedAt:time,phase:z.enum(['prepared','decision','saved','released','failed']),stage:z.enum(['preparing-context','verifying-owner','reading-count','reading-list','saving','releasing-context','author-wait','batch-rest','resume-wait']),
  strategy:z.enum(['pending','native-latest','count-only','full-native','full-active','failed']),countSame:z.boolean().nullable(),errorCode:error.nullable(),
  milestones:z.array(z.object({step:z.enum(['listener-ready','navigation','page-ready','count-ready','native-decision','decision','save-ack','released','failure']),at:time}).strict()).max(16),
  native:z.object({startedAt:time,limits:z.object({resourceBytes:z.literal(8388608),totalBytes:z.literal(33554432),requests:z.literal(24),
    arrivalWaitMs:z.literal(600),readyWaitMs:z.literal(1500),bodyTimeoutMs:z.literal(2000)}).strict(),matchedRequests:z.number().int().min(0).max(100000),
    ignored:z.object({childSession:z.number().int().min(0).max(100000),method:z.number().int().min(0).max(100000),author:z.number().int().min(0).max(100000),cursor:z.number().int().min(0).max(100000)}).strict(),
    requests:z.array(z.object({sequence:z.number().int().positive(),cursor:z.number().int().nonnegative(),stage:z.enum(['request','response','loaded','body','projected','failed','ended']),
      requestedAt:time,responseAt:time.nullable(),loadedAt:time.nullable(),bodyStartedAt:time.nullable(),completedAt:time.nullable(),httpStatus:z.number().int().min(0).max(999).nullable(),
      encodedBytes:number.nullable(),decodedBytes:number.nullable(),responseSource:z.enum(['network','disk-cache','service-worker']).nullable(),records:z.number().int().min(0).max(200).nullable(),
      bodyError:error.nullable(),errorCode:error.nullable(),failureStage:z.enum(['body-read','decode','capacity','json','projection']).nullable().optional()}).strict()).max(24),
    availability:z.object({at:time,waitedMs:number,outcome:z.union([z.literal('ready'),error]),errorCode:error.nullable()}).strict().nullable(),
    dropped:z.number().int().nonnegative(),fatalError:error.nullable()}).strict().nullable(),
  network:activityNetworkTraceSchema,browser:activityBrowserTraceSchema
}).strict()
export type CreatorActivityObservation=z.infer<typeof creatorActivityObservationSchema>

export function nativeListUnavailableMessage(code:string|null):string{
  if(code==='ACTIVITY_NATIVE_LIST_UNAVAILABLE')return '未观察到匹配列表请求'
  if(code==='ACTIVITY_NATIVE_PENDING')return '列表仍在加载'
  if(code==='ACTIVITY_NATIVE_BODY_TIMEOUT')return '列表内容读取超时'
  if(code==='ACTIVITY_NATIVE_BODY_EVICTED')return '浏览器已清除响应缓存'
  if(code==='ACTIVITY_NATIVE_BODY_NOT_RETAINED')return '浏览器未保留响应内容'
  if(code==='ACTIVITY_BODY_TOO_LARGE')return '列表响应超过读取容量'
  if(code==='ACTIVITY_NATIVE_BODY_UNAVAILABLE')return '浏览器响应内容未能读取'
  return '本次未取得可用列表'
}

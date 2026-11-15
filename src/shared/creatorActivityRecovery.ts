import {z} from 'zod'
export const CREATOR_ACTIVITY_RECOVERY_POLICY={maxAttempts:2,delayMinMs:5000,delayMaxMs:10000} as const
export type CreatorActivityRecoveryPolicy=typeof CREATOR_ACTIVITY_RECOVERY_POLICY
export const creatorActivityRecoverySchema=z.object({creatorId:z.number().int().negative(),secUid:z.string().regex(/^[A-Za-z0-9._-]{1,240}$/),
  attempt:z.number().int().min(1).max(2),reason:z.enum(['DEBUGGER_NOT_ATTACHED','TARGET_NAVIGATED_OR_CLOSED','EXECUTION_CONTEXT_UNAVAILABLE']),
  startedAt:z.string().datetime(),waitUntil:z.string().datetime(),phase:z.enum(['waiting','reconnecting','recovered','failed']),
  preservedPages:z.number().int().min(0).max(200),completedAt:z.string().datetime().optional(),failureCode:z.string().regex(/^[A-Z0-9_-]{1,100}$/).optional()
}).strict().refine(value=>['recovered','failed'].includes(value.phase)===!!value.completedAt&&
  (value.phase==='failed'===!!value.failureCode),'恢复结束状态不一致')
export type CreatorActivityRecovery=z.infer<typeof creatorActivityRecoverySchema>

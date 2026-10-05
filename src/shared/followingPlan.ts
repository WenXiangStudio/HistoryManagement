import {z} from 'zod'

const identity=z.string().regex(/^[A-Za-z0-9._-]{1,240}$/)
export const planOwnerSchema=z.object({uid:identity,secUid:identity,nickname:z.string().min(1).max(200)}).strict()
export const planCreatorSchema=z.object({uid:identity,secUid:identity,nickname:z.string().min(1).max(200),
  avatarUrl:z.string().url().nullable(),signature:z.string().max(2000).nullable(),profileUrl:z.string().url()
}).strict().refine(row=>row.profileUrl==='https://www.douyin.com/user/'+encodeURIComponent(row.secUid),'主页与身份不一致')
export const planPageSchema=z.object({owner:planOwnerSchema,position:z.number().int().min(1).max(100),
  requestCursor:z.number().int().nonnegative(),requestOffset:z.number().int().nonnegative(),
  nextCursor:z.number().int().nonnegative().nullable(),nextOffset:z.number().int().nonnegative().nullable(),
  hasMore:z.boolean(),creators:z.array(planCreatorSchema).max(200),collectedAt:z.string().datetime(),
  activeApiRequests:z.literal(1)
}).strict()
export const basicCaptureSchema=z.object({ownerSecUid:identity,creator:planCreatorSchema,collectedAt:z.string().datetime(),
  source:z.literal('profile-other'),activeApiRequests:z.literal(1)
}).strict()
export type PlanCreator=z.infer<typeof planCreatorSchema>
export type PlanPage=z.infer<typeof planPageSchema>
export type BasicState={phase:'idle'|'running'|'completed'|'cancelled'|'blocked';runId:string|null;total:number;done:number;
  succeeded:number;failed:number;pending:number;currentName:string|null;message:string;errorCode?:string}
export type FollowingPlanState={runId:string|null;complete:boolean;pageCount:number;count:number;nextCursor:number;nextOffset:number;
  resumable:boolean;checkedAt:string|null}

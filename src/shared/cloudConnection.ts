import {z} from 'zod'

const revision=z.string().min(1).max(128)
const profileId=z.string().min(1).max(128)
export const cloudConnectionInputSchema=z.discriminatedUnion('kind',[
  z.object({kind:z.literal('siliconflow'),profileId,expectedRevision:revision}).strict(),
  z.object({kind:z.literal('profile'),profileId,service:z.enum(['text','vision']),expectedRevision:revision}).strict(),
  z.object({kind:z.literal('doubao'),expectedRevision:revision}).strict()
])
export type CloudConnectionInput=z.infer<typeof cloudConnectionInputSchema>
export type CloudConnectionResult={
  ok:boolean
  message:string
  elapsedMs:number
  testedAt:string
  model:string
  service:'text'|'vision'|'speech'
  httpStatus?:number
  code?:string
  requestId?:string
}

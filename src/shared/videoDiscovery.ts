import {z} from 'zod'
import {creatorActivityOwnerProofSchema} from './creatorActivity'
import {videoInformationSchema} from './videoInformation'
const identity=z.string().min(1).max(240)
export const videoDiscoveryPageSchema=z.object({runId:identity,batchId:identity,creatorId:z.number().int().negative(),
  ownerVerification:creatorActivityOwnerProofSchema,checkedAt:z.string().datetime(),
  sourceProof:z.object({kind:z.enum(['native-network','active-get']),endpoint:z.literal('/aweme/v1/web/aweme/post/'),method:z.literal('GET'),
    secUid:identity,requestCursor:z.number().int().nonnegative(),httpStatus:z.literal(200),observedAt:z.string().datetime()}).strict(),
  page:z.object({status_code:z.literal(0),has_more:z.union([z.literal(0),z.literal(1),z.boolean()]),max_cursor:z.number().int().nonnegative(),
    records:z.array(z.object({workId:z.string().regex(/^\d{8,30}$/),publishedAt:z.string().datetime(),pinned:z.boolean().nullable(),
      visibility:z.enum(['public','restricted','temporary-marker','deleted','prohibited','unknown']),awemeType:z.number().int().nullable()}).strict()).max(200),
    works:z.array(videoInformationSchema).max(200)}).strict()}).strict()
export type VideoDiscoveryPage=z.infer<typeof videoDiscoveryPageSchema>
export type VideoDiscoveryCommand={action:'video-discovery';runId:string;batchId:string;ownerSecUid:string;ownerUid:string;
  creatorId:number;authorUid:string;authorSecUid:string;start:string;endExclusive:string;cursor:number;startedAt:string}

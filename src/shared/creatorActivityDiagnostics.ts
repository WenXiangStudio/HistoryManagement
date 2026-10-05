import {z} from 'zod'

const errorCode=z.string().regex(/^[A-Z0-9_-]{1,100}$/)
const pathRelation=z.enum(['target','other-platform','other-origin','missing'])
const commandError=z.enum(['DEBUGGER_NOT_ATTACHED','DEBUGGER_BUSY','TARGET_NAVIGATED_OR_CLOSED','TARGET_UNAVAILABLE','EXECUTION_CONTEXT_UNAVAILABLE','PROMISE_COLLECTED',
  'COMMAND_NOT_ALLOWED','COMMAND_TIMEOUT','SCREENSHOT_FAILED','INVALID_COMMAND_PARAMETERS','COMMAND_UNSUPPORTED','COMMAND_FAILED','PAGE_SCRIPT_EXCEPTION','COMMAND_RESULT_MISSING'])
const browserSchema=z.object({commands:z.array(z.object({sequence:z.number().int().positive(),at:z.string().datetime(),
  operation:z.enum(['list-read','failure-page','profile-count','owner-read','runtime-other','failure-screenshot','navigate','response-body','setup']),
  stage:z.enum(['pending','complete','exception','missing-result','rejected']),elapsedMs:z.number().finite().nonnegative(),error:commandError.nullable(),
  exceptionClass:z.enum(['Error','TypeError','ReferenceError','SyntaxError','RangeError','EvalError','DOMException','other']).nullable(),
  resultType:z.enum(['object','undefined','string','number','boolean','function','symbol','bigint']).nullable()
}).strict()).max(64),connections:z.array(z.object({at:z.string().datetime(),event:z.enum(['detached','target-selected']),
  reason:z.enum(['target_closed','canceled_by_user','other']).nullable()}).strict()).max(16),dropped:z.number().int().nonnegative()}).strict()
export const activityFailureDiagnosticSchema=z.object({
  contract:z.literal('signaldesk-activity-failure/v1'),creatorId:z.number().int().negative(),
  secUid:z.string().regex(/^[A-Za-z0-9._-]{1,240}$/),capturedAt:z.string().datetime(),errorCode,
  stage:z.enum(['preparing-context','verifying-owner','reading-count','reading-list','saving']),
  capturePhase:z.enum(['frozen','complete']).optional(),retainedTabId:z.number().int().positive().nullable().optional(),completedAt:z.string().datetime().optional(),
  environment:z.object({tabExists:z.boolean(),status:z.enum(['loading','complete','unknown']),discarded:z.boolean().nullable(),pathRelation,
    pageSource:z.enum(['unavailable','debugger','extension-script']),diagnosticReattached:z.boolean(),tabError:commandError.nullable(),recoveryError:commandError.nullable()}).strict().optional(),
  page:z.object({pathRelation,readyState:z.enum(['loading','interactive','complete']),visibilityState:z.enum(['visible','hidden']),
    worksTabPresent:z.boolean(),worksTabVisible:z.boolean(),worksTabSelected:z.boolean().nullable(),panelPresent:z.boolean(),panelVisible:z.boolean(),
    visibleWorkLinks:z.number().int().min(0).max(200),markers:z.object({login:z.boolean(),verification:z.boolean(),unavailable:z.boolean(),empty:z.boolean()}).strict()
  }).strict().nullable(),pageError:z.literal('UNAVAILABLE').nullable(),
  screenshot:z.string().max(262144).regex(/^\/9j\/[A-Za-z0-9+/]*={0,2}$/).nullable(),
  screenshotError:z.enum(['UNAVAILABLE','TOO_LARGE']).nullable(),
  pageFailureReason:commandError.optional(),screenshotFailureReason:commandError.optional(),
  browser:browserSchema.optional(),captureBrowser:browserSchema.optional(),
  network:z.object({events:z.array(z.object({at:z.string().datetime().optional(),updatedAt:z.string().datetime().optional(),endpoint:z.enum(['works-list','self','profile','other-api']),method:z.enum(['GET','POST','other']),
    match:z.enum(['other-endpoint','child-session','method','author','cursor','target']),phase:z.enum(['page','explicit']),
    stage:z.enum(['request','response','load-failed','loaded']),httpStatus:z.number().int().min(0).max(999).nullable(),json:z.enum(['unknown','mime-json'])
  }).strict()).max(48),documents:z.array(z.object({at:z.string().datetime().optional(),kind:z.enum(['committed','same-document']),pathRelation,childSession:z.boolean()}).strict()).max(16),
    runtime:z.array(z.object({at:z.string().datetime(),kind:z.enum(['exception','contexts-cleared','context-destroyed']),
      exceptionClass:z.enum(['Error','TypeError','ReferenceError','SyntaxError','RangeError','EvalError','DOMException','other']).nullable()}).strict()).max(24).optional(),
    dropped:z.number().int().nonnegative(),scriptExceptions:z.number().int().min(0).max(100000)
  }).strict(),
  attempts:z.array(z.object({cursor:z.number().int().nonnegative(),stage:z.enum(['context','request','response','body','projection','complete','execution']),
    httpStatus:z.number().int().min(0).max(999).nullable(),json:z.enum(['pending','valid','invalid']),errorCode:errorCode.nullable()
  }).strict()).max(10)
}).strict().refine(value=>value.capturePhase==='frozen'
  ?value.page===null&&value.screenshot===null&&!value.completedAt
  :(value.page===null)===(value.pageError!==null)&&(value.screenshot===null)===(value.screenshotError!==null),'失败现场捕获状态不一致')
export type ActivityFailureDiagnostic=z.infer<typeof activityFailureDiagnosticSchema>

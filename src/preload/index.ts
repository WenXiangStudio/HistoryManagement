import { contextBridge, ipcRenderer } from 'electron'
import type {CreatorDatabaseView,CreatorDatabaseMutation} from '../shared/creatorDatabase'
import type {FeishuConfigurationInput,FeishuProbeInput,FeishuProbeReceipt,FeishuState,FeishuSyncRun} from '../shared/feishu'
import type {CreatorRefreshScope} from '../shared/creatorRefreshPolicy'
import type {CreatorPriorityInput,CreatorPriorityState} from '../shared/creatorPriority'

const api = {
  getDashboard: () => ipcRenderer.invoke('dashboard:get'),
  listInbox: (options?: { search?: string; state?: string; limit?: number }) => ipcRenderer.invoke('inbox:list', options),
  getWork: (workId: number) => ipcRenderer.invoke('work:get', workId),
  updateInbox: (workId: number, state: 'unread' | 'read' | 'later' | 'saved', feedback = 0) => ipcRenderer.invoke('inbox:update', workId, state, feedback),
  listCreators: (search?: string) => ipcRenderer.invoke('creators:list', search),
  getCreatorDatabase: ():Promise<CreatorDatabaseView> => ipcRenderer.invoke('creators:database-get'),
  updateCreatorDatabase: (input:CreatorDatabaseMutation):Promise<CreatorDatabaseView> => ipcRenderer.invoke('creators:database-update',input),
  getFeishuState: ():Promise<FeishuState> => ipcRenderer.invoke('feishu:state'),
  saveFeishuConfiguration: (input:FeishuConfigurationInput):Promise<FeishuState> => ipcRenderer.invoke('feishu:save',input),
  probeFeishuCreator: (input:FeishuProbeInput):Promise<FeishuProbeReceipt> => ipcRenderer.invoke('feishu:probe',input),
  syncFeishuCreators: (input:{ownerSecUid:string}):Promise<FeishuSyncRun> => ipcRenderer.invoke('feishu:sync',input),
  setFeishuAutomatic: (input:{ownerSecUid:string;enabled:boolean}):Promise<FeishuState> => ipcRenderer.invoke('feishu:automatic',input),
  updateCreator: (creatorId: number, input: { isStarred?: boolean; note?: string }) => ipcRenderer.invoke('creators:update', creatorId, input),
  updateCreatorPriority: (input:CreatorPriorityInput):Promise<CreatorPriorityState> => ipcRenderer.invoke('creators:priority-update',input),
  listJobs: () => ipcRenderer.invoke('jobs:list'),
  refreshFollowing: (resume=false) => ipcRenderer.invoke('following:refresh', resume),
  completeFollowingBasics: () => ipcRenderer.invoke('following:basic-start'),
  cancelFollowingBasics: () => ipcRenderer.invoke('following:basic-cancel'),
  refreshCreatorActivity: (creatorId?:number,resume=false,creatorIds?:number[],scope?:CreatorRefreshScope) => ipcRenderer.invoke('creators:activity-refresh',creatorId,resume,creatorIds,scope),
  cancelCreatorActivity: () => ipcRenderer.invoke('creators:activity-cancel'),
  ackCreatorActivityRendered: (runId:string) => ipcRenderer.invoke('creators:activity-rendered',runId),
  getFollowingSyncStatus: () => ipcRenderer.invoke('following:status'),
  getFollowingConfiguration: () => ipcRenderer.invoke('following:configuration'),
  saveFollowingConfiguration: (input:{chromeProfile:string;label?:string}) => ipcRenderer.invoke('following:configuration-save',input),
  switchFollowingAccount: (secUid:string) => ipcRenderer.invoke('following:account-switch',secUid),
  bindFollowingAccount: (input:{label:string;profileUrl?:string}) => ipcRenderer.invoke('following:account-bind',input),
  cancelFollowingAccountBinding: () => ipcRenderer.invoke('following:account-bind-cancel'),
  prepareFollowing: () => ipcRenderer.invoke('following:prepare'),
  probeStructuredFollowing: () => ipcRenderer.invoke('following:structured-probe'),
  configureFollowing: () => ipcRenderer.invoke('following:configure'),
  loginFollowing: () => ipcRenderer.invoke('following:login'),
  cancelFollowingSync: () => ipcRenderer.invoke('following:cancel'),
  ackFollowingRendered: (runId:string,loadedCount:number) => ipcRenderer.invoke('following:rendered',runId,loadedCount),
  startCreatorWorksSync: (creatorUid: string, worksPerCreator: number) => ipcRenderer.invoke('works:sync', creatorUid, worksPerCreator),
  startCommentsSync: (workId: string, commentsPerWork: number) => ipcRenderer.invoke('sync:comments', workId, commentsPerWork),
  getIsolatedPilotCatalog: () => ipcRenderer.invoke('isolated-pilot:catalog'),
  prepareIsolatedPilot: (creatorUid: string) => ipcRenderer.invoke('isolated-pilot:prepare', creatorUid),
  getIsolatedPilotStatus: () => ipcRenderer.invoke('isolated-pilot:status'),
  cancelIsolatedPilot: () => ipcRenderer.invoke('isolated-pilot:cancel'),
  openIsolatedPilotExtension: () => ipcRenderer.invoke('isolated-pilot:open-extension'),
  openIsolatedPilotReport: () => ipcRenderer.invoke('isolated-pilot:open-report'),
  pauseSync: () => ipcRenderer.invoke('sync:pause'),
  resumeSync: (jobId: number) => ipcRenderer.invoke('sync:resume', jobId),
  seedDemo: () => ipcRenderer.invoke('demo:seed'),
  getDemoSummary: () => ipcRenderer.invoke('demo:summary'),
  clearDemo: () => ipcRenderer.invoke('demo:clear'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (input: Record<string, unknown>) => ipcRenderer.invoke('settings:save', input),
  estimateCloud: (limit?: number) => ipcRenderer.invoke('cloud:estimate', limit),
  runCloud: (batchId: number) => ipcRenderer.invoke('cloud:run', batchId),
  preflightWorker: () => ipcRenderer.invoke('worker:preflight'),
  setupWorker: () => ipcRenderer.invoke('worker:setup'),
  exportAll: (anonymize = true) => ipcRenderer.invoke('export:all', anonymize),
  openConnectorFolder: () => ipcRenderer.invoke('connector:open-folder'),
  openExternal: (url: string) => ipcRenderer.invoke('external:open', url),
  onDataChanged: (listener: (event: unknown) => void) => {
    const handler = (_event: unknown, payload: unknown): void => listener(payload)
    ipcRenderer.on('data:changed', handler)
    return () => ipcRenderer.removeListener('data:changed', handler)
  },
  onWorkerSetupProgress: (listener: (event: { message: string }) => void) => {
    const handler = (_event: unknown, payload: { message: string }): void => listener(payload)
    ipcRenderer.on('worker:setup-progress', handler)
    return () => { ipcRenderer.removeListener('worker:setup-progress', handler) }
  }
}

contextBridge.exposeInMainWorld('signalDesk', api)

export type SignalDeskApi = typeof api

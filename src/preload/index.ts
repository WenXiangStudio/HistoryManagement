import { contextBridge, ipcRenderer } from 'electron'
import type { SampleSyncOptions } from '../shared/contracts'

const api = {
  getDashboard: () => ipcRenderer.invoke('dashboard:get'),
  listInbox: (options?: { search?: string; state?: string; limit?: number }) => ipcRenderer.invoke('inbox:list', options),
  getWork: (workId: number) => ipcRenderer.invoke('work:get', workId),
  updateInbox: (workId: number, state: 'unread' | 'read' | 'later' | 'saved', feedback = 0) => ipcRenderer.invoke('inbox:update', workId, state, feedback),
  listCreators: (search?: string) => ipcRenderer.invoke('creators:list', search),
  updateCreator: (creatorId: number, input: { isStarred?: boolean; note?: string }) => ipcRenderer.invoke('creators:update', creatorId, input),
  listJobs: () => ipcRenderer.invoke('jobs:list'),
  startSync: (options: SampleSyncOptions) => ipcRenderer.invoke('sync:start', options),
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

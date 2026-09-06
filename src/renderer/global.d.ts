import type { SignalDeskApi } from '../preload/index'

declare global {
  interface Window {
    signalDesk: SignalDeskApi
  }
}

export {}

/** Narrow bridge shared by the manager document and its sandboxed preload. */
import type { InstanceConfig, InstanceId, InstanceStatus, TabState } from './instances.ts'
import type { ManagerMessages } from './manager-locale.ts'
export const MANAGER_CHANNEL = 'dsh-manager:operation'
export const MANAGER_SHORTCUT = 'dsh-manager:shortcut'
export const MANAGER_CHANGED = 'dsh-manager:changed'
/** Instance documents may request the shell settings tab without receiving manager operations. */
export const INSTANCE_OPEN_SETTINGS = 'dsh-instance:open-settings'
/** Public state contains no runtime URLs, host fingerprints, or credentials. */
export interface ManagerSnapshot {
  instances: InstanceConfig[]
  tabs: TabState
  statuses: Record<string, InstanceStatus>
  messages: ManagerMessages
  packaged: boolean
  maximized: boolean
}
/** Closed operation names; main validates every payload and instance ID. */
export type ManagerOperation = 'snapshot' | 'window' | 'pluginLibrary' | 'softwareSettings' | 'shortcuts' | 'shortcutCapture' | 'rename' | 'save' | 'remove' | 'open' | 'close' | 'disconnect' | 'stop' | 'restart' | 'logs' | 'plugins' | 'disablePlugins' | 'reset' | 'overlay'
/** Only the local manager document receives this bridge. */
export interface ManagerApi {
  invoke(operation: ManagerOperation,
    payload?: {
      id?: InstanceId
      config?: unknown
      name?: string
      action?: string
      input?: unknown
      bindings?: unknown
      credentials?: unknown
      visible?: boolean
    }): Promise<unknown>
  onShortcut(listener: (action: string) => void): () => void
  subscribe(listener: () => void): () => void
}

/** Narrow bridge shared by the manager document and its sandboxed preload. */
import type { InstanceConfig, InstanceId, InstanceStatus, TabState } from './instances.ts'
import type { DshDesktopApi } from './ipc.ts'
import type { ManagerMessages } from './manager-locale.ts'
import type { DesktopInstallProgress } from './install-progress.ts'
export const MANAGER_CHANNEL = 'dsh-manager:operation'
export const MANAGER_SHORTCUT = 'dsh-manager:shortcut'
export const MANAGER_CHANGED = 'dsh-manager:changed'
/** Instance documents may request the shell settings tab without receiving manager operations. */
export const INSTANCE_OPEN_SETTINGS = 'dsh-instance:open-settings'
/** Public state contains no runtime URLs, host fingerprints, or credentials. */
export interface ManagerSnapshot {
  version: string
  instances: InstanceConfig[]
  tabs: TabState
  statuses: Record<string, InstanceStatus>
  messages: ManagerMessages
  packaged: boolean
  pluginManagement: boolean
  maximized: boolean
  installationProgress?: Record<string, DesktopInstallProgress>
}
/** Closed operation names; main validates every payload and instance ID. */
export type ManagerOperation = 'snapshot' | 'window' | 'kernel' | 'pluginUpdates' | 'diagnostics' | 'softwareSettings' | 'storage' | 'workspaces' | 'shortcuts' | 'shortcutCapture' | 'rename' | 'save' | 'remove' | 'open' | 'close' | 'disconnect' | 'stop' | 'restart' | 'logs' | 'plugins' | 'disablePlugins' | 'reset' | 'overlay'
/** Only the local manager document receives this bridge. */
export interface ManagerApi {
  readonly pluginLibrary: Pick<DshDesktopApi, 'locale' | 'plugins' | 'backend'>
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
      deleteData?: boolean
    }): Promise<unknown>
  onShortcut(listener: (action: string) => void): () => void
  subscribe(listener: () => void): () => void
}

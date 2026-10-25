/** Plugin IPC methods shared by the owned settings page and instance recovery windows. */
import { ipcRenderer } from 'electron'
import { DESKTOP_IPC, type DshDesktopApi } from './ipc.ts'
import type { DesktopBackendState } from './backend-controller.ts'

/** Only plugin, locale, and backend controls; application updates are owned separately. */
export const pluginApi: Pick<DshDesktopApi, 'locale' | 'plugins' | 'backend'> = {
  locale: () => ipcRenderer.invoke(DESKTOP_IPC.localeGet) as Promise<ReturnType<DshDesktopApi['locale']> extends Promise<infer T> ? T : never>,
  plugins: {
    library: () => ipcRenderer.invoke(DESKTOP_IPC.pluginsLibrary) as ReturnType<DshDesktopApi['plugins']['library']>,
    inject: (name, version, target) => ipcRenderer.invoke(DESKTOP_IPC.pluginsInject, name, version, target) as Promise<void>,
    list: () => ipcRenderer.invoke(DESKTOP_IPC.pluginsList) as Promise<ReturnType<DshDesktopApi['plugins']['list']> extends Promise<infer T> ? T : never>,
    catalog: () => ipcRenderer.invoke(DESKTOP_IPC.pluginsCatalog) as ReturnType<DshDesktopApi['plugins']['catalog']>,
    plan: spec => ipcRenderer.invoke(DESKTOP_IPC.pluginsPlan, spec) as Promise<ReturnType<DshDesktopApi['plugins']['plan']> extends Promise<infer T> ? T : never>,
    add: planId => ipcRenderer.invoke(DESKTOP_IPC.pluginsAdd, planId) as Promise<void>,
    remove: (name, version) => ipcRenderer.invoke(DESKTOP_IPC.pluginsRemove, name, version) as Promise<void>,
    toggle: (name, enabled) => ipcRenderer.invoke(DESKTOP_IPC.pluginsToggle, name, enabled) as Promise<void>,
    disableAll: () => ipcRenderer.invoke(DESKTOP_IPC.pluginsDisableAll) as Promise<void>,
  },
  backend: {
    status: () => ipcRenderer.invoke(DESKTOP_IPC.backendStatus) as ReturnType<DshDesktopApi['backend']['status']>,
    retry: () => ipcRenderer.invoke(DESKTOP_IPC.backendRetry) as Promise<void>,
    subscribe(listener) {
      const handle = (_event: Electron.IpcRendererEvent, state: DesktopBackendState): void => { listener(state) }
      ipcRenderer.on(DESKTOP_IPC.backendState, handle)
      return () => { ipcRenderer.off(DESKTOP_IPC.backendState, handle) }
    },
  },
}

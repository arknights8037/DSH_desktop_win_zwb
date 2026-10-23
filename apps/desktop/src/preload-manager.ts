/** Sandboxed bridge for the local manager document only. */
import { contextBridge, ipcRenderer } from 'electron'
import { MANAGER_CHANNEL, MANAGER_CHANGED, MANAGER_SHORTCUT, type ManagerApi } from './manager-ipc.ts'
const api: ManagerApi = {
  invoke: (operation, payload) => ipcRenderer.invoke(MANAGER_CHANNEL, operation, payload),
  onShortcut(listener) {
    const handler = (_event: Electron.IpcRendererEvent, action: string): void => { listener(action) }
    ipcRenderer.on(MANAGER_SHORTCUT, handler)
    return () => { ipcRenderer.off(MANAGER_SHORTCUT, handler) }
  },
  subscribe(listener) {
    const handler = (): void => { listener() }
    ipcRenderer.on(MANAGER_CHANGED, handler)
    return () => { ipcRenderer.removeListener(MANAGER_CHANGED, handler) }
  },
}
if (location.href === 'dsh-app://shell/manager.html') contextBridge.exposeInMainWorld('dshManager', api)

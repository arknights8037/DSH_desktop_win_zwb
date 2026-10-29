/** Shell-owned workspace editor injected by Desktop Host at profile startup. */
import { useEffect, useState } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { IWorkspaces, WorkspaceId, WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import { Button, IconFolderCloseRegular, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './workspace-editor.module.css'
import { DESKTOP_WORKSPACE_PATH } from './workspace-wire.ts'
import { installWorkspaceMenu } from './workspace-menu.ts'

/** Services required before the shell editor can register its controls. */
export const inject = ['workspaces', 'locale', 'slots']

interface EditorActions {
  settle: () => void
  save: (id: WorkspaceId, title: string, folders: readonly string[]) => Promise<unknown>
  remove: (id: WorkspaceId) => Promise<void>
  pick: () => Promise<string | null>
  canPick: boolean
}
interface EditorInjected extends EditorActions { hooks: { workspaceEdit: HostObservable<WorkspaceView | null> } }
type EditorProps = PropsRuntime<'shell.overlay'> & PropsLocale<'desktopWorkspaceEdit'> & InjectFace<EditorInjected>
const namespace = 'desktopWorkspaceEdit'
const zh = {
  title: '编辑工作区', name: '工作区名称', folders: '源文件夹', folder: '文件夹', primary: '主目录',
  makePrimary: '设为主目录', choose: '重新选择', removeFolder: '移除文件夹', add: '+ 添加文件夹',
  save: '保存', saving: '正在保存…', remove: '移除工作区', confirmRemove: '确认移除',
  removeHint: '仅移除工作区登记，文件和会话均保留；再次点击确认',
  duplicate: '该文件夹已在工作区中', close: '关闭', cancel: '取消', saveFailed: '保存工作区失败，请检查目录后重试。',
  loading: '正在读取工作区…', loadFailed: '读取工作区失败，请重试。', retry: '重试',
}
const en = {
  title: 'Edit workspace', name: 'Workspace name', folders: 'Source folders', folder: 'Folder', primary: 'Primary',
  makePrimary: 'Make primary', choose: 'Choose folder', removeFolder: 'Remove folder', add: '+ Add folder',
  save: 'Save', saving: 'Saving…', remove: 'Remove workspace', confirmRemove: 'Confirm removal',
  removeHint: 'Only the registration is removed; files and conversations are retained. Click again to confirm.',
  duplicate: 'This folder is already in the workspace.', close: 'Close', cancel: 'Cancel', saveFailed: 'Workspace could not be saved. Check the directories and retry.',
  loading: 'Loading workspace…', loadFailed: 'Workspace could not be loaded. Retry.', retry: 'Retry',
}

type DesktopWorkspaceEditKey = keyof typeof zh
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    desktopWorkspaceEdit: DesktopWorkspaceEditKey
  }
}

function Editor({ useWorkspaceEdit, ...props }: EditorProps) {
  const workspace = useWorkspaceEdit(value => value)
  return workspace === null ? null : <EditorForm key={workspace.workspaceId} workspace={workspace} {...props} />
}

function EditorForm({ workspace, save, remove, settle, pick, canPick, t }: EditorActions & PropsLocale<'desktopWorkspaceEdit'> & { workspace: WorkspaceView }) {
  const [title, setTitle] = useState(workspace.title)
  const [folders, setFolders] = useState<{ id: string; path: string }[]>([])
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [confirmRemove, setConfirmRemove] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    setLoadState('loading')
    void (async () => {
      try {
        const response = await fetch(`${DESKTOP_WORKSPACE_PATH}?workspaceId=${encodeURIComponent(workspace.workspaceId)}`, { signal: controller.signal })
        if (!response.ok) throw new Error('Workspace read failed')
        const value: unknown = await response.json()
        if (typeof value !== 'object' || value === null || !('title' in value) || typeof value.title !== 'string'
          || !('folders' in value) || !Array.isArray(value.folders) || value.folders.length < 1 || value.folders.length > 32
          || !value.folders.every((path: unknown) => typeof path === 'string' && path.length > 0)) {
          throw new Error('Invalid Workspace response')
        }
        if (controller.signal.aborted) return
        setTitle(value.title)
        setFolders(value.folders.map((path: string) => ({ id: crypto.randomUUID(), path })))
        setLoadState('ready')
      } catch (_error) {
        if (!controller.signal.aborted) setLoadState('error')
      }
    })()
    return () => { controller.abort() }
  }, [workspace.workspaceId, loadAttempt])
  const run = async (operation: () => Promise<unknown>, close = false) => {
    setBusy(true); setError('')
    try { await operation(); if (close) settle() }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setBusy(false) }
  }
  const choose = (index?: number) => { void run(async () => {
    const path = await pick()
    if (!path) return
    if (folders.some((folder, position) => folder.path === path && position !== index)) throw new Error(t('duplicate'))
    setFolders(current => index === undefined ? [...current, { id: crypto.randomUUID(), path }] : current.map((folder, position) => position === index ? { ...folder, path } : folder))
  }) }
  const invalid = loadState !== 'ready' || !title.trim() || folders.length === 0 || folders.some(folder => !folder.path.trim()) || new Set(folders.map(folder => folder.path.trim())).size !== folders.length
  return <Modal open className={css.dialog!} title={t('title')} closeLabel={t('close')} onClose={() => { if (!busy) settle() }} footer={<>
    <Button variant="outline" className={css.remove} disabled={busy || loadState !== 'ready'} onClick={() => { if (confirmRemove) void run(() => remove(workspace.workspaceId), true); else setConfirmRemove(true) }}>{t(confirmRemove ? 'confirmRemove' : 'remove')}</Button>
    <Button variant="outline" disabled={busy} onClick={settle}>{t('cancel')}</Button>
    <Button variant="primary" disabled={busy || invalid} onClick={() => { void run(() => save(workspace.workspaceId, title.trim(), folders.map(folder => folder.path.trim())), true) }}>{t(busy ? 'saving' : 'save')}</Button>
  </>}>
    <div className={css.editor} aria-busy={busy || loadState === 'loading'}>
      {loadState === 'loading' && <p role="status">{t('loading')}</p>}
      {loadState === 'error' && <div role="alert"><p>{t('loadFailed')}</p><Button variant="outline" onClick={() => { setLoadAttempt(value => value + 1) }}>{t('retry')}</Button></div>}
      <fieldset className={css.fields} disabled={busy || loadState !== 'ready'}>
      <label className={css.name}><IconFolderCloseRegular /><input value={title} aria-label={t('name')} data-modal-autofocus disabled={busy} maxLength={256} onChange={event => { setTitle(event.target.value) }} /></label>
      <h3>{t('folders')}</h3>
      <div className={css.folders}>
        {folders.map((folder, index) => <div className={css.folder} key={folder.id}>
          <IconFolderCloseRegular />
          <input value={folder.path} aria-label={`${t('folder')} ${index + 1}`} disabled={busy} onChange={event => { setFolders(current => current.map((value, position) => position === index ? { ...value, path: event.target.value } : value)) }} />
          <div className={css.folderActions}>
            {index === 0 ? <span className={css.primary}>{t('primary')}</span> : <button type="button" disabled={busy} onClick={() => { setFolders(current => [current[index]!, ...current.filter((_, position) => position !== index)]) }}>{t('makePrimary')}</button>}
            {canPick && <button type="button" disabled={busy} onClick={() => { choose(index) }}>{t('choose')}</button>}
            <button type="button" disabled={busy || folders.length === 1} aria-label={t('removeFolder')} onClick={() => { setFolders(current => current.filter((_, position) => position !== index)) }}>×</button>
          </div>
        </div>)}
        <button className={css.add} type="button" disabled={busy || folders.length >= 32} onClick={() => { if (canPick) choose(); else setFolders(current => [...current, { id: crypto.randomUUID(), path: '' }]) }}>{t('add')}</button>
      </div>
      </fieldset>
      {confirmRemove && <p role="alert" className={css.error}>{t('removeHint')}</p>}
      {error && <p role="alert" className={css.error}>{error}</p>}
    </div>
  </Modal>
}

/** Register shell-owned editing controls in the injected Desktop profile. */
export function apply(ctx: Context): void {
  const workspaces = ctx.get('workspaces') as IWorkspaces
  const request = createSnapshotStore<WorkspaceView | null>(null)
  const picker = (globalThis as typeof globalThis & { __DSH_DIRECTORY_PICKER__?: { pick: () => Promise<string | null> } }).__DSH_DIRECTORY_PICKER__
  ctx.effect(() => ctx.locale.register(namespace, { zh, en }), 'desktop workspace editor: dictionaries')
  ctx.effect(() => installWorkspaceMenu(
    document,
    () => ctx.locale.bind(namespace)('title'),
    id => workspaces.list.getSnapshot().items.some(item => item.workspaceId === id),
    id => { request.set(workspaces.list.getSnapshot().items.find(item => item.workspaceId === id) ?? null) },
  ), 'desktop workspace editor: directory menu')
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay', id: 'desktop.workspace.edit', locale: namespace,
    inject: (): EditorInjected => ({ hooks: { workspaceEdit: request }, settle: () => { request.set(null) },
      save: async (id, title, folders) => {
        const response = await fetch(DESKTOP_WORKSPACE_PATH, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ workspaceId: id, title, folders }),
        })
        if (!response.ok) throw new Error(ctx.locale.bind(namespace)('saveFailed'))
      }, remove: id => workspaces.delete(id),
      canPick: picker !== undefined, pick: () => picker ? picker.pick() : Promise.resolve(null) }),
  }, Editor))
}

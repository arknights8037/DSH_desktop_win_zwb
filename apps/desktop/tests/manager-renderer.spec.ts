import { readFileSync } from 'node:fs'
import { runInContext } from 'node:vm'
import { JSDOM } from 'jsdom'
import { expect, it, onTestFinished, vi } from 'vitest'
import { managerMessages } from '../src/manager-locale.ts'
import { instanceId, type InstanceConfig } from '../src/instances.ts'
import type { ModelSourceView } from '../src/model-sources.ts'
import { DEFAULT_DSH_SETTINGS } from '../src/dsh-settings.ts'
import { DEFAULT_SHORTCUTS } from '../src/manager-shortcuts.ts'
import { DEFAULT_PERSONAL_APPEARANCE, parsePersonalAppearance } from '../src/personal-appearance.ts'
import type { ManagerSnapshot } from '../src/manager-ipc.ts'

const id = instanceId('aabbccdd-1234-4321-8123-123456789012')
function page(config?: InstanceConfig | InstanceConfig[], locale = 'en', openTabs = false, theme?: string) {
  const dom = new JSDOM(readFileSync(new URL('../renderer/manager.html', import.meta.url), 'utf8'), { runScripts: 'outside-only', url: 'https://manager.test/' })
  onTestFinished(() => { dom.window.close() })
  Object.defineProperty(dom.window, 'structuredClone', { value: structuredClone })
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true }
  dom.window.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new dom.window.Event('close')) }
  const instances = config ? Array.isArray(config) ? config : [config] : []
  const snapshot: ManagerSnapshot = { instances, tabs: { ids: openTabs ? instances.map(item => item.id) : [], active: openTabs ? instances.at(-1)!.id : null }, statuses: Object.fromEntries(instances.map(item => [item.id, { process: 'unknown', connection: 'disconnected' }])), messages: managerMessages(locale), packaged: false, maximized: false }
  const settings = { revision: 0, appearance: { theme: theme || 'system', fontSize: 14, language: '', busyEnter: 'queue' },
    personalization: structuredClone(DEFAULT_PERSONAL_APPEARANCE),
    dsh: { ...DEFAULT_DSH_SETTINGS }, modelSources: [] as ModelSourceView[], credentials: [] as string[],
    credentialWritable: true, syncErrors: {} }
  let shortcutBindings = { ...DEFAULT_SHORTCUTS } as Record<string, string>
  const invoke = vi.fn(async (operation: string, payload?: {
    id?: string
    name?: string
    action?: string
    input?: Record<string, unknown>
    bindings?: Record<string, string>
  }) => {
    if (operation === 'snapshot') return snapshot
    if (operation === 'save') return { id }
    if (operation === 'rename') snapshot.instances = snapshot.instances.map(item => item.id === payload?.id ? { ...item, name: payload.name! } : item)
    if (operation === 'open' && payload?.id) snapshot.statuses[payload.id]!.connection = 'connected'
    if (operation === 'close' && payload?.id) {
      snapshot.tabs.ids = snapshot.tabs.ids.filter(item => item !== payload.id)
      if (snapshot.tabs.active === payload.id) snapshot.tabs.active = snapshot.tabs.ids.at(-1) || null
    }
    if (operation === 'shortcuts') { if (payload?.bindings) shortcutBindings = payload.bindings; if (payload?.action === 'reset') shortcutBindings = { ...DEFAULT_SHORTCUTS }; return shortcutBindings }
    if (operation === 'softwareSettings') {
      if (payload?.action === 'read') return structuredClone(settings)
      if (payload?.action === 'credentialInfo') return { [String(payload.input?.ref)]: { configured: settings.credentials.includes(String(payload.input?.ref)), writable: true, source: 'software' } }
      if (payload?.action === 'update') {
        Object.assign(settings.appearance, { [String(payload.input?.field)]: payload.input?.value })
        settings.revision++
      }
      if (payload?.action === 'dshUpdate') { Object.assign(settings.dsh, payload.input?.value); settings.revision++ }
      if (payload?.action === 'personalize') { settings.personalization = parsePersonalAppearance(payload.input?.value); settings.revision++ }
      if (payload?.action === 'sourceSave') {
        const config = payload.input?.config as Omit<ModelSourceView, 'id' | 'keyConfigured'>
        const sourceId = (typeof payload.input?.id === 'string' ? payload.input.id : dom.window.crypto.randomUUID()) as ModelSourceView['id']
        const index = settings.modelSources.findIndex(source => source.id === sourceId)
        const source = { ...config, id: sourceId, keyConfigured: true }
        if (index < 0) settings.modelSources.push(source); else settings.modelSources[index] = source
      }
      if (payload?.action === 'sourceRemove') settings.modelSources = settings.modelSources.filter(source => source.id !== payload.input?.id)
      if (payload?.action === 'credentialSet') settings.credentials.push(String(payload.input?.ref))
      if (payload?.action === 'credentialRemove') settings.credentials = settings.credentials.filter(ref => ref !== payload.input?.ref)
      return structuredClone(settings)
    }
    if (operation === 'logs') return ['Connected', 'Ready']
    return undefined
  })
  const onShortcut = vi.fn<(listener: (action: string) => void) => () => void>(() => () => {})
  Object.defineProperty(dom.window, 'dshManager', { value: { invoke, subscribe: () => () => {}, onShortcut } })
  runInContext(readFileSync(new URL('../renderer/manager.js', import.meta.url), 'utf8'), dom.getInternalVMContext())
  runInContext(readFileSync(new URL('../renderer/manager-sources.js', import.meta.url), 'utf8'), dom.getInternalVMContext())
  runInContext(readFileSync(new URL('../renderer/manager-appearance.js', import.meta.url), 'utf8'), dom.getInternalVMContext())
  runInContext(readFileSync(new URL('../renderer/manager-settings.js', import.meta.url), 'utf8'), dom.getInternalVMContext())
  return { dom, invoke, settings, snapshot, shortcut: (action: string) => { onShortcut.mock.calls[0]![0](action) } }
}
it('previews personal colors and text, saves them, and cancels or resets drafts', async () => {
  const { dom, invoke, settings } = page()
  const document = dom.window.document
  await expect.poll(() => document.querySelector<HTMLButtonElement>('#appearance-defaults')?.disabled).toBe(false)
  document.querySelector<HTMLButtonElement>('#settings')!.click()
  await expect.poll(() => document.querySelector<HTMLElement>('#settings-page')?.hidden).toBe(false)
  document.querySelector<HTMLButtonElement>('[data-settings-tab=appearance]')!.click()
  const preset = document.querySelector<HTMLSelectElement>('#appearance-preset')!
  preset.value = 'plum'
  preset.dispatchEvent(new dom.window.Event('change'))
  expect(document.documentElement.style.getPropertyValue('--text')).toBe('#f2eafc')
  expect(settings.personalization.colors.text).toBe('')
  const preview = invoke.mock.calls.find(([operation, payload]) => operation === 'softwareSettings' && payload?.action === 'previewPersonalization')
  expect(preview?.[1]?.input?.value).toMatchObject({ colors: { text: '#f2eafc' } })
  document.querySelector<HTMLButtonElement>('#appearance-revert')!.click()
  expect(document.documentElement.style.getPropertyValue('--text')).toBe('')
  expect(invoke).toHaveBeenCalledWith('softwareSettings', { action: 'previewPersonalization', input: { value: null } })
  const text = document.querySelector<HTMLInputElement>('#personal-color-text')!
  text.value = '#123456'
  text.dispatchEvent(new dom.window.Event('change'))
  document.querySelector<HTMLFormElement>('#personal-appearance-form')!.dispatchEvent(new dom.window.Event('submit', { cancelable: true }))
  await expect.poll(() => settings.personalization.colors.text).toBe('#123456')
  await expect.poll(() => document.querySelector<HTMLButtonElement>('#appearance-defaults')?.disabled).toBe(false)
  expect(invoke.mock.calls.some(([operation, payload]) => operation === 'softwareSettings' && payload?.action === 'personalize')).toBe(true)
  document.querySelector<HTMLButtonElement>('#appearance-defaults')!.click()
  expect(document.documentElement.style.getPropertyValue('--text')).toBe('')
  expect(settings.personalization.colors.text).toBe('#123456')
  document.querySelector<HTMLButtonElement>('#appearance-revert')!.click()
  expect(document.documentElement.style.getPropertyValue('--text')).toBe('#123456')
})

it('imports color files into a preview and rejects invalid schemes without changing saved colors', async () => {
  const { dom, settings } = page()
  const document = dom.window.document
  const file = document.querySelector<HTMLInputElement>('#colors-import')!
  await expect.poll(() => file.disabled).toBe(false)
  const colors = { ...DEFAULT_PERSONAL_APPEARANCE.colors, text: '#abc123', content: '#123abc' }
  Object.defineProperty(file, 'files', { configurable: true, value: [{ size: 300, text: () => Promise.resolve(JSON.stringify({ version: 1, colors })) }] })
  file.dispatchEvent(new dom.window.Event('change'))
  await expect.poll(() => document.documentElement.style.getPropertyValue('--text')).toBe('#abc123')
  expect(settings.personalization.colors.text).toBe('')
  Object.defineProperty(file, 'files', { configurable: true, value: [{ size: 300, text: () => Promise.resolve('{invalid json') }] })
  file.dispatchEvent(new dom.window.Event('change'))
  await expect.poll(() => document.querySelector('#notice')?.textContent).toContain('Invalid color scheme')
  expect(document.documentElement.style.getPropertyValue('--text')).toBe('#abc123')
})

it('opens the shell library from plugin settings and keeps instance copies separate', async () => {
  const { dom, invoke, snapshot } = page({ id, name: '<local>', kind: 'local' })
  snapshot.packaged = true
  const document = dom.window.document
  await expect.poll(() => document.querySelector('#plugin-instances strong')?.textContent).toBe('<local>')
  document.querySelector<HTMLButtonElement>('#settings')!.click()
  document.querySelector<HTMLButtonElement>('[data-settings-tab=plugins]')!.click()
  expect(document.querySelector<HTMLElement>('#settings-pane-plugins')?.hidden).toBe(false)
  expect(document.querySelector('#settings-title')?.textContent).toBe('Plugins')
  expect(document.querySelector('#plugin-instances local')).toBeNull()
  document.querySelector<HTMLButtonElement>('#open-plugin-library')!.click()
  await expect.poll(() => invoke.mock.calls.some(([operation]) => operation === 'pluginLibrary')).toBe(true)
  expect(invoke.mock.calls.some(([operation]) => operation === 'open')).toBe(false)
  expect(document.querySelectorAll<HTMLButtonElement>('#plugin-instances button')[1]?.disabled).toBe(true)
})
it('offers direct local and remote choices on the first launch', async () => {
  const { dom, invoke } = page()
  await expect.poll(() => dom.window.document.querySelector<HTMLElement>('#first-run')?.hidden).toBe(false)
  expect(dom.window.document.querySelector('.choice-card[data-kind="local"] strong')?.textContent).toBe('Create a local instance')
  expect(dom.window.document.querySelector('.choice-card[data-kind="ssh"] strong')?.textContent).toBe('Connect to a remote instance')
  dom.window.document.querySelector<HTMLButtonElement>('.choice-card[data-kind="local"]')!.click()
  await expect.poll(() => dom.window.document.querySelector<HTMLDialogElement>('#editor')!.open).toBe(false)
  await expect.poll(() => invoke.mock.calls.some(call => call[0] === 'save')).toBe(true)
  expect(invoke).toHaveBeenCalledWith('open', { id })
  dom.window.document.querySelector<HTMLButtonElement>('.choice-card[data-kind="ssh"]')!.click()
  await expect.poll(() => dom.window.document.querySelector<HTMLDialogElement>('#editor')!.open).toBe(true)
  expect(dom.window.document.querySelector<HTMLSelectElement>('select[name="kind"]')?.value).toBe('ssh')
})
it('renders saved names as text and uses localized manager copy', async () => {
  const { dom } = page({ id, name: '<img src=x onerror=alert(1)>', kind: 'local' }, 'zh-CN')
  await expect.poll(() => dom.window.document.querySelector('#menu-instances button')?.textContent).toBe('<img src=x onerror=alert(1)> · 本地')
  expect(dom.window.document.querySelector('#menu-instances img')).toBeNull()
  await expect.poll(() => dom.window.document.querySelector<HTMLElement>('#settings-pane-instances')?.hidden).toBe(false)
  expect(dom.window.document.querySelector<HTMLElement>('#settings-title')?.textContent).toBe('实例管理')
  expect(dom.window.document.querySelector('header')?.firstElementChild?.id).toBe('tabs')
  expect(dom.window.document.querySelector('#tabs')?.nextElementSibling?.querySelector('#add-tab')).not.toBeNull()
  expect(dom.window.document.querySelector('#manage')).toBeNull()
  expect(dom.window.document.querySelector('#settings svg')).not.toBeNull()
  expect(dom.window.document.querySelector('#settings')?.nextElementSibling?.className).toBe('window-controls')
  expect(dom.window.document.querySelector('#add-card')).toBeNull()
  expect(dom.window.document.querySelector('h1')).toBeNull()
  expect(dom.window.document.querySelector<HTMLElement>('#first-run')?.hidden).toBe(true)
})
it('opens the nested add menu and lists saved instances', async () => {
  const { dom, invoke } = page({ id, name: 'Linux', kind: 'local' })
  await expect.poll(() => dom.window.document.querySelector('#menu-instances button')).not.toBeNull()
  dom.window.document.querySelector<HTMLButtonElement>('#add-tab')!.click()
  expect(dom.window.document.querySelector<HTMLElement>('#instance-menu')?.hidden).toBe(false)
  dom.window.document.querySelector<HTMLButtonElement>('#menu-new')!.click()
  expect(dom.window.document.querySelector<HTMLElement>('#menu-new-sub')?.hidden).toBe(false)
  dom.window.document.querySelector<HTMLButtonElement>('#menu-instances button')!.click()
  await expect.poll(() => invoke.mock.calls.some(call => call[0] === 'open')).toBe(true)
  expect(dom.window.document.querySelector<HTMLElement>('#instance-menu')?.hidden).toBe(true)
})
it('requests SSH credentials separately from configuration and clears the input on submit', async () => {
  const { dom, invoke } = page({ id, name: 'Linux', kind: 'ssh', host: 'host', port: 22, username: 'user', auth: 'password', privateKeyPath: '', executable: 'dsh', home: '/tmp/instance' })
  await expect.poll(() => dom.window.document.querySelector('#menu-instances button')?.textContent).toContain('Linux')
  dom.window.document.querySelector<HTMLButtonElement>('#menu-instances button')!.click()
  await expect.poll(() => dom.window.document.querySelector<HTMLDialogElement>('#credentials')!.open).toBe(true)
  const input = dom.window.document.querySelector<HTMLInputElement>('#secret')!
  input.value = 'ephemeral-test-password'
  dom.window.document.querySelector<HTMLFormElement>('#credential-form')!.dispatchEvent(new dom.window.Event('submit', { cancelable: true }))
  await expect.poll(() => invoke.mock.calls.some(call => call[0] === 'open')).toBe(true)
  expect(input.value).toBe('')
  expect(invoke).toHaveBeenCalledWith('open', { id, credentials: { password: 'ephemeral-test-password' } })
  expect(invoke.mock.calls.some(call => call[0] === 'save')).toBe(false)
})

it('renames the clicked inactive tab inline and updates saved quick connections', async () => {
  const otherId = instanceId('bbccddee-1234-4321-8123-123456789012')
  const { dom, invoke } = page([{ id, name: 'First', kind: 'local' }, { id: otherId, name: 'Active', kind: 'local' }], 'en', true)
  const document = dom.window.document
  await expect.poll(() => document.querySelectorAll('.tab').length).toBe(2)
  document.querySelector('.tab')!.dispatchEvent(new dom.window.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 20, clientY: 30 }))
  await expect.poll(() => document.querySelector<HTMLDivElement>('#tab-menu')!.hidden).toBe(false)
  document.querySelector<HTMLButtonElement>('#tab-menu button')!.click()
  await expect.poll(() => document.querySelector('.tab-rename')).not.toBeNull()
  const input = document.querySelector<HTMLInputElement>('.tab-rename')!
  expect(document.activeElement).toBe(input)
  input.value = 'Renamed'
  input.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
  input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  await expect.poll(() => document.querySelector('.tab-name')?.textContent).toBe('Renamed')
  expect(invoke).toHaveBeenCalledWith('rename', { id, name: 'Renamed' })
  expect(document.querySelector('#menu-instances button')?.textContent).toBe('Renamed · Local')
  expect(document.querySelector('.tab.active .tab-name')?.textContent).toBe('Active')
  expect(invoke.mock.calls.some(([operation]) => ['save', 'stop', 'restart', 'disconnect'].includes(operation))).toBe(false)
})
it('keeps empty names unsaved and lets Escape cancel a rename', async () => {
  const { dom, invoke } = page({ id, name: 'First', kind: 'local' }, 'en', true)
  const document = dom.window.document
  await expect.poll(() => document.querySelector('.tab')).not.toBeNull()
  document.querySelector('.tab')!.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'F10', shiftKey: true, bubbles: true }))
  await expect.poll(() => document.querySelector<HTMLDivElement>('#tab-menu')!.hidden).toBe(false)
  document.querySelector<HTMLButtonElement>('#tab-menu button')!.click()
  await expect.poll(() => document.querySelector('.tab-rename')).not.toBeNull()
  const input = document.querySelector<HTMLInputElement>('.tab-rename')!
  input.value = '   '
  input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  expect(invoke.mock.calls.some(([operation]) => operation === 'rename')).toBe(false)
  input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  expect(document.querySelector('.tab-rename')).toBeNull()
  expect(document.querySelector('.tab-name')?.textContent).toBe('First')
})
it('targets tab menu actions at the clicked tab and renders multiline logs', async () => {
  const otherId = instanceId('bbccddee-1234-4321-8123-123456789012')
  const { dom, invoke } = page([{ id, name: 'First', kind: 'local' }, { id: otherId, name: 'Active', kind: 'local' }], 'en', true)
  const document = dom.window.document
  await expect.poll(() => document.querySelectorAll('.tab').length).toBe(2)
  const context = async () => {
    document.querySelector('.tab')!.dispatchEvent(new dom.window.MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    await expect.poll(() => document.querySelector<HTMLDivElement>('#tab-menu')!.hidden).toBe(false)
  }
  await context()
  document.querySelectorAll<HTMLButtonElement>('#tab-menu button')[2]!.click()
  await expect.poll(() => document.querySelector<HTMLDialogElement>('#log-dialog')!.open).toBe(true)
  expect(invoke).toHaveBeenCalledWith('logs', { id })
  expect(document.querySelector('#log-content')?.textContent).toBe('Connected\nReady')
  document.querySelector<HTMLButtonElement>('#log-close')!.click()
  await context()
  document.querySelectorAll<HTMLButtonElement>('#tab-menu button')[3]!.click()
  await expect.poll(() => invoke).toHaveBeenCalledWith('close', { id })
})
it('opens localized software settings, saves the shared theme, and returns to instances', async () => {
  const { dom, invoke } = page({ id, name: 'Local', kind: 'local' }, 'zh-CN', true, 'dark')
  const document = dom.window.document
  await expect.poll(() => document.querySelector('.tab')).not.toBeNull()
  document.querySelector('.tab')!.dispatchEvent(new dom.window.MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
  await expect.poll(() => document.querySelector<HTMLDivElement>('#tab-menu')!.hidden).toBe(false)
  const menu = [...document.querySelectorAll('#tab-menu button')].map(node => node.textContent).join('\n')
  document.querySelector<HTMLButtonElement>('#settings')!.click()
  await expect.poll(() => document.querySelector<HTMLElement>('#settings-page')!.hidden).toBe(false)
  expect(document.querySelector<HTMLElement>('#tab-menu')!.hidden).toBe(true)
  expect(document.documentElement.dataset.theme).toBe('dark')
  const theme = document.querySelector<HTMLSelectElement>('#theme')!
  expect(theme.value).toBe('dark')
  document.querySelector<HTMLButtonElement>('[data-settings-tab=general]')!.click()
  const controls = [...document.querySelectorAll('[data-settings-tab], [data-settings-pane=general] [data-copy], [data-settings-pane=appearance] [data-copy], [data-settings-pane=advanced] [data-copy], [data-settings-pane=keys] [data-copy]')]
  await expect(`${menu}\n\n${document.querySelector('#settings-title')!.textContent}\n${controls.map(node => node.textContent).join('\n')}\n`).toMatchFileSnapshot('expected/manager-controls.txt')
  const applicationTab = document.querySelector<HTMLButtonElement>('[data-settings-tab=general]')!
  applicationTab.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowDown', cancelable: true }))
  expect(document.activeElement).toBe(document.querySelector('[data-settings-tab=instances]'))
  document.activeElement!.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowDown', cancelable: true }))
  expect(document.activeElement).toBe(document.querySelector('[data-settings-tab=appearance]'))
  expect(document.querySelector('[data-settings-tab=appearance]')!.getAttribute('aria-selected')).toBe('true')
  expect(document.querySelector<HTMLElement>('[data-settings-pane=general]')!.hidden).toBe(true)
  expect(document.querySelector<HTMLElement>('[data-settings-pane=appearance]')!.hidden).toBe(false)
  expect(document.querySelector('#settings-title')!.textContent).toBe('外观')
  theme.value = 'light'
  theme.dispatchEvent(new dom.window.Event('change'))
  await expect.poll(() => document.documentElement.dataset.theme).toBe('light')
  expect(invoke).toHaveBeenCalledWith('softwareSettings', { action: 'update', input: { field: 'theme', value: 'light' } })
  expect(invoke.mock.calls.some(([operation]) => operation === 'instanceSettings')).toBe(false)
  document.querySelector<HTMLButtonElement>('[data-settings-tab=instances]')!.click()
  await expect.poll(() => document.querySelector<HTMLElement>('#settings-pane-instances')!.hidden).toBe(false)
  expect(document.querySelector<HTMLElement>('#settings-page')!.hidden).toBe(false)
})

it('saves shared preferences and model credentials before any instance exists', async () => {
  const { dom, invoke, settings } = page()
  const document = dom.window.document
  await expect.poll(() => document.querySelector<HTMLSelectElement>('#theme')!.disabled).toBe(false)
  document.querySelector<HTMLButtonElement>('#settings')!.click()
  const font = document.querySelector<HTMLSelectElement>('#font-size')!
  font.value = '16'; font.dispatchEvent(new dom.window.Event('change'))
  await expect.poll(() => settings.appearance.fontSize).toBe(16)
  document.querySelector<HTMLButtonElement>('[data-settings-tab=keys]')!.click()
  const secret = document.querySelector<HTMLInputElement>('#api-key-value')!
  await expect.poll(() => secret.disabled).toBe(false)
  secret.value = 'fixture-only-key'
  document.querySelector<HTMLFormElement>('#api-key-form')!.dispatchEvent(new dom.window.Event('submit', { cancelable: true }))
  expect(secret.value).toBe('')
  await expect.poll(() => settings.credentials).toEqual(['DEEPSEEK_API_KEY'])
  expect(invoke).toHaveBeenCalledWith('softwareSettings', { action: 'credentialSet', input: { ref: 'DEEPSEEK_API_KEY', value: 'fixture-only-key' } })
  expect(invoke.mock.calls.filter(([operation]) => operation === 'softwareSettings').every(([, args]) => !args?.id)).toBe(true)
  expect(dom.window.localStorage.length).toBe(0)
})

it('adds multiple sources, edits with a blank key, and confirms deletion inline', async () => {
  const { dom, settings, invoke } = page()
  const document = dom.window.document
  await expect.poll(() => document.querySelector<HTMLButtonElement>('#source-add')!.disabled).toBe(false)
  document.querySelector<HTMLButtonElement>('#settings')!.click()
  document.querySelector<HTMLButtonElement>('[data-settings-tab=keys]')!.click()
  for (const [name, protocol] of [['First', 'openai-completions'], ['Second', 'anthropic-messages']]) {
    document.querySelector<HTMLButtonElement>('#source-add')!.click()
    document.querySelector<HTMLInputElement>('#source-name')!.value = name!
    document.querySelector<HTMLSelectElement>('#source-protocol')!.value = protocol!
    document.querySelector<HTMLInputElement>('#source-url')!.value = 'https://gateway.test/v1'
    document.querySelector<HTMLTextAreaElement>('#source-models')!.value = 'model-a\nmodel-b'
    document.querySelector<HTMLInputElement>('#source-key')!.value = 'fixture-source-key'
    document.querySelector<HTMLFormElement>('#source-form')!.dispatchEvent(new dom.window.Event('submit', { cancelable: true }))
    expect(document.querySelector<HTMLInputElement>('#source-key')!.value).toBe('')
    await expect.poll(() => document.querySelector<HTMLElement>('#source-form')!.hidden).toBe(true)
    await expect.poll(() => document.querySelectorAll('.model-source').length).toBe(name === 'First' ? 1 : 2)
  }
  document.querySelector<HTMLButtonElement>('.model-source button')!.click()
  expect(document.querySelector<HTMLInputElement>('#source-key')!.required).toBe(false)
  document.querySelector<HTMLInputElement>('#source-name')!.value = 'Renamed'
  document.querySelector<HTMLFormElement>('#source-form')!.dispatchEvent(new dom.window.Event('submit', { cancelable: true }))
  await expect.poll(() => document.querySelector('.model-source strong')!.textContent).toBe('Renamed')
  expect(invoke.mock.calls.filter(([, args]) => args?.action === 'sourceSave').at(-1)?.[1]?.input?.key).toBe('')
  const remove = document.querySelectorAll<HTMLButtonElement>('.model-source button')[1]!
  remove.click()
  expect(settings.modelSources).toHaveLength(2)
  expect(remove.textContent).toBe('Confirm deletion')
  remove.click()
  await expect.poll(() => document.querySelectorAll('.model-source').length).toBe(1)
  expect(document.querySelector('.model-source strong')!.textContent).toBe('Second')
  expect(invoke.mock.calls.some(([operation]) => operation === 'open')).toBe(false)
})

it('records, disables, and restores window shortcuts', async () => {
  const { dom, invoke } = page()
  const document = dom.window.document
  await expect.poll(() => document.querySelectorAll('.shortcut-row input').length).toBe(6)
  const input = document.querySelector<HTMLInputElement>('.shortcut-row input')!
  input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 's', ctrlKey: true, altKey: true, cancelable: true }))
  await expect.poll(() => input.value).toBe('Ctrl+Alt+S')
  input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Backspace', cancelable: true }))
  await expect.poll(() => input.value).toBe('')
  document.querySelector<HTMLButtonElement>('#shortcut-reset')!.click()
  await expect.poll(() => document.querySelector<HTMLInputElement>('.shortcut-row input')!.value).toBe('Ctrl+,')
  expect(invoke).toHaveBeenCalledWith('shortcuts', { action: 'reset' })
})

it('edits DSH settings without an instance selector, connection, or native navigation', async () => {
  const { dom, invoke, settings } = page()
  const document = dom.window.document
  await expect.poll(() => document.querySelector<HTMLInputElement>('#dsh-deepseekBaseURL')!.disabled).toBe(false)
  document.querySelector<HTMLButtonElement>('#settings')!.click()
  document.querySelector<HTMLButtonElement>('[data-settings-tab=advanced]')!.click()
  expect(document.querySelector('#settings-instance')).toBeNull()
  expect(document.querySelector('[data-native-section]')).toBeNull()
  const url = document.querySelector<HTMLInputElement>('#dsh-deepseekBaseURL')!
  url.value = 'https://gateway.test/anthropic'
  url.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
  document.querySelector<HTMLButtonElement>('[data-settings-tab=general]')!.click()
  document.querySelector<HTMLButtonElement>('[data-settings-tab=advanced]')!.click()
  expect(url.value).toBe('https://gateway.test/anthropic')
  document.querySelector<HTMLFormElement>('#dsh-settings-form')!.dispatchEvent(new dom.window.Event('submit', { cancelable: true }))
  await expect.poll(() => settings.dsh.deepseekBaseURL).toBe('https://gateway.test/anthropic')
  expect(invoke).toHaveBeenCalledWith('softwareSettings', { action: 'dshUpdate', input: { value: { ...DEFAULT_DSH_SETTINGS,
    deepseekBaseURL: 'https://gateway.test/anthropic' } } })
  expect(document.querySelector<HTMLElement>('#settings-page')!.hidden).toBe(false)
  expect(invoke.mock.calls.some(([operation]) => ['open', 'nativeSettings'].includes(operation))).toBe(false)
})

it('keeps settings in one closable tab and cycles between settings and instances', async () => {
  const { dom, invoke, shortcut } = page({ id, name: 'Workspace', kind: 'local' }, 'en', true)
  const document = dom.window.document
  await expect.poll(() => invoke).toHaveBeenCalledWith('open', { id })
  document.querySelector<HTMLButtonElement>('#settings')!.click()
  await expect.poll(() => document.querySelector('#settings-tab.active')).not.toBeNull()
  expect(document.querySelectorAll('.tab[aria-selected="true"]')).toHaveLength(1)
  expect(document.querySelector('#settings-tab svg')).not.toBeNull()
  document.querySelector<HTMLButtonElement>('[data-settings-tab=instances]')!.click()
  expect(document.querySelector<HTMLElement>('#settings-pane-instances')!.hidden).toBe(false)
  shortcut('previous')
  await expect.poll(() => document.querySelector<HTMLElement>('#settings-page')!.hidden).toBe(true)
  expect(document.querySelector('#settings-tab')).not.toBeNull()
  shortcut('next')
  await expect.poll(() => document.querySelector('#settings-tab.active')).not.toBeNull()
  expect(document.querySelector<HTMLElement>('#settings-pane-instances')!.hidden).toBe(false)
  document.querySelector<HTMLButtonElement>('#settings')!.click()
  await expect.poll(() => document.querySelectorAll('#settings-tab').length).toBe(1)
  shortcut('close')
  await expect.poll(() => document.querySelector('#settings-tab')).toBeNull()
  expect(document.querySelector<HTMLElement>('#settings-page')!.hidden).toBe(true)
  expect(invoke.mock.calls.some(([operation]) => operation === 'close')).toBe(false)
  document.querySelector<HTMLButtonElement>('#settings')!.click()
  await expect.poll(() => document.querySelector('#settings-tab')).not.toBeNull()
  document.querySelector<HTMLButtonElement>('#settings-tab button')!.click()
  await expect.poll(() => document.querySelector('#settings-tab')).toBeNull()
})

it('returns to the welcome page when closing settings without an instance tab', async () => {
  const { dom } = page()
  const document = dom.window.document
  await expect.poll(() => document.querySelector<HTMLSelectElement>('#theme')!.disabled).toBe(false)
  document.querySelector<HTMLButtonElement>('#settings')!.click()
  await expect.poll(() => document.querySelector('#settings-tab')).not.toBeNull()
  document.querySelector<HTMLButtonElement>('[data-settings-tab=instances]')!.click()
  expect(document.querySelector<HTMLElement>('#instances-empty')!.hidden).toBe(false)
  document.querySelector<HTMLButtonElement>('#settings-tab button')!.click()
  await expect.poll(() => document.querySelector<HTMLElement>('#first-run')!.hidden).toBe(false)
})

it('sends localized window controls separately from instance tab actions', async () => {
  const { dom, invoke, snapshot } = page(undefined, 'zh')
  const document = dom.window.document
  await expect.poll(() => document.querySelector('#window-minimize')!.getAttribute('aria-label')).toBe('最小化')
  for (const action of ['minimize', 'maximize', 'close']) {
    document.querySelector<HTMLButtonElement>(`#window-${action}`)!.click()
    await expect.poll(() => invoke).toHaveBeenCalledWith('window', { action })
  }
  snapshot.maximized = true
  document.querySelector<HTMLButtonElement>('#settings')!.click()
  await expect.poll(() => document.querySelector('#window-maximize')!.getAttribute('aria-label')).toBe('还原')
  expect(document.querySelector('#window-maximize')!.getAttribute('aria-pressed')).toBe('true')
})

it('selects the settings tab when the final instance tab closes', async () => {
  const { dom, invoke, shortcut } = page({ id, name: 'Workspace', kind: 'local' }, 'en', true)
  const document = dom.window.document
  await expect.poll(() => invoke).toHaveBeenCalledWith('open', { id })
  document.querySelector<HTMLButtonElement>('#settings')!.click()
  await expect.poll(() => document.querySelector('#settings-tab.active')).not.toBeNull()
  document.querySelector<HTMLElement>('.tab:not(.settings-tab)')!.click()
  await expect.poll(() => document.querySelector<HTMLElement>('#settings-page')!.hidden).toBe(true)
  shortcut('close')
  await expect.poll(() => document.querySelector('#settings-tab.active')).not.toBeNull()
  expect(document.querySelectorAll('.tab')).toHaveLength(1)
  expect(invoke).toHaveBeenCalledWith('close', { id })
})

/** Exercise real Electron tabs and local Hosts using an isolated development home. */
import { createRequire } from 'node:module'
import { existsSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { prepareDevelopmentProject } from './development-project.ts'
import { DESKTOP_HOST_PROTOCOL_VERSION } from '../src/host-protocol.ts'
import type { InstanceConfig } from '../src/instances.ts'
import type { ManagerSnapshot } from '../src/manager-ipc.ts'
import type { SoftwareSettingsSnapshot } from '../src/software-settings.ts'
import { sourceRoute, sourceKeyRef } from '../src/model-sources.ts'

const root = resolve(import.meta.dirname, '../../..')
const appRoot = join(root, 'apps/desktop')
const require = createRequire(join(appRoot, 'package.json'))
const playwright = await import(pathToFileURL(join(root, 'node_modules/.pnpm/node_modules/playwright-core/index.mjs')).href)
const home = mkdtempSync(join(tmpdir(), 'dsh-manager-smoke-'))
const output = join(appRoot, '.desktop-build', 'manager-smoke')
mkdirSync(output, { recursive: true })
const packagedExecutable = process.argv[2]
if (!packagedExecutable) prepareDevelopmentProject({
  projectDir: join(appRoot, '.desktop-build', 'development', 'project'), cliDir: join(root, 'apps/cli'),
  hostDir: join(root, 'apps/desktop-host'), dependencyDir: join(root, 'node_modules/.pnpm/node_modules'),
  release: { schemaVersion: 1, version: JSON.parse(readFileSync(join(appRoot, 'package.json'), 'utf8')).version,
    hostProtocolVersion: DESKTOP_HOST_PROTOCOL_VERSION, nodeVersion: process.versions.node,
    pnpmVersion: JSON.parse(readFileSync(join(appRoot, 'node_modules/pnpm/package.json'), 'utf8')).version },
})
const environment: NodeJS.ProcessEnv = { ...process.env, DSH_HOME: home, DSH_DESKTOP_NODE_BINARY: process.execPath, DSH_DESKTOP_OPEN_DEVTOOLS: '0' }
delete environment.ELECTRON_RUN_AS_NODE
const electron = await playwright._electron.launch({ executablePath: packagedExecutable ?? require('electron'), args: [...(packagedExecutable ? [] : [appRoot]), `--user-data-dir=${join(home, 'browser')}`], env: environment })
try {
  const page = await electron.firstWindow()
  const capture = async (name: string): Promise<void> => {
    const png = await electron.evaluate(async ({ BrowserWindow }: typeof import('electron')) =>
      (await BrowserWindow.getAllWindows()[0]!.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG().toString('base64'))
    writeFileSync(join(output, name), Buffer.from(png, 'base64'))
  }
  page.on('pageerror', (error: Error) => console.error('renderer:', error.message))
  await page.waitForFunction(() => document.querySelectorAll('#add-tab').length === 1 && document.querySelector('#add-tab')!.textContent === '+')
  await page.locator('#settings').click()
  await page.locator('#settings-tab.active').waitFor()
  await page.locator('[data-settings-tab=instances]').click()
  await page.locator('#instances-empty').waitFor()
  await page.locator('#window-maximize').click()
  await page.waitForFunction(() => document.querySelector('#window-maximize')?.getAttribute('aria-pressed') === 'true')
  await capture('settings-maximized.png')
  await page.locator('#window-maximize').click()
  await page.waitForFunction(() => document.querySelector('#window-maximize')?.getAttribute('aria-pressed') === 'false')
  await page.locator('#window-minimize').click()
  await electron.evaluate(({ BrowserWindow }: typeof import('electron')) => {
    const window = BrowserWindow.getAllWindows()[0]!
    if (!window.isMinimized()) throw new Error('Window did not minimize')
    window.restore()
  })
  await page.locator('#settings-tab button').click()
  await page.locator('#first-run').waitFor()
  for (const _name of ['Local development', 'Isolated review']) {
    await page.locator('#add-tab').click()
    await page.locator('#menu-new').click()
    await page.locator('#menu-new-sub [data-kind="local"]').click()
    await page.locator('#instance-menu').waitFor({ state: 'hidden' })
    await page.locator('#settings').click()
    await page.locator('[data-settings-tab=instances]').click()
  }
  await capture('instances.png')
  const configs: InstanceConfig[] = await page.evaluate(async () => (await (window as unknown as { dshManager: { invoke: (operation: string) => Promise<ManagerSnapshot> } }).dshManager.invoke('snapshot')).instances)
  const invoke = (operation: string, args?: unknown) => page.evaluate(async (
    { operation, args }: { operation: string; args?: unknown },
  ) => {
    const api = (window as unknown as { dshManager: { invoke: (operation: string, args?: unknown) => Promise<unknown> } }).dshManager
    return api.invoke(operation, args)
  }, { operation, args })
  const hostRead = (method: string, args: Record<string, unknown> = {}) => electron.evaluate(async ({ webContents }: typeof import('electron'), { method, args }: { method: string; args: Record<string, unknown> }) => {
    const script = `(async () => {
      const rpcId = crypto.randomUUID();
      const response = await fetch('/api/' + ${JSON.stringify(method)}, {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type:'client-request',rpcId,method:${JSON.stringify(method)},payload:{args:${JSON.stringify(args)}}})});
      const result = (await response.json()).result;
      if (!result.ok) throw new Error(JSON.stringify(result.error));
      return result.value;
    })()`
    return Promise.all(webContents.getAllWebContents().filter(item => item.getURL().startsWith('dsh-app://app/')).map(item => item.executeJavaScript(script)))
  }, { method, args })
  for (const [index, config] of configs.entries()) {
    await page.locator('#add-tab').click()
    await page.locator('#menu-instances button').nth(index).click()
    await page.evaluate(async (id: string) => { await (window as unknown as { dshManager: { invoke: (operation: string, args: unknown) => Promise<unknown> } }).dshManager.invoke('open', { id }) }, config.id)
    await page.locator('#settings').click()
    await page.locator('[data-settings-tab=instances]').click()
  }
  const state: ManagerSnapshot = await page.evaluate(async () => (window as unknown as { dshManager: { invoke: (operation: string) => Promise<ManagerSnapshot> } }).dshManager.invoke('snapshot'))
  if (state.instances.some(config => state.statuses[config.id]?.connection !== 'connected')) throw new Error(`Local instances did not connect: ${JSON.stringify(state.statuses)}`)
  const screenshot = await electron.evaluate(async ({ BrowserWindow }: typeof import('electron')) => (await BrowserWindow.getAllWindows()[0]!.capturePage()).toPNG().toString('base64'))
  writeFileSync(join(output, 'two-local-tabs.png'), Buffer.from(screenshot, 'base64'))
  const hostPages = await electron.evaluate(async ({ webContents }: typeof import('electron')) => {
    const contents = webContents.getAllWebContents().filter(item => item.getURL().startsWith('dsh-app://app/'))
    return await Promise.all(contents.map(async item => ({ url: item.getURL(), title: await item.executeJavaScript('document.title'), text: await item.executeJavaScript('document.body.innerText.slice(0, 500)'), image: (await item.capturePage()).toPNG().toString('base64') })))
  })
  if (hostPages.length !== 2 || hostPages.some((item: { text: string }) => !item.text.trim())) throw new Error('Instance page did not render')
  for (const [index, hostPage] of hostPages.entries()) writeFileSync(join(output, `host-${index}.png`), Buffer.from(hostPage.image, 'base64'))
  console.log('Rendered instance pages:', hostPages.map(({ url, title, text }: { url: string; title: string; text: string }) => ({ url, title, text })))
  const firstTab = page.locator('.tab').first()
  const lastTabBounds = await page.locator('.tab').last().boundingBox()
  const addBounds = await page.locator('#add-tab').boundingBox()
  if (!lastTabBounds || !addBounds || addBounds.x < lastTabBounds.x + lastTabBounds.width || addBounds.x - lastTabBounds.x - lastTabBounds.width > 12) throw new Error('Add button does not follow the last tab')
  const contentsBefore = await electron.evaluate(({ webContents }: typeof import('electron')) => webContents.getAllWebContents().filter(item => item.getURL().startsWith('dsh-app://app/')).map(item => item.id).sort())
  await firstTab.click({ button: 'right' })
  await page.locator('#tab-menu').waitFor({ state: 'visible' })
  await capture('tab-menu.png')
  await page.locator('#tab-menu button').nth(0).click()
  await page.locator('.tab-rename').fill('Renamed local')
  await page.locator('.tab-rename').press('Enter')
  await page.waitForFunction(() => document.querySelector('.tab-name')?.textContent === 'Renamed local')
  const renamed: ManagerSnapshot = await page.evaluate(async () => (window as unknown as { dshManager: { invoke: (operation: string) => Promise<ManagerSnapshot> } }).dshManager.invoke('snapshot'))
  const contentsAfter = await electron.evaluate(({ webContents }: typeof import('electron')) => webContents.getAllWebContents().filter(item => item.getURL().startsWith('dsh-app://app/')).map(item => item.id).sort())
  if (JSON.stringify(contentsBefore) !== JSON.stringify(contentsAfter) || renamed.statuses[configs[0]!.id]?.connection !== 'connected') throw new Error('Renaming replaced a live instance view')
  if (renamed.instances.find(item => item.id === configs[0]!.id)?.name !== 'Renamed local') throw new Error('Renamed instance was not saved')
  await page.locator('#settings').click()
  const sidebar = await page.locator('.settings-nav').boundingBox()
  const content = await page.locator('.settings-content').boundingBox()
  if (!sidebar || !content || sidebar.x > 16 || sidebar.y > 52 || content.x < sidebar.x + sidebar.width) throw new Error('Settings do not use the full-height sidebar layout')
  await page.locator('[data-settings-tab=appearance]').click()
  await page.locator('#theme').selectOption('light')
  await page.waitForFunction(() => !document.querySelector<HTMLSelectElement>('#theme')!.disabled && document.documentElement.dataset.theme === 'light')
  await capture('settings-light.png')
  await page.locator('[data-settings-tab=general]').click()
  await capture('settings-application.png')
  await page.locator('[data-settings-tab=appearance]').click()
  const lightBackground = await page.locator('body').evaluate((node: HTMLElement) => getComputedStyle(node).backgroundColor)
  await page.locator('#theme').selectOption('dark')
  await page.waitForFunction(() => !document.querySelector<HTMLSelectElement>('#theme')!.disabled && document.documentElement.dataset.theme === 'dark')
  await capture('settings-dark.png')
  const darkBackground = await page.locator('body').evaluate((node: HTMLElement) => getComputedStyle(node).backgroundColor)
  if (lightBackground === darkBackground) throw new Error('Explicit theme selection did not change the appearance')
  await page.locator('#font-size').selectOption('16')
  await page.waitForFunction(() => !document.querySelector<HTMLSelectElement>('#font-size')!.disabled && document.querySelector<HTMLSelectElement>('#font-size')!.value === '16')
  const wallpaper = await page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 800; canvas.height = 600
    const context = canvas.getContext('2d')!
    const gradient = context.createLinearGradient(0, 0, 800, 600)
    gradient.addColorStop(0, '#225580'); gradient.addColorStop(0.5, '#668875'); gradient.addColorStop(1, '#be9170')
    context.fillStyle = gradient; context.fillRect(0, 0, 800, 600)
    return canvas.toDataURL('image/png').split(',')[1]!
  })
  await page.locator('#wallpaper-file').setInputFiles({ name: 'smoke-wallpaper.png', mimeType: 'image/png', buffer: Buffer.from(wallpaper, 'base64') })
  await page.waitForFunction(() => document.querySelector('#wallpaper-status')?.textContent === '已选择图片')
  await page.locator('#appearance-preset').selectOption('ocean')
  await page.locator('#personal-color-text').evaluate((node: HTMLInputElement) => { node.value = '#234567'; node.dispatchEvent(new Event('change')) })
  for (const host of electron.context().pages().filter((item: { url(): string }) => item.url().startsWith('dsh-app://app/'))) {
    await host.waitForFunction(() => getComputedStyle(document.body).backgroundColor === 'rgba(0, 0, 0, 0)'
      && getComputedStyle(document.body).getPropertyValue('--dsw-alias-label-primary').trim() === '#234567')
  }
  const previewSettings = await invoke('softwareSettings', { action: 'read' }) as SoftwareSettingsSnapshot
  if (previewSettings.personalization.backgroundImage || previewSettings.personalization.colors.text) throw new Error('Appearance preview persisted before Save')
  await page.locator('#personal-appearance-form [type=submit]').click()
  await page.waitForFunction(() => !document.querySelector<HTMLButtonElement>('#appearance-defaults')!.disabled && document.querySelector<HTMLButtonElement>('#appearance-revert')!.disabled)
  const appearanceState = await invoke('softwareSettings', { action: 'read' }) as SoftwareSettingsSnapshot & { syncErrors: Record<string, string> }
  if (Object.keys(appearanceState.syncErrors).length || !appearanceState.personalization.backgroundImage.startsWith('data:image/webp;')) throw new Error('Wallpaper did not save and synchronize')
  await page.locator('.settings-content').evaluate((node: HTMLElement) => { node.scrollTop = 0 })
  await capture('appearance-masked.png')
  const instanceAppearance = () => electron.evaluate(async ({ webContents }: typeof import('electron')) => Promise.all(
    webContents.getAllWebContents().filter(item => item.getURL().startsWith('dsh-app://app/')).map(item => item.executeJavaScript(`(() => {
      const style = getComputedStyle(document.body);
      return { wallpaper: style.backgroundImage, canvas: style.backgroundColor, text: style.getPropertyValue('--dsw-alias-label-primary'), sidebar: style.getPropertyValue('--dsw-specific-sidebar-fill') };
    })()`)),
  )) as Promise<Array<{ wallpaper: string; canvas: string; text: string; sidebar: string }>>
  const masked = await instanceAppearance()
  if (masked.length !== 2 || masked.some(item => item.wallpaper !== 'none' || item.canvas !== 'rgba(0, 0, 0, 0)' || item.text.trim() !== '#234567' || !item.sidebar.includes('80%'))) throw new Error('Shell presentation did not replace instance wallpaper, canvas, and text')
  const maskedWallpaper = await page.locator('body').evaluate((node: HTMLElement) => getComputedStyle(node).backgroundImage)
  const shellSurfaces = () => page.evaluate(() => {
    return { card: getComputedStyle(document.querySelector('.plugin-library-card')!).backgroundColor,
      instance: getComputedStyle(document.querySelector('#plugin-instances .instance-row')!).backgroundColor,
      activeTab: getComputedStyle(document.querySelector('#settings-tab')!).backgroundColor,
      content: getComputedStyle(document.querySelector('.settings-content')!).backgroundColor,
      welcome: getComputedStyle(document.querySelector('.choice-card')!).backgroundColor,
      input: getComputedStyle(document.querySelector('#source-form input')!).backgroundColor,
      textarea: getComputedStyle(document.querySelector('#source-form textarea')!).backgroundColor,
      menu: getComputedStyle(document.querySelector('#instance-menu')!).backgroundColor }
  })
  await page.locator('[data-settings-tab=plugins]').click()
  const wallpaperSurfaces = await shellSurfaces()
  if ([wallpaperSurfaces.card, wallpaperSurfaces.instance, wallpaperSurfaces.activeTab].some(color => color !== 'rgba(0, 0, 0, 0)')
    || wallpaperSurfaces.welcome !== wallpaperSurfaces.content || wallpaperSurfaces.textarea !== wallpaperSurfaces.input
    || !wallpaperSurfaces.menu.startsWith('rgb(')) throw new Error(`Shell controls block wallpaper or lose popup contrast: ${JSON.stringify(wallpaperSurfaces)}`)
  await capture('plugins-wallpaper.png')
  await page.locator('[data-settings-tab=appearance]').click()
  const colorFile = join(home, 'smoke-colors.json')
  await electron.evaluate(({ dialog }: typeof import('electron'), filePath: string) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath })
  }, colorFile)
  await page.locator('#colors-export').click()
  const exportDeadline = Date.now() + 10_000
  while (!existsSync(colorFile) && Date.now() < exportDeadline) await new Promise(resolve => setTimeout(resolve, 100))
  const colorJson = JSON.parse(readFileSync(colorFile, 'utf8')) as { version: number; colors: { text: string }; backgroundImage?: string }
  if (colorJson.version !== 1 || colorJson.colors.text !== '#234567' || colorJson.backgroundImage !== undefined) throw new Error('Color export did not preserve colors independently of wallpaper')
  await page.locator('#wallpaper-mask').uncheck()
  await page.locator('#personal-appearance-form [type=submit]').click()
  await page.waitForFunction(() => !document.querySelector<HTMLButtonElement>('#appearance-defaults')!.disabled && document.querySelector<HTMLButtonElement>('#appearance-revert')!.disabled)
  const unmaskedWallpaper = await page.locator('body').evaluate((node: HTMLElement) => getComputedStyle(node).backgroundImage)
  if (unmaskedWallpaper === maskedWallpaper) throw new Error('Disabling the mask did not change the shell wallpaper')
  await page.locator('.settings-content').evaluate((node: HTMLElement) => { node.scrollTop = 0 })
  await capture('appearance-unmasked.png')
  await electron.evaluate(async ({ webContents }: typeof import('electron')) => Promise.all(webContents.getAllWebContents().filter(item => item.getURL().startsWith('dsh-app://app/')).map(item => item.executeJavaScript('(async () => { for (const text of ["继续", "Continue", "稍后配置", "Configure later"]) { const button = Array.from(document.querySelectorAll("[role=dialog] button")).find(button => button.textContent === text); if (button) { button.click(); await new Promise(resolve => setTimeout(resolve, 150)); } } })()'))))
  await page.locator('.tab').first().dispatchEvent('click')
  await page.waitForFunction(() => document.querySelector('#tabs .tab')?.getAttribute('aria-selected') === 'true')
  await capture('appearance-composited.png')
  // Pixel evidence uses an unobstructed region of the visible conversation,
  // after both onboarding steps have settled and the compositor has painted.
  const visibleHost = electron.context().pages().find((item: { url(): string }) => item.url().startsWith('dsh-app://app/'))!
  await visibleHost.waitForFunction(() => !document.querySelector('[role=dialog]'))
  const visualAppearance = { ...appearanceState.personalization, maskEnabled: false, surfaceOpacity: 0 }
  await invoke('softwareSettings', { action: 'personalize', input: { value: visualAppearance } })
  await visibleHost.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
  const pixel = await electron.evaluate(async ({ BrowserWindow }: typeof import('electron')) => {
    const window = BrowserWindow.getAllWindows()[0]!
    const view = window.contentView.children.find(item => 'webContents' in item && item.getVisible()) as import('electron').WebContentsView
    const image = await view.webContents.capturePage({ x: 1000, y: 258, width: 1, height: 1 })
    return [...image.toBitmap().subarray(0, 4)]
  })
  if (pixel[3] !== 0) throw new Error(`Instance still blocks the shell wallpaper: ${JSON.stringify(pixel)}`)
  await capture('appearance-through-instance.png')
  await visibleHost.getByRole('button', { name: '设置', exact: true }).dispatchEvent('click')
  await page.locator('#settings-tab.active').waitFor()
  await page.locator('#settings').click()
  await page.locator('[data-settings-tab=appearance]').click()
  await page.locator('#appearance-defaults').dispatchEvent('click')
  await page.locator('#personal-appearance-form [type=submit]').dispatchEvent('click')
  await page.waitForFunction(() => !document.querySelector<HTMLButtonElement>('#appearance-defaults')!.disabled && document.querySelector<HTMLButtonElement>('#appearance-revert')!.disabled)
  let resetAppearance = await instanceAppearance()
  const resetDeadline = Date.now() + 10_000
  while (resetAppearance.some(item => item.wallpaper !== 'none' || item.text.trim() === '#234567') && Date.now() < resetDeadline) {
    await new Promise(resolve => setTimeout(resolve, 100))
    resetAppearance = await instanceAppearance()
  }
  if (resetAppearance.some(item => item.wallpaper !== 'none' || item.text.trim() === '#234567')) throw new Error(`Default appearance did not retract custom tokens: ${JSON.stringify(resetAppearance)}`)
  const defaultSurfaces = await shellSurfaces()
  if ([defaultSurfaces.card, defaultSurfaces.instance, defaultSurfaces.activeTab].some(color => !color.startsWith('rgb('))) {
    throw new Error(`Default shell controls did not regain solid fills: ${JSON.stringify(defaultSurfaces)}`)
  }
  await page.locator('[data-settings-tab=general]').click()
  await page.locator('#language').selectOption('en')
  await page.waitForFunction(() => !document.querySelector<HTMLSelectElement>('#language')!.disabled && document.querySelector<HTMLSelectElement>('#language')!.value === 'en')
  await page.locator('#busy-enter').selectOption('steer')
  await page.waitForFunction(() => !document.querySelector<HTMLSelectElement>('#busy-enter')!.disabled && document.querySelector<HTMLSelectElement>('#busy-enter')!.value === 'steer')
  const shared = await invoke('softwareSettings', { action: 'read' }) as { syncErrors: Record<string, string> }
  if (Object.keys(shared.syncErrors).length) throw new Error(`Software sync failed: ${JSON.stringify(shared.syncErrors)}`)
  const documents = await hostRead('settings/describe') as Array<{ namespaces: Array<{ ns: string; value: Record<string, unknown> }> }>
  for (const doc of documents) {
    for (const [ns, expected] of [['ui-theme', { preference: 'dark', fontSize: 16 }], ['locale', { preference: 'en' }], ['ui-conversation', { busyEnter: 'steer' }]] as const) {
      const value = doc.namespaces.find(item => item.ns === ns)?.value
      if (!value || Object.entries(expected).some(([key, item]) => value[key] !== item)) throw new Error(`Instance did not inherit ${ns}: ${JSON.stringify(value)}`)
    }
  }
  await page.locator('[data-settings-tab=shortcuts]').click()
  const shortcut = page.locator('.shortcut-row input').first()
  await shortcut.press('Control+Alt+s')
  await page.waitForFunction(() => document.querySelector<HTMLInputElement>('.shortcut-row input')!.value === 'Ctrl+Alt+S')
  await capture('settings-shortcuts.png')
  const originalSize = await electron.evaluate(({ BrowserWindow }: typeof import('electron')) => {
    const window = BrowserWindow.getAllWindows()[0]!
    const size = window.getSize()
    window.setSize(960, 660)
    return size
  })
  await page.waitForFunction(() => innerWidth < 1000)
  await page.locator('#shortcut-reset').scrollIntoViewIfNeeded()
  const narrowLayout = await page.evaluate(() => {
    const sidebar = document.querySelector('.settings-nav')!.getBoundingClientRect()
    const reset = document.querySelector('#shortcut-reset')!.getBoundingClientRect()
    return { sidebarTop: sidebar.top, bottom: reset.bottom, height: innerHeight, overflow: document.body.scrollWidth > innerWidth }
  })
  await capture('settings-compact.png')
  // Fractional display scaling can round the scroll position by less than one CSS pixel.
  if (narrowLayout.sidebarTop > 52 || narrowLayout.bottom > narrowLayout.height + 1 || narrowLayout.overflow) throw new Error(`Compact settings scroll moved the sidebar or clipped controls: ${JSON.stringify(narrowLayout)}`)
  await electron.evaluate(({ BrowserWindow }: typeof import('electron'), size: number[]) => { BrowserWindow.getAllWindows()[0]!.setSize(size[0]!, size[1]!) }, originalSize)
  await page.waitForFunction(() => innerWidth > 1000)
  await page.locator('[data-settings-tab=keys]').click()
  for (const protocol of ['openai-completions', 'openai-responses', 'anthropic-messages']) {
    await page.locator('#source-add').click()
    await page.locator('#source-name').fill(`Fixture ${protocol}`)
    await page.locator('#source-protocol').selectOption(protocol)
    await page.locator('#source-url').fill('https://fixture-model-api.invalid/v1')
    await page.locator('#source-models').fill(`fixture-${protocol}`)
    await page.locator('#source-key').fill(`fixture-key-${protocol}`)
    await page.locator('#source-form [type=submit]').click()
    await page.locator('#source-form').waitFor({ state: 'hidden' })
  }
  const sources = await invoke('softwareSettings', { action: 'read' }) as SoftwareSettingsSnapshot & { syncErrors: Record<string, string> }
  if (sources.modelSources.length !== 3 || Object.keys(sources.syncErrors).length) throw new Error(`Sources did not sync: ${JSON.stringify(sources.syncErrors)}`)
  const providerLists = await hostRead('llm/listProviders') as Array<Array<{ id: string; name: string }>>
  for (const providers of providerLists) {
    for (const source of sources.modelSources) {
      if (!providers.some(provider => provider.id === sourceRoute(source.id))) throw new Error(`Source did not register: ${source.protocol}`)
    }
  }
  if (readFileSync(join(home, 'desktop', 'agent-manager', 'software-settings.json'), 'utf8').includes('fixture-key-')) throw new Error('Source key persisted in plaintext')
  await capture('settings-sources-dark.png')
  await page.locator('.model-source button').first().click()
  if (await page.locator('#source-key').inputValue()) throw new Error('Source editor exposed a saved key')
  await page.locator('#source-name').fill('Renamed source')
  await page.locator('#source-form [type=submit]').click()
  await page.locator('#source-form').waitFor({ state: 'hidden' })
  const first = sources.modelSources[0]!
  const keyMetadata = await hostRead('credentials/describe', { refs: [sourceKeyRef(first.id)] }) as Array<Record<string, { configured: boolean }>>
  if (keyMetadata.some(info => !info[sourceKeyRef(first.id)]?.configured)) throw new Error('Blank replacement removed the saved source key')
  await invoke('close', { id: configs[0]!.id })
  await page.locator('.model-source').first().locator('button').nth(1).click()
  await page.locator('.model-source').first().locator('button').nth(1).click()
  await page.waitForFunction(() => document.querySelectorAll('.model-source').length === 2)
  await invoke('open', { id: configs[0]!.id })
  const afterRemoval = await hostRead('llm/listProviders') as typeof providerLists
  if (afterRemoval.some(providers => providers.some(provider => provider.id === sourceRoute(first.id)))) throw new Error('Deleted source survived reconnection')
  const deletedKey = await hostRead('credentials/describe', { refs: [sourceKeyRef(first.id)] }) as typeof keyMetadata
  if (deletedKey.some(info => info[sourceKeyRef(first.id)]?.configured)) throw new Error('Deleted source key survived reconnection')
  await invoke('overlay', { visible: true })
  await page.locator('#standalone-keys summary').click()
  await page.locator('#api-key-ref').fill('MANAGER_SMOKE_API_KEY')
  await page.locator('#api-key-ref').press('Tab')
  await page.locator('#api-key-value').fill('fixture-only-manager-smoke-key')
  await page.locator('#api-key-form [type=submit]').click()
  await page.waitForFunction(() => !document.querySelector<HTMLButtonElement>('#key-remove')!.disabled && !document.querySelector<HTMLInputElement>('#api-key-value')!.value)
  const metadata = await hostRead('credentials/describe', { refs: ['MANAGER_SMOKE_API_KEY'] }) as Array<Record<string, { configured: boolean }>>
  if (metadata.length !== 2 || metadata.some(item => !item.MANAGER_SMOKE_API_KEY?.configured)) throw new Error('Software key did not reach both instances')
  if (readFileSync(join(home, 'desktop', 'agent-manager', 'software-settings.json'), 'utf8').includes('fixture-only-manager-smoke-key')) throw new Error('Software stored a plaintext key')
  if (JSON.stringify(await invoke('softwareSettings', { action: 'read' })).includes('fixture-only-manager-smoke-key')) throw new Error('Software exposed a key in metadata')
  await capture('settings-keys.png')
  await invoke('close', { id: configs[0]!.id })
  await invoke('softwareSettings', { action: 'credentialRemove', input: { ref: 'MANAGER_SMOKE_API_KEY' } })
  await invoke('open', { id: configs[0]!.id })
  const removed = await hostRead('credentials/describe', { refs: ['MANAGER_SMOKE_API_KEY'] }) as Array<Record<string, { configured: boolean }>>
  if (removed.some(item => item.MANAGER_SMOKE_API_KEY?.configured)) throw new Error('Offline instance did not inherit credential removal')
  await invoke('overlay', { visible: true })
  await page.locator('[data-settings-tab=general]').click()
  await page.locator('[data-settings-tab=advanced]').click()
  if (await page.locator('#settings-instance, [data-native-section]').count()) throw new Error('DSH preferences still require instance navigation')
  await page.locator('#dsh-transcriptView').selectOption('normal')
  await page.locator('#dsh-modeSelectionEnabled').uncheck()
  await page.locator('#dsh-deepseekMaxTokens').fill('8192')
  await page.locator('#dsh-settings-form [type=submit]').click()
  await page.waitForFunction(() => !document.querySelector<HTMLInputElement>('#dsh-deepseekMaxTokens')!.disabled
    && document.querySelector('#dsh-save-status')!.textContent?.startsWith('Saved.'))
  const dshState = await invoke('softwareSettings', { action: 'read' }) as SoftwareSettingsSnapshot & { syncErrors: Record<string, string> }
  if (Object.keys(dshState.syncErrors).length) throw new Error(`DSH override failed: ${JSON.stringify(dshState.syncErrors)}`)
  const overridden = await hostRead('settings/describe') as Array<{ namespaces: Array<{ ns: string; value: Record<string, unknown> }> }>
  if (overridden.length !== 2) throw new Error('DSH overrides did not reach two instances')
  for (const doc of overridden) {
    if (doc.namespaces.find(item => item.ns === 'ui-chat')?.value.transcriptView !== 'normal'
      || doc.namespaces.find(item => item.ns === 'agent-presets')?.value.modeSelectionEnabled !== false
      || doc.namespaces.find(item => item.ns === 'llm-deepseek')?.value.maxTokens !== 8192) {
      throw new Error('Instance values did not match the software DSH settings')
    }
  }
  await capture('settings-dsh.png')
  await invoke('close', { id: configs[0]!.id })
  await invoke('softwareSettings', { action: 'dshUpdate', input: { value: { ...dshState.dsh, deepseekMaxTokens: 4096 } } })
  await invoke('open', { id: configs[0]!.id })
  const reconnected = await hostRead('settings/describe') as typeof overridden
  if (reconnected.some(doc => doc.namespaces.find(item => item.ns === 'llm-deepseek')?.value.maxTokens !== 4096)) {
    throw new Error('Offline instance did not inherit software DSH overrides on reconnection')
  }
  await invoke('overlay', { visible: false })
  await electron.evaluate(({ webContents }: typeof import('electron')) => {
    const target = webContents.getAllWebContents().find(item => item.getURL().startsWith('dsh-app://app/'))!
    target.focus()
    target.sendInputEvent({ type: 'keyDown', keyCode: 'S', modifiers: ['control', 'alt'] })
    target.sendInputEvent({ type: 'keyUp', keyCode: 'S', modifiers: ['control', 'alt'] })
  })
  await page.waitForFunction(() => !document.querySelector<HTMLElement>('#settings-page')!.hidden && document.querySelector<HTMLElement>('#settings-page')!.getBoundingClientRect().height > 0)
  await page.locator('[data-settings-tab=general]').click()
  await page.reload()
  await page.locator('#settings').click()
  await page.locator('[data-settings-tab=appearance]').click()
  await page.waitForFunction(() => !document.querySelector<HTMLSelectElement>('#theme')!.disabled && document.querySelector<HTMLSelectElement>('#theme')!.value === 'dark')
  await page.locator('#theme').selectOption('light')
  await page.waitForFunction(() => !document.querySelector<HTMLSelectElement>('#theme')!.disabled && document.documentElement.dataset.theme === 'light')
  await page.locator('#settings').click()
  await page.locator('[data-settings-tab=instances]').click()
  if (packagedExecutable) {
    await page.evaluate(async (id: string) => { await (window as unknown as { dshManager: { invoke: (operation: string, args: unknown) => Promise<unknown> } }).dshManager.invoke('disablePlugins', { id }) }, configs[0]!.id)
    await page.evaluate(async (id: string) => { await (window as unknown as { dshManager: { invoke: (operation: string, args: unknown) => Promise<unknown> } }).dshManager.invoke('reset', { id }) }, configs[0]!.id)
    const states: ManagerSnapshot = await page.evaluate(async () => (window as unknown as { dshManager: { invoke: (operation: string) => Promise<ManagerSnapshot> } }).dshManager.invoke('snapshot'))
    if (Object.values(states.statuses).some(status => status.connection !== 'connected')) throw new Error('Profile recovery disrupted another instance')
  }
  await page.evaluate(async (id: string) => { await (window as unknown as { dshManager: { invoke: (operation: string, args: unknown) => Promise<unknown> } }).dshManager.invoke('close', { id }) }, configs[0]!.id)
  const retained: ManagerSnapshot = await page.evaluate(async () => (window as unknown as { dshManager: { invoke: (operation: string) => Promise<ManagerSnapshot> } }).dshManager.invoke('snapshot'))
  if (retained.statuses[configs[0]!.id]?.process !== 'running') throw new Error('Closing a tab stopped its local process')
  for (const config of configs) await page.evaluate(async (id: string) => { await (window as unknown as { dshManager: { invoke: (operation: string, args: unknown) => Promise<unknown> } }).dshManager.invoke('stop', { id }) }, config.id)
  writeFileSync(join(output, 'result.json'), JSON.stringify({ home, instances: configs.map(config => config.id), result: 'two local Hosts connected; closed tab retained its process; both stopped' }, null, 2))
  console.log(`Manager smoke passed: ${output}`)
} finally {
  await electron.evaluate(({ dialog }: typeof import('electron')) => { dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false }) })
  await electron.close()
}

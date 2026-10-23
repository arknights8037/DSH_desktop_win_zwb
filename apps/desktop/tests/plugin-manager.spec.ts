import { readFileSync } from 'node:fs'
import { runInContext } from 'node:vm'
import { JSDOM } from 'jsdom'
import { expect, it, vi } from 'vitest'
import { resolveDesktopLocale } from '../src/locale.ts'

it.each(['en', 'zh-CN'])('injects an installed shell version into the selected SSH instance in %s', async (language) => {
  const dom = new JSDOM(readFileSync(new URL('../renderer/plugin-manager.html', import.meta.url), 'utf8'), { runScripts: 'outside-only' })
  const locale = resolveDesktopLocale(language)
  const targets = [{ id: 'offline', name: '<offline>', kind: 'local', available: false },
    { id: 'remote', name: 'Linux', kind: 'ssh', available: true }, { id: 'local', name: 'Windows', kind: 'local', available: true }]
  const inject = vi.fn(async () => {})
  const remove = vi.fn(async () => {})
  const api = { locale: async () => locale, backend: { status: async () => ({ phase: 'ready' }) },
    plugins: { library: async () => ({ active: true, targets }), inject, remove,
      list: async () => [{ name: 'plugin', version: '1.2.3', enabled: true }],
      catalog: async () => ({ plugins: [], source: 'https://catalog.test/', categories: {} }),
    } }
  Object.defineProperty(dom.window, 'dshDesktop', { value: api })
  dom.window.confirm = () => true
  try {
    runInContext(readFileSync(new URL('../renderer/plugin-manager.js', import.meta.url), 'utf8'), dom.getInternalVMContext())
    const document = dom.window.document
    await expect.poll(() => document.querySelector('#plugins li')).not.toBeNull()
    expect(document.querySelector<HTMLSelectElement>('#target-instance')?.value).toBe('remote')
    expect(document.querySelector<HTMLOptionElement>('#target-instance option')?.disabled).toBe(true)
    expect(document.querySelector('#target-instance offline')).toBeNull()
    await expect(`${document.querySelector('#description')!.textContent}\n${document.querySelector('#target-hint')!.textContent}\n${document.querySelector('#plugins')!.textContent}\n`).toMatchFileSnapshot(`expected/plugin-library-${language}.txt`)
    document.querySelector<HTMLButtonElement>('[data-inject]')!.click()
    await expect.poll(() => inject.mock.calls).toEqual([['plugin', '1.2.3', 'remote']])
    await expect.poll(() => document.querySelector('#status')?.textContent).toBe(locale.messages.libraryOperationComplete)
    document.querySelectorAll<HTMLButtonElement>('#plugins li button')[1]!.click()
    await expect.poll(() => remove.mock.calls).toEqual([['plugin', '1.2.3']])
    await expect.poll(() => document.querySelector('#status')?.textContent).toBe(locale.messages.libraryOperationComplete)
  } finally { dom.window.close() }
})

it('keeps disabled packages visible and offers recovery without a running backend', async () => {
  const dom = new JSDOM(readFileSync(new URL('../renderer/plugin-manager.html', import.meta.url), 'utf8'), { runScripts: 'outside-only' })
  let enabled = true
  let ready = false
  const disableAll = vi.fn(async () => { enabled = false; ready = true })
  const toggle = vi.fn(async (_name: string, active: boolean) => { enabled = active })
  const api = {
    locale: async () => resolveDesktopLocale('en'),
    backend: { status: async () => ready ? { phase: 'ready' } : { phase: 'error', message: 'plugin requires Cordis ^2.0.0' }, retry: vi.fn() },
    plugins: { library: async () => ({ active: false, targets: [] }), list: async () => [{ name: 'example-plugin', version: '1.0.0', enabled }], disableAll, toggle,
      catalog: async () => ({ source: 'https://example.com/catalog', plugins: [], categories: {} }) },
  }
  Object.defineProperty(dom.window, 'dshDesktop', { value: api })
  try {
    runInContext(readFileSync(new URL('../renderer/plugin-manager.js', import.meta.url), 'utf8'), dom.getInternalVMContext())
    const document = dom.window.document
    await expect.poll(() => document.querySelector('#plugins li')?.textContent).toContain('example-plugin')
    expect(document.querySelector<HTMLElement>('#recovery')?.hidden).toBe(false)
    expect(document.querySelector<HTMLElement>('#install-form')?.hidden).toBe(true)
    expect(document.querySelector<HTMLElement>('#market')?.hidden).toBe(true)
    expect(document.querySelector('#startup-error')?.textContent).toBe('plugin requires Cordis ^2.0.0')
    document.querySelector<HTMLButtonElement>('#disable-all')?.click()
    await expect.poll(() => document.querySelector<HTMLElement>('#recovery')?.hidden).toBe(true)
    expect(disableAll).toHaveBeenCalledOnce()
    expect(document.querySelector('#plugins li')?.textContent).toMatchInlineSnapshot('"example-plugin1.0.0 · DisabledEnableRemove"')
    document.querySelector<HTMLButtonElement>('#plugins li button')?.click()
    await expect.poll(() => toggle.mock.calls).toEqual([['example-plugin', true]])
    await expect.poll(() => document.querySelector('#plugins li')?.textContent).toBe('example-plugin1.0.0DisableRemove')
    await expect.poll(() => document.querySelector('#status')?.textContent).toBe('Done. The Desktop backend has restarted.')
  } finally { dom.window.close() }
})

it.each(['en', 'zh-CN'])('searches the catalog, reviews metadata and installs only the approved plan in %s', async (language) => {
  const dom = new JSDOM(readFileSync(new URL('../renderer/plugin-manager.html', import.meta.url), 'utf8'), { runScripts: 'outside-only' })
  const locale = resolveDesktopLocale(language)
  const plugin = { name: 'Useful', npm: '@test/plugin', owner: 'Example', repository: 'https://github.com/example/plugin', categories: ['usage'], description: { en: 'Token meter', zh: '回合计价器' }, capabilities: ['network'] }
  const plan = { id: 'approved-exact-version', name: '@test/plugin', version: '1.2.3', description: '<img src=x onerror=alert(1)>', source: 'npm',
    license: 'MIT', repository: plugin.repository, compatibility: 'unknown', requirements: [], blockers: [], scripts: [], snapshotPath: 'profile-snapshot', requiresRestart: true }
  const api = {
    locale: async () => locale, backend: { status: async () => ({ phase: 'ready' }) },
    plugins: { library: async () => ({ active: true, targets: [] }), list: async () => [], catalog: vi.fn(async () => ({ source: 'https://example.com/catalog', categories: {}, plugins: [plugin,
      { ...plugin, name: 'Git only', npm: undefined, description: { en: 'Git example', zh: 'Git 示例' } }] })),
    plan: vi.fn(async () => plan), add: vi.fn(async () => {}) },
  }
  Object.defineProperty(dom.window, 'dshDesktop', { value: api })
  try {
    runInContext(readFileSync(new URL('../renderer/plugin-manager.js', import.meta.url), 'utf8'), dom.getInternalVMContext())
    const document = dom.window.document
    await expect.poll(() => document.querySelectorAll('#catalog li').length).toBe(2)
    expect(document.querySelector<HTMLButtonElement>('#catalog li:last-child button')?.disabled).toBe(true)
    const query = document.querySelector<HTMLInputElement>('#search-query')!
    query.value = language === 'en' ? 'token' : '计价'
    query.dispatchEvent(new dom.window.Event('input'))
    expect(document.querySelectorAll('#catalog li')).toHaveLength(1)
    document.querySelector<HTMLButtonElement>('#catalog li button')!.click()
    await expect.poll(() => document.querySelector<HTMLElement>('#install-plan')!.hidden).toBe(false)
    expect(api.plugins.plan).toHaveBeenCalledWith('@test/plugin')
    expect(api.plugins.add).not.toHaveBeenCalled()
    expect(document.querySelector('#install-plan img')).toBeNull()
    expect(document.querySelector('#plan-fields')?.textContent).toContain('MIT')
    expect(document.querySelector('#plan-fields')?.textContent).toContain(locale.messages.unknown)
    expect(document.querySelector('#plan-fields')?.textContent).toContain('network')
    expect(document.querySelector('#plan-fields')?.textContent).toContain('profile-snapshot')
    expect(Array.from(document.querySelectorAll('#plan-fields dt, #plan-fields dd'), element => element.textContent))
      .toMatchSnapshot(`install details ${language}`)
    document.querySelector<HTMLButtonElement>('#cancel-install')!.click()
    expect(document.querySelector('#status')?.textContent).toBe(locale.messages.installCancelled)
    expect(api.plugins.add).not.toHaveBeenCalled()
    document.querySelector<HTMLButtonElement>('#catalog li button')!.click()
    await expect.poll(() => document.querySelector<HTMLButtonElement>('#confirm-install')!.disabled).toBe(false)
    document.querySelector<HTMLButtonElement>('#confirm-install')!.click()
    await expect.poll(() => document.querySelector('#status')?.textContent).toBe(locale.messages.libraryOperationComplete)
    expect(api.plugins.add.mock.calls).toEqual([['approved-exact-version']])
    expect(document.querySelector<HTMLButtonElement>('#confirm-install')!.disabled).toBe(true)
  } finally { dom.window.close() }
})

it('blocks packages without bundles and shows catalog failure with a working retry', async () => {
  const dom = new JSDOM(readFileSync(new URL('../renderer/plugin-manager.html', import.meta.url), 'utf8'), { runScripts: 'outside-only' })
  const api = {
    locale: async () => resolveDesktopLocale('en'), backend: { status: async () => ({ phase: 'ready' }) },
    plugins: { library: async () => ({ active: true, targets: [] }), list: async () => [], catalog: vi.fn().mockRejectedValueOnce(new Error('network unavailable')).mockResolvedValue({ plugins: [], categories: {}, source: 'https://example.com/catalog' }),
      plan: async () => ({ id: 'blocked', name: 'bad', version: '1.0.0', compatibility: 'incompatible', blockers: ['missing-bundle'], requirements: [{ name: 'dsh', range: '^9', actual: '1', status: 'incompatible' }], scripts: [], snapshotPath: 'snapshot' }), add: vi.fn() },
  }
  Object.defineProperty(dom.window, 'dshDesktop', { value: api })
  try {
    runInContext(readFileSync(new URL('../renderer/plugin-manager.js', import.meta.url), 'utf8'), dom.getInternalVMContext())
    const document = dom.window.document
    await expect.poll(() => document.querySelector('#catalog-status')?.textContent).toContain('network unavailable')
    document.querySelector<HTMLButtonElement>('#catalog-refresh')!.click()
    await expect.poll(() => document.querySelector('#catalog-status')?.textContent).toBe('0 matching plugins · 0 total')
    document.querySelector<HTMLInputElement>('#package-spec')!.value = 'bad'
    document.querySelector('#install-form')!.dispatchEvent(new dom.window.Event('submit', { cancelable: true }))
    await expect.poll(() => document.querySelector<HTMLElement>('#install-plan')!.hidden).toBe(false)
    expect(document.querySelector<HTMLButtonElement>('#confirm-install')!.disabled).toBe(true)
    document.querySelector<HTMLButtonElement>('#confirm-install')!.click()
    expect(api.plugins.add).not.toHaveBeenCalled()
  } finally { dom.window.close() }
})

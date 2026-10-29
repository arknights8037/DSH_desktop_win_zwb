import { readFileSync } from 'node:fs'
import { runInContext } from 'node:vm'
import { JSDOM } from 'jsdom'
import { expect, it, vi } from 'vitest'
import { resolveDesktopLocale } from '../src/locale.ts'

it.each(['en', 'zh-CN'])('filters market entries, locates retained versions, and retries a failed latest-version review in %s', async (language) => {
  const dom = new JSDOM(readFileSync(new URL('../renderer/plugin-manager.html', import.meta.url), 'utf8'), { runScripts: 'outside-only' })
  const document = dom.window.document
  const locale = resolveDesktopLocale(language)
  const entry = { name: 'Meter', npm: 'meter', owner: 'Example', categories: ['usage'], description: { en: 'Costs', zh: '费用' }, repository: 'https://example.com/meter' }
  const plan = { id: 'next', name: 'meter', version: '1.4.0', compatibility: 'unknown', requirements: [], blockers: [], scripts: [] }
  const api = { locale: async () => locale, backend: { status: async () => ({ phase: 'ready' }) }, plugins: {
    library: async () => ({ active: true, targets: [] }),
    list: async () => [{ name: 'meter', version: '1.2.3', enabled: true }, { name: 'meter', version: '1.3.0', enabled: true }],
    catalog: async () => ({ source: 'https://catalog.test/', plugins: [entry, { ...entry, name: 'Other', npm: 'other' }, { ...entry, name: 'Git', npm: undefined }] }),
    plan: vi.fn().mockRejectedValueOnce(new Error('registry offline')).mockResolvedValue(plan),
  } }
  Object.defineProperty(dom.window, 'dshDesktop', { value: api })
  try {
    runInContext(readFileSync(new URL('../renderer/plugin-manager.js', import.meta.url), 'utf8'), dom.getInternalVMContext())
    await expect.poll(() => document.querySelectorAll('#catalog li').length).toBe(3)
    expect(document.querySelector('#installed-count')!.textContent).toBe('2')
    expect(document.querySelector('.plugin-badge')!.textContent).toBe(locale.messages.inLibrary)
    const libraryQuery = document.querySelector<HTMLInputElement>('#library-search')!
    libraryQuery.value = '1.3.0'
    libraryQuery.dispatchEvent(new dom.window.Event('input'))
    expect(document.querySelectorAll('#plugins li')).toHaveLength(1)
    libraryQuery.value = 'missing'
    libraryQuery.dispatchEvent(new dom.window.Event('input'))
    expect(document.querySelector('#empty')!.textContent).toBe(locale.messages.noLibraryMatches)
    document.querySelector<HTMLButtonElement>('[data-catalog-filter=npm]')!.click()
    expect(document.querySelectorAll('#catalog li')).toHaveLength(2)
    document.querySelector<HTMLButtonElement>('[data-catalog-filter=library]')!.click()
    expect(document.querySelectorAll('#catalog li')).toHaveLength(1)
    document.querySelector<HTMLButtonElement>('#catalog li button')!.click()
    expect(libraryQuery.value).toBe('')
    expect(document.activeElement?.getAttribute('data-package')).toBe('meter')
    const query = document.querySelector<HTMLInputElement>('#search-query')!
    query.value = 'missing'
    query.dispatchEvent(new dom.window.Event('input'))
    expect(document.querySelector<HTMLElement>('#catalog-empty')!.hidden).toBe(false)
    document.querySelector<HTMLButtonElement>('#search-clear')!.click()
    expect(document.querySelectorAll('#catalog li')).toHaveLength(3)
    expect(document.querySelector('[data-catalog-filter=all]')!.getAttribute('aria-pressed')).toBe('true')
    document.querySelectorAll<HTMLButtonElement>('#catalog li:first-child button')[1]!.click()
    await expect.poll(() => document.querySelector('#status')!.textContent).toContain('registry offline')
    expect(document.querySelector<HTMLElement>('#status')!.dataset.tone).toBe('error')
    expect(document.querySelector('.plugin-columns')!.getAttribute('aria-busy')).toBe('false')
    document.querySelectorAll<HTMLButtonElement>('#catalog li:first-child button')[1]!.click()
    await expect.poll(() => document.querySelector<HTMLElement>('#install-plan')!.hidden).toBe(false)
    expect(api.plugins.plan.mock.calls).toEqual([['meter'], ['meter']])
    expect(document.querySelector('#plan-heading')!.textContent).toBe('meter@1.4.0')
    document.querySelector<HTMLButtonElement>('#cancel-install')!.click()
    expect(document.activeElement).toBe(query)
    libraryQuery.focus()
    libraryQuery.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true, cancelable: true }))
    expect(document.activeElement).toBe(query)
    await expect(Array.from(document.querySelectorAll('[data-catalog-filter], .plugin-badge, #catalog li:first-child button, #manual-install-label, #plan-advanced-label'), node => node.textContent).join('\n') + '\n')
      .toMatchFileSnapshot(`expected/plugin-workspace-actions-${language}.txt`)
  } finally { dom.window.close() }
})

it('requires an explicit target choice when the selected instance becomes unavailable', async () => {
  const dom = new JSDOM(readFileSync(new URL('../renderer/plugin-manager.html', import.meta.url), 'utf8'), { runScripts: 'outside-only' })
  const document = dom.window.document
  const targets = [{ id: 'a', name: 'A', kind: 'local', available: true }, { id: 'b', name: 'B', kind: 'ssh', available: true }]
  const api = { locale: async () => resolveDesktopLocale('en'), backend: { status: async () => ({ phase: 'ready' }) }, plugins: {
    library: async () => ({ active: true, targets }), list: async () => [{ name: 'meter', version: '1.2.3', enabled: true }],
    catalog: async () => ({ source: 'https://catalog.test/', plugins: [] }), inject: vi.fn(),
  } }
  Object.defineProperty(dom.window, 'dshDesktop', { value: api })
  try {
    runInContext(readFileSync(new URL('../renderer/plugin-manager.js', import.meta.url), 'utf8'), dom.getInternalVMContext())
    await expect.poll(() => document.querySelectorAll('#plugins li').length).toBe(1)
    const target = document.querySelector<HTMLSelectElement>('#target-instance')!
    target.value = 'b'
    target.dispatchEvent(new dom.window.Event('change'))
    expect(document.querySelector<HTMLButtonElement>('[data-inject]')!.title).toBe('Apply to B')
    targets[1]!.available = false
    document.querySelector<HTMLButtonElement>('#refresh')!.click()
    await expect.poll(() => document.querySelector('#status')!.textContent).toBe('Plugin list refreshed.')
    expect(target.value).toBe('')
    expect(document.querySelector<HTMLButtonElement>('[data-inject]')!.disabled).toBe(true)
    document.querySelector<HTMLButtonElement>('[data-inject]')!.click()
    expect(api.plugins.inject).not.toHaveBeenCalled()
    target.value = 'a'
    target.dispatchEvent(new dom.window.Event('change'))
    expect(document.querySelector<HTMLButtonElement>('[data-inject]')!.disabled).toBe(false)
    expect(document.querySelector<HTMLButtonElement>('[data-inject]')!.title).toBe('Apply to A')
  } finally { dom.window.close() }
})

it.each(['en', 'zh-CN'])('keeps settings navigation usable during inline review and retries a failed market in %s', async (language) => {
  const dom = new JSDOM('<title>Settings</title><button id="navigation">Settings</button><p id="status">Shell status</p><div id="workspace"></div>', { runScripts: 'outside-only' })
  const document = dom.window.document
  const locale = resolveDesktopLocale(language)
  const reply = Promise.withResolvers<object>()
  const entry = { name: 'Meter', npm: 'dsh-cost-meter', owner: 'Community', repository: 'https://github.com/example/meter', categories: ['usage'], description: { en: 'Token costs', zh: '费用统计' } }
  const catalog = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ source: 'https://catalog.test/', plugins: [entry] })
  let installed = false
  const add = vi.fn(async () => { installed = true })
  const api = { locale: async () => locale, backend: { status: async () => ({ phase: 'ready' }) },
    plugins: { library: async () => ({ active: true, targets: [] }), catalog, plan: vi.fn(() => reply.promise), add,
      list: async () => installed ? [{ name: entry.npm, version: '1.2.3', enabled: true }] : [] } }
  try {
    runInContext(readFileSync(new URL('../renderer/plugin-manager.js', import.meta.url), 'utf8'), dom.getInternalVMContext())
    const mount = runInContext('window.mountPluginManager', dom.getInternalVMContext()) as (root: Element, api: unknown, prefix: string) => Promise<unknown>
    await mount(document.querySelector('#workspace')!, api, 'library-')
    const deployments = document.createElement('div')
    deployments.dataset.instanceDeployments = ''
    deployments.innerHTML = '<button disabled>Offline instance</button>'
    document.querySelector('.plugin-management')!.append(deployments)
    await expect.poll(() => document.querySelector('#library-catalog-status')?.textContent).toContain('offline')
    document.querySelector<HTMLButtonElement>('#library-catalog-refresh')!.click()
    await expect.poll(() => document.querySelectorAll('#library-catalog li').length).toBe(1)
    const query = document.querySelector<HTMLInputElement>('#library-search-query')!
    query.value = language === 'en' ? 'costs' : '费用'
    query.dispatchEvent(new dom.window.Event('input'))
    expect(document.querySelectorAll('#library-catalog li')).toHaveLength(1)
    document.querySelector<HTMLButtonElement>('#library-catalog li button')!.click()
    expect(document.querySelector<HTMLButtonElement>('#library-search-submit')!.disabled).toBe(false)
    query.value = 'no matching plugin'
    query.dispatchEvent(new dom.window.Event('input'))
    expect(document.querySelector<HTMLElement>('#library-catalog-empty')!.hidden).toBe(false)
    document.querySelector<HTMLButtonElement>('#library-search-clear')!.click()
    expect(document.querySelector<HTMLButtonElement>('#library-catalog li button')!.disabled).toBe(true)
    expect(api.plugins.plan).toHaveBeenCalledOnce()
    expect(document.querySelector<HTMLButtonElement>('#navigation')!.disabled).toBe(false)
    expect(document.querySelector('#status')!.textContent).toBe('Shell status')
    expect(document.title).toBe('Settings')
    reply.resolve({ id: 'reviewed', name: entry.npm, version: '1.2.3', compatibility: 'unknown', blockers: [], requirements: [], scripts: [], snapshotPath: 'library' })
    await expect.poll(() => document.querySelector<HTMLButtonElement>('#library-confirm-install')!.disabled).toBe(false)
    expect(deployments.querySelector('button')!.disabled).toBe(true)
    await expect(Array.from(document.querySelectorAll('.plugin-column-heading h2, .plugin-installed h2, #library-search-label, #library-category-label, #library-confirm-install'), node => node.textContent).join('\n') + '\n')
      .toMatchFileSnapshot(`expected/plugin-workspace-${language}.txt`)
    document.querySelector<HTMLButtonElement>('#library-confirm-install')!.click()
    await expect.poll(() => document.querySelector('#library-status')?.textContent).toBe(locale.messages.libraryOperationComplete)
    expect(add.mock.calls).toEqual([['reviewed']])
    expect(document.querySelector('.plugin-management #library-plugins')!.textContent).toContain(entry.npm)
    expect(document.querySelector<HTMLButtonElement>('[data-inject]')!.disabled).toBe(true)
    expect(deployments.querySelector('button')!.disabled).toBe(true)
  } finally { dom.window.close() }
})

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
    expect(document.querySelector<HTMLOptionElement>('#target-instance option[value=offline]')?.disabled).toBe(true)
    expect(document.querySelector('#target-instance offline')).toBeNull()
    await expect(`${document.querySelector('#installed-heading')!.textContent}\n${document.querySelector('#target-label')!.textContent}\n${document.querySelector('#plugins')!.textContent}\n`).toMatchFileSnapshot(`expected/plugin-library-${language}.txt`)
    document.querySelector<HTMLButtonElement>('[data-inject]')!.click()
    await expect.poll(() => inject.mock.calls).toEqual([['plugin', '1.2.3', 'remote']])
    await expect.poll(() => document.querySelector('#status')?.textContent).toBe(locale.messages.appliedToTarget.replace('{name}', 'plugin').replace('{version}', '1.2.3').replace('{target}', 'Linux'))
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
    expect(document.querySelector('#plan-description')).toBeNull()
    expect(document.querySelector('.plugin-card-description')).toBeNull()
    expect(document.querySelector('#plan-fields')?.textContent).toContain('MIT')
    expect(document.querySelector('#plan-fields')?.textContent).toContain(locale.messages.unknown)
    expect(document.querySelector('#plan-fields')?.textContent).toContain('network')
    expect(document.querySelector('#plan-advanced-fields')?.textContent).toContain('profile-snapshot')
    expect(Array.from(document.querySelectorAll('#plan-fields dt, #plan-fields dd, #plan-advanced-fields dt, #plan-advanced-fields dd'), element => element.textContent))
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

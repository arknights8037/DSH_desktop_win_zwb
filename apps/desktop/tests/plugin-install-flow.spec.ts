import { readFileSync } from 'node:fs'
import { runInContext } from 'node:vm'
import { JSDOM } from 'jsdom'
import { expect, it, vi } from 'vitest'
import { resolveDesktopLocale } from '../src/locale.ts'

async function workspace() {
  const dom = new JSDOM('<div id="workspace"></div>', { runScripts: 'outside-only' })
  let target = 'a'
  const targets = [{ id: 'a', name: 'Workspace A', available: true }, { id: 'b', name: 'Workspace B', available: true }]
  const add = vi.fn(async () => {})
  const inject = vi.fn(async () => {})
  const cancel = vi.fn(async () => {})
  const installed = vi.fn(async () => {})
  const api = { locale: async () => resolveDesktopLocale('en'), backend: { status: async () => ({ phase: 'ready' }) }, plugins: {
    library: async () => ({ active: true, targets }), list: async () => [],
    catalog: async () => ({ source: 'fixture', plugins: [] }),
    plan: vi.fn(async () => ({ id: 'reviewed', name: 'plugin', version: '2.0.0', compatibility: 'compatible', blockers: [], requirements: [], scripts: [] })),
    add, inject, cancel,
  } }
  runInContext(readFileSync(new URL('../renderer/plugin-manager.js', import.meta.url), 'utf8'), dom.getInternalVMContext())
  const root = dom.window.document.querySelector<HTMLElement>('#workspace')!
  const mount = runInContext('window.mountPluginManager', dom.getInternalVMContext())
  const panel = await mount(root, api, 'test-', { target: () => target, installed })
  const review = () => {
    root.querySelector<HTMLInputElement>('#test-package-spec')!.value = 'plugin'
    root.querySelector('form#test-install-form')!.dispatchEvent(new dom.window.Event('submit', { cancelable: true }))
  }
  return { dom, root, api, panel, review, add, inject, cancel, installed, targets, setTarget: (id: string) => { target = id } }
}

it('confirms one install and applies the reviewed version to its named instance', async () => {
  const w = await workspace()
  try {
    w.review()
    await expect.poll(() => w.root.querySelector<HTMLElement>('#test-install-plan')!.hidden).toBe(false)
    expect(w.root.querySelector('#test-plan-destination')!.textContent).toBe('Install to Workspace A')
    expect(w.add).not.toHaveBeenCalled()
    // The displayed confirmation owns the destination even if another event changes selection.
    w.setTarget('b')
    w.root.querySelector<HTMLButtonElement>('#test-confirm-install')!.click()
    await expect.poll(() => w.installed.mock.calls).toEqual([['a']])
    expect(w.add.mock.calls).toEqual([['reviewed']])
    expect(w.inject.mock.calls).toEqual([['plugin', '2.0.0', 'a']])
  } finally { w.dom.window.close() }
})

it('can cancel a pending plugin installation from the loading surface', async () => {
  const w = await workspace()
  const pending = Promise.withResolvers<void>()
  w.add.mockReturnValueOnce(pending.promise)
  try {
    w.review()
    await expect.poll(() => w.root.querySelector<HTMLElement>('#test-install-plan')!.hidden).toBe(false)
    w.root.querySelector<HTMLButtonElement>('#test-confirm-install')!.click()
    await expect.poll(() => w.root.querySelector<HTMLElement>('#test-plugin-cancel')!.hidden).toBe(false)
    expect(w.root.querySelector<HTMLButtonElement>('#test-plugin-cancel')!.disabled).toBe(false)
    w.root.querySelector<HTMLButtonElement>('#test-plugin-cancel')!.click()
    expect(w.cancel).toHaveBeenCalledOnce()
    pending.resolve(undefined)
    await expect.poll(() => w.root.querySelector<HTMLElement>('#test-plugin-loading')!.hidden).toBe(true)
  } finally { w.dom.window.close() }
})

it('keeps errors visible and can review again after deployment fails', async () => {
  const w = await workspace()
  try {
    w.inject.mockRejectedValueOnce(new Error('instance could not restart'))
    w.review()
    await expect.poll(() => w.root.querySelector<HTMLElement>('#test-install-plan')!.hidden).toBe(false)
    w.root.querySelector<HTMLButtonElement>('#test-confirm-install')!.click()
    await expect.poll(() => w.root.querySelector('#test-status')!.textContent).toContain('instance could not restart')
    expect(w.installed).not.toHaveBeenCalled()
    w.review()
    await expect.poll(() => w.api.plugins.plan.mock.calls.length).toBe(2)
    await expect.poll(() => w.root.querySelector<HTMLButtonElement>('#test-confirm-install')!.disabled).toBe(false)
  } finally { w.dom.window.close() }
})

it('blocks an unavailable target and supports library-only selection when no instance exists', async () => {
  const w = await workspace()
  try {
    w.targets[0]!.available = false
    w.review()
    await expect.poll(() => w.root.querySelector('#test-status')!.textContent).toBe('Open instance first')
    expect(w.api.plugins.plan).not.toHaveBeenCalled()
    w.setTarget('')
    w.review()
    await expect.poll(() => w.root.querySelector<HTMLElement>('#test-install-plan')!.hidden).toBe(false)
    expect(w.root.querySelector('#test-plan-destination')!.textContent).toBe('Add to plugin library')
    w.root.querySelector<HTMLButtonElement>('#test-confirm-install')!.click()
    await expect.poll(() => w.add.mock.calls.length).toBe(1)
    expect(w.inject).not.toHaveBeenCalled()
  } finally { w.dom.window.close() }
})

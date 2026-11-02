import type { Context } from '@deepseek-ai/cordis'
import { JSDOM } from 'jsdom'
import { expect, it, vi } from 'vitest'
import { installNativePluginPanel } from '../../desktop-host/src/native-plugin-panel.ts'

it('embeds the native page, filters installed packages and restores the previous panel on exit', async () => {
  const dom = new JSDOM('<html><head></head><body><section data-plugin-panel><section data-plugin-group="basic"><li data-plugin-item="terminal">Terminal settings</li></section><section data-plugin-group="bundles"><li data-plugin-package="meter">Cost meter</li></section></section></body></html>')
  vi.stubGlobal('document', dom.window.document)
  let activePanelId: string | null = null
  const unsubscribe = vi.fn()
  let dispose!: () => void
  const layout = {
    panelInfo: { getSnapshot: () => ({ activePanelId }), subscribe: () => unsubscribe },
    selectPanel: (id: string | null) => { activePanelId = id },
  }
  const ctx = { get: (name: string) => name === 'layout' ? layout : {},
    effect: (setup: () => () => void) => { dispose = setup() }, logger: { warn: vi.fn() } }
  try {
    installNativePluginPanel(ctx as unknown as Context)
    const target = globalThis as typeof globalThis & { __DSH_NATIVE_PLUGINS__?: { show(packageName?: string): void; hide(): void } }
    target.__DSH_NATIVE_PLUGINS__!.show('meter')
    expect(activePanelId).toBe('plugins')
    expect(document.documentElement.hasAttribute('data-desktop-plugin-panel')).toBe(true)
    expect(document.head.textContent).toContain('grid-column: 2')
    expect(document.querySelector('[data-plugin-package="meter"]')!.hasAttribute('data-desktop-plugin-focused')).toBe(true)
    const search = document.querySelector<HTMLInputElement>('.desktop-plugin-toolbar input')!
    search.value = 'meter'
    search.dispatchEvent(new dom.window.Event('input'))
    expect(document.querySelector('[data-plugin-item]')!.hasAttribute('data-desktop-filtered')).toBe(true)
    expect(document.querySelector('[data-plugin-package]')!.hasAttribute('data-desktop-filtered')).toBe(false)
    search.value = ''; search.dispatchEvent(new dom.window.Event('input'))
    document.querySelector<HTMLButtonElement>('[data-filter="basic"]')!.click()
    expect(document.querySelector('[data-plugin-group="bundles"]')!.hasAttribute('data-desktop-filtered')).toBe(true)
    expect(document.querySelector('[data-plugin-group="basic"]')!.hasAttribute('data-desktop-filtered')).toBe(false)
    // Host updates can replace rows; the filter must remain active after reconciliation.
    const row = document.createElement('li'); row.dataset.pluginPackage = 'new'; row.textContent = 'New plugin'
    document.querySelector('[data-plugin-group="bundles"]')!.append(row)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(row.hasAttribute('data-desktop-filtered')).toBe(true)
    target.__DSH_NATIVE_PLUGINS__!.hide()
    expect(activePanelId).toBe(null)
    target.__DSH_NATIVE_PLUGINS__!.show()
    dispose()
    expect(activePanelId).toBe(null)
    expect(unsubscribe).toHaveBeenCalledOnce()
    expect(target.__DSH_NATIVE_PLUGINS__).toBeUndefined()
    expect(document.querySelector('.desktop-plugin-toolbar')).toBeNull()
    expect(document.querySelector('[data-desktop-filtered]')).toBeNull()
  } finally { vi.unstubAllGlobals(); dom.window.close() }
})

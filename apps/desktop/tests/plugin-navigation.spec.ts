/** Desktop navigation service supplied to the kernel's entry menus. */
import type { Context } from '@deepseek-ai/cordis'
import { expect, it, vi } from 'vitest'
import { installDesktopPluginNavigation } from '../../desktop-host/src/plugin-navigation.ts'

it('forwards both navigation methods and unregisters on client disposal', async () => {
  const dispose = vi.fn()
  const provide = vi.fn((_name: string, _navigation: { openList(): void; openBundle(name: string): void }) => dispose)
  const effects: (() => void)[] = []
  const ctx = { reflect: { provide }, effect: (setup: () => () => void) => { effects.push(setup()) }, logger: { warn: vi.fn() } }
  const openList = vi.fn(async () => {})
  const openBundle = vi.fn(async () => {})
  installDesktopPluginNavigation(ctx as unknown as Context, { openList, openBundle })
  expect(provide).toHaveBeenCalledWith('pluginNavigation', expect.any(Object))
  const navigation = provide.mock.calls[0]![1] as { openList(): void; openBundle(name: string): void }
  navigation.openList()
  navigation.openBundle('example-plugin')
  await Promise.resolve()
  expect(openList).toHaveBeenCalledOnce()
  expect(openBundle).toHaveBeenCalledWith('example-plugin')
  effects.forEach(disposeEffect => disposeEffect())
  expect(dispose).toHaveBeenCalledOnce()
})

it('reports rejected shell navigation without an unhandled rejection', async () => {
  let navigation!: { openList(): void }
  const warn = vi.fn()
  const ctx = { reflect: { provide: (_name: string, value: typeof navigation) => { navigation = value; return () => {} } },
    effect: (setup: () => () => void) => setup(), logger: { warn } }
  installDesktopPluginNavigation(ctx as unknown as Context, {
    openList: () => Promise.reject(new Error('window unavailable')),
    openBundle: () => Promise.resolve(),
  })
  navigation.openList()
  await Promise.resolve()
  expect(warn).toHaveBeenCalledWith('Desktop plugin navigation failed: %s', 'window unavailable')
})

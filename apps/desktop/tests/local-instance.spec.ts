import { expect, it, vi } from 'vitest'
import type { DesktopProjectHooks } from '../src/project-manager.ts'
const harness = vi.hoisted(() => ({ locked: false, prepares: 0, starts: 0, stops: 0 }))
vi.mock('../src/project-manager.ts', () => ({ DesktopProjectManager: class {
  async applyRelease() {
    if (harness.locked) throw new Error('another package transaction is active')
    harness.prepares++
  }
  assertProfileRuntime() {}
  async mutate(_mutation: unknown, hooks: DesktopProjectHooks) {
    harness.locked = true
    try { await hooks.beforeChange(); await hooks.afterChange() }
    finally { harness.locked = false }
  }
  async resetConfiguration(hooks: DesktopProjectHooks) { await this.mutate({}, hooks) }
} }))
vi.mock('../src/host-process.ts', () => ({ DesktopHostProcess: class {
  async start() { harness.starts++ }
  async stop() { harness.stops++ }
} }))
import { LocalInstance } from '../src/local-instance.ts'
it('restarts after plugin changes without recursively entering the held profile transaction', async () => {
  harness.locked = false; harness.prepares = 0; harness.starts = 0; harness.stops = 0
  const local = new LocalInstance('isolated-test-home', { node: 'node', pnpm: 'pnpm', dsh: 'runtime' }, undefined, () => {})
  await local.connect(new AbortController().signal)
  await local.mutate({ type: 'plugins-disable-all' })
  await local.mutate('reset')
  expect(harness.prepares).toBe(1)
  expect(harness.starts).toBe(3)
  expect(harness.stops).toBe(2)
  await local.stop()
})

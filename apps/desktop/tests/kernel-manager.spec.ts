import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { expect, it, onTestFinished, vi } from 'vitest'
import { DesktopKernelManager } from '../src/kernel-manager.ts'
import { runtimeFixture } from './runtime-fixture.ts'

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'desktop-kernels-'))
  onTestFinished(() => { rmSync(root, { recursive: true, force: true }) })
  const dsh = join(root, 'bundled')
  runtimeFixture(dsh, '0.1.6-alpha.1')
  const bundled = { node: process.execPath, pnpm: 'unused', dsh }
  const prepare = vi.fn(async (version: string, directory: string) => { runtimeFixture(directory, version) })
  const fetcher = vi.fn<typeof fetch>(async () => Response.json({ name: '@deepseek-ai/dsh', version: '0.2.1-rc.2' }))
  const manager = new DesktopKernelManager(root, bundled, prepare, fetcher)
  return { root, bundled, prepare, fetcher, manager }
}

it('publishes verified updates for the next launch without replacing the active kernel', async () => {
  const { root, bundled, prepare, fetcher, manager } = fixture()
  expect(await manager.check()).toMatchObject({ current: '0.1.6-alpha.1', available: '0.2.1-rc.2', phase: 'ready', restartRequired: true })
  expect(manager.runtime()).toBe(bundled)
  const next = new DesktopKernelManager(root, bundled, prepare, fetcher)
  expect(next.runtime().dsh).toBe(join(root, 'releases', '0.2.1-rc.2'))
  await next.initialize()
  expect(prepare).toHaveBeenLastCalledWith('0.2.1-rc.2', next.runtime().dsh)
})

it('keeps manual checks read-only and coalesces a concurrent install request', async () => {
  const { manager, fetcher, prepare } = fixture()
  manager.automatic(false)
  await manager.check()
  expect(prepare).not.toHaveBeenCalled()
  const response = Promise.withResolvers<Response>()
  fetcher.mockReturnValueOnce(response.promise)
  const check = manager.check()
  const install = manager.check(true)
  expect(check).toBe(install)
  response.resolve(Response.json({ name: '@deepseek-ai/dsh', version: '0.2.1-rc.2' }))
  await install
  expect(prepare).toHaveBeenCalledTimes(1)
})

it('retains the previous selection after download failure or a mismatched runtime', async () => {
  const { manager, prepare, root } = fixture()
  manager.automatic(false)
  const before = readFileSync(join(root, 'selection.json'), 'utf8')
  prepare.mockRejectedValueOnce(new Error('download interrupted'))
  expect(await manager.check(true)).toMatchObject({ phase: 'error', restartRequired: false, message: 'download interrupted' })
  expect(readFileSync(join(root, 'selection.json'), 'utf8')).toBe(before)
  prepare.mockImplementationOnce(async (_version, directory) => { runtimeFixture(directory, '0.2.0') })
  expect(await manager.check(true)).toMatchObject({ phase: 'error', restartRequired: false })
  expect(readFileSync(join(root, 'selection.json'), 'utf8')).toBe(before)
})

it.each(['../escape', '1.0.0/../../escape', 12])('rejects unsafe durable version %s', (selected) => {
  const { root, bundled, prepare, fetcher } = fixture()
  writeFileSync(join(root, 'selection.json'), JSON.stringify({ version: 1, selected, previous: null, automatic: true }))
  expect(() => new DesktopKernelManager(root, bundled, prepare, fetcher)).toThrow('Invalid desktop kernel selection')
})

it('rejects registry responses that name another package without preparing it', async () => {
  const { manager, fetcher, prepare } = fixture()
  fetcher.mockResolvedValueOnce(Response.json({ name: 'another-package', version: '99.0.0' }))
  expect(await manager.check(true)).toMatchObject({ phase: 'error', message: 'Invalid DSH release metadata' })
  expect(prepare).not.toHaveBeenCalled()
})

it('uses a newer bundled kernel when the shell installer advances past a selected release', async () => {
  const { root, manager, bundled, prepare, fetcher } = fixture()
  await manager.check(true)
  runtimeFixture(bundled.dsh, '0.3.0')
  const updated = new DesktopKernelManager(root, bundled, prepare, fetcher)
  expect(updated.runtime()).toBe(bundled)
  expect(updated.snapshot().current).toBe('0.3.0')
})

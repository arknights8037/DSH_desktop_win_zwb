import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, onTestFinished } from 'vitest'
import { verifyBundledRuntime } from '../scripts/verify-bundled-runtime.ts'
import { runtimeFixture } from './runtime-fixture.ts'

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'desktop-packaging-verification-'))
  onTestFinished(() => { rmSync(root, { recursive: true, force: true }) })
  const dsh = join(root, 'dsh'), runtime = join(root, 'runtime')
  runtimeFixture(dsh, '0.2.1-rc.2')
  mkdirSync(runtime)
  writeFileSync(join(runtime, 'versions.json'), JSON.stringify({ node: '24.17.0', pnpm: '11.7.0' }))
  return { dsh, runtime }
}

it('accepts the required kernel independently of the desktop application version', async () => {
  const { dsh, runtime } = fixture()
  await expect(verifyBundledRuntime(dsh, runtime, '0.2.1-rc.2', process)).resolves.toBeUndefined()
})

it('rejects an earlier kernel before packaging', async () => {
  const { dsh, runtime } = fixture()
  await expect(verifyBundledRuntime(dsh, runtime, '0.2.1-rc.3', process)).rejects.toThrow('does not match required kernel')
})

it('rejects stale execution tools even when the kernel files verify', async () => {
  const { dsh, runtime } = fixture()
  writeFileSync(join(runtime, 'versions.json'), JSON.stringify({ node: '24.17.0', pnpm: '10.0.0' }))
  await expect(verifyBundledRuntime(dsh, runtime, '0.2.1-rc.2', process)).rejects.toThrow('prepared Node.js and pnpm')
})

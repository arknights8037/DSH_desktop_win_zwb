import { mkdirSync, mkdtempSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { expect, it, onTestFinished } from 'vitest'
import { resolveDevelopmentKernel } from '../scripts/development-kernel.ts'
import { runtimeFixture } from './runtime-fixture.ts'
import { removeOwnedDirectory } from '../src/owned-directory.ts'

function fixture() {
  const home = mkdtempSync(join(tmpdir(), 'desktop-development-kernel-'))
  onTestFinished(() => { removeOwnedDirectory(home) })
  const root = join(home, 'desktop', 'agent-manager', 'kernels')
  const directory = join(root, 'releases', '0.2.1-rc.2')
  runtimeFixture(directory, '0.2.1-rc.2')
  const selection = join(root, 'selection.json')
  writeFileSync(selection, JSON.stringify({ version: 1, selected: '0.2.1-rc.2', previous: null, automatic: false }))
  const runtime = join(home, 'tools')
  const node = join(runtime, 'node', process.platform === 'win32' ? 'node.exe' : 'node')
  const pnpm = join(runtime, 'pnpm', 'bin', 'pnpm.mjs')
  for (const path of [node, pnpm]) { mkdirSync(join(path, '..'), { recursive: true }); writeFileSync(path, '') }
  writeFileSync(join(runtime, 'versions.json'), JSON.stringify({ node: '24.17.0', pnpm: '11.7.0' }))
  return { home, root, directory, selection, runtime, node, pnpm }
}

it('resolves the selected kernel and its tools without using a source project', () => {
  const { home, root, directory, runtime, node, pnpm } = fixture()
  expect(resolveDevelopmentKernel(home, runtime)).toEqual({ directory, root, version: '0.2.1-rc.2', node, pnpm })
})

it.each([null, '../escape', '', '0.2.1/../../other', 12])('rejects an invalid selected release %s', (selected) => {
  const { home, selection, runtime } = fixture()
  writeFileSync(selection, JSON.stringify({ version: 1, selected }))
  expect(() => resolveDevelopmentKernel(home, runtime)).toThrow('no valid release')
})

it('refuses missing selections and mismatched runtime metadata', () => {
  const { home, directory, selection, runtime } = fixture()
  const original = readFileSync(selection)
  unlinkSync(selection)
  expect(() => resolveDevelopmentKernel(home, runtime)).toThrow('selected kernel is missing')
  writeFileSync(selection, original)
  runtimeFixture(directory, '0.2.0')
  expect(() => resolveDevelopmentKernel(home, runtime)).toThrow('selected kernel version mismatch')
})

it('refuses mismatched or missing prepared tools', () => {
  const { home, runtime, pnpm } = fixture()
  const versions = join(runtime, 'versions.json')
  const original = readFileSync(versions)
  writeFileSync(versions, JSON.stringify({ node: '22.19.0', pnpm: '11.7.0' }))
  expect(() => resolveDevelopmentKernel(home, runtime)).toThrow('do not match')
  writeFileSync(versions, original)
  unlinkSync(pnpm)
  expect(() => resolveDevelopmentKernel(home, runtime)).toThrow('bundled pnpm is missing')
})

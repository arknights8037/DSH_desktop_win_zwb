import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { expect, it, onTestFinished } from 'vitest'
import { adaptDesktopPlugin } from '../src/plugin-compat.ts'

function fixture(version = '0.6.3') {
  const directory = mkdtempSync(join(tmpdir(), 'desktop-at-file-'))
  onTestFinished(() => { rmSync(directory, { recursive: true, force: true }) })
  mkdirSync(join(directory, 'lib'))
  writeFileSync(join(directory, 'package.json'), JSON.stringify({ version,
    peerDependencies: { '@deepseek-ai/dsh-client-runtime': '*', react: '^18.2.0' },
    peerDependenciesMeta: { '@deepseek-ai/dsh-client-runtime': { optional: true } },
    dsh: { client: { inject: ['@deepseek-ai/dsh-client-runtime', 'other-service'] } },
  }))
  writeFileSync(join(directory, 'lib/client.js'), 'const store = require("@deepseek-ai/dsh-client-runtime/client");\n')
  return directory
}

it('adapts the retired browser store without changing other injection requirements', () => {
  const directory = fixture()
  adaptDesktopPlugin(directory, 'dsh-at-file')
  expect(readFileSync(join(directory, 'lib/client.js'), 'utf8')).toContain('require("@deepseek-ai/dsh-client-store")')
  const manifest: unknown = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'))
  expect(manifest).toMatchObject({ peerDependencies: { '@deepseek-ai/dsh-client-store': '*', react: '^18.2.0' },
    dsh: { client: { inject: ['@deepseek-ai/dsh-client-store', 'other-service'] } } })
  expect(manifest).not.toHaveProperty('peerDependencies.@deepseek-ai/dsh-client-runtime')
})

it('refuses unfamiliar published bytes and leaves other versions untouched', () => {
  const directory = fixture()
  writeFileSync(join(directory, 'lib/client.js'), 'changed publisher code\n')
  expect(() => { adaptDesktopPlugin(directory, 'dsh-at-file') }).toThrow('Unexpected dsh-at-file')
  const next = fixture('0.6.4')
  const before = readFileSync(join(next, 'lib/client.js'), 'utf8')
  adaptDesktopPlugin(next, 'dsh-at-file')
  expect(readFileSync(join(next, 'lib/client.js'), 'utf8')).toBe(before)
})

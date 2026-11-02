import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { cachedKernelPackage } from '../scripts/fetch-kernel-packages.ts'
import type { DesktopCorePackageRecord } from '../src/core-package-set.ts'

const roots: string[] = []

function fixture(): { root: string; record: DesktopCorePackageRecord; tarball: string } {
  const root = mkdtempSync(join(tmpdir(), 'dsh-kernel-cache-test-'))
  roots.push(root)
  mkdirSync(join(root, 'package'))
  mkdirSync(join(root, 'desktop-packages'))
  writeFileSync(join(root, 'package/package.json'), JSON.stringify({ name: '@deepseek-ai/example', version: '1.2.3' }))
  const file = 'example-1.2.3.tgz'
  const tarball = join(root, 'desktop-packages', file)
  const result = spawnSync('tar', ['-czf', tarball, '-C', root, 'package'], { encoding: 'utf8' })
  if (result.error || result.status !== 0) throw result.error ?? new Error(result.stderr)
  const body = readFileSync(tarball)
  return { root, tarball, record: {
    name: '@deepseek-ai/example', version: '1.2.3', file, bytes: body.length,
    integrity: `sha512-${createHash('sha512').update(body).digest('base64')}`,
  } }
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('kernel package cache', () => {
  it('reuses a verified local tarball within the requested version range', () => {
    const { root, record, tarball } = fixture()
    expect(cachedKernelPackage(root, [record], record.name, '~1.2.0')).toEqual({
      tarball, manifest: { name: record.name, version: record.version },
    })
    expect(cachedKernelPackage(root, [record], record.name, '2.0.0')).toBeUndefined()
    expect(cachedKernelPackage(root, [record], '@deepseek-ai/missing', '1.2.3')).toBeUndefined()
  })

  it('rejects tampered bytes even when the file size matches', () => {
    const { root, record, tarball } = fixture()
    const body = readFileSync(tarball)
    body[body.length - 1] = body[body.length - 1]! ^ 1
    writeFileSync(tarball, body)
    expect(cachedKernelPackage(root, [record], record.name, '1.2.3')).toBeUndefined()
  })

  it('falls back for a missing tarball or a mismatched package identity', () => {
    const { root, record, tarball } = fixture()
    expect(cachedKernelPackage(root, [{ ...record, name: '@deepseek-ai/other' }], '@deepseek-ai/other', '1.2.3')).toBeUndefined()
    rmSync(tarball)
    expect(cachedKernelPackage(root, [record], record.name, '1.2.3')).toBeUndefined()
  })
})

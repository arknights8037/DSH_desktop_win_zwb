import { rename } from 'node:fs/promises'
import { afterEach, expect, it, vi } from 'vitest'
import { renameOwnedDirectory } from '../src/owned-directory.ts'

vi.mock('node:fs/promises', () => ({ rename: vi.fn() }))
vi.mock('node:timers/promises', () => ({ setTimeout: vi.fn(async () => {}) }))
afterEach(() => { vi.resetAllMocks(); vi.unstubAllGlobals() })

it('retries a transient Windows handle error and awaits publication', async () => {
  vi.stubGlobal('process', { ...process, platform: 'win32' })
  const publication = Promise.withResolvers<undefined>()
  vi.mocked(rename).mockRejectedValueOnce(Object.assign(new Error('locked'), { code: 'EPERM' }))
    .mockReturnValueOnce(publication.promise)
  let completed = false
  const pending = renameOwnedDirectory('stage', 'release').then(() => { completed = true })
  await vi.waitFor(() => { expect(rename).toHaveBeenCalledTimes(2) })
  expect(completed).toBe(false)
  publication.resolve(undefined)
  await pending
  expect(completed).toBe(true)
})

it('bounds Windows handle retries and preserves the final failure', async () => {
  vi.stubGlobal('process', { ...process, platform: 'win32' })
  const failure = Object.assign(new Error('still locked'), { code: 'EBUSY' })
  vi.mocked(rename).mockRejectedValue(failure)
  await expect(renameOwnedDirectory('stage', 'release')).rejects.toBe(failure)
  expect(rename).toHaveBeenCalledTimes(8)
})

it.each(['linux', 'win32'])('does not retry permanent failures on %s', async (platform) => {
  vi.stubGlobal('process', { ...process, platform })
  const failure = Object.assign(new Error('no space'), { code: 'ENOSPC' })
  vi.mocked(rename).mockRejectedValue(failure)
  await expect(renameOwnedDirectory('stage', 'release')).rejects.toBe(failure)
  expect(rename).toHaveBeenCalledTimes(1)
})

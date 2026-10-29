import { mkdtemp, mkdir, readFile, writeFile, symlink, readlink, rm, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, onTestFinished } from 'vitest'
import { copyDataHome, DesktopDataStorage } from '../src/data-storage.ts'

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'desktop-data-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  const source = join(root, 'original')
  const target = join(root, 'relocated')
  const locator = join(root, 'browser', 'data-location.json')
  await mkdir(join(source, 'desktop', 'library'), { recursive: true })
  await writeFile(join(source, 'sessions.jsonl'), '{"type":"fixture"}\n')
  return { root, source, target, locator }
}
it('copies session bytes and relocates internal directory links and plugin declarations while retaining the source', async () => {
  const { source, target } = await fixture()
  const library = join(source, 'desktop', 'library')
  await writeFile(join(library, 'plugin.js'), 'export const fixture = true\n')
  await symlink(library, join(source, 'plugin-link'), process.platform === 'win32' ? 'junction' : 'dir')
  await writeFile(join(source, 'package.json'), JSON.stringify({ dsh: { profile: { injectedPlugins: { 'test-plugin': library } } } }))
  await copyDataHome(source, target)
  expect(await readFile(join(target, 'sessions.jsonl'), 'utf8')).toBe(await readFile(join(source, 'sessions.jsonl'), 'utf8'))
  expect(await realpath(join(target, 'plugin-link'))).toBe(await realpath(join(target, 'desktop', 'library')))
  expect(await readFile(join(target, 'plugin-link', 'plugin.js'), 'utf8')).toContain('fixture = true')
  expect(JSON.parse(await readFile(join(target, 'package.json'), 'utf8'))).toMatchObject({ dsh: { profile: { injectedPlugins: { 'test-plugin': join(target, 'desktop', 'library') } } } })
  expect(await readlink(join(source, 'plugin-link'))).toContain('original')
})
it('commits a scheduled destination only after restart-time copying and accepts the installer UTF-16 locator', async () => {
  const { source, target, locator } = await fixture()
  await mkdir(join(locator, '..'), { recursive: true })
  await writeFile(locator, Buffer.from(`\ufeff${JSON.stringify({ version: 1, home: source })}`, 'utf16le'))
  const storage = new DesktopDataStorage(locator, 'ignored')
  expect(await storage.initialize()).toBe(source)
  await storage.schedule(target)
  expect(JSON.parse(await readFile(locator, 'utf8'))).toMatchObject({ home: source, pending: target })
  expect(await new DesktopDataStorage(locator, 'ignored').initialize()).toBe(target)
  expect(JSON.parse(await readFile(locator, 'utf8'))).toEqual({ version: 1, home: target })
  expect(await readFile(join(source, 'sessions.jsonl'), 'utf8')).toContain('fixture')
})
it('refuses overlap and occupied targets, and retains the original home when a scheduled target becomes occupied', async () => {
  const { source, target, locator } = await fixture()
  const storage = new DesktopDataStorage(locator, source)
  for (const path of [source, join(source, 'nested'), join(source, '..')]) await expect(storage.schedule(path)).rejects.toThrow('overlap')
  await storage.schedule(target)
  await mkdir(target)
  await writeFile(join(target, 'sentinel'), 'retain')
  await expect(new DesktopDataStorage(locator, source).initialize()).rejects.toThrow()
  expect(JSON.parse(await readFile(locator, 'utf8'))).toEqual({ version: 1, home: source })
  expect(await readFile(join(target, 'sentinel'), 'utf8')).toBe('retain')
  await expect(new DesktopDataStorage(locator, source).schedule(target)).rejects.toThrow('unoccupied')
})

it('moves one category while keeping other category locations and original files', async () => {
  const { root, source, target, locator } = await fixture()
  const storage = new DesktopDataStorage(locator, source)
  const original = storage.paths()
  await mkdir(original.instances, { recursive: true })
  await writeFile(join(original.instances, 'session.db'), 'retained-session')
  await storage.schedule(target, 'instances')
  await expect(storage.schedule(join(root, 'another'), 'cache')).rejects.toThrow('already scheduled')
  const next = new DesktopDataStorage(locator, source)
  await next.initialize()
  expect(next.paths()).toEqual({ ...original, instances: target })
  expect(await readFile(join(target, 'session.db'), 'utf8')).toBe('retained-session')
  expect(await readFile(join(original.instances, 'session.db'), 'utf8')).toBe('retained-session')
  await expect(next.schedule(join(target, 'nested'), 'cache')).rejects.toThrow('overlap')
})

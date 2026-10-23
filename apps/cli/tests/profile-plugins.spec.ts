/** Restart-time activation and interrupted-launch recovery use independent profile copies. */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, onTestFinished } from 'vitest'
import { activateProfilePluginUpdate, ProfilePlugins } from '../src/profile-plugins.ts'

function fixture(state: 'pending' | 'applying' = 'pending', enabled = true) {
  const profile = mkdtempSync(join(tmpdir(), 'dsh-profile-plugin-restart-'))
  onTestFinished(() => { rmSync(profile, { recursive: true, force: true }) })
  const preparation = 'aaaaaaaa-1111-4111-8111-111111111111'
  const copy = join(profile, '.plugin-copies', preparation)
  const old = join(profile, 'old-plugin')
  const next = join(copy, 'node_modules/plugin')
  const link = join(profile, 'node_modules/plugin')
  mkdirSync(old, { recursive: true })
  mkdirSync(next, { recursive: true })
  mkdirSync(join(profile, 'node_modules'))
  writeFileSync(join(old, 'version'), '1.0.0')
  writeFileSync(join(next, 'version'), '2.0.0')
  symlinkSync(old, link, process.platform === 'win32' ? 'junction' : 'dir')
  cpSync(link, join(copy, 'previous-link'), { recursive: true, verbatimSymlinks: true })
  const initial = JSON.stringify({ dependencies: { plugin: '1.0.0' }, dsh: { profile: { bundles: enabled ? ['base', 'plugin'] : ['base'] } } })
  writeFileSync(join(profile, 'package.json'), initial)
  writeFileSync(join(profile, 'cordis.patch.yml'), '# instance-owned options\n')
  writeFileSync(join(copy, 'previous-package.json'), initial)
  writeFileSync(join(profile, '.plugin-deployment.json'), JSON.stringify({ state, preparation, name: 'plugin', version: '2.0.0', hadLink: true }))
  return { profile, old, next, link, initial }
}

it.each([true, false])('applies an explicit selection on restart and preserves activation and config (enabled: %s)', async (enabled) => {
  const { profile, next, link } = fixture('pending', enabled)
  const confirm = await activateProfilePluginUpdate(profile)
  expect(realpathSync(link)).toBe(realpathSync(next))
  const manifest = JSON.parse(readFileSync(join(profile, 'package.json'), 'utf8')) as { dependencies: { plugin: string }; dsh: { profile: { bundles: string[] } } }
  expect(manifest.dependencies.plugin).toBe('2.0.0')
  expect(manifest.dsh.profile.bundles.includes('plugin')).toBe(enabled)
  expect(readFileSync(join(profile, 'cordis.patch.yml'), 'utf8')).toBe('# instance-owned options\n')
  confirm()
  await activateProfilePluginUpdate(profile)
  expect(realpathSync(link)).toBe(realpathSync(next))
  expect(existsSync(join(profile, '.plugin-deployment.json'))).toBe(false)
})

it('restores the previous manifest and package link after startup fails before readiness', async () => {
  const { profile, old, link, initial } = fixture()
  await activateProfilePluginUpdate(profile)
  expect(readFileSync(join(link, 'version'), 'utf8')).toBe('2.0.0')
  await activateProfilePluginUpdate(profile)
  expect(realpathSync(link)).toBe(realpathSync(old))
  expect(readFileSync(join(profile, 'package.json'), 'utf8')).toBe(initial)
})

it('restores an applying journal interrupted before the package link was replaced', async () => {
  const { profile, old, link, initial } = fixture('applying')
  await activateProfilePluginUpdate(profile)
  expect(realpathSync(link)).toBe(realpathSync(old))
  expect(readFileSync(join(profile, 'package.json'), 'utf8')).toBe(initial)
})

it('refuses to overwrite profile edits made after scheduling a deployment', async () => {
  const { profile, old, link } = fixture()
  writeFileSync(join(profile, 'package.json'), '{"private":true}\n')
  await expect(activateProfilePluginUpdate(profile)).rejects.toThrow('Profile changed')
  expect(realpathSync(link)).toBe(realpathSync(old))
})

it('rejects malformed journals, non-registry selections, and changes after service disposal', async () => {
  const { profile } = fixture()
  writeFileSync(join(profile, '.plugin-deployment.json'), '{"preparation":"../outside"}')
  await expect(activateProfilePluginUpdate(profile)).rejects.toThrow('journal')
  rmSync(join(profile, '.plugin-deployment.json'))
  const provider = new ProfilePlugins(profile, { profilesDir: profile, profileDir: profile, localPackageNames: [], entries: [] })
  await expect(provider.prepare({ name: '../outside', version: '1.0.0' }, new AbortController().signal)).rejects.toThrow('exact registry')
  await expect(provider.prepare({ name: 'plugin', version: 'latest' }, new AbortController().signal)).rejects.toThrow('exact registry')
  await provider.close()
  await expect(provider.prepare({ name: 'plugin', version: '1.0.0' }, new AbortController().signal)).rejects.toThrow()
})

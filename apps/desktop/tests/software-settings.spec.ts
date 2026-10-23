import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, onTestFinished } from 'vitest'
import { SoftwareSettings, type SoftwareEncryption } from '../src/software-settings.ts'
import { DEFAULT_SHORTCUTS } from '../src/manager-shortcuts.ts'
import { DEFAULT_DSH_SETTINGS } from '../src/dsh-settings.ts'
import { parseModelSource, modelSourceId, sourceKeyRef } from '../src/model-sources.ts'

const sourceConfig = { name: 'Gateway', protocol: 'openai-completions', baseURL: 'https://gateway.test/v1',
  models: ['model-a', 'model-b'], contextWindow: 128000, maxTokens: 4096 }

it('manages independent sources, preserves blank replacement keys, and persists offline deletions', () => {
  const { path, encryption, settings } = fixture()
  settings.saveSource(undefined, sourceConfig, 'first-fixture-key')
  settings.saveSource(undefined, { ...sourceConfig, name: 'Anthropic', protocol: 'anthropic-messages' }, 'second-fixture-key')
  const [first, second] = settings.snapshot().modelSources
  expect(first!.id).not.toBe(second!.id)
  expect(first!.keyConfigured).toBe(true)
  expect(readFileSync(path, 'utf8')).not.toMatch(/first-fixture-key|second-fixture-key/u)
  expect(JSON.stringify(settings.snapshot())).not.toMatch(/first-fixture-key|second-fixture-key/u)
  settings.saveSource(first!.id, { ...sourceConfig, name: 'Renamed' }, '')
  expect(settings.instanceCredentials().find(key => key.ref === sourceKeyRef(first!.id))?.value).toBe('first-fixture-key')
  settings.saveSource(second!.id, { ...sourceConfig, protocol: 'openai-responses' }, 'replacement-fixture-key')
  expect(settings.instanceCredentials().find(key => key.ref === sourceKeyRef(second!.id))?.value).toBe('replacement-fixture-key')
  settings.removeSource(first!.id)
  const reloaded = new SoftwareSettings(path, encryption)
  expect(reloaded.snapshot().modelSources).toHaveLength(1)
  expect(reloaded.removedSourceIds()).toEqual([first!.id])
  expect(reloaded.instanceCredentials()).toContainEqual({ ref: sourceKeyRef(first!.id) })
  expect(reloaded.instanceSources()[0]!.protocol).toBe('openai-responses')
  expect(() => { reloaded.saveSource(first!.id, sourceConfig, 'x') }).toThrow('Unknown')
})

it('rejects invalid source catalogs, URLs, keys, and protocols before saving', () => {
  const { settings } = fixture()
  const id = modelSourceId('aabbccdd-1234-4321-8123-123456789012')
  for (const config of [{ ...sourceConfig, protocol: 'other' }, { ...sourceConfig, models: [] },
    { ...sourceConfig, models: ['same', 'same'] }, { ...sourceConfig, maxTokens: 0 },
    { ...sourceConfig, maxTokens: 128001 }, { ...sourceConfig, apiKey: 'secret' },
    { ...sourceConfig, baseURL: 'https://user:password@gateway.test/v1' },
  ]) expect(() => parseModelSource(config, id)).toThrow()
  expect(() => { settings.saveSource(undefined, sourceConfig, '') }).toThrow('requires an API key')
  expect(settings.snapshot().modelSources).toEqual([])
})

it('persists validated DSH overrides offline without accepting secrets or arbitrary settings', () => {
  const { path, encryption, settings } = fixture()
  const dsh = { ...DEFAULT_DSH_SETTINGS, deepseekBaseURL: 'https://gateway.test/anthropic',
    deepseekMaxTokens: 8192, modeSelectionEnabled: false, defaultPreset: 'custom' }
  settings.updateDsh(dsh)
  expect(new SoftwareSettings(path, encryption).snapshot().dsh).toEqual(dsh)
  const detached = settings.snapshot(); detached.dsh.defaultPreset = 'changed'
  expect(settings.snapshot().dsh.defaultPreset).toBe('custom')
  for (const bad of [null, { ...dsh, apiKey: 'secret' }, { ...dsh, deepseekKeyRef: '../key' },
    { ...dsh, deepseekMaxTokens: 0 }, { ...dsh, deepseekMaxTokens: 1.5 }, { ...dsh, defaultPreset: '' },
    { ...dsh, transcriptView: ['compact'] }, { ...dsh, deepseekProtocol: 'ftp' },
    { ...dsh, modeSelectionEnabled: 'true' }, { ...dsh, reasoningEffort: 'unknown' },
    ...['file:///tmp/key', 'https://user:secret@host.test', 'https://host.test?key=secret'].map(deepseekBaseURL => ({ ...dsh, deepseekBaseURL })),
  ]) expect(() => { settings.updateDsh(bad) }).toThrow()
  expect(settings.snapshot().dsh).toEqual(dsh)
  const file = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
  delete file.dsh
  writeFileSync(path, JSON.stringify(file))
  expect(new SoftwareSettings(path, encryption).snapshot().dsh).toEqual(DEFAULT_DSH_SETTINGS)
})

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'dsh-software-settings-'))
  onTestFinished(() => { rmSync(root, { recursive: true, force: true }) })
  const path = join(root, 'settings.json')
  const encryption: SoftwareEncryption = { available: () => true,
    encrypt: value => Buffer.from(value).reverse(), decrypt: value => Buffer.from(value).reverse().toString() }
  return { path, encryption, settings: new SoftwareSettings(path, encryption) }
}

it('retains shared preferences and shortcuts independently of instances', () => {
  const { path, encryption, settings } = fixture()
  settings.update('theme', 'light'); settings.update('language', 'en'); settings.update('fontSize', 16)
  settings.shortcuts({ ...DEFAULT_SHORTCUTS, settings: 'Ctrl+Alt+S' })
  const reloaded = new SoftwareSettings(path, encryption)
  expect(reloaded.snapshot()).toMatchObject({ appearance: { theme: 'light', language: 'en', fontSize: 16 }, shortcuts: { settings: 'Ctrl+Alt+S' } })
  const detached = reloaded.snapshot(); detached.appearance.theme = 'dark'
  expect(reloaded.snapshot().appearance.theme).toBe('light')
  for (const [field, value] of [['theme', ['dark']], ['language', ['en']], ['fontSize', 18], ['busyEnter', 'unknown'], ['other', true]]) {
    expect(() => { settings.update(field, value) }).toThrow('Invalid software preference')
  }
})

it('encrypts keys, exposes names only, and retains removals for offline instances', () => {
  const { path, encryption, settings } = fixture()
  settings.setCredential('MODEL_KEY', 'fixture-secret-only')
  expect(readFileSync(path, 'utf8')).not.toContain('fixture-secret-only')
  expect(JSON.stringify(settings.snapshot())).not.toContain('fixture-secret-only')
  expect(new SoftwareSettings(path, encryption).instanceCredentials()).toEqual([{ ref: 'MODEL_KEY', value: 'fixture-secret-only' }])
  settings.removeCredential('MODEL_KEY')
  expect(new SoftwareSettings(path, encryption).instanceCredentials()).toEqual([{ ref: 'MODEL_KEY' }])
  settings.setCredential('MODEL_KEY', 'replacement-fixture')
  expect(settings.instanceCredentials()).toEqual([{ ref: 'MODEL_KEY', value: 'replacement-fixture' }])
})

it('refuses plaintext fallback and invalid persisted settings', () => {
  const { path, encryption, settings } = fixture()
  encryption.available = () => false
  expect(settings.snapshot().credentialWritable).toBe(false)
  expect(() => { settings.setCredential('MODEL_KEY', 'fixture') }).toThrow('encryption is unavailable')
  expect(() => { settings.setCredential('bad key', 'fixture') }).toThrow('Invalid credential name')
  for (const contents of ['null', '{}', '{', JSON.stringify({ version: 2 })]) {
    writeFileSync(path, contents)
    expect(() => new SoftwareSettings(path, encryption)).toThrow()
  }
})

import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, onTestFinished } from 'vitest'
import { InstanceRegistry, instanceId, parseInstance, parseCredentials } from '../src/instances.ts'

function registry() {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-instances-'))
  onTestFinished(() => { rmSync(directory, { recursive: true, force: true }) })
  const path = join(directory, 'instances.json')
  return { path, store: new InstanceRegistry(path) }
}
const ssh = { name: 'Remote', kind: 'ssh', host: '127.0.0.1', port: 22, username: 'test', auth: 'password', privateKeyPath: '', executable: 'dsh', home: '' }
it('persists separate identities and tab layout without credentials', () => {
  const { store, path } = registry()
  const local = store.save({ name: 'Local', kind: 'local' })
  const remote = store.save({ ...ssh, password: 'never-persist-this', passphrase: 'also-secret' })
  store.tab(local.id, true)
  store.tab(remote.id, true)
  store.tab(local.id, true)
  expect(store.snapshot().tabs).toEqual({ ids: [local.id, remote.id], active: local.id })
  expect(readFileSync(path, 'utf8')).not.toContain('secret')
  expect(readFileSync(path, 'utf8')).not.toContain('never-persist')
  expect(new InstanceRegistry(path).snapshot()).toEqual(store.snapshot())
  store.tab(local.id, false)
  expect(store.snapshot().tabs.active).toBe(remote.id)
  expect(store.snapshot().instances).toHaveLength(2)
})
it('removes only configuration and maintains valid active tabs', () => {
  const { store } = registry()
  const item = store.save({ name: 'Local', kind: 'local' })
  store.tab(item.id, true)
  store.remove(item.id)
  expect(store.snapshot()).toEqual({ instances: [], tabs: { ids: [], active: null } })
  expect(() => store.get(item.id)).toThrow('Unknown')
})
it('rejects path-shaped IDs, invalid ports, and unsafe homes at the boundary', () => {
  const { store } = registry()
  const id = store.save({ name: 'Local', kind: 'local' }).id
  expect(() => instanceId('../escape')).toThrow()
  expect(() => parseInstance({ ...ssh, port: 0 }, id)).toThrow('port')
  expect(() => parseInstance({ ...ssh, home: '/tmp/../' }, id)).toThrow('directory')
  expect(() => parseInstance({ ...ssh, home: '~/' }, id)).toThrow('directory')
  expect(() => parseCredentials({ password: 123 })).toThrow()
  expect(parseCredentials({ password: ' x ', unknown: 'discard' })).toEqual({ password: ' x ' })
})
it('refuses changed pinned host keys and retains the previous trust', () => {
  const { store, path } = registry()
  store.trust('host:22', 'a'.repeat(64))
  expect(() => { store.trust('host:22', 'b'.repeat(64)) }).toThrow('changed')
  expect(new InstanceRegistry(path).fingerprint('host:22')).toBe('a'.repeat(64))
})
it('rejects changing instance kind without losing the old definition', () => {
  const { store } = registry()
  const local = store.save({ name: 'Local', kind: 'local' })
  expect(() => store.save(ssh, local.id)).toThrow('kind')
  expect(store.get(local.id)).toEqual(local)
})

it('persists a new display name while retaining SSH identity, tabs, and trust', () => {
  const { store, path } = registry()
  const remote = store.save(ssh)
  store.tab(remote.id, true)
  store.trust('host:22', 'a'.repeat(64))
  store.save({ ...store.get(remote.id), name: '  Renamed  ' }, remote.id)
  const reloaded = new InstanceRegistry(path)
  expect(reloaded.get(remote.id)).toEqual({ ...remote, name: 'Renamed' })
  expect(reloaded.snapshot().tabs).toEqual({ ids: [remote.id], active: remote.id })
  expect(reloaded.fingerprint('host:22')).toBe('a'.repeat(64))
  expect(() => reloaded.save({ ...remote, name: '' }, remote.id)).toThrow('name')
  expect(reloaded.get(remote.id).name).toBe('Renamed')
})

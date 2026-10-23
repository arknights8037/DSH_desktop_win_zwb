/** Run with Electron and ELECTRON_RUN_AS_NODE=1 to exercise its filesystem implementation. */
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { DesktopProjectManager } from '../../lib/types/project-manager.js'
import { resolveDesktopPaths } from '../../lib/types/paths.js'
import { removeOwnedDirectory } from '../../lib/types/owned-directory.js'
import { writeDesktopRuntime } from '../../lib/types/runtime-tree.js'
import { DESKTOP_HOST_RUNTIME_FILES } from '../../lib/types/core-package-set.js'
import { DESKTOP_HOST_PROTOCOL_VERSION } from '../../lib/types/host-protocol.js'

assert.ok(process.versions.electron, 'Run this regression with Electron')
const root = mkdtempSync(join(tmpdir(), 'desktop-electron-profile-'))
try {
  const runtime = join(root, 'runtime')
  const names = ['@deepseek-ai/dsh', '@deepseek-ai/dsh-desktop-host', '@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@deepseek-ai/cordis']
  for (const name of names) {
    const path = join(runtime, 'node_modules', name)
    mkdirSync(path, { recursive: true })
    writeFileSync(join(path, 'package.json'), JSON.stringify({ name, version: '1.0.0', type: 'module', exports: './index.js' }))
    writeFileSync(join(path, 'index.js'), 'export const value = {}\n')
  }
  for (const file of DESKTOP_HOST_RUNTIME_FILES) {
    const path = join(runtime, 'node_modules', '@deepseek-ai/dsh-desktop-host', file)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, '')
  }
  writeFileSync(join(runtime, 'package.json'), '{"type":"module"}\n')
  writeDesktopRuntime(runtime, { schemaVersion: 1, version: '1.0.0', nodeVersion: process.versions.node,
    pnpmVersion: '11.7.0', hostProtocolVersion: DESKTOP_HOST_PROTOCOL_VERSION }, names)
  const pnpm = join(root, 'pnpm.mjs')
  writeFileSync(pnpm, `
    import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
    import { join } from 'node:path';
    import { removeOwnedDirectory } from ${JSON.stringify(new URL('../../lib/types/owned-directory.js', import.meta.url).href)};
    const args = process.argv.slice(2);
    if (args.includes('add')) {
      const spec = args[args.indexOf('add') + 1];
      const [name, version] = spec.split('@');
      const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
      manifest.dependencies[name] = version;
      writeFileSync('package.json', JSON.stringify(manifest));
      removeOwnedDirectory('node_modules');
      mkdirSync(join('node_modules', name), { recursive: true });
      writeFileSync(join('node_modules', name, 'package.json'), JSON.stringify({ name, version, dsh: { bundle: { patch: 'bundle.yml' } } }));
      writeFileSync(join('node_modules', name, 'bundle.yml'), '[]\\n');
      writeFileSync('pnpm-lock.yaml', JSON.stringify(manifest.dependencies));
    }
  `)
  const manager = new DesktopProjectManager(resolveDesktopPaths(join(root, 'home')), {
    node: process.execPath, pnpm, dsh: runtime, profileResolution: 'runtime',
  })
  const hooks = { beforeChange: async () => {}, afterChange: async () => {} }
  await manager.applyRelease()
  await manager.mutate({ type: 'plugin-add', spec: 'example@1.0.0' }, hooks)
  const external = join(root, 'external')
  mkdirSync(external)
  writeFileSync(join(external, 'sentinel'), 'external bytes')
  symlinkSync(external, join(manager.paths.profile, 'linked-data'), process.platform === 'win32' ? 'junction' : 'dir')
  const bytes = join(manager.paths.profile, 'node_modules/example/custom.bin')
  const config = join(manager.paths.profile, 'cordis.patch.yml')
  writeFileSync(bytes, Buffer.from([0, 255, 10]))
  writeFileSync(config, 'original config')
  let starts = 0
  await assert.rejects(manager.mutate({ type: 'plugin-update', name: 'example', version: '2.0.0' }, {
    beforeChange: async () => { assert.ok(existsSync(manager.paths.lock)) },
    afterChange: async () => {
      if (++starts === 1) { writeFileSync(config, 'failed startup config'); throw new Error('startup failed') }
    },
  }), /original Profile restored and restarted/u)
  assert.equal(starts, 2)
  assert.deepEqual(manager.listPlugins(), [{ name: 'example', version: '1.0.0', enabled: true }])
  assert.deepEqual(readFileSync(bytes), Buffer.from([0, 255, 10]))
  assert.equal(readFileSync(config, 'utf8'), 'original config')
  await manager.mutate({ type: 'plugin-toggle', name: 'example', enabled: false }, hooks)
  assert.equal(readFileSync(join(external, 'sentinel'), 'utf8'), 'external bytes')
  assert.equal(existsSync(manager.paths.lock), false)
  console.log(JSON.stringify({ electron: process.versions.electron, restoredProfileBytes: true, preservedLinkTargets: true }))
} finally { removeOwnedDirectory(root) }

/** Version-scoped fixes for published community artifacts installed by the shell. */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Adapt at-file 0.6.3's retired snapshot-store import to the selected Host's store package.
 * @param directory - Stopped profile's installed plugin directory.
 * @param name - Requested registry package.
 * @returns Completion after the manifest and browser bundle agree; unfamiliar bytes reject.
 */
export function adaptDesktopPlugin(directory: string, name: string): void {
  if (name !== 'dsh-at-file') return
  const path = join(directory, 'package.json')
  const manifest = JSON.parse(readFileSync(path, 'utf8')) as {
    version: string
    peerDependencies: Record<string, string>
    peerDependenciesMeta?: Record<string, unknown>
    dsh: { client: { inject: string[] } }
  }
  if (manifest.version !== '0.6.3') return
  const bundle = join(directory, 'lib/client.js')
  const source = readFileSync(bundle, 'utf8')
  const legacy = 'require("@deepseek-ai/dsh-client-runtime/client")'
  if (source.split(legacy).length !== 2) throw new Error('Unexpected dsh-at-file@0.6.3 browser bundle; update its compatibility adapter')
  writeFileSync(bundle, source.replace(legacy, 'require("@deepseek-ai/dsh-client-store")'))
  Reflect.deleteProperty(manifest.peerDependencies, '@deepseek-ai/dsh-client-runtime')
  if (manifest.peerDependenciesMeta) Reflect.deleteProperty(manifest.peerDependenciesMeta, '@deepseek-ai/dsh-client-runtime')
  manifest.peerDependencies['@deepseek-ai/dsh-client-store'] = '*'
  manifest.dsh.client.inject = manifest.dsh.client.inject.map(name => name === '@deepseek-ai/dsh-client-runtime'
    ? '@deepseek-ai/dsh-client-store' : name)
  writeFileSync(path, `${JSON.stringify(manifest, undefined, 2)}\n`)
}

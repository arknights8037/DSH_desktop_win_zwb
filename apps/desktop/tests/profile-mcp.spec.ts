/** MCP resource ownership in the shipped Desktop composition. */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { composeEntries, loadOverlayPatches, loadProfileDirectory } from '@deepseek-ai/dsh-app-boot'
import { createPluginProfile } from '../src/project-manager.ts'

it('retains one shared resource consumer after the Desktop host overlay', () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-desktop-profile-mcp-'))
  try {
    const profileDir = join(home, 'profiles', 'desktop')
    createPluginProfile(profileDir)
    const installAnchor = fileURLToPath(new URL('../../cli/package.json', import.meta.url))
    const profile = loadProfileDirectory('dsh desktop', profileDir, installAnchor)
    expect(profile.skippedBundles).toEqual([])
    const overlay = fileURLToPath(new URL('../../desktop-host/config/desktop.cordis.patch.yml', import.meta.url))
    const warnings: string[] = []
    const rows = composeEntries([
      ...profile.layers.map(layer => layer.patches),
      profile.patches,
      loadOverlayPatches('dsh desktop', overlay),
    ], message => warnings.push(message))

    expect(rows.filter(row => row.name === '@deepseek-ai/dsh-mcp-resources')).toEqual([
      { id: 'mcp-resources', name: '@deepseek-ai/dsh-mcp-resources' },
    ])
    expect(rows.filter(row => row.name === '@deepseek-ai/dsh-mcp-client')).toEqual([])
    expect(rows.find(row => row.id === 'webserver')?.disabled).toBe(true)
    expect(rows.find(row => row.id === 'harness-dev-context')?.disabled).toBe(true)
    for (const id of ['plugin-manager', 'tool-plugin-manager', 'ui-plugin-manager']) {
      expect(rows.find(row => row.id === id)?.disabled).toBe(true)
    }
    expect(rows.find(row => row.id === 'desktop-workspace-editor')?.name).toBe('@deepseek-ai/dsh-desktop-host')
    const manifest = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8')) as { dependencies: Record<string, string> }
    expect(manifest.dependencies['@deepseek-ai/dsh-desktop-host']).toBeUndefined()
    expect(warnings).toEqual([])
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

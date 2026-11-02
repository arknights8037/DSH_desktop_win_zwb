import { defineConfig } from 'vitest/config'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const runtime = process.env.DSH_DESKTOP_TEST_RUNTIME
const sourceRoot = process.env.DSH_DESKTOP_TEST_SOURCE_ROOT
const kernel = runtime ? createRequire(join(resolve(runtime), 'package.json')) : undefined
const sharedPackages = runtime
  ? (JSON.parse(readFileSync(join(resolve(runtime), 'desktop-runtime.json'), 'utf8')) as {
      sharedPackages: Array<{ name: string; path: string }>
    }).sharedPackages.map(({ name, path }) => ({
      find: name,
      replacement: join(resolve(runtime), path),
    }))
  : []

// Desktop is built independently of the absent kernel source workspace.
export default defineConfig({
  oxc: { tsconfig: false },
  resolve: { alias: [
    ...(process.env.DSH_DESKTOP_TEST_JSDOM ? [{ find: 'jsdom', replacement: process.env.DSH_DESKTOP_TEST_JSDOM }] : []),
    ...sourceRoot ? [
      { find: '../../../scripts/release/process.ts', replacement: join(resolve(sourceRoot), 'scripts/release/process.ts') },
      { find: '../../../scripts/release/tarball.ts', replacement: join(resolve(sourceRoot), 'scripts/release/tarball.ts') },
      { find: '../../../packages/storage/storage-domain/tests/helpers/memory-backend.ts',
        replacement: join(resolve(sourceRoot), 'packages/storage/storage-domain/tests/helpers/memory-backend.ts') },
    ] : [],
    ...sharedPackages,
    ...kernel ? [
    ...['@deepseek-ai/dsh-agent-default-model', '@deepseek-ai/dsh-llm-deepseek', '@deepseek-ai/dsh-app-boot'].map(name => ({ find: name, replacement: kernel.resolve(name) })),
    { find: '../../../packages/settings/settings/src/schema.ts', replacement: join(dirname(kernel.resolve('@deepseek-ai/dsh-settings/package.json')), 'lib/types/schema.js') },
  ] : [],
  ] },
  test: { include: ['apps/desktop/tests/**/*.spec.{ts,tsx}'] },
})

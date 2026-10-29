import { readFile } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'
import { defineConfig } from 'tsdown'
import { transform } from 'lightningcss'

const packageId = '@deepseek-ai/dsh-desktop-host'
const clientExternals = new Set([
  'react',
  'react/jsx-runtime',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-primitives',
])
const cssPrefix = '\0desktop-host-css:'
const cssSuffix = '.mjs'

function stylesheetModule(file: string, css: string, classes: Readonly<Record<string, string>>): string {
  const tagId = `${packageId}/${basename(file)}`
  return [
    `const css = ${JSON.stringify(css)};`,
    `const tagId = ${JSON.stringify(tagId)};`,
    'if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {',
    '  const tag = document.createElement("style");',
    `  tag.dataset.plugin = ${JSON.stringify(packageId)};`,
    '  tag.dataset.pluginCss = tagId;',
    '  tag.textContent = css;',
    '  document.head.appendChild(tag);',
    '}',
    `export default ${JSON.stringify(classes)};`,
  ].join('\n')
}

const cssModules = {
  name: 'desktop-host-css-modules',
  enforce: 'pre' as const,
  resolveId(source: string, importer: string | undefined) {
    if (!source.endsWith('.module.css') || importer === undefined) return null
    return `${cssPrefix}${resolve(dirname(importer), source)}${cssSuffix}`
  },
  async load(id: string) {
    if (!id.startsWith(cssPrefix)) return null
    const file = id.slice(cssPrefix.length, -cssSuffix.length)
    this.addWatchFile(file)
    const source = await readFile(file)
    const result = transform({
      filename: file,
      code: source,
      cssModules: { pattern: '[hash]_[local]' },
      minify: true,
    })
    const classes = Object.fromEntries(Object.entries(result.exports ?? {})
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([local, value]) => [local, value.name]))
    return stylesheetModule(file, result.code.toString(), classes)
  },
}

export default defineConfig([
  {
    entry: { index: 'lib/types/index.js' },
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    tsconfig: 'tsconfig.release.json',
    fixedExtension: false,
    dts: false,
    clean: false,
    deps: { neverBundle: ['electron'] },
  },
  {
    entry: { client: 'src/client/index.ts' },
    outDir: 'lib',
    format: ['cjs'],
    platform: 'browser',
    target: 'es2024',
    tsconfig: 'tsconfig.release.json',
    dts: false,
    clean: false,
    deps: {
      neverBundle: specifier => clientExternals.has(specifier),
      alwaysBundle: specifier => !clientExternals.has(specifier),
    },
    plugins: [cssModules],
    experimental: { css: false },
    outputOptions: {
      entryFileNames: 'client.js',
      banner: chunk => `window.__ModuleLoader__.load({ id: ${JSON.stringify(packageId)}, ${chunk.isEntry ? '' : `chunk: ${JSON.stringify(chunk.fileName)}, `}factory: (require) => {`,
      intro: 'var module = { exports: {} }; var exports = module.exports;',
      footer: 'return module.exports; } });',
    },
  },
])

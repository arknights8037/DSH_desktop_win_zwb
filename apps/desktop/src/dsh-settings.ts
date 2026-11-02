/** Desktop-owned DSH preferences and their allowlisted instance fields. */

/** Non-secret preferences delivered to every managed DSH instance. */
export interface DshSettings {
  transcriptView: 'compact' | 'standard' | 'detailed' | 'verbose'
  collapseTiming: 'completion' | 'next-input'
  performanceUsage: 'compact' | 'detailed'
  linkOpening: 'sidebar' | 'new-tab'
  developerToolsEnabled: boolean
  permissionDefaultPreset: string
  defaultPreset: string
  codeFontSize: number
  terminalFontSize: number
  textFontFamily: string
  codeFontFamily: string
  terminalFontFamily: string
  deepseekProtocol: 'messages' | 'chat-completions'
  deepseekBaseURL: string
  deepseekKeyRef: string
  deepseekMaxTokens: number
  reasoningEffort: string
  defaultProvider: string
  defaultModel: string
}

/** Initial software choices match the shipped DSH web composition. */
export const DEFAULT_DSH_SETTINGS: Readonly<DshSettings> = {
  transcriptView: 'detailed', collapseTiming: 'completion', performanceUsage: 'detailed',
  linkOpening: 'sidebar', developerToolsEnabled: true, permissionDefaultPreset: 'workspace-write',
  defaultPreset: 'standard', codeFontSize: 11, terminalFontSize: 13,
  textFontFamily: '', codeFontFamily: '', terminalFontFamily: '',
  deepseekProtocol: 'messages', deepseekBaseURL: 'https://api.deepseek.com/anthropic',
  deepseekKeyRef: 'DEEPSEEK_API_KEY', deepseekMaxTokens: 256_000, reasoningEffort: 'high',
  defaultProvider: '', defaultModel: '',
}

const genericFontFamilies = new Set([
  'serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-serif', 'ui-sans-serif',
  'ui-monospace', 'ui-rounded', 'emoji', 'math', 'fangsong', '-apple-system', 'blinkmacsystemfont',
])

function normalizeFontFamily(value: string): string {
  return value.split(',')
    .map(name => name.replace(/["'\\<>\u0000-\u001f\u007f]/gu, '').replace(/\s+/gu, ' ').trim())
    .filter(name => name !== '')
    .map(name => genericFontFamilies.has(name.toLowerCase()) ? name : `"${name}"`)
    .join(', ')
}

/**
 * Validate a complete non-secret settings document from IPC or disk.
 * @param input - untrusted persisted or renderer preferences.
 * @returns a detached document containing only supported preferences.
 */
export function parseDshSettings(input: unknown): DshSettings {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) throw new Error('Invalid DSH settings')
  const value = input as Record<string, unknown>
  const defaultProvider = value.defaultProvider === undefined ? '' : value.defaultProvider
  const defaultModel = value.defaultModel === undefined ? '' : value.defaultModel
  const field = (key: keyof DshSettings): unknown => value[key] === undefined ? DEFAULT_DSH_SETTINGS[key] : value[key]
  const transcriptView = value.transcriptView === 'normal' || value.transcriptView === 'expanded' ? 'detailed' : field('transcriptView')
  const collapseTiming = field('collapseTiming')
  const performanceUsage = field('performanceUsage')
  const linkOpening = field('linkOpening')
  const developerToolsEnabled = field('developerToolsEnabled')
  const permissionDefaultPreset = field('permissionDefaultPreset')
  const defaultPreset = field('defaultPreset')
  const codeFontSize = field('codeFontSize')
  const terminalFontSize = field('terminalFontSize')
  const textFontFamily = field('textFontFamily')
  const codeFontFamily = field('codeFontFamily')
  const terminalFontFamily = field('terminalFontFamily')
  const legacyFields = new Set(['modeSelectionEnabled'])
  if (Object.keys(value).some(key => !Object.hasOwn(DEFAULT_DSH_SETTINGS, key) && !legacyFields.has(key))
    || typeof transcriptView !== 'string' || !['compact', 'standard', 'detailed', 'verbose'].includes(transcriptView)
    || typeof collapseTiming !== 'string' || !['completion', 'next-input'].includes(collapseTiming)
    || typeof performanceUsage !== 'string' || !['compact', 'detailed'].includes(performanceUsage)
    || typeof linkOpening !== 'string' || !['sidebar', 'new-tab'].includes(linkOpening)
    || typeof developerToolsEnabled !== 'boolean'
    || typeof permissionDefaultPreset !== 'string' || !permissionDefaultPreset.trim() || permissionDefaultPreset.length > 256
    || typeof defaultPreset !== 'string' || !defaultPreset.trim() || defaultPreset.length > 256
    || typeof codeFontSize !== 'number' || !Number.isInteger(codeFontSize) || codeFontSize < 10 || codeFontSize > 16
    || typeof terminalFontSize !== 'number' || !Number.isInteger(terminalFontSize) || terminalFontSize < 10 || terminalFontSize > 20
    || [textFontFamily, codeFontFamily, terminalFontFamily].some(item => typeof item !== 'string' || item.length > 1024)
    || typeof value.deepseekProtocol !== 'string' || !['messages', 'chat-completions'].includes(value.deepseekProtocol)
    || typeof value.deepseekBaseURL !== 'string' || value.deepseekBaseURL.length > 4096
    || typeof value.deepseekKeyRef !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(value.deepseekKeyRef)
    || value.deepseekKeyRef.length > 256 || typeof value.deepseekMaxTokens !== 'number'
    || !Number.isSafeInteger(value.deepseekMaxTokens) || value.deepseekMaxTokens < 1
    || typeof value.reasoningEffort !== 'string' || !value.reasoningEffort.trim() || value.reasoningEffort.length > 256
    || typeof defaultProvider !== 'string' || typeof defaultModel !== 'string'
    || defaultProvider.length > 256 || defaultModel.length > 256
    || Boolean(defaultProvider.trim()) !== Boolean(defaultModel.trim())) {
    throw new Error('Invalid DSH settings')
  }
  const url = new URL(value.deepseekBaseURL)
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('DSH model URL must be HTTP(S) without credentials, query, or fragment')
  }
  return { transcriptView: transcriptView as DshSettings['transcriptView'], collapseTiming: collapseTiming as DshSettings['collapseTiming'],
    performanceUsage: performanceUsage as DshSettings['performanceUsage'], linkOpening: linkOpening as DshSettings['linkOpening'],
    developerToolsEnabled, permissionDefaultPreset: permissionDefaultPreset.trim(), defaultPreset: defaultPreset.trim(),
    codeFontSize, terminalFontSize, textFontFamily: normalizeFontFamily(textFontFamily as string),
    codeFontFamily: normalizeFontFamily(codeFontFamily as string), terminalFontFamily: normalizeFontFamily(terminalFontFamily as string),
    deepseekProtocol: value.deepseekProtocol as DshSettings['deepseekProtocol'],
    deepseekBaseURL: value.deepseekBaseURL, deepseekKeyRef: value.deepseekKeyRef, deepseekMaxTokens: value.deepseekMaxTokens,
    reasoningEffort: value.reasoningEffort.trim(), defaultProvider: defaultProvider.trim(), defaultModel: defaultModel.trim() }
}
